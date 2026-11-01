/**
 * iso-view.js —— 等轴测轮廓线稿
 * 输入 computeIso() 的三维投影结果，按容器宽度等比缩放后绘制。
 */

import { svgEl, node, ensureDefs, line, textEl, pathEl, dimLine, recordLabel, contentWidth } from './svg.js';
import { computeIso } from './geometry.js';
import { fmtLength } from './units.js';

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

  // 左侧外引标注：W(前)/W(后) 平行于顶面棱，H(前) 用另一条引线指到左下角外
  const screenX = (id) => P(id).x;
  const allX = Object.keys(iso.corners).map(screenX);
  const minScreenX = Math.min(...allX);
  /**
   * 把某条棱的尺寸线整体平移到图形左侧外面用细虚线引出去。
   * labelAt: 文字落在这条尺寸线上的位置（0..1），用来把两条平行标注错开。
   */
  const dimOutside = (key, label, targetX, labelAt = 0.5) => {
    const anchor = iso.anchors[key];
    if (!anchor) return;
    const a = P(anchor[0]);
    const b = P(anchor[1]);
    if (!a || !b) return;
    const dx = targetX - (a.x + b.x) / 2;
    const a2 = { x: a.x + dx, y: a.y };
    const b2 = { x: b.x + dx, y: b.y };
    root.appendChild(line(a.x, a.y, a2.x, a2.y, { class: 'dim-ext' })); // 延长线（细虚线）
    root.appendChild(line(b.x, b.y, b2.x, b2.y, { class: 'dim-ext' }));
    root.appendChild(
      line(a2.x, a2.y, b2.x, b2.y, {
        class: 'dim-line',
        'marker-start': 'url(#cm-dim-arrow)',
        'marker-end': 'url(#cm-dim-arrow)',
      }),
    );
    // 文字垂直于尺寸线方向让开一点，压在上方
    const isVerticalLine = Math.abs(a2.x - b2.x) < 1;
    const lx = a2.x + (b2.x - a2.x) * labelAt + (isVerticalLine ? -8 : 0);
    const ly = a2.y + (b2.y - a2.y) * labelAt - (isVerticalLine ? 0 : 7);
    root.appendChild(
      textEl(lx, ly, label, {
        class: 'dim-text',
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
      }),
    );
    recordLabel(root, label, lx, ly, isVerticalLine ? -90 : 0);
  };
  if (iso.anchors.Wback) {
    // 两条平行标注一个靠上、一个靠下，避免文字包围盒相交
    dimOutside('Wback', `W(后) ${fmtLength(dims.Wback, unit)}`, minScreenX - 96, 0.2);
  }
  if (iso.anchors.Wfront) {
    dimOutside('Wfront', `W(前) ${fmtLength(dims.Wfront, unit)}`, minScreenX - 96, 0.85);
  }
  if (hasFront && iso.anchors.H) {
    dimOutside('H', `H(前) ${fmtLength(dims.Hfront, unit)}`, minScreenX - 44, 0.5);
  }

  host.replaceChildren(root);
  return root;
}
