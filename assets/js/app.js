/**
 * app.js —— 页面装配与交互
 *
 * 数据流：输入（毫米）→ 几何计算 → 视图绘制；
 * 编辑：画布里的元素改动 → 写回 state.panels（毫米坐标）→ 撤销栈 + 草稿存储。
 */

import {
  SHAPES,
  SLOT_LABELS,
  EXAMPLE_DIMS,
  createPanels,
  serializeDraft,
  isEditablePanel,
  parseDraft,
  dimKeysFor,
  dimsForShape,
} from './project.js';
import { loadProject, saveProject, compressImage } from './storage.js';
import { computeNet } from './geometry.js';
import { computeIsoShape, tiandiDerived } from './geometry-shapes.js';
import { renderNet } from './net-view.js';
import { renderIso } from './iso-view.js';
import { createEditor } from './editor.js';
import { renderProperties, syncNumberFields } from './properties.js';
import { History } from './history.js';
import { clampElement, createTextElement, createImageElement, createLineElement, deepCopyElement, rotateElement } from './elements.js';
import { validateDim, displayValue, unitSuffix, fmt, fmtLength, withUnit } from './units.js';
import { initAccountUI, currentAccount, isSubscribed, openLogin, openSubscribe, refreshAccount, handleApiError } from './auth-ui.js';
import { exportPdf, imageReport } from './pdf-export.js';
import { summarize, exportFileName, MIN_DPI } from './pdf-plan.js';
import { createTemplatesUI } from './templates-ui.js';
import { computeMetrics, fmt2 } from './metrics.js';

/* 尺寸字段登记表：一个字段 = 一个输入框 + 一条错误提示；不同箱型按 dimKeysFor() 取用 */
const DIM_FIELDS = {
  L: { input: 'dimL', err: 'errL', name: '长 L' },
  W: { input: 'dimW', err: 'errW', name: '宽 W' },
  H: { input: 'dimH', err: 'errH', name: '高 H' },
  Hfront: { input: 'dimHF', err: 'errHF', name: '高 H(前)' },
  Hback: { input: 'dimHB', err: 'errHB', name: '高 H(后)' },
  Wfront: { input: 'dimWF', err: 'errWF', name: '深 W(前)' },
  Wback: { input: 'dimWB', err: 'errWB', name: '深 W(后)' },
};
const ALL_DIM_KEYS = Object.keys(DIM_FIELDS);
const DIM_DEFAULTS = {
  L: 600,
  W: 400,
  H: 300,
  Hfront: 300,
  Hback: 450,
  Wfront: 250,
  Wback: 150,
};
const el = (id) => document.getElementById(id);

const dom = {
  shape: el('shapeSelect'),
  unitToggle: el('unitToggle'),
  inputs: Object.fromEntries(ALL_DIM_KEYS.map((k) => [k, el(DIM_FIELDS[k].input)])),
  errors: Object.fromEntries(ALL_DIM_KEYS.map((k) => [k, el(DIM_FIELDS[k].err)])),
  dimFields: [...document.querySelectorAll('[data-shape-fields]')],
  fieldL: el('fieldL'),
  fieldW: el('fieldW'),
  fieldH: el('fieldH'),
  dimWDerived: el('dimWDerived'),
  dimLBase: el('dimLBase'),
  dimWBase: el('dimWBase'),
  dimHBase: el('dimHBase'),
  notice: el('notice'),
  isoHost: el('isoHost'),
  netHost: el('netHost'),
  isoMeta: el('isoMeta'),
  netMeta: el('netMeta'),
  metricMax: el('metricMax'),
  metricReal: el('metricReal'),
  metricPerim: el('metricPerim'),
  metricNote: el('metricNote'),
  netTitle: el('netTitle'),
  footnote: el('netFootnote'),
  netSize: el('netSize'),
  selInfo: el('selInfo'),
  resetBtn: el('resetBtn'),
  helpBtn: el('helpBtn'),
  helpDialog: el('helpDialog'),
  toast: el('toast'),
  templatesBtn: el('templatesBtn'),
  brandSub: el('brandSub'),
  serviceBanner: el('serviceBanner'),
  mobileHint: el('mobileHint'),
  exportPaper: el('exportPaper'),
  tilePaperField: el('tilePaperField'),
  exportBtn: el('exportBtn'),
  exportDialog: el('exportDialog'),
  exportForm: el('exportForm'),
  exportSummary: el('exportSummary'),
  exportMode: el('exportMode'),
  exportFileName: el('exportFileName'),
  exportWarnings: el('exportWarnings'),
  exportConfirmBtn: el('exportConfirmBtn'),
  exportCancelBtn: el('exportCancelBtn'),
  exportCloseBtn: el('exportCloseBtn'),
  undoBtn: el('undoBtn'),
  redoBtn: el('redoBtn'),

  editorCard: el('editorCard'),
  editorTitle: el('editorTitle'),
  editorSub: el('editorSub'),
  editorCanvas: el('editorCanvas'),
  propsPanel: el('propsPanel'),
  addTextBtn: el('addTextBtn'),
  addImageBtn: el('addImageBtn'),
  addLineBtn: el('addLineBtn'),
  saveTemplateBtn: el('saveTemplateBtn'),
  linePane: el('linePane'),
  lineOrientation: el('lineOrientation'),
  lineThickness: el('lineThickness'),
  lineColor: el('lineColor'),
  copyTarget: el('copyTarget'),
  copyOverwriteBtn: el('copyOverwriteBtn'),
  copyAppendBtn: el('copyAppendBtn'),
  clearPanelBtn: el('clearPanelBtn'),
  closeEditorBtn: el('closeEditorBtn'),

  elementDialog: el('elementDialog'),
  elementForm: el('elementForm'),
  elementTitle: el('elementTitle'),
  elementTabs: el('elementTabs'),
  elementText: el('elementText'),
  elementFontSize: el('elementFontSize'),
  elementAlign: el('elementAlign'),
  elementBold: el('elementBold'),
  elementFile: el('elementFile'),
  imagePreview: el('imagePreview'),
  textPane: el('textPane'),
  imagePane: el('imagePane'),
  elementError: el('elementError'),
  elementSubmitBtn: el('elementSubmitBtn'),
  elementCancelBtn: el('elementCancelBtn'),
  elementCloseBtn: el('elementCloseBtn'),
};

const state = {
  shape: 'rsc',
  unit: 'mm',
  dims: { ...DIM_DEFAULTS },
  // 每个箱型各自一套尺寸：切回来时原样还在，也不会漏到别的箱型里
  dimsByShape: {},
  selected: null,
  selectedElement: null,
  panels: {},
};

const history = new History(60);
let lastNet = null;
let accountReady = false;
let pendingShape = '';
let pendingDims = null; // 深链里带给目标箱型的尺寸，等切过去再应用
let pendingPanel = '';
let netApi = null;
let renderQueued = false;
let toastTimer = 0;
let saveTimer = 0;
let lastStorage = '';
let pendingImage = null;
let exporting = false;

/* ── 编辑器 ─────────────────────────────────────── */

const editor = createEditor({
  host: dom.editorCanvas,
  callbacks: {
    onChange: () => {
      pushHistory();
      persistSoon();
      updateSelectionInfo();
    },
    onSelectionChange: (id) => {
      state.selectedElement = id;
      renderProps();
    },
    onElementMove: (element) => {
      syncNumberFields(dom.propsPanel, element);
    },
    onRequestNew: () => openElementDialog('text'),
  },
});

/* ── 初始化 ─────────────────────────────────────── */

async function init() {
  buildShapeSelect();
  bindEvents();

  const draft = await loadProject();
  if (draft) {
    state.dimsByShape = { ...(draft.dimsByShape || {}) };
    state.dims = { ...DIM_DEFAULTS, ...draft.dims };
    state.unit = draft.unit;
    state.shape = draft.shape;
    applyUnitChrome();
  }
  rememberDims();
  updateShapeChrome();

  // 深链：?shape=lshape&Hfront=350&panel=topLid 之类，便于分享与自测
  // 订阅专属箱型要等 /api/me 回来、确认已订阅后才切（见 onAccountChanged）
  const params = new URLSearchParams(location.search);
  const wantedShape = params.get('shape');
  if (wantedShape && SHAPES.some((s) => s.id === wantedShape && s.enabled)) {
    pendingShape = wantedShape;
  }
  // 深链里的尺寸属于「目标箱型」，不是当前箱型：跟着 pendingShape 一起延后应用，
  // 否则会被记到当前箱型那份里（切箱型后尺寸各存各的）
  const urlDims = {};
  for (const k of ALL_DIM_KEYS) {
    const raw = params.get(k);
    if (raw != null && raw !== '' && Number.isFinite(Number(raw))) urlDims[k] = Number(raw);
  }
  if (pendingShape && Object.keys(urlDims).length) {
    pendingDims = urlDims;
  } else {
    Object.assign(state.dims, urlDims);
  }
  const wantedUnit = params.get('unit');
  if (wantedUnit === 'cm' || wantedUnit === 'in' || wantedUnit === 'mm') {
    state.unit = wantedUnit;
    applyUnitChrome();
  }

  // 面板槽位完全由当前箱型的几何结果生成（不写死 RSC）
  // 尺寸非法时先用兜底值出图，把错误提示留给输入框，不白屏
  state.panels = createPanels(computeNet(safeDims(state.dims), state.shape));
  if (draft) {
    mergeDraftPanels(draft.panels);
    showToast('已恢复上次草稿');
  }

  dom.shape.value = state.shape;
  writeInputsFromState();
  render();
  const badInputs = readInputs();
  if (badInputs.errors.length) showErrors(badInputs.errors);
  if (window.matchMedia && window.matchMedia('(max-width: 720px)').matches) {
    dom.mobileHint.hidden = false;
  }
  history.reset(snapshot());
  updateHistoryButtons();

  // 账号 / 订阅：首屏拉一次 /api/me，失败按游客处理，不挡使用
  bindAccountGate();
  templates = createTemplatesUI({
    onLoad: applyTemplate,
    getTemplateData: buildTemplateData,
    toast: showToast,
    onError: handleApiError,
  });
  initAccountUI({ onChange: onAccountChanged })
    .then((acc) => {
      accountReady = true;
      onAccountChanged(acc);
      // 深链：?templates=1 打开模板列表、?saveTemplate=1 打开命名弹窗（便于分享与自测）
      const q = new URLSearchParams(location.search);
      if (acc.subscribed && q.get('templates') === '1') templates?.open();
      if (acc.subscribed && q.get('saveTemplate') === '1') templates?.openNameDialog();
    })
    .catch(() => {
      accountReady = true;
      onAccountChanged({ user: null, subExpiresAt: null, subscribed: false, backendDown: false });
    });
  // 支持 ?panel=front 这类深链，方便直接打开某一面
  pendingPanel = new URLSearchParams(location.search).get('panel') || '';
  if (pendingPanel && isEditablePanel(lastNet, pendingPanel)) {
    selectPanel(pendingPanel, { scroll: false });
    pendingPanel = '';
  }
}

/** 把草稿内容合并进当前几何生成的面板；几何里没有的 key 直接丢弃 */
function mergeDraftPanels(rawPanels) {
  if (!rawPanels) return;
  for (const [key, value] of Object.entries(rawPanels)) {
    if (!state.panels[key] || !value || !Array.isArray(value.elements)) continue;
    state.panels[key].elements = value.elements;
  }
}

/** 模板门：未登录 → 登录弹层；已登录未订阅 → 订阅层；已订阅 → 我的模板 */
function bindAccountGate() {
  dom.templatesBtn?.addEventListener('click', () => {
    const acc = currentAccount();
    if (!acc.user) {
      openLogin();
      return;
    }
    if (!isSubscribed()) {
      openSubscribe();
      return;
    }
    templates?.open();
  });
}

/* ── 模板（M9） ─────────────────────────────────── */

/** 只把与箱型无关的元素数据存进模板；尺寸/箱型单独存 */
function buildTemplateData() {
  const panels = {};
  for (const [key, panel] of Object.entries(state.panels)) {
    if (!panel || !Array.isArray(panel.elements)) continue;
    panels[key] = { elements: panel.elements };
  }
  return {
    version: 1,
    shape: state.shape,
    unit: state.unit,
    dims: { ...state.dims },
    panels,
  };
}

/** 载入模板：整体替换箱型 / 尺寸 / 所有面的元素；失败返回 false */
function applyTemplate(data, name) {
  const parsed = parseDraft(data);
  if (!parsed) {
    showToast('模板数据无法解析，未做改动');
    return false;
  }
  const shape = SHAPES.find((s) => s.id === parsed.shape);
  if (shape && shape.subscriberOnly && !isSubscribed()) {
    openSubscribe();
    return false;
  }
  state.shape = parsed.shape;
  state.unit = parsed.unit;
  state.dims = { ...DIM_DEFAULTS, ...parsed.dims };
  state.dimsByShape[state.shape] = { ...state.dims };
  state.selected = null;
  state.selectedElement = null;
  state.panels = createPanels(computeNet(safeDims(state.dims), state.shape));
  mergeDraftPanels(parsed.panels);
  dom.shape.value = state.shape;
  applyUnitChrome();
  updateShapeChrome();
  writeInputsFromState();
  render();
  pushHistory();
  persistSoon();
  return true;
}

let templates = null;

/**
 * 顶栏版本标签只给管理员看。
 * 游客 / 普通注册用户根本不渲染这个节点（index.html 里也没有），
 * 所以要等 /api/me 回来知道 isAdmin 之后才插进去，不会有「先出现再消失」的闪动。
 */
const STAGE_LABEL = 'M10 · 天地盖（天盖 + 地盖）';

function renderStageTag(acc) {
  const actions = dom.templatesBtn ? dom.templatesBtn.parentElement : null;
  if (!actions) return;
  const existing = actions.querySelector('#stageTag');
  if (acc && acc.user && acc.user.isAdmin === true) {
    if (existing) return;
    const tag = document.createElement('span');
    tag.id = 'stageTag';
    tag.className = 'tag';
    tag.textContent = STAGE_LABEL;
    actions.insertBefore(tag, dom.templatesBtn);
    return;
  }
  if (existing) existing.remove();
}

/** 顶栏副标题：未登录 / 未订阅时提示可订阅解锁（浅黄底），已订阅恢复原本的说明文字 */
const BRAND_SUB_PROMO = '无需注册/登录也可以使用，注册并订阅可以解锁更多箱形和功能';
const BRAND_SUB_DEFAULT = 'Carton Mark · 纸箱展开图箱唛编辑与 PDF 导出';

function renderBrandSub(acc) {
  const node = dom.brandSub;
  if (!node) return;
  const subscribed = Boolean(acc && acc.subscribed);
  const text = subscribed ? BRAND_SUB_DEFAULT : BRAND_SUB_PROMO;
  if (node.textContent !== text) node.textContent = text;
  node.classList.toggle('is-promo', !subscribed);
}

function onAccountChanged(acc) {
  renderStageTag(acc);
  renderBrandSub(acc);
  if (dom.serviceBanner) dom.serviceBanner.hidden = !acc.backendDown;
  // 模板按钮的状态与悬停提示（未登录/未订阅/可用三种）
  if (dom.templatesBtn) {
    const loggedIn = Boolean(acc.user);
    const locked = !acc.subscribed;
    dom.templatesBtn.classList.toggle('is-disabled', !loggedIn);
    dom.templatesBtn.classList.toggle('is-locked', loggedIn && locked);
    dom.templatesBtn.setAttribute('aria-disabled', String(!loggedIn));
    dom.templatesBtn.title = !loggedIn ? '未登录，不可用' : locked ? '需订阅后可用' : '打开我的模板';
  }
  // 订阅失效 / 退出登录：模板列表里的旧名字一起收掉，别留半截状态
  if (!acc.subscribed && templates) templates.reset('订阅或登录已失效，模板列表已清空。');
  buildShapeSelect();
  // 深链里带的订阅专属箱型，等 /api/me 真正返回后再切（首帧 notify 先跳过）
  if (accountReady && pendingShape) {
    const want = SHAPES.find((s) => s.id === pendingShape);
    if (want && (!want.subscriberOnly || acc.subscribed)) {
      const target = pendingShape;
      pendingShape = '';
      switchShape(target, { silent: true, dims: pendingDims });
      pendingDims = null;
      return;
    }
    pendingShape = '';
  }
  // 只有 /api/me 真正返回之后才按订阅状态回退，避免首帧「未知状态」误把深链箱型切走
  const cur = SHAPES.find((s) => s.id === state.shape);
  if (accountReady && cur?.subscriberOnly && !acc.subscribed) {
    switchShape('rsc', { silent: true });
    showToast('订阅已过期，已切回矩形箱');
  }
}
function buildShapeSelect() {
  dom.shape.replaceChildren();
  for (const s of SHAPES) {
    const opt = document.createElement('option');
    opt.value = s.id;
    const locked = s.subscriberOnly && !isSubscribed();
    // 标签只留箱型名，订阅状态靠下拉是否可点表示
    opt.textContent = s.name;
    opt.disabled = !s.enabled || locked;
    dom.shape.appendChild(opt);
  }
  dom.shape.value = state.shape;
}

/** 按当前箱型显示/隐藏尺寸字段（L 形箱的 W 只读派生，H 也不是它的输入） */
function updateShapeChrome() {
  const show = (node, on) => {
    if (!node) return;
    node.hidden = !on;
    node.style.display = on ? '' : 'none';
  };
  for (const node of dom.dimFields) {
    const list = (node.dataset.shapeFields || '').split(/\s+/);
    show(node, list.includes(state.shape));
  }
  const isTiandi = state.shape === 'tiandi';
  show(dom.fieldW, state.shape !== 'lshape');
  show(dom.fieldH, state.shape === 'rsc' || isTiandi);
  setFieldLabel(dom.fieldL, isTiandi ? '长 L(天)' : '长 L');
  setFieldLabel(dom.fieldW, isTiandi ? '宽 W(天)' : '宽 W');
  setFieldLabel(dom.fieldH, isTiandi ? '高 H(天)' : '高 H');
  updateDerivedW();
}

function setFieldLabel(field, text) {
  if (!field) return;
  const node = field.querySelector('.label');
  if (node && node.textContent !== text) node.textContent = text;
}

/** 换箱型：尺寸各存各的、画布清空、撤销栈重置 */
function switchShape(id, opts = {}) {
  const shape = SHAPES.find((s) => s.id === id) || SHAPES[0];
  if (shape.id !== state.shape) rememberDims(); // 先存下旧箱型的尺寸
  state.shape = shape.id;
  state.dims = { ...dimsForShape(state.dimsByShape, shape.id, DIM_DEFAULTS), ...(opts.dims || {}) };
  document.body.dataset.shape = shape.id;
  state.selected = null;
  state.selectedElement = null;
  // 面板 id 每个箱型都不一样，跨箱型映射只会把内容搬错面，一律清空
  const clearedCount = Object.values(state.panels).reduce(
    (n, p) => n + ((p && Array.isArray(p.elements) && p.elements.length) || 0),
    0,
  );
  state.panels = createPanels(computeNet(safeDims(state.dims), state.shape));
  dom.shape.value = shape.id;
  updateShapeChrome();
  writeInputsFromState();
  const check = readInputs();
  if (check.errors.length) showErrors(check.errors);
  render();
  // 换箱型不写进撤销栈：否则一撤销就把上一个箱型的面板搬回来
  history.reset(snapshot());
  updateHistoryButtons();
  persistSoon();
  // 撤销栈已清空，所以「内容没了」必须说清楚，不能让人以为还在
  if (!opts.silent) {
    if (clearedCount > 0) {
      showToast(`已切换到${shape.name}：上一箱型的 ${clearedCount} 个箱唛元素已清空（这一步不能撤销）`, { ms: 5200, tone: 'warn' });
    } else {
      showToast(`已切换到${shape.name}`, { ms: 1800 });
    }
  }
  // 换箱型后补上 ?panel= 深链（面板 key 只在新箱型里存在）
  if (pendingPanel && isEditablePanel(lastNet, pendingPanel)) {
    const key = pendingPanel;
    pendingPanel = '';
    selectPanel(key, { scroll: false });
  }
}

/** 记下当前箱型的尺寸，切走 / 撤销 / 存草稿时用 */
function rememberDims() {
  state.dimsByShape[state.shape] = { ...state.dims };
}

/* ── 输入与校验 ─────────────────────────────────── */

function writeInputsFromState() {
  const active = new Set(dimKeysFor(state.shape));
  for (const k of ALL_DIM_KEYS) {
    // 不属于当前箱型的输入框直接清空，别留着上一个箱型的数字
    if (!active.has(k)) {
      if (dom.inputs[k]) dom.inputs[k].value = '';
      continue;
    }
    const v = state.dims[k] != null ? state.dims[k] : DIM_DEFAULTS[k];
    dom.inputs[k].value = String(displayValue(v, state.unit));
  }
  for (const k of ALL_DIM_KEYS) dom.errors[k].textContent = '';
  updateDerivedW();
}

function updateDerivedW() {
  if (dom.dimWDerived) {
    const wf = Number(state.dims.Wfront) || 0;
    const wb = Number(state.dims.Wback) || 0;
    const sum = wf + wb;
    dom.dimWDerived.textContent = sum > 0 ? String(displayValue(sum, state.unit)) : '—';
  }
  // 天地盖：地盖三个尺寸由天盖派生（长宽各 −20mm、高 −10mm）
  if (dom.dimLBase) {
    const { lid, base } = tiandiDerived(safeDims(state.dims));
    const pair = [
      [dom.dimLBase, base.L],
      [dom.dimWBase, base.W],
      [dom.dimHBase, base.H],
    ];
    for (const [node, mm] of pair) {
      if (node) node.textContent = String(displayValue(mm, state.unit));
    }
    const title = `天盖 ${displayValue(lid.L, state.unit)} × ${displayValue(lid.W, state.unit)} × ${displayValue(lid.H, state.unit)} → 长宽各 −20、高 −10`;
    const host = dom.dimLBase.closest('[data-shape-fields="tiandi"]');
    if (host) host.title = title;
  }
}

function readInputs() {
  const dims = {};
  const errors = [];
  const warns = [];

  for (const k of dimKeysFor(state.shape)) {
    const r = validateDim(dom.inputs[k].value, state.unit, DIM_FIELDS[k].name);
    if (!r.ok) {
      errors.push({ key: k, msg: r.error });
    } else {
      dims[k] = Math.round(r.mm * 10) / 10;
      if (r.warn) warns.push(r.warn);
    }
  }
  // 没在当前箱型里的字段也留着上一次的值，切回时不用重输
  for (const k of ALL_DIM_KEYS) if (dims[k] == null) dims[k] = state.dims[k] ?? DIM_DEFAULTS[k];

  if (!errors.length && state.shape !== 'rsc' && state.shape !== 'tiandi' && dims.Hfront === dims.Hback) {
    errors.push({ key: 'Hback', msg: 'H(前) 与 H(后) 相等就不是斜形/台阶形状了，请输入不同高度' });
  }
  return { dims: errors.length ? null : dims, errors, warns };
}

function showErrors(errors) {
  for (const k of ALL_DIM_KEYS) {
    dom.errors[k].textContent = '';
    dom.inputs[k].classList.remove('is-error');
  }
  for (const e of errors) {
    if (!dom.errors[e.key]) continue;
    dom.errors[e.key].textContent = e.msg;
    dom.inputs[e.key].classList.add('is-error');
  }
}

function showNotice(warns) {
  if (!warns || !warns.length) {
    dom.notice.hidden = true;
    dom.notice.textContent = '';
    dom.notice.classList.remove('is-error');
    return;
  }
  dom.notice.hidden = false;
  dom.notice.classList.remove('is-error');
  dom.notice.textContent = warns.join('；');
}

function showErrorNotice(msg) {
  dom.notice.hidden = false;
  dom.notice.classList.add('is-error');
  dom.notice.textContent = msg;
}

function onInputChanged() {
  const { dims, errors, warns } = readInputs();
  showErrors(errors);

  if (!dims) {
    showErrorNotice('尺寸无效，图纸保留上一次有效结果');
    return;
  }

  showNotice(warns);
  state.dims = dims;
  rememberDims();
  updateDerivedW();
  render();
  pushHistory({ coalesceKey: 'dims' });
  persistSoon();
}

/* ── 单位 ───────────────────────────────────────── */

function applyUnitChrome() {
  const suffix = unitSuffix(state.unit);
  document.querySelectorAll('[data-unit-suffix]').forEach((n) => {
    n.textContent = suffix;
  });
  dom.unitToggle.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.unit === state.unit;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  for (const k of ALL_DIM_KEYS) dom.inputs[k].step = state.unit === 'mm' ? '1' : '0.1';
}

function switchUnit(unit) {
  if (unit === state.unit) return;
  state.unit = unit;
  applyUnitChrome();
  // 只把毫米值按新单位显示，绝不把显示值读回状态：
  // 英寸显示是 23.62（截断），读回会变成 599.9 mm，再切厘米就成了 59.99（用户 2026-11-01 报的问题）
  writeInputsFromState();
  render();
  persistSoon();
}

/* ── 绘制 ───────────────────────────────────────── */

/* 尺寸非法时用兜底值出图（错误提示走输入框，图纸不消失、页面不白） */
function safeDims(dims) {
  const out = { ...dims };
  for (const k of ALL_DIM_KEYS) {
    if (!(Number(out[k]) > 0)) out[k] = DIM_DEFAULTS[k];
  }
  if (state.shape !== 'rsc' && state.shape !== 'tiandi' && Number(out.Hfront) === Number(out.Hback)) {
    out.Hback = Number(out.Hfront) + 150;
  }
  return out;
}

/**
 * 把一个容器拆成若干「标题 + 画布」的竖排槽位（天地盖的两张图用），返回 id → 画布元素
 * @param {HTMLElement} host
 * @param {Array<{id:string,title:string}>} items
 * @param {'net'|'iso'} kind
 */
function buildPieceSlots(host, items, kind) {
  host.replaceChildren();
  const canvases = {};
  for (const item of items) {
    const box = document.createElement('div');
    box.className = 'piece-slot';
    if (item.title) {
      const head = document.createElement('div');
      head.className = 'piece-title';
      head.textContent = item.title;
      box.appendChild(head);
    }
    const canvas = document.createElement('div');
    canvas.className = kind === 'net' ? 'canvas canvas--net' : 'canvas';
    box.appendChild(canvas);
    host.appendChild(box);
    canvases[item.id] = canvas;
  }
  return canvases;
}

function render() {
  const dims = safeDims(state.dims);
  const isTiandi = state.shape === 'tiandi';
  lastNet = computeNet(dims, state.shape);
  clampAllElements();

  const u = state.unit;
  if (isTiandi) {
    // 天地盖：天盖、地盖两张展开图上下排，各自独立缩放（总宽不同，不强行对齐比例）
    const pieces = lastNet.pieces;
    const netSlots = buildPieceSlots(
      dom.netHost,
      pieces.map((p) => ({ id: p.id, title: `${p.label} 展开 ${withUnit(p.net.width, u)} × ${withUnit(p.net.height, u)}` })),
      'net',
    );
    const apis = pieces.map((p) =>
      renderNet(netSlots[p.id], p.net, {
        selected: state.selected,
        onSelect: selectPanel,
        unit: state.unit,
      }),
    );
    netApi = {
      select(key) {
        for (const api of apis) api.select(key);
      },
    };
  } else {
    netApi = renderNet(dom.netHost, lastNet, {
      selected: state.selected,
      onSelect: selectPanel,
      unit: state.unit,
    });
  }
  if (state.selected) netApi.select(state.selected);

  if (isTiandi) {
    // 等轴测区：天盖、地盖上下排，各带小标题；尺寸标注带上(天)/(地)
    const slots = buildPieceSlots(
      dom.isoHost,
      [
        { id: 'lid', title: '天盖' },
        { id: 'base', title: '地盖' },
      ],
      'iso',
    );
    for (const piece of lastNet.pieces) {
      const pd = piece.net.dims;
      const suffix = piece.id === 'base' ? '(地)' : '(天)';
      renderIso(slots[piece.id], { L: pd.L, W: pd.W, H: pd.H }, {
        unit: state.unit,
        dimLabels: { L: `L${suffix}`, W: `W${suffix}`, H: `H${suffix}` },
      });
    }
    dom.isoHost.dataset.isoError = '';
  } else if (state.shape === 'rsc') {
    dom.isoHost.replaceChildren();
    renderIso(dom.isoHost, dims, { unit: state.unit });
  } else {
    try {
      dom.isoHost.replaceChildren();
      renderIso(dom.isoHost, computeIsoShape(dims, state.shape), { unit: state.unit });
      dom.isoHost.dataset.isoError = '';
    } catch (err) {
      console.error('iso failed', err);
      dom.isoHost.dataset.isoError = String((err && err.message) || err);
      dom.isoHost.replaceChildren();
    }
  }

  const { L, W } = dims;
  const hasFront = state.shape === 'bevel' || state.shape === 'lshape';
  const geoDims = lastNet.dims;
  // 图上所有标注都按当前单位显示，内部仍是毫米
  const isoDims = isTiandi
    ? lastNet.pieces
        .map((p) => {
          const d = p.net.dims;
          return `${p.label} ${fmtLength(d.L, u)} × ${fmtLength(d.W, u)} × ${fmtLength(d.H, u)}`;
        })
        .join(' · ') + ` ${unitSuffix(u)}`
    : hasFront
      ? `${fmtLength(geoDims.L, u)} × ${fmtLength(geoDims.W, u)} × ${fmtLength(geoDims.Hfront, u)}/${fmtLength(geoDims.Hback, u)} ${unitSuffix(u)}`
      : `${fmtLength(L, u)} × ${fmtLength(W, u)} × ${fmtLength(dims.H, u)} ${unitSuffix(u)}`;
  dom.isoMeta.textContent = isoDims;

  // 轮廓图下方：体积与周长（单位固定 CBM / 英寸，不跟顶部单位切换走）
  const metrics = computeMetrics(dims, state.shape);
  if (dom.metricMax) dom.metricMax.textContent = fmt2(metrics.maxCbm);
  if (dom.metricReal) dom.metricReal.textContent = fmt2(metrics.realCbm);
  if (dom.metricPerim) dom.metricPerim.textContent = metrics.perimeterIn == null ? '—' : String(metrics.perimeterIn);
  if (dom.metricNote) dom.metricNote.hidden = !isTiandi;
  dom.netMeta.textContent = isTiandi
    ? '两张图各自按容器宽度等比缩放'
    : `按容器宽度等比缩放 · 实际 ${withUnit(lastNet.width, u)} × ${withUnit(lastNet.height, u)}`;
  const lidText = lastNet.lid
    ? lastNet.lid.kind === 'split'
      ? `顶摇盖 ${fmtLength(geoDims.L, u)} × ${fmtLength(lastNet.lid.length, u)}（两片各 ${fmtLength(lastNet.lid.piece, u)}）`
      : `顶盖 ${fmtLength(geoDims.L, u)} × ${fmtLength(lastNet.lid.length, u)}（一整片）`
    : '';
  dom.netSize.textContent =
    `展开 ${withUnit(lastNet.width, u)} × ${withUnit(lastNet.height, u)} · ` +
    (isTiandi
      ? lastNet.pieces
          .map((p) => `${p.label} ${fmtLength(p.net.dims.L, u)} × ${fmtLength(p.net.dims.W, u)} · 翻边高 ${fmtLength(p.net.dims.H, u)}`)
          .join(' · ')
      : hasFront
        ? `箱身 ${fmtLength(geoDims.L, u)} × ${fmtLength(geoDims.W, u)} · 高 ${fmtLength(geoDims.Hfront, u)}/${fmtLength(geoDims.Hback, u)} · ${lidText}`
        : `箱身 ${fmtLength(L, u)}/${fmtLength(W, u)} × ${fmtLength(dims.H, u)} · ` +
          `主摇盖 ${fmtLength(L, u)} × ${fmtLength(lastNet.flap, u)} · 防尘摇盖 ${fmtLength(W, u)} × ${fmtLength(lastNet.flap, u)}（不印）`);

  const panelCount = Object.keys(lastNet.panels).length;
  const editableCount = Object.values(lastNet.panels).filter((p) => p.editable).length;
  if (dom.netTitle) {
    dom.netTitle.textContent = isTiandi
      ? `展开图 · 天盖 + 地盖 · ${editableCount} 个可编辑面`
      : `展开图 · ${panelCount} 个区域 / ${editableCount} 个可编辑面`;
  }
  if (dom.footnote) {
    dom.footnote.textContent =
      state.shape === 'bevel'
        ? '虚线为折叠线，实线为裁切线。顶部是两片对开摇盖（前后各一片，每片 600 宽、深 = 斜面实长 √(W²+ΔH²) 的一半，两片合计 = 斜长）；底面 2 片主摇盖加 2 片侧面防尘摇盖（仅结构件，不印箱唛）；内部一律按真实毫米计算。'
        : state.shape === 'lshape'
          ? '虚线为折叠线，实线为裁切线。顶部是从前面板翻过去的一整片单摇盖（深度 = W前 + |ΔH| + W后，片内两条折线画虚线）；底面 2 片主摇盖加 2 片侧面防尘摇盖（仅结构件，不印箱唛）；内部一律按真实毫米计算。'
          : state.shape === 'tiandi'
            ? '天地盖是两件套，各印一张：天盖顶面 + 四条翻边共 5 个可编辑面，地盖只印底面 1 个可编辑面（地盖四条翻边只画轮廓，不印箱唛）。地盖尺寸自动派生：长、宽各比天盖小 20mm，高小 10mm。虚线为折叠线，实线为裁切线，内部一律按真实毫米计算。'
            : '虚线为折叠线，实线为裁切线。展开图 = (2L + 2W) × (H + W)：4 个箱身面（L×H / W×H 交替）+ 4 片主摇盖（L × W/2，前/后对开拼成顶面）+ 4 片防尘摇盖（W × W/2，仅结构件，不印箱唛）；摇盖深 = W ÷ 2，内部一律按真实毫米计算。';
  }

  updateSelectionInfo();
  syncEditor();
}

function clampAllElements() {
  if (!lastNet) return;
  for (const [key, geo] of Object.entries(lastNet.panels)) {
    if (!state.panels[key]) continue;
    for (const element of state.panels[key].elements) clampElement(element, geo.w, geo.h);
  }
}

function syncEditor() {
  if (!state.selected) {
    dom.editorCard.hidden = true;
    editor.destroy();
    return;
  }
  const geo = lastNet.panels[state.selected];
  const meta = geo;
  dom.editorCard.hidden = false;
  dom.editorTitle.textContent = meta.label;
  dom.editorSub.textContent = `${meta.slotLabel || SLOT_LABELS[meta.slot]} · ${fmt(geo.w)} × ${fmt(geo.h)} mm`;
  fillCopyTargets();
  editor.setPanel(state.selected, geo, state.panels[state.selected].elements);
  renderProps();
}

function fillCopyTargets() {
  const options = Object.entries(lastNet.panels)
    .filter(([key, p]) => p.editable && key !== state.selected)
    .map(([key, p]) => ({ key, label: p.label }));
  dom.copyTarget.replaceChildren(
    ...options.map((p) => {
      const opt = document.createElement('option');
      opt.value = p.key;
      opt.textContent = p.label;
      return opt;
    }),
  );
}

function renderProps() {
  if (!state.selected) return;
  const meta = lastNet.panels[state.selected];
  renderProperties(dom.propsPanel, {
    panelKey: state.selected,
    panelMeta: meta,
    geo: lastNet.panels[state.selected],
    elements: state.panels[state.selected].elements,
    selectedId: state.selectedElement,
    callbacks: {
      select: (id) => editor.select(id),
      patch: patchElement,
      remove: removeElement,
      replaceImage,
      addText: () => openElementDialog('text'),
      addImage: () => openElementDialog('image'),
      addLine: () => openElementDialog('line'),
      setLineOrientation,
      rotate: rotateElementById,
      clear: clearPanel,
    },
  });
}

function selectPanel(key, { scroll = true } = {}) {
  // 防尘摇盖只画轮廓，点不动
  if (!isEditablePanel(lastNet, key)) return;
  state.selected = key;
  state.selectedElement = null;
  netApi?.select(key);
  updateSelectionInfo();
  syncEditor();
  if (scroll) dom.editorCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeEditor() {
  state.selected = null;
  state.selectedElement = null;
  netApi?.select(null);
  dom.editorCard.hidden = true;
  editor.destroy();
  updateSelectionInfo();
}

function updateSelectionInfo() {
  if (!state.selected || !lastNet) {
    dom.selInfo.textContent = '未选择面板';
    dom.selInfo.classList.remove('is-active');
    return;
  }
  const p = lastNet.panels[state.selected];
  const meta = p;
  const count = state.panels[state.selected].elements.length;
  dom.selInfo.textContent = `正在编辑：${meta.label}（${p.slotLabel || SLOT_LABELS[p.kind]}）· ${fmt(p.w)} × ${fmt(p.h)} mm · ${count} 个元素`;
  dom.selInfo.classList.add('is-active');
}

/* ── 元素编辑 ───────────────────────────────────── */

function currentElements() {
  return state.selected ? state.panels[state.selected].elements : [];
}

function patchElement(id, values, coalesceKey = '') {
  const element = currentElements().find((e) => e.id === id);
  if (!element || !state.selected) return;
  Object.assign(element, values);
  const geo = lastNet.panels[state.selected];
  if ('x' in values || 'y' in values || 'w' in values || 'h' in values) {
    clampElement(element, geo.w, geo.h);
  }
  editor.render();
  pushHistory({ coalesceKey });
  persistSoon();
}

/** 旋转 90°：dir = 1 顺时针、-1 逆时针（以元素中心为轴，W/H 互换后夹回面板） */
function rotateElementById(id, dir) {
  const element = currentElements().find((e) => e.id === id);
  if (!element || !state.selected) return;
  const geo = lastNet.panels[state.selected];
  rotateElement(element, dir, geo.w, geo.h);
  editor.render();
  renderProps();
  pushHistory();
  persistSoon();
  updateSelectionInfo();
}

function removeElement(id) {
  const list = currentElements();
  const index = list.findIndex((e) => e.id === id);
  if (index < 0) return;
  list.splice(index, 1);
  state.selectedElement = null;
  editor.setElements(list);
  renderProps();
  pushHistory();
  persistSoon();
  updateSelectionInfo();
}

/** 横线/竖线切换：保持中心点，长度和粗细互换方向 */
function setLineOrientation(id, orientation) {
  if (!state.selected || !lastNet) return;
  const element = currentElements().find((e) => e.id === id);
  if (!element || element.type !== 'line') return;
  const geo = lastNet.panels[state.selected];
  const cx = element.x + element.w / 2;
  const cy = element.y + element.h / 2;
  const length = Math.max(element.w, element.h);
  const thickness = Math.max(0.5, Math.min(element.w, element.h));
  const vertical = orientation === 'vertical';

  element.orientation = vertical ? 'vertical' : 'horizontal';
  element.w = vertical ? thickness : length;
  element.h = vertical ? length : thickness;
  element.x = Math.min(Math.max(cx - element.w / 2, 0), Math.max(0, geo.w - element.w));
  element.y = Math.min(Math.max(cy - element.h / 2, 0), Math.max(0, geo.h - element.h));

  editor.render();
  renderProps();
  pushHistory();
  persistSoon();
}

async function replaceImage(id, file) {
  const element = currentElements().find((e) => e.id === id);
  if (!element || !state.selected) return;
  try {
    const res = await compressImage(file);
    element.src = res.dataUrl;
    const ratio = res.width / res.height || 1;
    element.h = Math.min(element.h, lastNet.panels[state.selected].h);
    element.w = element.h * ratio;
    if (element.w > lastNet.panels[state.selected].w) {
      element.w = lastNet.panels[state.selected].w;
      element.h = element.w / ratio;
    }
    clampElement(element, lastNet.panels[state.selected].w, lastNet.panels[state.selected].h);
    editor.render();
    renderProps();
    pushHistory();
    persistSoon();
    showToast('图片已替换');
  } catch (err) {
    showToast(err.message);
  }
}

function addElement(element) {
  if (!state.selected) return;
  const list = currentElements();
  list.push(element);
  editor.setElements(list);
  editor.select(element.id);
  pushHistory();
  persistSoon();
  updateSelectionInfo();
}

function clearPanel() {
  if (!state.selected) return;
  const list = currentElements();
  if (!list.length) {
    showToast('这一面本来就是空的');
    return;
  }
  list.splice(0, list.length);
  state.selectedElement = null;
  editor.setElements(list);
  renderProps();
  pushHistory();
  persistSoon();
  updateSelectionInfo();
  showToast('已清空本面内容');
}

/* ── 复制到另一面 ───────────────────────────────── */

function copyPanelTo(mode) {
  if (!state.selected) return;
  const target = dom.copyTarget.value;
  if (!target || target === state.selected) {
    showToast('请选择一个不同的目标面');
    return;
  }
  const source = state.panels[state.selected].elements;
  if (!source.length) {
    showToast('当前面没有内容可复制');
    return;
  }
  const copies = source.map(deepCopyElement);
  if (mode === 'overwrite') state.panels[target].elements = copies;
  else state.panels[target].elements = state.panels[target].elements.concat(copies);

  pushHistory();
  persistSoon();
  showToast(
    `已${mode === 'overwrite' ? '覆盖' : '追加'} ${copies.length} 个元素到「${lastNet.panels[target].label}」`,
  );
}

/* ── 新建元素弹层 ───────────────────────────────── */

function setDialogTab(tab) {
  const type = tab === 'image' ? 'image' : tab === 'line' ? 'line' : 'text';
  dom.elementDialog.dataset.type = type;
  dom.elementTitle.textContent = type === 'image' ? '新建图片' : type === 'line' ? '新建线条' : '新建文字';
  dom.textPane.hidden = type !== 'text';
  dom.imagePane.hidden = type !== 'image';
  dom.linePane.hidden = type !== 'line';
  dom.elementTabs.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.tab === type;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', String(on));
  });
  dom.elementError.textContent = '';
}

function openElementDialog(tab = 'text') {
  if (!state.selected) return;
  setDialogTab(tab);
  dom.elementText.value = '';
  dom.elementFontSize.value = '20';
  dom.elementBold.checked = false;
  dom.elementAlign.value = 'left';
  dom.lineOrientation.value = 'horizontal';
  dom.lineThickness.value = '10';
  dom.lineColor.value = '#000000';
  dom.elementFile.value = '';
  dom.imagePreview.replaceChildren();
  pendingImage = null;
  dom.elementSubmitBtn.disabled = false;

  if (typeof dom.elementDialog.showModal === 'function') dom.elementDialog.showModal();
  else dom.elementDialog.setAttribute('open', '');
  if (tab !== 'image') dom.elementText.focus();
}

function closeElementDialog() {
  if (typeof dom.elementDialog.close === 'function') dom.elementDialog.close();
  else dom.elementDialog.removeAttribute('open');
}

function submitElementDialog(ev) {
  ev.preventDefault();
  if (!state.selected || !lastNet) {
    closeElementDialog();
    return;
  }
  const type = ['image', 'line'].includes(dom.elementDialog.dataset.type)
    ? dom.elementDialog.dataset.type
    : 'text';
  const geo = lastNet.panels[state.selected];

  if (type === 'text') {
    const text = dom.elementText.value.trim();
    if (!text) {
      dom.elementError.textContent = '请先输入文字内容';
      dom.elementText.focus();
      return;
    }
    const fontSize = Number(dom.elementFontSize.value);
    if (!Number.isFinite(fontSize) || fontSize < 3 || fontSize > 300) {
      dom.elementError.textContent = '字号需在 3–300 mm 之间';
      dom.elementFontSize.focus();
      return;
    }
    addElement(
      createTextElement(geo.w, geo.h, {
        text,
        fontSize,
        bold: dom.elementBold.checked,
        align: dom.elementAlign.value,
      }),
    );
  } else if (type === 'line') {
    const thickness = Number(dom.lineThickness.value);
    if (!Number.isFinite(thickness) || thickness < 0.5 || thickness > 50) {
      dom.elementError.textContent = '粗细需在 0.5–50 mm 之间';
      dom.lineThickness.focus();
      return;
    }
    addElement(
      createLineElement(geo.w, geo.h, {
        orientation: dom.lineOrientation.value,
        thickness,
        color: dom.lineColor.value,
      }),
    );
  } else {
    if (!pendingImage) {
      dom.elementError.textContent = '请先选择一张图片';
      return;
    }
    addElement(
      createImageElement(geo.w, geo.h, {
        src: pendingImage.dataUrl,
        width: pendingImage.width,
        height: pendingImage.height,
      }),
    );
  }
  closeElementDialog();
}

async function onImageFileChanged() {
  const file = dom.elementFile.files && dom.elementFile.files[0];
  if (!file) return;
  dom.elementError.textContent = '';
  dom.elementSubmitBtn.disabled = true;
  try {
    const res = await compressImage(file);
    pendingImage = res;
    const img = document.createElement('img');
    img.src = res.dataUrl;
    img.alt = '图片预览';
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${res.width} × ${res.height} px · 约 ${Math.round(res.bytes / 1024)} KB`;
    dom.imagePreview.replaceChildren(img, meta);
  } catch (err) {
    pendingImage = null;
    dom.imagePreview.replaceChildren();
    dom.elementError.textContent = err.message;
  } finally {
    dom.elementSubmitBtn.disabled = false;
  }
}

/* ── 撤销 / 重做 ────────────────────────────────── */

function snapshot() {
  return JSON.stringify({ dims: state.dims, panels: state.panels });
}

function pushHistory({ coalesceKey = '' } = {}) {
  history.push(snapshot(), { coalesceKey });
  updateHistoryButtons();
}

function restore(snap) {
  const data = JSON.parse(snap);
  state.dims = data.dims;
  state.panels = data.panels;
  rememberDims();
  writeInputsFromState();
  render();
  updateHistoryButtons();
  persistSoon();
}

function undo() {
  const snap = history.undo();
  if (snap) {
    restore(snap);
    showToast('已撤销');
  }
}

function redo() {
  const snap = history.redo();
  if (snap) {
    restore(snap);
    showToast('已重做');
  }
}

function updateHistoryButtons() {
  dom.undoBtn.disabled = !history.canUndo();
  dom.redoBtn.disabled = !history.canRedo();
}

/* ── 草稿保存 ───────────────────────────────────── */

function persistSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 350);
}

async function persistNow() {
  const payload = serializeDraft({
    dims: state.dims,
    dimsByShape: state.dimsByShape,
    unit: state.unit,
    shape: state.shape,
    panels: state.panels,
  });
  const where = await saveProject(payload);
  if (where === 'none') {
    showToast('图片太大，草稿没能保存（关掉页面会丢）');
  }
  lastStorage = where;
}

/* ── 导出 PDF ───────────────────────────────────── */

/** 天地盖要出两页：天盖一套、地盖一套，各用自己的展开图；其他箱型只有一张 */
function exportSheets() {
  if (state.shape !== 'tiandi' || !lastNet || !lastNet.nets) return null;
  const subset = (net) => {
    const out = {};
    for (const key of Object.keys(net.panels)) if (state.panels[key]) out[key] = state.panels[key];
    return out;
  };
  return [
    { net: lastNet.nets.lid, panels: subset(lastNet.nets.lid), label: '天盖' },
    { net: lastNet.nets.base, panels: subset(lastNet.nets.base), label: '地盖' },
  ];
}

/** 文件名里的形状标签：天地盖带上两个高度（cartonmark_tiandi_600x400_300-290_日期.pdf） */
function fileNameTag() {
  if (state.shape !== 'tiandi') return '';
  const { lid, base } = tiandiDerived(safeDims(state.dims));
  return `tiandi_${Math.round(lid.L)}x${Math.round(lid.W)}_${Math.round(lid.H)}-${Math.round(base.H)}`;
}

async function openExportDialog() {
  if (!lastNet) return;
  dom.exportFileName.value = exportFileName(state.dims, new Date(), fileNameTag());
  await refreshExportSummary();
  if (typeof dom.exportDialog.showModal === 'function') dom.exportDialog.showModal();
  else dom.exportDialog.setAttribute('open', '');
}

async function refreshExportSummary() {
  if (!lastNet) return;
  const mode = dom.exportMode.value === 'panel' ? 'panel' : dom.exportMode.value === 'tile' ? 'tile' : 'sheet';
  const tilePaper = dom.exportPaper.value === 'a4' ? 'a4' : 'a3';
  dom.tilePaperField.hidden = mode !== 'tile';

  // 两件套每件各算一套，页数和尺寸分别列出来
  const sheets = exportSheets();
  const units = sheets
    ? sheets.map((s) => ({ label: s.label, net: s.net, panels: s.panels }))
    : [{ label: '', net: lastNet, panels: state.panels }];
  const statsList = units.map((u) => ({
    ...u,
    stats: summarize({ net: u.net, panels: u.panels, mode, tilePaper }),
  }));
  const totalElements = statsList.reduce((n, u) => n + u.stats.elementCount, 0);
  const totalPanels = statsList.reduce((n, u) => n + u.stats.usedPanels, 0);
  const totalImages = statsList.reduce((n, u) => n + u.stats.imageCount, 0);
  const totalPages = statsList.reduce((n, u) => n + (u.stats.pages || 1), 0);

  const sizeText = statsList
    .map((u) => {
      const p = u.stats.pageSize;
      const tag = u.label ? `${u.label} ` : '';
      return `${tag}<b>${fmt(p.width)} × ${fmt(p.height)} mm</b>`;
    })
    .join(' · ');

  dom.exportSummary.innerHTML =
    `页面尺寸：${sizeText}（1:1${statsList.some((u) => u.stats.pageSize.scaled) ? '，已缩放' : ''}）<br>` +
    `包含内容：<b>${totalPanels}</b> 个面 · <b>${totalElements}</b> 个元素（${totalImages} 张图片）<br>` +
    `页数：<b>${totalPages}</b> 页` +
    (mode === 'tile'
      ? `<br>拼版：${statsList
          .map((u) => `<b>${u.label ? u.label + ' ' : ''}${u.stats.tilePlan.cols} 列 × ${u.stats.tilePlan.rows} 行 = ${u.stats.tilePlan.tiles.length} 块</b>`)
          .join(' + ')}（1:1，不缩放，天/地盖分开编号）`
      : '');

  dom.exportWarnings.replaceChildren();
  const warn = (text, cls = '') => {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = text;
    dom.exportWarnings.appendChild(div);
  };

  if (totalElements === 0) {
    warn('还没有任何箱唛内容，先加文字或图片再导出。', 'is-error');
  }
  if (sheets) {
    warn('天地盖会出两页：第 1 页天盖、第 2 页地盖，各自 1:1；某一页没放内容也会照样出页，打印店按页数对位。');
  }
  for (const u of statsList) {
    if (!u.stats.tilePlan) continue;
    warn(`${u.label ? u.label + '：' : ''}拼版共 ${u.stats.tilePlan.tiles.length} 块，每块边角有裁切标记，块上标了件名、块号和「接边」方向；拼接后即为 1:1 整图。`);
  }
  for (const u of statsList) {
    const page = u.stats.pageSize;
    if (!page.scaled) continue;
    warn(`${u.label ? u.label + '：' : ''}展开图 ${fmt(u.net.width)} × ${fmt(u.net.height)} mm 超过 PDF 单页上限 ${page.limit} mm，已等比缩到 ${(page.scale * 100).toFixed(1)}%，打印时需按同比例放大。`);
  }
  if (totalImages) {
    for (const u of statsList) {
      const rows = await imageReport(u.net, u.panels);
      for (const row of rows) {
        if (row.error) warn('有一张图片解码失败，导出时会跳过。', 'is-error');
        else if (row.dpi < MIN_DPI) {
          warn(`${u.label ? u.label + ' · ' : ''}${row.panelLabel} 的图片打印尺寸 ${Math.round(row.width)} × ${Math.round(row.height)} mm，有效约 ${Math.round(row.dpi)} dpi（低于 ${MIN_DPI} dpi，印刷可能发虚）。`);
        }
      }
    }
  }

  dom.exportConfirmBtn.disabled = totalElements === 0;
}

async function submitExport(ev) {
  ev.preventDefault();
  if (exporting || !lastNet) return;
  exporting = true;
  const btn = dom.exportConfirmBtn;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '生成中…';

  try {
    const res = await exportPdf({
      net: lastNet,
      panels: state.panels,
      dims: state.dims,
      sheets: exportSheets(),
      mode: dom.exportMode.value === 'panel' ? 'panel' : dom.exportMode.value === 'tile' ? 'tile' : 'sheet',
      tilePaper: dom.exportPaper.value === 'a4' ? 'a4' : 'a3',
      fileName: dom.exportFileName.value.trim() || undefined,
      download: true,
    });
    dom.exportDialog.close();
    const sizes = (res.pageSizes || [])
      .map((p) => `${p.label ? p.label + ' ' : ''}${Math.round(p.width)} × ${Math.round(p.height)} mm`)
      .join(' · ');
    showToast(`PDF 已生成：${res.pageCount} 页 · ${sizes || `${Math.round(res.pageSize.width)} × ${Math.round(res.pageSize.height)} mm`}`);
  } catch (err) {
    dom.exportWarnings.replaceChildren();
    const div = document.createElement('div');
    div.className = 'is-error';
    div.textContent = err.message || '导出失败';
    dom.exportWarnings.appendChild(div);
  } finally {
    exporting = false;
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function exportForTest(opts = {}) {
  return exportPdf({
    net: lastNet,
    panels: state.panels,
    dims: state.dims,
    download: false,
    ...opts,
  });
}

/* ── 事件绑定 ───────────────────────────────────── */

function bindEvents() {
  for (const k of ALL_DIM_KEYS) {
    dom.inputs[k].addEventListener('input', onInputChanged);
    dom.inputs[k].addEventListener('blur', onInputChanged);
  }

  dom.unitToggle.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-unit]');
    if (btn) switchUnit(btn.dataset.unit);
  });

  dom.resetBtn.addEventListener('click', () => {
    // 重置 = 尺寸回到当前箱型示例 + 清空所有箱唛内容（用户 2026-11-01 要求）
    state.dims = { ...DIM_DEFAULTS };
    rememberDims();
    for (const panel of Object.values(state.panels)) {
      if (panel && Array.isArray(panel.elements)) panel.elements = [];
    }
    state.selectedElement = null;
    closeEditor();
    writeInputsFromState();
    showNotice([]);
    render();
    pushHistory();
    persistSoon();
    showToast('已清空箱唛内容，尺寸恢复为示例');
  });

  dom.helpBtn.addEventListener('click', () => {
    if (typeof dom.helpDialog.showModal === 'function') dom.helpDialog.showModal();
    else dom.helpDialog.setAttribute('open', '');
  });
  dom.helpDialog.addEventListener('click', (ev) => {
    if (ev.target === dom.helpDialog) dom.helpDialog.close?.();
  });

  dom.shape.addEventListener('change', () => {
    const chosen = SHAPES.find((s) => s.id === dom.shape.value);
    if (!chosen || !chosen.enabled) {
      dom.shape.value = state.shape;
      return;
    }
    if (chosen.subscriberOnly && !isSubscribed()) {
      dom.shape.value = state.shape;
      openSubscribe();
      return;
    }
    switchShape(chosen.id);
  });

  dom.undoBtn.addEventListener('click', undo);
  dom.redoBtn.addEventListener('click', redo);

  dom.exportBtn.addEventListener('click', openExportDialog);
  dom.exportMode.addEventListener('change', refreshExportSummary);
  dom.exportPaper.addEventListener('change', refreshExportSummary);
  dom.exportForm.addEventListener('submit', submitExport);
  dom.exportCancelBtn.addEventListener('click', () => dom.exportDialog.close());
  dom.exportCloseBtn.addEventListener('click', () => dom.exportDialog.close());

  dom.closeEditorBtn.addEventListener('click', closeEditor);
  dom.addTextBtn.addEventListener('click', () => openElementDialog('text'));
  dom.addImageBtn.addEventListener('click', () => openElementDialog('image'));
  dom.addLineBtn.addEventListener('click', () => openElementDialog('line'));
  dom.saveTemplateBtn?.addEventListener('click', () => {
    if (!isSubscribed()) {
      openSubscribe();
      return;
    }
    templates?.openNameDialog();
  });
  dom.copyOverwriteBtn.addEventListener('click', () => copyPanelTo('overwrite'));
  dom.copyAppendBtn.addEventListener('click', () => copyPanelTo('append'));
  dom.clearPanelBtn.addEventListener('click', clearPanel);

  dom.elementTabs.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-tab]');
    if (btn) setDialogTab(btn.dataset.tab);
  });
  dom.elementForm.addEventListener('submit', submitElementDialog);
  dom.elementCancelBtn.addEventListener('click', closeElementDialog);
  dom.elementCloseBtn.addEventListener('click', closeElementDialog);
  dom.elementFile.addEventListener('change', onImageFileChanged);

  document.addEventListener('keydown', onKeyDown);

  window.addEventListener('resize', scheduleRender);
  let lastWidth = dom.netHost.clientWidth;
  const ro = new ResizeObserver(() => {
    const w = dom.netHost.clientWidth;
    if (w !== lastWidth) {
      lastWidth = w;
      scheduleRender();
    }
  });
  ro.observe(dom.netHost);

  // 编辑区宽度变化时也重算缩放
  let lastEditorWidth = dom.editorCanvas.clientWidth;
  const ro2 = new ResizeObserver(() => {
    const w = dom.editorCanvas.clientWidth;
    if (w !== lastEditorWidth) {
      lastEditorWidth = w;
      if (state.selected) editor.render();
    }
  });
  ro2.observe(dom.editorCanvas);
}

function onKeyDown(ev) {
  const target = ev.target;
  const tag = (target && target.tagName) || '';
  const typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (target && target.isContentEditable);
  const mod = ev.ctrlKey || ev.metaKey;

  if (mod && ev.key.toLowerCase() === 'z') {
    if (typing) return;
    ev.preventDefault();
    if (ev.shiftKey) redo();
    else undo();
    return;
  }
  if (mod && ev.key.toLowerCase() === 'y') {
    if (typing) return;
    ev.preventDefault();
    redo();
    return;
  }
  if (typing || !state.selectedElement) return;

  const step = ev.shiftKey ? 10 : 1;
  const moves = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  if (moves[ev.key]) {
    ev.preventDefault();
    editor.nudge(moves[ev.key][0], moves[ev.key][1]);
    return;
  }
  if (ev.key === 'Delete' || ev.key === 'Backspace') {
    ev.preventDefault();
    editor.deleteSelected();
    return;
  }
  if (ev.key === 'Escape') {
    editor.select(null);
  }
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

/* ── 轻提示 ─────────────────────────────────────── */

/**
 * @param {string} msg
 * @param {{ms?:number, tone?:'warn'}} [opts] 需要让人看清的提示（比如箱唛被清空）用更长的时间和醒目底色
 */
function showToast(msg, opts = {}) {
  const ms = Number(opts.ms) || 2200;
  dom.toast.textContent = msg;
  dom.toast.hidden = false;
  dom.toast.classList.toggle('is-warn', opts.tone === 'warn');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.hidden = true;
    dom.toast.classList.remove('is-warn');
  }, ms);
}

/* ── 启动 ───────────────────────────────────────── */

try {
  await init();
} catch (err) {
  console.error('init failed', err);
  document.body.dataset.initError = String((err && err.message) || err);
  const notice = document.getElementById('notice');
  if (notice) {
    notice.hidden = false;
    notice.classList.add('is-error');
    notice.textContent = `页面初始化失败：${(err && err.message) || err}`;
  }
}

// 便于调试与自动化检查
window.__CM__ = {
  state,
  editor,
  history,
  getNet: () => lastNet,
  computeNet,
  openElementDialog,
  closeElementDialog,
  copyPanelTo,
  exportPdf: exportForTest,
  account: { state: currentAccount, openLogin, openSubscribe, refresh: refreshAccount, handleError: handleApiError },
  undo,
  redo,
};
