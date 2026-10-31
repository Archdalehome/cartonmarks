/**
 * iso-view.js —— 等轴测轮廓线稿
 * 输入 computeIso() 的三维投影结果，按容器宽度等比缩放后绘制。
 */

import { svgEl, node, ensureDefs, line, pathEl, dimLine, contentWidth } from './svg.js';
import { computeIso } from './geometry.js';
import { fmt } from './units.js';

const PAD_X = 54;
const PAD_Y = 38;

export function renderIso(host, input) {
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
  const scale = Math.min((cw - PAD_X * 2) / bw, (maxH - PAD_Y * 2) / bh);

  const totalH = Math.round(bh * scale + PAD_Y * 2);
  const ox = (cw - bw * scale) / 2 - minX * scale;
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
  const dims3 = [
    { key: 'L', label: `L ${fmt(dims.L)}`, offset: 26 },
    { key: 'W', label: `W ${fmt(dims.W)}`, offset: 26 },
    {
      key: 'H',
      label: hasFront ? `H(前) ${fmt(dims.Hfront)}` : `H ${fmt(dims.H)}`,
      offset: 26,
    },
  ];
  for (const item of dims3) {
    const [a, b] = iso.anchors[item.key].map(P);
    dimLine(root, { a, b, label: item.label, offset: item.offset, center });
  }

  host.replaceChildren(root);
  return root;
}
