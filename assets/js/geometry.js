/**
 * geometry.js —— RSC 开槽箱的纯几何计算（不含任何绘制）
 *
 * 输入永远是一组真实毫米尺寸 { L, W, H }，输出也是毫米坐标。
 * 视图层只负责把毫米等比映射到屏幕像素。
 *
 * RSC 展开图（8 个可编辑面）：
 *
 *        [前顶][  ][后顶][  ]        ← 上摇盖带，高 W/2（只有前/后两片）
 *        [ 前 ][右][ 后 ][左]        ← 箱身带，高 H
 *        [前底][  ][后底][  ]        ← 下摇盖带，高 W/2
 *
 * 总宽 = 2L + 2W，总高 = H + W。
 */

export const FLAP_RATIO = 0.5;

/**
 * @param {{L:number,W:number,H:number}} dims 毫米
 */
export function computeNet(dims) {
  const L = Number(dims.L);
  const W = Number(dims.W);
  const H = Number(dims.H);

  const flap = W * FLAP_RATIO; // 摇盖高度
  const width = 2 * L + 2 * W;
  const height = H + W;

  const x0 = 0;
  const x1 = L;
  const x2 = L + W;
  const x3 = 2 * L + W;
  const x4 = 2 * L + 2 * W;

  const y0 = 0;
  const y1 = flap;
  const y2 = flap + H;
  const y3 = H + W;

  const panels = {
    front: { x: x0, y: y1, w: L, h: H },
    right: { x: x1, y: y1, w: W, h: H },
    back: { x: x2, y: y1, w: L, h: H },
    left: { x: x3, y: y1, w: W, h: H },
    topFront: { x: x0, y: y0, w: L, h: flap },
    topBack: { x: x2, y: y0, w: L, h: flap },
    bottomFront: { x: x0, y: y2, w: L, h: flap },
    bottomBack: { x: x2, y: y2, w: L, h: flap },
  };

  // 裁切线轮廓（毫米坐标，顺时针）
  const outline = [
    [x0, y0], [x1, y0], [x1, y1], [x2, y1],
    [x2, y0], [x3, y0], [x3, y1], [x4, y1],
    [x4, y2], [x3, y2], [x3, y3], [x2, y3],
    [x2, y2], [x1, y2], [x1, y3], [x0, y3],
  ];

  // 折叠线：摇盖与箱身之间、箱身四面之间
  const folds = [
    { x1: x0, y1, x2: x1, y2: y1 }, // 前顶 / 前
    { x1: x2, y1, x2: x3, y2: y1 }, // 后顶 / 后
    { x1: x0, y1: y2, x2: x1, y2 }, // 前底 / 前
    { x1: x2, y1: y2, x2: x3, y2 }, // 后底 / 后
    { x1: x1, y1, x2: x1, y2 }, // 前 / 右
    { x1: x2, y1, x2: x2, y2 }, // 右 / 后
    { x1: x3, y1, x2: x3, y2 }, // 后 / 左
  ];

  return {
    shape: 'rsc',
    width,
    height,
    flap,
    bodyTop: y1,
    bodyBottom: y2,
    panels,
    outline,
    folds,
    dims: { L, W, H },
  };
}

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

  const edges = [];
  for (const id of Object.keys(corners)) {
    const [i, j, k] = [...id].map(Number);
    if (i === 0) edges.push([id, key(1, j, k)]);
    if (j === 0) edges.push([id, key(i, 1, k)]);
    if (k === 0) edges.push([id, key(i, j, 1)]);
  }

  // 投影后 X、Y 都朝屏幕下方，所以离观察者最近的是 (L, W, *) 这个角：
  // 可见面是 X = L、Y = W 两个立面，加上顶面 Z = H。
  // 一条棱的中点若不在任何可见面上，就是被箱体遮住的背棱 → 虚线。
  const isHidden = (idA, idB) => {
    const a = corners3d[idA];
    const b = corners3d[idB];
    const mx = (a.X + b.X) / 2;
    const my = (a.Y + b.Y) / 2;
    const mz = (a.Z + b.Z) / 2;
    const onVisibleFace = mx === L || my === W || mz === H;
    return !onVisibleFace;
  };

  return {
    corners,
    corners3d,
    edges: edges.map(([a, b]) => ({ a, b, hidden: isHidden(a, b) })),
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
