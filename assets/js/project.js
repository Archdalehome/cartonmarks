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

/** 8 个可编辑面板（顺序即展开图从左到右、从上到下的语义顺序） */
export const PANELS = [
  { key: 'front', label: '前箱唛', slot: 'body' },
  { key: 'right', label: '右侧箱唛', slot: 'body' },
  { key: 'back', label: '后箱唛', slot: 'body' },
  { key: 'left', label: '左侧箱唛', slot: 'body' },
  { key: 'topFront', label: '前顶箱唛', slot: 'flap' },
  { key: 'topBack', label: '后顶箱唛', slot: 'flap' },
  { key: 'bottomFront', label: '前底箱唛', slot: 'flap' },
  { key: 'bottomBack', label: '后底箱唛', slot: 'flap' },
];

export const PANEL_BY_KEY = Object.fromEntries(PANELS.map((p) => [p.key, p]));

export const DRAFT_KEY = 'cartonmark.draft.v1';

export const EXAMPLE_DIMS = { L: 600, W: 400, H: 300 };

export function createPanelState() {
  const panels = {};
  for (const p of PANELS) {
    panels[p.key] = { label: p.label, elements: [] };
  }
  return panels;
}

export function createProject(dims) {
  return {
    shape: 'rsc',
    dims: { L: dims.L, W: dims.W, H: dims.H },
    panels: createPanelState(),
  };
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
    return {
      dims: { L: Number(dims.L), W: Number(dims.W), H: Number(dims.H) },
      unit: data.unit === 'cm' ? 'cm' : 'mm',
      shape: SHAPES.some((s) => s.id === data.shape && s.enabled) ? data.shape : 'rsc',
    };
  } catch {
    return null;
  }
}

export function saveDraft({ dims, unit, shape }) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ dims, unit, shape, savedAt: Date.now() }));
  } catch {
    /* 隐私模式或配额满：静默失败，不影响绘图 */
  }
}
