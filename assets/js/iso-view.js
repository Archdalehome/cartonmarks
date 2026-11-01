/**
 * iso-view.js —— 等轴测轮廓线稿
 * 输入 computeIso() 的三维投影结果，按容器宽度等比缩放后绘制。
 */

import { svgEl, node, ensureDefs, line, textEl, pathEl, dimLine, recordLabel, contentWidth } from './svg.js';
import { computeIso } from './geometry.js';
import { fmtLength } from './units.js';

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

/** 凸包在某个 y 上的左边界 x（引线要从这里往左画，才算在箱体外面） */
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

const PAD_X = 54;
const PAD_Y = 38;

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

  const maxH = Math.min(430, Math.max(230, Math.round((window.innerHeight || 820) * 0.38)));
  // L 形箱的 W(前)/W(后) 要引到图形左侧外面，左边多留一点边距
  const padLeft = iso.anchors && iso.anchors.Wfront ? 158 : PAD_X;
  const scale = Math.min((cw - padLeft - PAD_X) / bw, (maxH - PAD_Y * 2) / bh);

  const totalH = Math.round(bh * scale + PAD_Y * 2);
  const ox = padLeft + ((cw - padLeft - PAD_X) - bw * scale) / 2 - minX * scale;
  const oy = PAD_Y - minY * scale;

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
    x: (minX + maxX) / 2 * scale + ox,
    y: (minY + maxY) / 2 * scale + oy,
  };
  const hasFront = Number.isFinite(Number(dims.Hfront));
  // 主标注：L / W；矩形箱的 H 也在右侧竖棱上
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
  for (const item of dims3) {
    const anchor = iso.anchors[item.key];
    if (!anchor) continue;
    const [a, b] = anchor.map(P);
    if (!a || !b) continue;
    dimLine(root, { a, b, label: item.label, offset: item.offset, center });
  }

  // 左侧外引标注：从被标棱的两端往左牵一条细虚线到尺寸线为止，再在左侧竖直连起来
  const screenX = (id) => P(id).x;
  const allX = Object.keys(iso.corners).map(screenX);
  const minScreenX = Math.min(...allX);
  const extLines = [];
  /**
   * @param {number} targetX 尺寸线所在的屏幕 x（在箱体左侧外面）
   * @param {number} labelAt 文字落在尺寸线上的位置（0..1），用来把相邻标注错开
   */
  const dimOutside = (key, label, targetX, labelAt = 0.5) => {
    const anchor = iso.anchors[key];
    if (!anchor) return;
    const a = P(anchor[0]);
    const b = P(anchor[1]);
    if (!a || !b) return;
    // 延长线：只往左走，并且从箱体轮廓外面才开始画，避免虚线横穿箱体
    const a2 = { x: targetX, y: a.y };
    const b2 = { x: targetX, y: b.y };
    for (const [from, to] of [
      [a, a2],
      [b, b2],
    ]) {
      const startX = Math.min(from.x, hullLeftX(hull, from.y) - 2);
      if (startX <= to.x + 1) continue; // 太短就不画，免得贴着箱体
      const el2 = line(startX, from.y, to.x, from.y, { class: 'dim-ext' });
      root.appendChild(el2);
      extLines.push({ x1: startX, y1: from.y, x2: to.x, y2: from.y });
    }
    // 尺寸线：竖直落在左侧，把两条延长线连起来，箭头朝内
    root.appendChild(
      line(a2.x, a2.y, b2.x, b2.y, {
        class: 'dim-line',
        'marker-start': 'url(#cm-dim-arrow)',
        'marker-end': 'url(#cm-dim-arrow)',
      }),
    );
    // 文字竖排压在尺寸线外侧
    const lx = targetX - 8;
    const ly = a2.y + (b2.y - a2.y) * labelAt;
    root.appendChild(
      textEl(lx, ly, label, {
        class: 'dim-text',
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        transform: `rotate(-90 ${lx} ${ly})`,
      }),
    );
    recordLabel(root, label, lx, ly, -90);
  };
  if (iso.anchors.Wback) {
    dimOutside('Wback', `W(后) ${fmtLength(dims.Wback, unit)}`, minScreenX - 96, 0.25);
  }
  if (iso.anchors.Wfront) {
    dimOutside('Wfront', `W(前) ${fmtLength(dims.Wfront, unit)}`, minScreenX - 96, 0.8);
  }
  if (hasFront && iso.anchors.H) {
    dimOutside('H', `H(前) ${fmtLength(dims.Hfront, unit)}`, minScreenX - 44, 0.5);
  }
  root.__extLines = extLines;
  root.__hull = hull;

  host.replaceChildren(root);
  return root;
}
