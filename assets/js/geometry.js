/**
 * geometry.js —— 箱型几何计算（不含任何绘制）
 *
 * 输入永远是一组真实毫米尺寸 { L, W, H }，输出也是毫米坐标。
 * 视图层只负责把毫米等比映射到屏幕像素。
 *
 * 面板列表由几何函数自己给出（key / label / 尺寸 / 是否可编辑），
 * 页面和导出层都不硬编码某一箱型 —— 新增 L 形、斜形箱只要注册一个几何函数。
 *
 * RSC（FEFCO 0201）展开图共 12 个区域：
 *
 *        [前顶][右顶][后顶][左顶]     ← 上摇盖带，高 W/2
 *        [ 前 ][ 右 ][ 后 ][ 左 ]     ← 箱身带，高 H
 *        [前底][右底][后底][左底]     ← 下摇盖带，高 W/2
 *
 * 前/后箱身面挂主摇盖（major，L × W/2，两片对开拼成顶面）；
 * 左/右箱身面挂防尘摇盖（minor，W × W/2，先折入再压主摇盖，不印箱唛）。
 * 总宽 = 2L + 2W，总高 = H + W。
 */

/** 摇盖深度与箱宽的比例（标准 RSC：槽深 = W/2） */
export const FLAP_DEPTH_RATIO = 0.5;

/** 箱型几何注册表：id -> compute(dims) => net */
const SHAPE_GEOMETRY = new Map();

export function registerShapeGeometry(id, compute) {
  SHAPE_GEOMETRY.set(id, compute);
}

export function hasShapeGeometry(id) {
  return SHAPE_GEOMETRY.has(id);
}

/** 已注册的箱型 id 列表（测试与调试用） */
export function listShapeGeometries() {
  return [...SHAPE_GEOMETRY.keys()];
}

/**
 * 计算展开图。面板列表完全来自几何函数，不存在“只认 RSC”的硬编码。
 * @param {{L:number,W:number,H:number}} dims 毫米
 * @param {string} shapeId 箱型 id，默认 rsc
 */
export function computeNet(dims, shapeId = 'rsc') {
  const compute = SHAPE_GEOMETRY.get(shapeId);
  if (!compute) throw new Error(`未注册的箱型几何：${shapeId}`);
  return compute(dims, shapeId);
}

function panel(label, kind, x, y, w, h) {
  return {
    label,
    kind, // body | major | minor
    slot: kind,
    editable: kind !== 'minor',
    x,
    y,
    w,
    h,
  };
}

function computeRsc(dims, shapeId) {
  const L = Number(dims.L);
  const W = Number(dims.W);
  const H = Number(dims.H);

  const depth = W * FLAP_DEPTH_RATIO; // 摇盖深度（主摇盖与防尘摇盖相同）
  const width = 2 * L + 2 * W;
  const height = H + W;

  const x0 = 0;
  const x1 = L;
  const x2 = L + W;
  const x3 = 2 * L + W;
  const x4 = 2 * L + 2 * W;

  const y0 = 0;
  const y1 = depth;
  const y2 = depth + H;
  const y3 = H + W;

  const panels = {
    // 箱身四面
    front: panel('前箱唛', 'body', x0, y1, L, H),
    right: panel('右侧箱唛', 'body', x1, y1, W, H),
    back: panel('后箱唛', 'body', x2, y1, L, H),
    left: panel('左侧箱唛', 'body', x3, y1, W, H),

    // 上摇盖：前/后为主摇盖，右/左为防尘摇盖
    topFront: panel('前顶箱唛', 'major', x0, y0, L, depth),
    topRight: panel('右顶箱唛', 'minor', x1, y0, W, depth),
    topBack: panel('后顶箱唛', 'major', x2, y0, L, depth),
    topLeft: panel('左顶箱唛', 'minor', x3, y0, W, depth),

    // 下摇盖：同构
    bottomFront: panel('前底箱唛', 'major', x0, y2, L, depth),
    bottomRight: panel('右底箱唛', 'minor', x1, y2, W, depth),
    bottomBack: panel('后底箱唛', 'major', x2, y2, L, depth),
    bottomLeft: panel('左底箱唛', 'minor', x3, y2, W, depth),
  };

  // 裁切线：12 个区域拼成完整矩形刀模，外轮廓就是整个矩形
  const outline = [
    [x0, y0],
    [x4, y0],
    [x4, y3],
    [x0, y3],
  ];

  // 折叠线：四列各有上下两条横折线（摇盖↔箱身），箱身之间三条竖折线
  const folds = [];
  for (const [sx, sw] of [[x0, L], [x1, W], [x2, L], [x3, W]]) {
    folds.push({ x1: sx, y1, x2: sx + sw, y2: y1 });
    folds.push({ x1: sx, y1: y2, x2: sx + sw, y2: y2 });
  }
  for (const x of [x1, x2, x3]) {
    folds.push({ x1: x, y1, x2: x, y2 });
  }

  // 开槽（切断线）：上下摇盖带里相邻摇盖之间的竖切口
  const cuts = [];
  for (const x of [x1, x2, x3]) {
    cuts.push({ x1: x, y1: y0, x2: x, y2: y1 });
    cuts.push({ x1: x, y1: y2, x2: x, y2: y3 });
  }

  return {
    shape: shapeId || 'rsc',
    shapeName: '矩形箱 / RSC 开槽箱',
    width,
    height,
    flap: depth,
    flapDepth: depth,
    bodyTop: y1,
    bodyBottom: y2,
    panels,
    outline,
    folds,
    cuts,
    dims: { L, W, H },
  };
}

registerShapeGeometry('rsc', computeRsc);

/* ── 等轴测（isometric）线稿 ────────────────────────── */

const ISO_X = { x: Math.cos(Math.PI / 6), y: 0.5 }; // 长 L 方向：右下
const ISO_Y = { x: -Math.cos(Math.PI / 6), y: 0.5 }; // 宽 W 方向：左下
const ISO_Z = { x: 0, y: -1 }; // 高 H 方向：上

function project(X, Y, Z) {
  return {
    x: X * ISO_X.x + Y * ISO_Y.x + Z * ISO_Z.x,
    y: X * ISO_X.y + Y * ISO_Y.y + Z * ISO_Z.y,
  };
}

const key = (i, j, k) => `${i}${j}${k}`;

/**
 * 唯一判定入口：一条棱相邻的两个面都背向视线，这条棱就不可见（画虚线）。
 * 所有箱型都走这里，不允许再按「某几条棱固定虚线」硬编码。
 */
export function isEdgeHidden(adjacent, faceVisibility) {
  if (!Array.isArray(adjacent) || adjacent.length === 0) return false;
  return !adjacent.some((id) => faceVisibility[id] === true);
}

/**
 * 返回 8 个顶点、12 条棱边（含可见性）、3 个可见面。
 * 坐标是无量纲的等轴测投影，视图层再统一缩放。
 */
export function computeIso(dims) {
  const L = Number(dims.L);
  const W = Number(dims.W);
  const H = Number(dims.H);

  const corners = {};
  const corners3d = {};
  for (const i of [0, 1]) {
    for (const j of [0, 1]) {
      for (const k of [0, 1]) {
        const id = key(i, j, k);
        corners3d[id] = { X: i * L, Y: j * W, Z: k * H };
        corners[id] = project(i * L, j * W, k * H);
      }
    }
  }

  // 可见性只看面：相机在 (+X, +Y, +Z) 方向，所以 X=L、Y=W、Z=H 三个面朝观察者
  const faceVisibility = { x0: false, xL: true, y0: false, yW: true, z0: false, zH: true };

  const edges = [];
  for (const id of Object.keys(corners)) {
    const [i, j, k] = [...id].map(Number);
    // 每条棱记下它相邻的两个面；可见性统一交给 isEdgeHidden 判
    if (i === 0) edges.push([id, key(1, j, k), ['y' + (j ? 'W' : '0'), 'z' + (k ? 'H' : '0')]]);
    if (j === 0) edges.push([id, key(i, 1, k), ['x' + (i ? 'L' : '0'), 'z' + (k ? 'H' : '0')]]);
    if (k === 0) edges.push([id, key(i, j, 1), ['x' + (i ? 'L' : '0'), 'y' + (j ? 'W' : '0')]]);
  }

  return {
    corners,
    corners3d,
    edges: edges.map(([a, b, adjacent]) => ({
      a,
      b,
      adjacent,
      hidden: isEdgeHidden(adjacent, faceVisibility),
    })),
    faceVisibility,
    faces: [
      { id: 'top', points: [key(0, 0, 1), key(1, 0, 1), key(1, 1, 1), key(0, 1, 1)], fill: '#eef2f7' },
      { id: 'front', points: [key(0, 1, 0), key(1, 1, 0), key(1, 1, 1), key(0, 1, 1)], fill: '#e6ecf4' },
      { id: 'side', points: [key(1, 0, 0), key(1, 1, 0), key(1, 1, 1), key(1, 0, 1)], fill: '#f2f5f9' },
    ],
    anchors: {
      L: [key(1, 1, 0), key(0, 1, 0)], // 底边：沿长 L
      W: [key(1, 1, 0), key(1, 0, 0)], // 底边：沿宽 W
      H: [key(1, 0, 0), key(1, 0, 1)], // 右侧立边：沿高 H
    },
    dims: { L, W, H },
  };
}
