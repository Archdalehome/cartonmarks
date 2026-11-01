/**
 * project.js —— 项目数据模型
 *
 * 面板列表不在这里写死：createPanels(net) 完全按几何结果生成。
 * 为后续箱型（L 形、斜形）预留的扩展点是 geometry.registerShapeGeometry。
 */

/** 可选箱型；subscriberOnly 的箱型要在订阅后才可选。下拉里按这个顺序排（天地盖放最后） */
export const SHAPES = [
  { id: 'rsc', name: '矩形箱', enabled: true },
  { id: 'lshape', name: 'L 形箱', enabled: true, subscriberOnly: true },
  { id: 'bevel', name: '斜形箱', enabled: true, subscriberOnly: true },
  { id: 'tiandi', name: '天地盖', enabled: true, subscriberOnly: true },
];

/**
 * 某个箱型要输哪几个尺寸。
 * L 形箱的 W 由 W前+W后 派生；天地盖只输天盖外尺寸，地盖三个尺寸自动派生。
 */
export function dimKeysFor(shape) {
  if (shape === 'lshape') return ['L', 'Wfront', 'Wback', 'Hfront', 'Hback'];
  if (shape === 'bevel') return ['L', 'W', 'Hfront', 'Hback'];
  if (shape === 'tiandi') return ['L', 'W', 'H'];
  return ['L', 'W', 'H'];
}

export const SLOT_LABELS = {
  body: '箱身面',
  major: '主摇盖',
  minor: '防尘摇盖',
};

/** 某个箱型有没有「天/地」这类多件套，需要切换查看 */
export const PIECE_SHAPES = ['tiandi'];

export const DRAFT_KEY = 'cartonmark.draft.v1';

export const EXAMPLE_DIMS = { L: 600, W: 400, H: 300 };

/**
 * 按箱型隔离的尺寸：切到某个箱型时用它自己那份，没设置过就用默认示例。
 * 这样 L 形的 W(前)/W(后)/H(前)/H(后) 不会漏到矩形箱里。
 */
export function dimsForShape(dimsByShape, shapeId, defaults = EXAMPLE_DIMS) {
  const saved = dimsByShape && dimsByShape[shapeId];
  return { ...defaults, ...(saved || {}) };
}

/** 按几何结果生成可编辑面板的内容槽位（不含防尘摇盖等不可编辑区域） */
export function createPanels(net) {
  const panels = {};
  // 多件套箱型一次给两件的面板（allPanels），切换天/地盖时内容不会丢
  const source = (net && net.allPanels) || (net && net.panels) || {};
  for (const [key, p] of Object.entries(source)) {
    if (!p || p.kind === 'minor' || p.editable === false) continue;
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
    if (!['text', 'image', 'line'].includes(el.type)) continue;
    if (!Number.isFinite(Number(el.w)) || !Number.isFinite(Number(el.h))) continue;
    out.push({
      id: String(el.id || `el-${Math.random().toString(36).slice(2, 9)}`),
      type: el.type,
      x: Number(el.x) || 0,
      y: Number(el.y) || 0,
      w: Math.max(el.type === 'line' ? 0.5 : 1, Number(el.w) || 1),
      h: Math.max(el.type === 'line' ? 0.5 : 1, Number(el.h) || 1),
      rotation: Number(el.rotation) || 0,
      text: typeof el.text === 'string' ? el.text : '',
      fontSize: Number(el.fontSize) || 10,
      bold: Boolean(el.bold),
      align: ['left', 'center', 'right'].includes(el.align) ? el.align : 'left',
      orientation: el.orientation === 'vertical' ? 'vertical' : 'horizontal',
      color: /^#[0-9a-f]{6}$/i.test(String(el.color || '')) ? el.color : '#000000',
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

    const shape = SHAPES.some((s) => s.id === data.shape) ? data.shape : 'rsc';
    const num = (k) => {
      const n = Number(dims[k]);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    // 各箱型只收自己需要的尺寸；缺任何一个就整份草稿作废
    const wanted = dimKeysFor(shape);
    const cleanDims = {};
    for (const k of wanted) {
      const v = num(k);
      if (v == null) return null;
      cleanDims[k] = v;
    }

    // 各箱型自己那份尺寸（可选字段，老草稿没有就只是当前箱型那份）
    const dimsByShape = {};
    if (data.dimsByShape && typeof data.dimsByShape === 'object') {
      for (const s of SHAPES) {
        const raw = data.dimsByShape[s.id];
        if (!raw || typeof raw !== 'object') continue;
        const one = {};
        let ok = true;
        for (const k of dimKeysFor(s.id)) {
          const n = Number(raw[k]);
          if (!Number.isFinite(n) || n <= 0) {
            ok = false;
            break;
          }
          one[k] = n;
        }
        if (ok) dimsByShape[s.id] = one;
      }
    }

    const rawPanels = {};
    if (data.panels && typeof data.panels === 'object') {
      for (const [key, value] of Object.entries(data.panels)) {
        if (value && Array.isArray(value.elements)) {
          rawPanels[key] = { elements: sanitizeElements(value.elements) };
        }
      }
    }

    return {
      dims: cleanDims,
      dimsByShape,
      unit: data.unit === 'cm' ? 'cm' : data.unit === 'in' ? 'in' : 'mm',
      shape,
      panels: rawPanels,
    };
  } catch (err) {
    console.warn('草稿解析失败，已忽略这份数据', err);
    return null;
  }
}

/** 把项目序列化成可存储的纯数据（键来自当前面板，不写死箱型） */
export function serializeDraft({ dims, unit, shape, panels, dimsByShape }) {
  const payload = { version: 5, dims, unit, shape, panels: {} };
  if (dimsByShape && typeof dimsByShape === 'object') {
    payload.dimsByShape = {};
    for (const [id, d] of Object.entries(dimsByShape)) {
      if (d) payload.dimsByShape[id] = { ...d };
    }
  }
  for (const key of Object.keys(panels || {})) {
    payload.panels[key] = { elements: panels[key].elements || [] };
  }
  return payload;
}
