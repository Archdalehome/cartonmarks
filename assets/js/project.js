/**
 * project.js —— 项目数据模型
 *
 * 为后续箱型（L 形、斜形）预留结构：shape + dims + panels，
 * 每个面板独立存放 elements，坐标相对面板左上角、单位毫米。
 */

/** 可选箱型；enabled=false 的显示为「即将支持」且不可选 */
export const SHAPES = [
  { id: 'rsc', name: '矩形箱 / RSC 开槽箱', enabled: true },
  { id: 'lshape', name: 'L 形箱', enabled: false },
  { id: 'bevel', name: '斜形箱', enabled: false },
];

/**
 * 12 个可编辑区域（RSC / FEFCO 0201）
 * slot: body = 箱身面，major = 主摇盖（对开），minor = 防尘摇盖
 */
export const PANELS = [
  { key: 'front', label: '前箱唛', slot: 'body' },
  { key: 'right', label: '右侧箱唛', slot: 'body' },
  { key: 'back', label: '后箱唛', slot: 'body' },
  { key: 'left', label: '左侧箱唛', slot: 'body' },
  { key: 'topFront', label: '前顶箱唛', slot: 'major' },
  { key: 'topRight', label: '右顶箱唛', slot: 'minor' },
  { key: 'topBack', label: '后顶箱唛', slot: 'major' },
  { key: 'topLeft', label: '左顶箱唛', slot: 'minor' },
  { key: 'bottomFront', label: '前底箱唛', slot: 'major' },
  { key: 'bottomRight', label: '右底箱唛', slot: 'minor' },
  { key: 'bottomBack', label: '后底箱唛', slot: 'major' },
  { key: 'bottomLeft', label: '左底箱唛', slot: 'minor' },
];

export const PANEL_BY_KEY = Object.fromEntries(PANELS.map((p) => [p.key, p]));

/** 可编辑（能放箱唛）的面 = 4 箱身面 + 4 主摇盖；防尘摇盖只画轮廓 */
export const EDITABLE_PANELS = PANELS.filter((p) => p.slot !== 'minor');

export const isEditablePanel = (key) => Boolean(PANEL_BY_KEY[key]) && PANEL_BY_KEY[key].slot !== 'minor';

export const SLOT_LABELS = {
  body: '箱身面',
  major: '主摇盖',
  minor: '防尘摇盖',
};

export const DRAFT_KEY = 'cartonmark.draft.v1';

export const EXAMPLE_DIMS = { L: 600, W: 400, H: 300 };

/** 每个可编辑面板的初始状态：标签 + 元素列表（元素坐标单位毫米） */
export function createPanels() {
  const panels = {};
  for (const p of EDITABLE_PANELS) {
    panels[p.key] = { label: p.label, elements: [] };
  }
  return panels;
}

export function createProject(dims) {
  return {
    shape: 'rsc',
    dims: { L: dims.L, W: dims.W, H: dims.H },
    panels: createPanels(),
  };
}

/** 把外部数据里的元素清洗成合法结构，脏数据直接丢弃，不让页面挂掉 */
function sanitizeElements(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const el of list) {
    if (!el || typeof el !== 'object') continue;
    if (el.type !== 'text' && el.type !== 'image') continue;
    if (!Number.isFinite(Number(el.w)) || !Number.isFinite(Number(el.h))) continue;
    out.push({
      id: String(el.id || `el-${Math.random().toString(36).slice(2, 9)}`),
      type: el.type,
      x: Number(el.x) || 0,
      y: Number(el.y) || 0,
      w: Math.max(1, Number(el.w) || 1),
      h: Math.max(1, Number(el.h) || 1),
      rotation: Number(el.rotation) || 0,
      text: typeof el.text === 'string' ? el.text : '',
      fontSize: Number(el.fontSize) || 10,
      bold: Boolean(el.bold),
      align: ['left', 'center', 'right'].includes(el.align) ? el.align : 'left',
      src: typeof el.src === 'string' ? el.src : '',
    });
  }
  return out;
}

/** 读取本地草稿；任何异常都退回示例值，不让页面挂掉 */
export function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const dims = data && data.dims ? data.dims : null;
    if (!dims) return null;
    const valid = ['L', 'W', 'H'].every(
      (k) => Number.isFinite(Number(dims[k])) && Number(dims[k]) > 0,
    );
    if (!valid) return null;

    const panels = createPanels();
    if (data.panels && typeof data.panels === 'object') {
      for (const p of EDITABLE_PANELS) {
        const saved = data.panels[p.key];
        if (saved && Array.isArray(saved.elements)) {
          panels[p.key].elements = sanitizeElements(saved.elements);
        }
      }
    }

    return {
      dims: { L: Number(dims.L), W: Number(dims.W), H: Number(dims.H) },
      unit: data.unit === 'cm' ? 'cm' : 'mm',
      shape: SHAPES.some((s) => s.id === data.shape && s.enabled) ? data.shape : 'rsc',
      panels,
    };
  } catch {
    return null;
  }
}

export function serializeDraft({ dims, unit, shape, panels }) {
  const payload = { version: 3, dims, unit, shape, panels: {} };
  for (const p of EDITABLE_PANELS) {
    payload.panels[p.key] = { elements: (panels && panels[p.key] && panels[p.key].elements) || [] };
  }
  return payload;
}

export function saveDraft({ dims, unit, shape, panels }) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(serializeDraft({ dims, unit, shape, panels })));
    return true;
  } catch {
    /* 隐私模式或配额满：静默失败，不影响绘图 */
    return false;
  }
}
