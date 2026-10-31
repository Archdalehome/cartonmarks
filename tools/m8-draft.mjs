/**
 * m8-draft.mjs —— 生成 M8 两张展开图草案（SVG + HTML，供截图给用户确认）
 *
 * 用法：node tools/m8-draft.mjs
 * 输出：.tmp/m8-bevel.svg / .tmp/m8-lshape.svg
 *       .tmp/m8-bevel.html / .tmp/m8-lshape.html
 *
 * 只用真实毫米算，绘制时整体乘 scale。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeNet } from '../assets/js/geometry.js';
import '../assets/js/geometry-shapes.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', '.tmp');
mkdirSync(outDir, { recursive: true });

const SCALE = 0.55; // px / mm
const PAD = { top: 96, right: 84, bottom: 232, left: 96 };

const mm = (v) => (Math.round(v * 1000) / 1000).toString();
const round1 = (v) => Number(v.toFixed(1));

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderDraft(net, opts) {
  const drawW = net.width * SCALE;
  const drawH = net.height * SCALE;
  const W = Math.round(drawW + PAD.left + PAD.right);
  const H = Math.round(drawH + PAD.top + PAD.bottom);
  const ox = PAD.left;
  const oy = PAD.top;

  const X = (v) => ox + v * SCALE;
  const Y = (v) => oy + v * SCALE;

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'Microsoft YaHei','PingFang SC','Noto Sans SC',sans-serif">`,
  );
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(
    `<text x="${ox - 60}" y="40" font-size="26" font-weight="700" fill="#0f172a">${esc(opts.title)}</text>`,
  );
  parts.push(
    `<text x="${ox - 60}" y="68" font-size="15" fill="#64748b">${esc(opts.subtitle)}</text>`,
  );

  // 面板
  const labels = [];
  for (const [key, p] of Object.entries(net.panels)) {
    const pts = p.points
      ? p.points.map(([px, py]) => `${mm(X(px))},${mm(Y(py))}`).join(' ')
      : `${mm(X(p.x))},${mm(Y(p.y))} ${mm(X(p.x + p.w))},${mm(Y(p.y))} ${mm(X(p.x + p.w))},${mm(Y(p.y + p.h))} ${mm(X(p.x))},${mm(Y(p.y + p.h))}`;
    const fill = p.kind === 'body' ? '#e8eef7' : '#f6f8fc';
    parts.push(
      `<polygon points="${pts}" fill="${fill}" stroke="#334155" stroke-width="1.6" stroke-linejoin="round" data-panel="${key}"/>`,
    );
    const cx = X(p.x + p.w / 2);
    const cy = Y(p.y + p.h / 2);
    // 折线正好穿过文字时把文字块错开，避免看不清
    const foldYs = (net.folds || [])
      .filter((f) => Math.abs(f.y1 - f.y2) < 1e-9)
      .map((f) => Y(f.y1));
    let shift = 0;
    if (foldYs.some((fy) => Math.abs(fy - cy) < 34)) {
      shift = Y(p.y + p.h) - 26 - cy > 8 ? 24 : -24;
    }
    const twoLine = p.w * SCALE >= 92;
    labels.push(
      `<text x="${mm(cx)}" y="${mm(cy - (twoLine ? 4 : -5) + shift)}" font-size="15" font-weight="600" fill="#0f172a" text-anchor="middle" stroke="#ffffff" stroke-width="6" paint-order="stroke">${esc(p.label)}</text>`,
    );
    labels.push(
      `<text x="${mm(cx)}" y="${mm(cy + 17 + shift)}" font-size="13" fill="#475569" text-anchor="middle" stroke="#ffffff" stroke-width="6" paint-order="stroke">${esc(opts.sizeText(p))}</text>`,
    );
  }

  // 折线（画在文字下面，靠文字白边压住）
  for (const f of net.folds || []) {
    parts.push(
      `<line x1="${mm(X(f.x1))}" y1="${mm(Y(f.y1))}" x2="${mm(X(f.x2))}" y2="${mm(Y(f.y2))}" stroke="#2563eb" stroke-width="1.4" stroke-dasharray="7 5"/>`,
    );
  }
  parts.push(...labels);

  const hdim = (x1, x2, y, label, strong) => {
    const yy = mm(Y(y));
    const parts2 = [
      `<line x1="${mm(X(x1))}" y1="${yy}" x2="${mm(X(x2))}" y2="${yy}" stroke="#0f172a" stroke-width="${strong ? 1.4 : 1}"/>`,
      `<line x1="${mm(X(x1))}" y1="${mm(Y(y) - 6)}" x2="${mm(X(x1))}" y2="${mm(Y(y) + 6)}" stroke="#0f172a" stroke-width="1.2"/>`,
      `<line x1="${mm(X(x2))}" y1="${mm(Y(y) - 6)}" x2="${mm(X(x2))}" y2="${mm(Y(y) + 6)}" stroke="#0f172a" stroke-width="1.2"/>`,
      `<text x="${mm(X((x1 + x2) / 2))}" y="${mm(Y(y) + (strong ? 24 : 20))}" font-size="${strong ? 17 : 14}" font-weight="${strong ? 700 : 500}" fill="#0f172a" text-anchor="middle">${esc(label)}</text>`,
    ];
    parts.push(...parts2);
  };

  const vdim = (x, y1, y2, label, strong) => {
    parts.push(
      `<line x1="${mm(X(x))}" y1="${mm(Y(y1))}" x2="${mm(X(x))}" y2="${mm(Y(y2))}" stroke="#0f172a" stroke-width="${strong ? 1.4 : 1}"/>`,
      `<line x1="${mm(X(x) - 6)}" y1="${mm(Y(y1))}" x2="${mm(X(x) + 6)}" y2="${mm(Y(y1))}" stroke="#0f172a" stroke-width="1.2"/>`,
      `<line x1="${mm(X(x) - 6)}" y1="${mm(Y(y2))}" x2="${mm(X(x) + 6)}" y2="${mm(Y(y2))}" stroke="#0f172a" stroke-width="1.2"/>`,
      `<text x="${mm(X(x) + 10)}" y="${mm(Y((y1 + y2) / 2))}" font-size="${strong ? 17 : 14}" font-weight="${strong ? 700 : 500}" fill="#0f172a" dominant-baseline="middle">${esc(label)}</text>`,
    );
  };

  // 总宽 / 总高
  hdim(0, net.width, net.height + 92 / SCALE, `总宽 ${round1(net.width)} mm`, true);
  vdim(-70 / SCALE, 0, net.height, `总高 ${round1(net.height)} mm`, true);

  if (opts.dims) opts.dims(parts, { X, Y, mm, hdim, vdim, net });

  // 说明行
  let ty = H - 84;
  for (const line of opts.notes) {
    parts.push(
      `<text x="${ox - 60}" y="${ty}" font-size="15" fill="#334155">${esc(line)}</text>`,
    );
    ty += 24;
  }

  parts.push('</svg>');
  return parts.join('\n');
}

const html = (svg, title) =>
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title>` +
  `<style>html,body{margin:0;padding:0;background:#fff}svg{display:block}</style></head>` +
  `<body>${svg}</body></html>`;

const bevel = computeNet({ L: 600, W: 400, Hfront: 300, Hback: 450 }, 'bevel');
const lshape = computeNet(
  { L: 600, W: 400, Hfront: 300, Hback: 450, Wfront: 250, Wback: 150 },
  'lshape',
);

const bevelSvg = renderDraft(bevel, {
  title: '斜形箱展开图（草案 v2，待确认）',
  subtitle:
    'L 600 · W 400 · H(前) 300 · H(后) 450   总宽 2000 · 总高 927.2   单位 mm   蓝虚线=折线',
  sizeText: (p) => `${p.w.toFixed(1)} × ${p.h.toFixed(1)}`,
  notes: [
    '从左到右：前(L×H前) → 右(梯形 W，前 300 过渡到后 450) → 后(L×H后) → 左(梯形，反向)',
    '顶部一整片单摇盖 600 × 427.2（斜边实长 √(400²+150²)），中间不折，折到后沿为止；顶部无防尘摇盖',
    '底部 2 片主摇盖各 600×200 + 2 片侧面防尘摇盖（灰底，不可编辑、不进 PDF）',
  ],
  dims(parts, { X, Y, mm, hdim, vdim, net }) {
    hdim(0, bevel.dims.L, (net.height + 34 / SCALE), `L ${bevel.dims.L}`, false);
    hdim(bevel.dims.L, bevel.dims.L + bevel.dims.W, (net.height + 34 / SCALE), `W ${bevel.dims.W}`, false);
    // 顶盖展开长度标注（顶盖在最上方一列）
    // removed, bevel.panels.topLid.y, bevel.panels.topLid.y + bevel.panels.topLid.h, '顶盖 427.2', false);
  },
});

const lshapeSvg = renderDraft(lshape, {
  title: 'L 形箱展开图（草案 v2，待确认）',
  subtitle:
    'L 600 · W(前) 250 · W(后) 150 → W 400 · H(前) 300 · H(后) 450   总宽 2000 · 总高 1050   单位 mm',
  sizeText: (p) => `${p.w.toFixed(1)} × ${p.h.toFixed(1)}`,
  notes: [
    '从左到右：前(L×H前) → 右(台阶形，前段 250 高 300、后段 150 高 450) → 后(L×H后) → 左(台阶镜像)',
    '顶部一整片单摇盖 600 × 550（250 前段顶 + 150 竖壁 + 150 后段顶），片内两条折线距根部 250 和 400',
    '台阶竖线在右侧面距前边 250mm；底面 2 片主摇盖各 600×200 + 2 片侧面防尘摇盖（不可编辑）',
  ],
  dims(parts, { X, Y, mm, hdim, vdim, net }) {
    hdim(0, lshape.dims.L, (net.height + 34 / SCALE), `L ${lshape.dims.L}`, false);
    hdim(
      lshape.dims.L,
      lshape.dims.L + lshape.dims.Wfront,
      (net.height + 34 / SCALE),
      `W(前) ${lshape.dims.Wfront}`,
      false,
    );
    hdim(
      lshape.dims.L + lshape.dims.Wfront,
      lshape.dims.L + lshape.dims.W,
      (net.height + 34 / SCALE),
      `W(后) ${lshape.dims.Wback}`,
      false,
    );
    // removed, lshape.panels.topLid.y, lshape.panels.topLid.y + lshape.panels.topLid.h, '顶盖 550', false);
  },
});

const files = [
  ['m8-bevel', '斜形箱展开图草案', bevelSvg],
  ['m8-lshape', 'L 形箱展开图草案', lshapeSvg],
];

for (const [name, title, svg] of files) {
  writeFileSync(resolve(outDir, `${name}.svg`), svg, 'utf8');
  writeFileSync(resolve(outDir, `${name}.html`), html(svg, title), 'utf8');
  console.log(`${name}: ${svg.length} bytes`);
}
console.log(`总宽/总高 斜形 = ${bevel.width} × ${bevel.height}，L 形 = ${lshape.width} × ${lshape.height}`);
for (const [k, p] of Object.entries(bevel.panels)) console.log(`  斜形 ${k}: ${p.label} ${Math.round(p.w)}×${Math.round(p.h)} @(${Math.round(p.x)},${Math.round(p.y)})`);
for (const [k, p] of Object.entries(lshape.panels)) console.log(`  L形 ${k}: ${p.label} ${Math.round(p.w)}×${Math.round(p.h)} @(${Math.round(p.x)},${Math.round(p.y)})`);
