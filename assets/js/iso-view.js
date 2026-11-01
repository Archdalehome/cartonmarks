/**
 * iso-view.js —— 等轴测轮廓线稿
 * 输入 computeIso() 的三维投影结果，按容器宽度等比缩放后绘制。
 *
 * 尺寸标注的两条硬规则（三种箱型统一）：
 *  1. 尺寸线平行于被标的那条棱，落在箱体外侧；
 *  2. 延长线只走等轴测的三个轴向（右 30° / 左 30° / 竖直），并且只画箱体外面那段。
 */

import { svgEl, node, ensureDefs, line, textEl, pathEl, dimLine, recordLabel, contentWidth } from './svg.js';
import { computeIso } from './geometry.js';
import { fmtLength } from './units.js';

/* ── 等轴测三轴 ───────────────────────────────────────── */

/** 等轴测只有三个轴向：长（右 30°）、深（左 30°）、高（竖直）。尺寸线与延长线只允许走这三个方向。 */
export const ISO_AXES = [
  { id: 'x', v: { x: Math.cos(Math.PI / 6), y: 0.5 } },
  { id: 'y', v: { x: -Math.cos(Math.PI / 6), y: 0.5 } },
  { id: 'z', v: { x: 0, y: -1 } },
];

function dirUnit(dx, dy) {
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** 两个方向的夹角（度），0 表示平行（同向或反向都算） */
export function angleBetween(d1, d2) {
  const u = dirUnit(d1.x, d1.y);
  const v = dirUnit(d2.x, d2.y);
  const cos = Math.min(1, Math.abs(u.x * v.x + u.y * v.y));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** 方向与最近一条等轴测轴的夹角（度），0 表示完全贴着某条轴 */
export function axisDeviation(dx, dy) {
  let best = 180;
  for (const ax of ISO_AXES) best = Math.min(best, angleBetween({ x: dx, y: dy }, ax.v));
  return best;
}

/** 一条棱平行于哪条轴（'x' / 'y' / 'z'） */
export function edgeAxisId(a, b) {
  let best = null;
  let bestDeg = 180;
  for (const ax of ISO_AXES) {
    const deg = angleBetween({ x: b.x - a.x, y: b.y - a.y }, ax.v);
    if (deg < bestDeg) {
      bestDeg = deg;
      best = ax.id;
    }
  }
  return best;
}

/* ── 轮廓与裁剪辅助 ───────────────────────────────────── */

/** 凸包（Andrew monotone chain），用来判断引线有没有横穿箱体 */
export function convexHull(points) {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** 凸包在某个 y 上的左边界 x（保留给旧调用方，尺寸标注改用可视面裁剪） */
export function hullLeftX(hull, y) {
  let best = Infinity;
  for (let i = 0; i < hull.length; i += 1) {
    const p = hull[i];
    const q = hull[(i + 1) % hull.length];
    if ((p.y - y) * (q.y - y) <= 0 && p.y !== q.y) {
      const x = p.x + ((q.x - p.x) * (y - p.y)) / (q.y - p.y);
      if (x < best) best = x;
    }
  }
  return best === Infinity ? -Infinity : best;
}

export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * 从 q 往 p 走，第一个碰到可见面的位置的参数 t（0..1，0 在 q），碰不到返回 null。
 * 用来把延长线截到箱体外面：延长线压在可见面上就会显得穿箱。
 */
export function firstFaceHit(q, p, polys) {
  let best = null;
  const rx = p.x - q.x;
  const ry = p.y - q.y;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const a = poly[j];
      const b = poly[i];
      const sx = b.x - a.x;
      const sy = b.y - a.y;
      const denom = rx * sy - ry * sx;
      if (Math.abs(denom) < 1e-9) continue;
      const qx = a.x - q.x;
      const qy = a.y - q.y;
      const t = (qx * sy - qy * sx) / denom;
      const u = (qx * ry - qy * rx) / denom;
      if (t <= 1e-6 || t > 1.000001 || u < -1e-6 || u > 1.000001) continue;
      if (best === null || t < best) best = t;
    }
  }
  return best;
}

const PAD_X = 62;
const PAD_Y = 38;
const EXT_GAP = 3; // 延长线离棱留的口子

export function renderIso(host, input, opts = {}) {
  const { unit = 'mm' } = opts;
  const cw = contentWidth(host);
  // 兼容两种入参：RSC 直接传尺寸（内部用 computeIso），新箱型传已算好的拉伸线稿
  const iso = input && input.corners ? input : computeIso(input);
  const dims = iso.dims || input;
  const pts = Object.values(iso.corners);

  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const bw = Math.max(1e-6, maxX - minX);
  const bh = Math.max(1e-6, maxY - minY);

  const hasFront = Number.isFinite(Number(dims.Hfront));
  // 外引标注（W(前)/W(后)/H(前)）在图形左侧，边距要留够
  const needsOutside = Boolean(iso.anchors.Wfront || (hasFront && iso.anchors.H));
  const maxH = Math.min(430, Math.max(230, Math.round((window.innerHeight || 820) * 0.38)));
  const padLeft = needsOutside ? 132 : PAD_X;
  const padTop = iso.anchors.Wback ? 80 : PAD_Y;
  const scale = Math.min((cw - padLeft - PAD_X) / bw, (maxH - padTop - PAD_Y) / bh);

  const totalH = Math.round(bh * scale + padTop + PAD_Y);
  const ox = padLeft + ((cw - padLeft - PAD_X) - bw * scale) / 2 - minX * scale;
  const oy = padTop - minY * scale;

  const root = svgEl(cw, totalH, { class: 'iso-svg', role: 'img' });
  ensureDefs(root);

  const P = (id) => ({
    x: iso.corners[id].x * scale + ox,
    y: iso.corners[id].y * scale + oy,
  });
  const hull = convexHull(Object.keys(iso.corners).map(P));

  /* 1. 可见面浅色填充，让线稿有体积 */
  for (const face of iso.faces) {
    const d = face.points
      .map((id, i) => {
        const q = P(id);
        return `${i === 0 ? 'M' : 'L'}${q.x.toFixed(2)},${q.y.toFixed(2)}`;
      })
      .join(' ') + ' Z';
    root.appendChild(pathEl(d, { class: 'iso-fill', fill: face.fill }));
  }
  // 可见面的屏幕多边形：延长线不许压在它们上面
  const facePolys = iso.faces.map((f) => f.points.map(P));

  /* 2. 12 条棱：可见实线、被遮挡虚线 */
  for (const e of iso.edges) {
    const a = P(e.a);
    const b = P(e.b);
    root.appendChild(
      line(a.x, a.y, b.x, b.y, { class: `iso-edge${e.hidden ? ' is-hidden' : ''}` }),
    );
  }

  /* 3. 尺寸线 L / W / H */
  const center = {
    x: ((minX + maxX) / 2) * scale + ox,
    y: ((minY + maxY) / 2) * scale + oy,
  };
  const dims3 = [
    { key: 'L', label: `L ${fmtLength(dims.L, unit)}`, offset: 26 },
    { key: 'W', label: `W ${fmtLength(dims.W, unit)}`, offset: 26 },
  ];
  if (!hasFront) {
    dims3.push({ key: 'H', label: `H ${fmtLength(dims.H, unit)}`, offset: 26 });
  }
  if (iso.anchors.Hback) {
    dims3.push({ key: 'Hback', label: `H(后) ${fmtLength(dims.Hback, unit)}`, offset: 42 });
  }
  const dimRecords = [];
  for (const item of dims3) {
    const anchor = iso.anchors[item.key];
    if (!anchor) continue;
    const [a, b] = anchor.map(P);
    if (!a || !b) continue;
    const out = dimLine(root, { a, b, label: item.label, offset: item.offset, center });
    dimRecords.push({ key: item.key, edge: { a, b }, line: out, kind: 'dim' });
  }

  /* 4. 外引标注（L 形的 W(前)/W(后)、斜形与 L 形的 H(前)）：
   *    尺寸线平行于被标棱，整体沿另一条等轴测轴挪到箱体外侧；
   *    延长线同样走等轴测轴向，并且只画箱体外面那段（不压在可见面上）。 */
  const outsideDims = [];
  const extLines = [];

  const clipExt = (from, to) => {
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return null;
    const hit = firstFaceHit(to, from, facePolys);
    const usable = Math.max(0, (hit === null ? len : len * hit) - EXT_GAP);
    if (usable < 5) return null;
    return {
      x1: to.x,
      y1: to.y,
      x2: to.x + (dx / len) * usable,
      y2: to.y + (dy / len) * usable,
    };
  };

  /**
   * @param {string} key anchors 的 key
   * @param {string} label 文字
   * @param {number} offsetPx 沿偏移轴挪出去的距离（像素）
   */
  const dimOutside = (key, label, offsetPx) => {
    const anchor = iso.anchors[key];
    if (!anchor) return;
    const a = P(anchor[0]);
    const b = P(anchor[1]);
    if (!a || !b) return;

    const edgeAxis = edgeAxisId(a, b);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const away = dirUnit(mid.x - center.x, mid.y - center.y);

    // 偏移轴：除被标棱自身外的两条轴里，指向箱体外侧的那条
    let offsetVec = null;
    let bestScore = -Infinity;
    for (const ax of ISO_AXES) {
      if (ax.id === edgeAxis) continue;
      for (const sign of [1, -1]) {
        const v = { x: ax.v.x * sign, y: ax.v.y * sign };
        const score = v.x * away.x + v.y * away.y;
        if (score > bestScore) {
          bestScore = score;
          offsetVec = v;
        }
      }
    }
    if (!offsetVec) return;

    const off = { x: offsetVec.x * offsetPx, y: offsetVec.y * offsetPx };
    const a2 = { x: a.x + off.x, y: a.y + off.y };
    const b2 = { x: b.x + off.x, y: b.y + off.y };

    const ext = [];
    for (const [from, to] of [
      [a, a2],
      [b, b2],
    ]) {
      const seg = clipExt(from, to);
      if (!seg) continue;
      root.appendChild(line(seg.x1, seg.y1, seg.x2, seg.y2, { class: 'dim-ext' }));
      ext.push(seg);
      extLines.push(seg);
    }

    root.appendChild(
      line(a2.x, a2.y, b2.x, b2.y, {
        class: 'dim-line',
        'marker-start': 'url(#cm-dim-arrow)',
        'marker-end': 'url(#cm-dim-arrow)',
      }),
    );

    // 文字沿尺寸线方向摆，落在线外侧
    const ang = (Math.atan2(b2.y - a2.y, b2.x - a2.x) * 180) / Math.PI;
    let rot = ang;
    if (rot > 90) rot -= 180;
    if (rot <= -90) rot += 180;
    const rad = (ang * Math.PI) / 180;
    let nx = -Math.sin(rad);
    let ny = Math.cos(rad);
    if ((mid.x - center.x) * nx + (mid.y - center.y) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const lx = (a2.x + b2.x) / 2 + nx * 11;
    const ly = (a2.y + b2.y) / 2 + ny * 11;
    root.appendChild(
      textEl(lx, ly, label, {
        class: 'dim-text',
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        transform: `rotate(${rot.toFixed(2)} ${lx.toFixed(2)} ${ly.toFixed(2)})`,
      }),
    );
    recordLabel(root, label, lx, ly, rot);

    outsideDims.push({
      key,
      edge: { a, b },
      line: { a: a2, b: b2 },
      ext,
    });
  };

  if (iso.anchors.Wback) dimOutside('Wback', `W(后) ${fmtLength(dims.Wback, unit)}`, 46);
  if (iso.anchors.Wfront) dimOutside('Wfront', `W(前) ${fmtLength(dims.Wfront, unit)}`, 46);
  if (hasFront && iso.anchors.H) dimOutside('H', `H(前) ${fmtLength(dims.Hfront, unit)}`, 78);

  root.__extLines = extLines;
  root.__hull = hull;
  root.__faces = facePolys;
  root.__dims = dimRecords.concat(outsideDims);

  host.replaceChildren(root);
  return root;
}
