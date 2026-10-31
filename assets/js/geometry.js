/**
 * geometry.js —— RSC 开槽箱的纯几何计算（不含任何绘制）
 *
 * 输入永远是一组真实毫米尺寸 { L, W, H }，输出也是毫米坐标。
 * 视图层只负责把毫米等比映射到屏幕像素。
 *
 * RSC（FEFCO 0201）展开图共 12 个区域：
 *
 *        [前顶][右顶][后顶][左顶]     ← 上摇盖带，高 W/2
 *        [ 前 ][ 右 ][ 后 ][ 左 ]     ← 箱身带，高 H
 *        [前底][右底][后底][左底]     ← 下摇盖带，高 W/2
 *
 * 前/后箱身面挂主摇盖（major，L × W/2，两片对开拼成顶面）；
 * 左/右箱身面挂防尘摇盖（minor，W × W/2，先折入再压主摇盖）。
 * 总宽 = 2L + 2W，总高 = H + W。
 */

/** 摇盖深度与箱宽的比例（标准 RSC：槽深 = W/2） */
export const FLAP_DEPTH_RATIO = 0.5;

/**
 * @param {{L:number,W:number,H:number}} dims 毫米
 */
export function computeNet(dims) {
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
    front: { x: x0, y: y1, w: L, h: H, kind: 'body' },
    right: { x: x1, y: y1, w: W, h: H, kind: 'body' },
    back: { x: x2, y: y1, w: L, h: H, kind: 'body' },
    left: { x: x3, y: y1, w: W, h: H, kind: 'body' },

    // 上摇盖：前/后为主摇盖，右/左为防尘摇盖
    topFront: { x: x0, y: y0, w: L, h: depth, kind: 'major' },
    topRight: { x: x1, y: y0, w: W, h: depth, kind: 'minor' },
    topBack: { x: x2, y: y0, w: L, h: depth, kind: 'major' },
    topLeft: { x: x3, y: y0, w: W, h: depth, kind: 'minor' },

    // 下摇盖：同构
    bottomFront: { x: x0, y: y2, w: L, h: depth, kind: 'major' },
    bottomRight: { x: x1, y: y2, w: W, h: depth, kind: 'minor' },
    bottomBack: { x: x2, y: y2, w: L, h: depth, kind: 'major' },
    bottomLeft: { x: x3, y: y2, w: W, h: depth, kind: 'minor' },
  };

  // 裁切线：12 个区域拼成完整刀模，外轮廓就是整个矩形
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
    shape: 'rsc',
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
    groups: {
      body: ['front', 'right', 'back', 'left'],
      major: ['topFront', 'topBack', 'bottomFront', 'bottomBack'],
      minor: ['topRight', 'topLeft', 'bottomRight', 'bottomLeft'],
    },
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
