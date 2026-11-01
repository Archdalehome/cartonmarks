/**
 * geometry-shapes.js —— 斜形箱 / L 形箱几何（M8）
 *
 * 两种箱型都是「有高差」的箱子：前沿高 H(前)、后沿高 H(后)。
 *  - 斜形箱（bevel）：顶面从前往后斜，只输 L / W / H(前) / H(后)
 *  - L 形箱（lshape）：顶面一级台阶，深度分成 W(前) / W(后)，W = W(前)+W(后) 派生
 *
 * 顶盖是从前面板顶边翻过去的「一整片单摇盖」（用户 2026-10-31 确认：顶部单摇盖，
 * 一片到底，不再用两片各半）：
 *
 *   斜形箱：整片 L × √(W²+ΔH²)              一整片，中间不折
 *   L 形箱：整片 L × (W(前) + |ΔH| + W(后))   片内两条折线，距根部 W(前) 和 W(前)+|ΔH|
 *
 * 底面是平的：2 片主摇盖（各 L×W/2，在中间对接）+ 2 片侧面防尘摇盖（不可编辑）。
 * 顶部不再画防尘摇盖 —— 一整片已经盖满，再加就是多余的纸。
 *
 * 展开图从左到右仍是四面连成一行：前 / 右 / 后 / 左，顶盖竖着长在「前」这一列上方。
 * 面板除 x/y/w/h 外还带 points（毫米多边形），因为侧面是梯形或台阶形。
 *
 * 单位一律毫米。
 */

import { FLAP_DEPTH_RATIO, registerShapeGeometry } from './geometry.js';

function pos(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bbox(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function panel(label, kind, points) {
  const b = bbox(points);
  return {
    label,
    kind,
    slot: kind,
    editable: kind !== 'minor',
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    points,
  };
}

function rectPanel(label, kind, x, y, w, h) {
  return panel(label, kind, [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]);
}

const hFold = (x1, x2, y) => ({ x1, y1: y, x2, y2: y });
const vFold = (x, y1, y2) => ({ x1: x, y1, x2: x, y2 });

function baseDims(dims) {
  return {
    L: pos(dims.L, 1),
    Hf: pos(dims.Hfront ?? dims.H, 1),
    Hb: pos(dims.Hback ?? dims.H, 1),
  };
}

/**
 * 裁切外轮廓：上沿按从左到右的「料边」点走，右侧竖直到底，底边一条直线回来。
 * @param {Array<[number,number]>} top 上沿点（x 递增）
 * @param {number} rightX 展开图最右边的 x
 * @param {number} bottomY 展开图最下边的 y
 */
function outlineOf(top, rightX, bottomY) {
  const pts = top.map(([x, y]) => [x, y]);
  pts.push([rightX, bottomY]);
  pts.push([top[0][0], bottomY]);
  return pts;
}

/* ── 斜形箱 ───────────────────────────────────────────── */

function computeBevel(dims, shapeId) {
  const { L, Hf, Hb } = baseDims(dims);
  const W = pos(dims.W, 1);

  const bottomDepth = W * FLAP_DEPTH_RATIO; // 底盖深 W/2
  const slope = Math.hypot(W, Hb - Hf); // 斜面实长（两片顶摇盖合计）
  const half = slope / 2; // 一片顶摇盖的深度（用户 2026-10-31 确认：两片各一半）
  const width = 2 * L + 2 * W;
  const height = bottomDepth + Math.max(Hf, Hb) + half;

  const x0 = 0;
  const x1 = L;
  const x2 = L + W;
  const x3 = 2 * L + W;
  const x4 = 2 * L + 2 * W;

  const yBot = height - bottomDepth;
  const yF = yBot - Hf; // 前面板顶边 = 前顶摇盖折线
  const yFTop = yF - half; // 前顶摇盖最远边
  const yB = yBot - Hb; // 后面板顶边 = 后顶摇盖折线
  const yBTop = yB - half; // 后顶摇盖最远边

  const panels = {
    front: rectPanel('前箱唛', 'body', x0, yF, L, Hf),
    right: panel('右侧箱唛', 'body', [
      [x1, yBot],
      [x2, yBot],
      [x2, yB],
      [x1, yF],
    ]),
    back: rectPanel('后箱唛', 'body', x2, yB, L, Hb),
    left: panel('左侧箱唛', 'body', [
      [x3, yBot],
      [x4, yBot],
      [x4, yF],
      [x3, yB],
    ]),

    // 顶摇盖：两片对开，各占斜面实长的一半
    topFront: rectPanel('前顶箱唛', 'major', x0, yFTop, L, half),
    topBack: rectPanel('后顶箱唛', 'major', x2, yBTop, L, half),

    // 底面平的：两片主摇盖
    bottomFront: rectPanel('前底箱唛', 'major', x0, yBot, L, bottomDepth),
    bottomBack: rectPanel('后底箱唛', 'major', x2, yBot, L, bottomDepth),

    // 侧面底防尘摇盖（不可编辑、不进 PDF）
    dustBottomRight: rectPanel('右底防尘摇盖', 'minor', x1, yBot, W, bottomDepth),
    dustBottomLeft: rectPanel('左底防尘摇盖', 'minor', x3, yBot, W, bottomDepth),
  };

  const folds = [
    hFold(x0, x1, yF), // 前面板 ↔ 前顶摇盖
    hFold(x2, x3, yB), // 后面板 ↔ 后顶摇盖
    hFold(x0, x1, yBot), // 前面板 ↔ 前底摇盖
    hFold(x2, x3, yBot),
    vFold(x1, yF, yBot),
    vFold(x2, yB, yBot),
    vFold(x3, yB, yBot),
    hFold(x1, x2, yBot), // 右侧面 ↔ 右底防尘摇盖
    hFold(x3, x4, yBot), // 左侧面 ↔ 左底防尘摇盖
  ];

  return {
    shape: shapeId || 'bevel',
    shapeName: '斜形箱',
    width,
    height,
    flap: bottomDepth,
    flapDepth: bottomDepth,
    bodyTop: Math.min(yF, yB),
    bodyBottom: yBot,
    panels,
    outline: outlineOf(
      [
        [x0, yFTop],
        [x1, yFTop],
        [x1, yF],
        [x2, yB],
        [x2, yBTop],
        [x3, yBTop],
        [x3, yB],
        [x4, yF],
      ],
      x4,
      height,
    ),
    folds,
    cuts: [],
    dims: { L, W, Hfront: Hf, Hback: Hb },
    lid: { kind: 'split', keys: ['topFront', 'topBack'], length: slope, piece: half },
  };
}

/* ── L 形箱 ───────────────────────────────────────────── */

function computeLShape(dims, shapeId) {
  const { L, Hf, Hb } = baseDims(dims);

  // W 不由用户输入：W = W(前) + W(后) 派生
  const Wf = Number(dims.Wfront);
  const Wb = Number(dims.Wback);
  if (!(Wf > 0) || !(Wb > 0)) {
    throw new Error('L 形箱要求 W(前) 和 W(后) 都大于 0');
  }
  const W = Wf + Wb;

  const riser = Math.abs(Hb - Hf); // 竖壁展开高度
  const bottomDepth = W * FLAP_DEPTH_RATIO;
  const lidLen = Wf + riser + Wb; // 一整片顶盖的展开长度
  const width = 2 * L + 2 * W;
  const height = bottomDepth + Hf + lidLen;

  const x0 = 0;
  const x1 = L;
  const x2 = L + W;
  const x3 = 2 * L + W;
  const x4 = 2 * L + 2 * W;

  const yBot = height - bottomDepth;
  const yF = yBot - Hf; // 前面板顶边 = 顶盖根部
  const yLidTop = yF - lidLen;
  const yB = yBot - Hb;
  const xStepR = x1 + Wf;
  const xStepL = x4 - Wf;

  // 顶盖内两条折线：距根部 W(前) 与 W(前)+|ΔH|
  const fold1 = yF - Wf;
  const fold2 = yF - Wf - riser;

  const panels = {
    front: rectPanel('前箱唛', 'body', x0, yF, L, Hf),
    right: panel('右侧箱唛', 'body', [
      [x1, yBot],
      [x2, yBot],
      [x2, yB],
      [xStepR, yB],
      [xStepR, yF],
      [x1, yF],
    ]),
    back: rectPanel('后箱唛', 'body', x2, yB, L, Hb),
    left: panel('左侧箱唛', 'body', [
      [x3, yBot],
      [x4, yBot],
      [x4, yF],
      [xStepL, yF],
      [xStepL, yB],
      [x3, yB],
    ]),

    // 顶盖：一整片单摇盖，片内两条折线
    topLid: rectPanel('台阶顶盖箱唛', 'major', x0, yLidTop, L, lidLen),

    bottomFront: rectPanel('前底箱唛', 'major', x0, yBot, L, bottomDepth),
    bottomBack: rectPanel('后底箱唛', 'major', x2, yBot, L, bottomDepth),

    dustBottomRight: rectPanel('右底防尘摇盖', 'minor', x1, yBot, W, bottomDepth),
    dustBottomLeft: rectPanel('左底防尘摇盖', 'minor', x3, yBot, W, bottomDepth),
  };

  panels.topLid.foldGuides = [
    { y: lidLen - Wf, label: `折线 ${Wf}` },
    { y: lidLen - (Wf + riser), label: `折线 ${Wf + riser}` },
  ];

  const folds = [
    hFold(x0, x1, yF), // 前面板 ↔ 顶盖
    hFold(x0, x1, fold1), // 顶盖内折线 1（前段顶 → 竖壁）
    hFold(x0, x1, fold2), // 顶盖内折线 2（竖壁 → 后段顶）
    hFold(x0, x1, yBot),
    hFold(x2, x3, yB),
    hFold(x2, x3, yBot),
    vFold(x1, yF, yBot),
    vFold(x2, yB, yBot),
    vFold(x3, yB, yBot),
    vFold(xStepR, Math.min(yF, yB), Math.max(yF, yB)),
    vFold(xStepL, Math.min(yF, yB), Math.max(yF, yB)),
    hFold(x1, x2, yBot),
    hFold(x3, x4, yBot),
  ];

  return {
    shape: shapeId || 'lshape',
    shapeName: 'L 形箱',
    width,
    height,
    flap: bottomDepth,
    flapDepth: bottomDepth,
    bodyTop: Math.min(yF, yB),
    bodyBottom: yBot,
    panels,
    outline: outlineOf(
      [
        [x0, yLidTop],
        [x1, yLidTop],
        [x1, yF],
        [xStepR, yF],
        [xStepR, yB],
        [x2, yB],
        [x3, yB],
        [xStepL, yB],
        [xStepL, yF],
        [x4, yF],
      ],
      x4,
      height,
    ),
    folds,
    cuts: [],
    dims: { L, W, Hfront: Hf, Hback: Hb, Wfront: Wf, Wback: Wb },
    lid: { key: 'topLid', length: lidLen, roots: [Wf, Wf + riser] },
  };
}

/* ── 等轴测（新箱型：把侧视剖面沿长度方向拉伸） ───────── */

const ISO_X = { x: Math.cos(Math.PI / 6), y: 0.5 };
const ISO_Y = { x: -Math.cos(Math.PI / 6), y: 0.5 };
const ISO_Z = { x: 0, y: -1 };

function project(X, Y, Z) {
  return {
    x: X * ISO_X.x + Y * ISO_Y.x + Z * ISO_Z.x,
    y: X * ISO_X.y + Y * ISO_Y.y + Z * ISO_Z.y,
  };
}

/** 侧视剖面（Y = 深度，Z = 高），保证逆时针 */
function profileOf(shapeId, dims) {
  const Hf = pos(dims.Hfront ?? dims.H, 1);
  const Hb = pos(dims.Hback ?? dims.H, 1);
  let pts;
  if (shapeId === 'bevel') {
    const W = pos(dims.W, 1);
    pts = [
      [0, 0],
      [W, 0],
      [W, Hf],
      [0, Hb],
    ];
  } else {
    const Wf = Number(dims.Wfront);
    const Wb = Number(dims.Wback);
    const W = Wf + Wb;
    pts = [
      [0, 0],
      [W, 0],
      [W, Hf],
      [W - Wf, Hf],
      [W - Wf, Hb],
      [0, Hb],
    ];
  }
  const area = pts.reduce((acc, p, i) => {
    const q = pts[(i + 1) % pts.length];
    return acc + (p[0] * q[1] - q[0] * p[1]);
  }, 0);
  return area < 0 ? pts.reverse() : pts;
}

/**
 * 把剖面沿 X 方向（长度 L）拉伸成等轴测线稿，返回 iso-view 需要的结构。
 */
export function computeIsoShape(dims, shapeId) {
  const L = pos(dims.L, 1);
  const Hf = pos(dims.Hfront ?? dims.H, 1);
  const Hb = pos(dims.Hback ?? dims.H, 1);
  const Wf = Number(dims.Wfront);
  // 与 computeNet 用同一个宽度口径：斜形用 W，L 形用 W(前)+W(后)
  const W = shapeId === 'bevel' ? pos(dims.W, 1) : Wf + Number(dims.Wback);
  const profile = profileOf(shapeId, dims);
  const n = profile.length;

  const corners = {};
  const corners3d = {};
  for (let j = 0; j < n; j += 1) {
    const [Y, Z] = profile[j];
    for (const [id, X] of [['a' + j, 0], ['b' + j, L]]) {
      corners3d[id] = { X, Y, Z };
      corners[id] = project(X, Y, Z);
    }
  }

  // 侧面的外法线：CCW 剖面的边 (p→q) 外法线 = (dz, -dy)
  const sides = profile.map((p, j) => {
    const q = profile[(j + 1) % n];
    const dy = q[0] - p[0];
    const dz = q[1] - p[1];
    const ny = dz;
    const nz = -dy;
    return { j, normal: { y: ny, z: nz }, visible: ny + nz > 1e-9 };
  });

  // 所有面（含背面），可见性按相机方向 (1,1,1) 判断，不写死几条棱
  const allFaces = [];
  for (const s of sides) {
    const j = s.j;
    const k = (j + 1) % n;
    allFaces.push({
      id: 'side' + j,
      points: ['a' + j, 'b' + j, 'b' + k, 'a' + k],
      visible: s.visible,
      fill: s.normal.z > s.normal.y ? '#eef2f7' : '#e6ecf4',
    });
  }
  allFaces.push({ id: 'endFar', points: profile.map((_, j) => 'a' + j), visible: false, fill: '#f2f5f9' });
  allFaces.push({ id: 'endNear', points: profile.map((_, j) => 'b' + j), visible: true, fill: '#f2f5f9' });

  const faces = allFaces.filter((f) => f.visible);

  // 深度：正交投影沿 (1,1,1) 看，X+Y+Z 越大越靠近观察者
  const depthOf = (id) => {
    const c = corners3d[id];
    return c.X + c.Y + c.Z;
  };
  const projectedPolygon = (face) => face.points.map((id) => corners[id]);

  /** 点是否在多边形内（射线法）；poly 已按质心缩过一点，避免共边误判 */
  function pointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const a = poly[i];
      const b = poly[j];
      const hit =
        a.y > pt.y !== b.y > pt.y &&
        pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y || 1e-12) + a.x;
      if (hit) inside = !inside;
    }
    return inside;
  }

  function shrinkPolygon(poly, k = 0.985) {
    const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
    return poly.map((p) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k }));
  }

  /** 一条棱是否被别的可见面挡住 */
  function isOccluded(a, b, adjacent) {
    const mid = { x: (corners[a].x + corners[b].x) / 2, y: (corners[a].y + corners[b].y) / 2 };
    const edgeDepth = (depthOf(a) + depthOf(b)) / 2;
    for (const face of faces) {
      if (adjacent.includes(face.id)) continue;
      const poly = shrinkPolygon(projectedPolygon(face));
      if (!pointInPolygon(mid, poly)) continue;
      const faceDepth =
        face.points.reduce((s, id) => s + depthOf(id), 0) / face.points.length;
      if (faceDepth > edgeDepth + 1e-6) return true;
    }
    return false;
  }

  const edges = [];
  for (let j = 0; j < n; j += 1) {
    const k = (j + 1) % n;
    // 近端轮廓（X = L）：相邻面是端面与第 j 个侧面
    edges.push({
      a: 'b' + j,
      b: 'b' + k,
      hidden: !sides[j].visible && isOccluded('b' + j, 'b' + k, ['endNear', 'side' + j]),
    });
    // 远端轮廓（X = 0）：不再一律虚线，按是否被遮挡判定
    edges.push({
      a: 'a' + j,
      b: 'a' + k,
      hidden: isOccluded('a' + j, 'a' + k, ['endFar', 'side' + j]),
    });
    // 沿长度方向的长棱：相邻的是左右两个侧面
    const prev = sides[(j - 1 + n) % n];
    edges.push({
      a: 'a' + j,
      b: 'b' + j,
      hidden: isOccluded('a' + j, 'b' + j, ['side' + prev.j, 'side' + j]),
    });
  }

  const idx = (Ywant, Zwant) =>
    profile.findIndex((p) => Math.abs(p[0] - Ywant) < 1e-6 && Math.abs(p[1] - Zwant) < 1e-6);
  const frontBottom = idx(W, 0);
  const backBottom = idx(0, 0);
  const frontTop = profile.findIndex(
    (p) => Math.abs(p[1]) > 1e-9 && Math.abs(p[0] - W) < 1e-6,
  );
  // 剖面点没找到时不能拼出 'b-1' 这种不存在的角，回落到底面角
  const at = (j, fallback) => (j >= 0 && j < n ? j : fallback);
  const iF = at(frontBottom, 0);
  const iB = at(backBottom, 0);
  const iT = at(frontTop, iF);

  return {
    corners,
    corners3d,
    edges,
    faces,
    anchors: {
      L: ['a' + iF, 'b' + iF],
      W: ['b' + iB, 'b' + iF],
      H: ['a' + iF, 'a' + iT],
      // 后箱面竖棱上的 H(后)
      Hback: ['b' + iB, 'b' + at(idx(0, Hb), iB)],
      ...(shapeId === 'lshape'
        ? {
            // 台阶两个顶面上的 W(前) / W(后)
            Wfront: ['b' + at(idx(W - Wf, Hf), iF), 'b' + at(idx(W, Hf), iF)],
            Wback: ['b' + at(idx(0, Hb), iB), 'b' + at(idx(W - Wf, Hb), iB)],
          }
        : {}),
    },
    dims: { ...dims, L, W },
  };
}

registerShapeGeometry('bevel', computeBevel);
registerShapeGeometry('lshape', computeLShape);

export { computeBevel, computeLShape };
