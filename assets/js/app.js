/**
 * app.js —— 页面装配与交互
 * 职责：读取尺寸输入 → 校验 → 计算几何 → 调视图绘制 → 保存草稿
 */

import { SHAPES, PANELS, PANEL_BY_KEY, SLOT_LABELS, EXAMPLE_DIMS, createPanels, loadDraft, saveDraft, isEditablePanel } from './project.js';
import { computeNet } from './geometry.js';
import { renderNet } from './net-view.js';
import { renderIso } from './iso-view.js';
import { validateDim, displayValue, unitSuffix, fmt } from './units.js';

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
  stageTag: el('stageTag'),
};

const state = {
  shape: 'rsc',
  unit: 'mm',
  dims: { ...EXAMPLE_DIMS },
  selected: null,
  panels: createPanels(),
};

let lastNet = null;
let netApi = null;
let renderQueued = false;
let toastTimer = 0;

/* ── 初始化 ─────────────────────────────────────── */

function init() {
  buildShapeSelect();
  bindEvents();

  const draft = loadDraft();
  if (draft) {
    state.dims = draft.dims;
    state.unit = draft.unit;
    state.shape = draft.shape;
    state.panels = draft.panels;
    applyUnitChrome();
    showToast('已恢复上次草稿');
  }

  dom.shape.value = state.shape;
  writeInputsFromState();
  render();
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
  for (const k of DIM_KEYS) {
    dom.inputs[k].value = String(displayValue(state.dims[k], state.unit));
  }
  for (const k of DIM_KEYS) dom.errors[k].textContent = '';
}

/**
 * 读取并校验三个输入框
 * @returns {{dims:object|null, errors:Array, warns:Array}}
 */
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
  for (const k of DIM_KEYS) dom.errors[k].textContent = '';
  for (const k of DIM_KEYS) dom.inputs[k].classList.remove('is-error');

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
  // 尺寸变了，原来选中的面板尺寸也变了，但选中状态保留
  render();
  persist();
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
  for (const k of DIM_KEYS) {
    dom.inputs[k].step = state.unit === 'cm' ? '0.1' : '1';
  }
}

function switchUnit(unit) {
  if (unit === state.unit) return;
  state.unit = unit;
  applyUnitChrome();
  writeInputsFromState();
  // 毫米值没变，图纸不用重画；但显示值经过取整，重新校验一遍保持一致
  const { dims } = readInputs();
  if (dims) state.dims = dims;
  persist();
}

/** 统一保存：尺寸、单位、箱型、各可编辑面板的内容 */
function persist() {
  const ok = saveDraft({
    dims: state.dims,
    unit: state.unit,
    shape: state.shape,
    panels: state.panels,
  });
  if (!ok) showToast('本地存储已满，草稿未能保存（图片过大时容易出现）');
  return ok;
}

/* ── 绘制 ───────────────────────────────────────── */

function render() {
  lastNet = computeNet(state.dims);

  netApi = renderNet(dom.netHost, lastNet, {
    selected: state.selected,
    onSelect: selectPanel,
  });

  renderIso(dom.isoHost, state.dims);

  const { L, W, H } = state.dims;
  dom.isoMeta.textContent = `${fmt(L)} × ${fmt(W)} × ${fmt(H)} mm`;
  dom.netMeta.textContent = `按容器宽度等比缩放 · 实际 ${fmt(lastNet.width)} × ${fmt(lastNet.height)} mm`;
  dom.netSize.textContent =
    `展开 ${fmt(lastNet.width)} × ${fmt(lastNet.height)} mm · ` +
    `箱身 ${fmt(L)}/${fmt(W)} × ${fmt(H)} · ` +
    `主摇盖 ${fmt(L)} × ${fmt(lastNet.flap)} · 防尘摇盖 ${fmt(W)} × ${fmt(lastNet.flap)}`;

  updateSelectionInfo();
}

function panelElements(key) {
  return (state.panels[key] && state.panels[key].elements) || [];
}

function selectPanel(key) {
  // 防尘摇盖只画轮廓，点不动
  if (!isEditablePanel(key)) return;
  state.selected = state.selected === key ? null : key;
  if (netApi) netApi.select(state.selected);
  updateSelectionInfo();
}

function updateSelectionInfo() {
  if (!state.selected || !lastNet) {
    dom.selInfo.textContent = '未选择面板';
    dom.selInfo.classList.remove('is-active');
    return;
  }
  const meta = PANEL_BY_KEY[state.selected];
  const p = lastNet.panels[state.selected];
  dom.selInfo.textContent = p
    ? `已选：${meta.label}（${SLOT_LABELS[p.kind]}）· ${fmt(p.w)} × ${fmt(p.h)} mm · 共 ${panelElements(state.selected).length} 个元素`
    : `已选：${meta.label}`;
  dom.selInfo.classList.add('is-active');
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
    state.selected = null;
    writeInputsFromState();
    showNotice([]);
    render();
    persist();
    showToast('已恢复示例尺寸 600 × 400 × 300 mm');
  });

  dom.helpBtn.addEventListener('click', () => {
    if (typeof dom.helpDialog.showModal === 'function') dom.helpDialog.showModal();
    else dom.helpDialog.setAttribute('open', '');
  });
  dom.helpDialog.addEventListener('click', (ev) => {
    // 点遮罩关闭
    if (ev.target === dom.helpDialog) dom.helpDialog.close?.();
  });

  dom.shape.addEventListener('change', () => {
    const chosen = SHAPES.find((s) => s.id === dom.shape.value);
    if (!chosen || !chosen.enabled) {
      dom.shape.value = state.shape;
      return;
    }
    state.shape = chosen.id;
  });

  window.addEventListener('resize', scheduleRender);

  // 只在宽度变化时重绘，避免 SVG 高度变化触发自身循环
  let lastWidth = dom.netHost.clientWidth;
  const ro = new ResizeObserver(() => {
    const w = dom.netHost.clientWidth;
    if (w !== lastWidth) {
      lastWidth = w;
      scheduleRender();
    }
  });
  ro.observe(dom.netHost);
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

init();

// 便于调试与自动化检查
window.__CM__ = { state, getNet: () => lastNet, computeNet, PANELS };
