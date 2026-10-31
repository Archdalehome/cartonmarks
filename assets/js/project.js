/**
 * project.js —— 项目数据模型
 *
 * 面板列表不在这里写死：createPanels(net) 完全按几何结果生成。
 * 为后续箱型（L 形、斜形）预留的扩展点是 geometry.registerShapeGeometry。
 */

/** 可选箱型；enabled=false 的显示为「即将支持」且不可选 */
export const SHAPES = [
  { id: 'rsc', name: '矩形箱 / RSC 开槽箱', enabled: true },
  { id: 'lshape', name: 'L 形箱', enabled: false },
  { id: 'bevel', name: '斜形箱', enabled: false },
];

export const SLOT_LABELS = {
  body: '箱身面',
  major: '主摇盖',
  minor: '防尘摇盖',
};

export const DRAFT_KEY = 'cartonmark.draft.v1';

export const EXAMPLE_DIMS = { L: 600, W: 400, H: 300 };

/** 按几何结果生成可编辑面板的内容槽位（不含防尘摇盖等不可编辑区域） */
export function createPanels(net) {
  const panels = {};
  for (const [key, p] of Object.entries(net.panels)) {
    if (!p.editable) continue;
    panels[key] = { label: p.label, kind: p.kind, elements: [] };
  }
  return panels;
}

/** 某个 key 在当前几何里是否可编辑 */
export function isEditablePanel(net, key) {
  return Boolean(net && net.panels && net.panels[key] && net.panels[key].editable);
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

/**
 * 解析一份草稿（不依赖某具体箱型）。
 * 返回 panel 内容按 key 分组的原始数据，由调用方合并进当前几何生成的面板。
 */
export function parseDraft(data) {
  try {
    if (!data || typeof data !== 'object') return null;
    const dims = data.dims;
    if (!dims) return null;
    const valid = ['L', 'W', 'H'].every(
      (k) => Number.isFinite(Number(dims[k])) && Number(dims[k]) > 0,
    );
    if (!valid) return null;

    const rawPanels = {};
    if (data.panels && typeof data.panels === 'object') {
      for (const [key, value] of Object.entries(data.panels)) {
        if (value && Array.isArray(value.elements)) {
          rawPanels[key] = { elements: sanitizeElements(value.elements) };
        }
      }
    }

    return {
      dims: { L: Number(dims.L), W: Number(dims.W), H: Number(dims.H) },
      unit: data.unit === 'cm' ? 'cm' : 'mm',
      shape: SHAPES.some((s) => s.id === data.shape && s.enabled) ? data.shape : 'rsc',
      panels: rawPanels,
    };
  } catch {
    return null;
  }
}

/** 把项目序列化成可存储的纯数据（键来自当前面板，不写死箱型） */
export function serializeDraft({ dims, unit, shape, panels }) {
  const payload = { version: 4, dims, unit, shape, panels: {} };
  for (const key of Object.keys(panels || {})) {
    payload.panels[key] = { elements: panels[key].elements || [] };
  }
  return payload;
}
