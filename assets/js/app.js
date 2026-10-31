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
} from './project.js';
import { loadProject, saveProject, compressImage } from './storage.js';
import { computeNet } from './geometry.js';
import { renderNet } from './net-view.js';
import { renderIso } from './iso-view.js';
import { createEditor } from './editor.js';
import { renderProperties, syncNumberFields } from './properties.js';
import { History } from './history.js';
import { clampElement, createTextElement, createImageElement, deepCopyElement } from './elements.js';
import { validateDim, displayValue, unitSuffix, fmt } from './units.js';
import { exportPdf, imageReport } from './pdf-export.js';
import { summarize, exportFileName, MIN_DPI } from './pdf-plan.js';

const NAMES = { L: '长 L', W: '宽 W', H: '高 H' };
const DIM_KEYS = ['L', 'W', 'H'];
const el = (id) => document.getElementById(id);

const dom = {
  shape: el('shapeSelect'),
  unitToggle: el('unitToggle'),
  inputs: { L: el('dimL'), W: el('dimW'), H: el('dimH') },
  errors: { L: el('errL'), W: el('errW'), H: el('errH') },
  notice: el('notice'),
  isoHost: el('isoHost'),
  netHost: el('netHost'),
  isoMeta: el('isoMeta'),
  netMeta: el('netMeta'),
  netSize: el('netSize'),
  selInfo: el('selInfo'),
  resetBtn: el('resetBtn'),
  helpBtn: el('helpBtn'),
  helpDialog: el('helpDialog'),
  toast: el('toast'),
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
  dims: { ...EXAMPLE_DIMS },
  selected: null,
  selectedElement: null,
  panels: {},
};

const history = new History(60);
let lastNet = null;
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
    state.dims = draft.dims;
    state.unit = draft.unit;
    state.shape = draft.shape;
    applyUnitChrome();
  }

  // 面板槽位完全由当前箱型的几何结果生成（不写死 RSC）
  state.panels = createPanels(computeNet(state.dims, state.shape));
  if (draft) {
    mergeDraftPanels(draft.panels);
    showToast('已恢复上次草稿');
  }

  dom.shape.value = state.shape;
  writeInputsFromState();
  render();
  if (window.matchMedia && window.matchMedia('(max-width: 720px)').matches) {
    dom.mobileHint.hidden = false;
  }
  history.reset(snapshot());
  updateHistoryButtons();

  // 支持 ?panel=front 这类深链，方便直接打开某一面
  const wanted = new URLSearchParams(location.search).get('panel');
  if (wanted && isEditablePanel(lastNet, wanted)) selectPanel(wanted, { scroll: false });
}

/** 把草稿内容合并进当前几何生成的面板；几何里没有的 key 直接丢弃 */
function mergeDraftPanels(rawPanels) {
  if (!rawPanels) return;
  for (const [key, value] of Object.entries(rawPanels)) {
    if (!state.panels[key] || !value || !Array.isArray(value.elements)) continue;
    state.panels[key].elements = value.elements;
  }
}

function buildShapeSelect() {
  dom.shape.replaceChildren();
  for (const s of SHAPES) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.enabled ? s.name : `${s.name}（即将支持）`;
    opt.disabled = !s.enabled;
    dom.shape.appendChild(opt);
  }
}

/* ── 输入与校验 ─────────────────────────────────── */

function writeInputsFromState() {
  for (const k of DIM_KEYS) dom.inputs[k].value = String(displayValue(state.dims[k], state.unit));
  for (const k of DIM_KEYS) dom.errors[k].textContent = '';
}

function readInputs() {
  const dims = {};
  const errors = [];
  const warns = [];

  for (const k of DIM_KEYS) {
    const r = validateDim(dom.inputs[k].value, state.unit, NAMES[k]);
    if (!r.ok) {
      errors.push({ key: k, msg: r.error });
    } else {
      dims[k] = Math.round(r.mm * 10) / 10;
      if (r.warn) warns.push(r.warn);
    }
  }
  return { dims: errors.length ? null : dims, errors, warns };
}

function showErrors(errors) {
  for (const k of DIM_KEYS) {
    dom.errors[k].textContent = '';
    dom.inputs[k].classList.remove('is-error');
  }
  for (const e of errors) {
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
  for (const k of DIM_KEYS) dom.inputs[k].step = state.unit === 'cm' ? '0.1' : '1';
}

function switchUnit(unit) {
  if (unit === state.unit) return;
  state.unit = unit;
  applyUnitChrome();
  writeInputsFromState();
  const { dims } = readInputs();
  if (dims) state.dims = dims;
  persistSoon();
}

/* ── 绘制 ───────────────────────────────────────── */

function render() {
  lastNet = computeNet(state.dims, state.shape);
  clampAllElements();

  netApi = renderNet(dom.netHost, lastNet, {
    selected: state.selected,
    onSelect: selectPanel,
  });
  if (state.selected) netApi.select(state.selected);

  renderIso(dom.isoHost, state.dims);

  const { L, W, H } = state.dims;
  dom.isoMeta.textContent = `${fmt(L)} × ${fmt(W)} × ${fmt(H)} mm`;
  dom.netMeta.textContent = `按容器宽度等比缩放 · 实际 ${fmt(lastNet.width)} × ${fmt(lastNet.height)} mm`;
  dom.netSize.textContent =
    `展开 ${fmt(lastNet.width)} × ${fmt(lastNet.height)} mm · ` +
    `箱身 ${fmt(L)}/${fmt(W)} × ${fmt(H)} · ` +
    `主摇盖 ${fmt(L)} × ${fmt(lastNet.flap)} · 防尘摇盖 ${fmt(W)} × ${fmt(lastNet.flap)}（不印）`;

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
  dom.editorSub.textContent = `${SLOT_LABELS[meta.slot]} · ${fmt(geo.w)} × ${fmt(geo.h)} mm`;
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
  dom.selInfo.textContent = `正在编辑：${meta.label}（${SLOT_LABELS[p.kind]}）· ${fmt(p.w)} × ${fmt(p.h)} mm · ${count} 个元素`;
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
  const isImage = tab === 'image';
  dom.elementDialog.dataset.type = isImage ? 'image' : 'text';
  dom.elementTitle.textContent = isImage ? '新建图片' : '新建文字';
  dom.textPane.hidden = isImage;
  dom.imagePane.hidden = !isImage;
  dom.elementTabs.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.tab === (isImage ? 'image' : 'text');
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
  const type = dom.elementDialog.dataset.type === 'image' ? 'image' : 'text';
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
    unit: state.unit,
    shape: state.shape,
    panels: state.panels,
  });
  const where = await saveProject(payload);
  if (where === 'none') {
    showToast('本地存储已满，草稿未能保存');
  } else if (where === 'idb' && lastStorage !== 'idb') {
    showToast('图片较大，草稿已改存浏览器 IndexedDB');
  }
  lastStorage = where;
}

/* ── 导出 PDF ───────────────────────────────────── */

async function openExportDialog() {
  if (!lastNet) return;
  dom.exportFileName.value = exportFileName(state.dims);
  await refreshExportSummary();
  if (typeof dom.exportDialog.showModal === 'function') dom.exportDialog.showModal();
  else dom.exportDialog.setAttribute('open', '');
}

async function refreshExportSummary() {
  if (!lastNet) return;
  const mode = dom.exportMode.value === 'panel' ? 'panel' : dom.exportMode.value === 'tile' ? 'tile' : 'sheet';
  const tilePaper = dom.exportPaper.value === 'a4' ? 'a4' : 'a3';
  dom.tilePaperField.hidden = mode !== 'tile';
  const stats = summarize({ net: lastNet, panels: state.panels, mode, tilePaper });
  const page = stats.pageSize;

  dom.exportSummary.innerHTML =
    `页面尺寸：<b>${fmt(page.width)} × ${fmt(page.height)} mm</b>（1:1${page.scaled ? '，已缩放' : ''}）<br>` +
    `包含内容：<b>${stats.usedPanels}</b> 个面 · <b>${stats.elementCount}</b> 个元素（${stats.imageCount} 张图片）<br>` +
    `页数：<b>${stats.pages || 1}</b> 页` +
    (stats.tilePlan
      ? `<br>拼版：<b>${stats.tilePlan.paperName} · ${stats.tilePlan.cols} 列 × ${stats.tilePlan.rows} 行 = ${stats.tilePlan.tiles.length} 块</b>（1:1，不缩放）`
      : '');

  dom.exportWarnings.replaceChildren();
  const warn = (text, cls = '') => {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = text;
    dom.exportWarnings.appendChild(div);
  };

  if (stats.elementCount === 0) {
    warn('还没有任何箱唛内容，先加文字或图片再导出。', 'is-error');
  }
  if (stats.tilePlan) {
    warn(`拼版共 ${stats.tilePlan.tiles.length} 块，每块边角有裁切标记，块上标了「接边」方向；拼接后即为 1:1 整图。`);
  }
  if (page.scaled) {
    warn(`展开图 ${fmt(lastNet.width)} × ${fmt(lastNet.height)} mm 超过 PDF 单页上限 ${page.limit} mm，已等比缩到 ${(page.scale * 100).toFixed(1)}%，打印时需按同比例放大。`);
  }
  if (stats.imageCount) {
    const rows = await imageReport(lastNet, state.panels);
    for (const row of rows) {
      if (row.error) warn('有一张图片解码失败，导出时会跳过。', 'is-error');
      else if (row.dpi < MIN_DPI) {
        warn(`${row.panelLabel} 的图片打印尺寸 ${Math.round(row.width)} × ${Math.round(row.height)} mm，有效约 ${Math.round(row.dpi)} dpi（低于 ${MIN_DPI} dpi，印刷可能发虚）。`);
      }
    }
  }

  dom.exportConfirmBtn.disabled = stats.elementCount === 0;
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
      mode: dom.exportMode.value === 'panel' ? 'panel' : dom.exportMode.value === 'tile' ? 'tile' : 'sheet',
      tilePaper: dom.exportPaper.value === 'a4' ? 'a4' : 'a3',
      fileName: dom.exportFileName.value.trim() || undefined,
      download: true,
    });
    dom.exportDialog.close();
    showToast(`PDF 已生成：${res.pageCount} 页 · ${Math.round(res.pageSize.width)} × ${Math.round(res.pageSize.height)} mm`);
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
  for (const k of DIM_KEYS) {
    dom.inputs[k].addEventListener('input', onInputChanged);
    dom.inputs[k].addEventListener('blur', onInputChanged);
  }

  dom.unitToggle.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-unit]');
    if (btn) switchUnit(btn.dataset.unit);
  });

  dom.resetBtn.addEventListener('click', () => {
    state.dims = { ...EXAMPLE_DIMS };
    writeInputsFromState();
    showNotice([]);
    render();
    pushHistory();
    persistSoon();
    showToast('已恢复示例尺寸 600 × 400 × 300 mm');
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
    state.shape = chosen.id;
    persistSoon();
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

function showToast(msg) {
  dom.toast.textContent = msg;
  dom.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.hidden = true;
  }, 2200);
}

/* ── 启动 ───────────────────────────────────────── */

await init();

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
  undo,
  redo,
};
