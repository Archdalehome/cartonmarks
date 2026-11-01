/**
 * net-view.js —— 展开图（12 个区域）绘制
 *
 * 输入：computeNet() 的毫米坐标结果
 * 输出：一张按容器宽度等比缩放的 SVG，面板可点击/键盘选中
 */

import { svgEl, node, ensureDefs, line, rectEl, textEl, pathEl, dimLine, contentWidth } from './svg.js';
import { fmtLength, withUnit } from './units.js';

const PAD_TOP = 56;
const PAD_BOTTOM = 66;
const PAD_LEFT = 76;
const PAD_RIGHT = 86;

/**
 * @param {HTMLElement} host
 * @param {ReturnType<import('./geometry.js').computeNet>} net
 * @param {{selected?:string|null, onSelect?:(key:string)=>void}} [opts]
 *
 * 12 个区域都画；防尘摇盖（minor）只画轮廓与尺寸，不可点击、不参与箱唛。
 */
export function renderNet(host, net, opts = {}) {
  const { selected = null, onSelect = () => {}, unit = 'mm' } = opts;

  const cw = contentWidth(host);
  const maxDrawH = Math.max(220, Math.min(620, Math.round((window.innerHeight || 820) * 0.56)));
  const availW = Math.max(120, cw - PAD_LEFT - PAD_RIGHT);
  const scale = Math.min(availW / net.width, maxDrawH / net.height);

  const drawW = net.width * scale;
  const drawH = net.height * scale;
  const ox = PAD_LEFT + Math.max(0, (availW - drawW) / 2);
  const oy = PAD_TOP;
  const totalH = Math.round(drawH + PAD_TOP + PAD_BOTTOM);

  const root = svgEl(cw, totalH, { class: 'net-svg', role: 'img' });
  ensureDefs(root);

  const X = (mm) => ox + mm * scale;
  const Y = (mm) => oy + mm * scale;
  const center = { x: X(net.width / 2), y: Y(net.height / 2) };

  /* 1. 裁切轮廓（整张刀模是一个矩形） */
  const d = net.outline
    .map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${X(px).toFixed(2)},${Y(py).toFixed(2)}`)
    .join(' ') + ' Z';
  root.appendChild(pathEl(d, { class: 'net-outline' }));

  /* 2. 面板：矩形用 rect，非矩形（梯形/台阶）用 polygon；防尘摇盖只画轮廓，不可点击 */
  const groups = new Map();
  const labelNodes = [];
  const polyD = (p) => {
    const pts = p.points || [
      [p.x, p.y],
      [p.x + p.w, p.y],
      [p.x + p.w, p.y + p.h],
      [p.x, p.y + p.h],
    ];
    return (
      pts
        .map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${X(px).toFixed(2)},${Y(py).toFixed(2)}`)
        .join(' ') + ' Z'
    );
  };
  for (const [metaKey, p] of Object.entries(net.panels)) {
    const meta = { key: metaKey, label: p.label, slot: p.kind };
    const editable = p.editable !== false && p.kind !== 'minor';
    const x = X(p.x);
    const y = Y(p.y);
    const w = p.w * scale;
    const h = p.h * scale;

    const g = node('g', {
      class: `panel is-${p.kind}${editable ? '' : ' is-locked'}`,
      'data-panel': metaKey,
      'data-slot': p.kind,
      'aria-label': editable
        ? `${meta.label}，${Math.round(p.w)} × ${Math.round(p.h)} 毫米`
        : `${meta.label}（防尘摇盖，不参与箱唛）`,
      ...(editable
        ? { tabindex: '0', role: 'button' }
        : { 'aria-disabled': 'true' }),
    });

    // 矩形面用 rect（保持像素宽高比可校验），梯形/台阶面用 path
    const corners = p.points || [
      [p.x, p.y],
      [p.x + p.w, p.y],
      [p.x + p.w, p.y + p.h],
      [p.x, p.y + p.h],
    ];
    const EPS = 1e-6;
    const isRect =
      corners.length === 4 &&
      corners.every(
        ([cx, cy]) =>
          (Math.abs(cx - p.x) < EPS || Math.abs(cx - (p.x + p.w)) < EPS) &&
          (Math.abs(cy - p.y) < EPS || Math.abs(cy - (p.y + p.h)) < EPS),
      );
    const drawPanel = (cls) =>
      isRect
        ? rectEl(x, y, w, h, { class: cls })
        : pathEl(polyD(p), { class: cls });

    g.appendChild(drawPanel('panel-bg'));
    g.appendChild(drawPanel('panel-hover'));
    g.appendChild(drawPanel('panel-edge'));

    const showName = w >= 54 && h >= 20;
    const showSize = w >= 88 && h >= 40;
    const cx = x + w / 2;
    const cy = y + h / 2;

    if (showName) {
      const dy = showSize ? -7 : 0;
      labelNodes.push(
        textEl(cx, cy + dy, meta.label, {
          class: 'panel-label',
          'text-anchor': 'middle',
          'dominant-baseline': 'middle',
        }),
      );
    }
    if (showSize) {
      labelNodes.push(
        textEl(cx, cy + 9, `${fmtLength(p.w, unit)} × ${fmtLength(p.h, unit)}`, {
          class: 'panel-size',
          'text-anchor': 'middle',
          'dominant-baseline': 'middle',
          stroke: '#ffffff',
          'stroke-width': 4,
          'paint-order': 'stroke',
        }),
      );
    }

    if (editable) {
      g.addEventListener('click', () => onSelect(meta.key));
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          onSelect(meta.key);
        }
      });
    }

    groups.set(meta.key, g);
    root.appendChild(g);
  }

  /* 3. 开槽切断线（实线） */
  for (const c of net.cuts) {
    root.appendChild(line(X(c.x1), Y(c.y1), X(c.x2), Y(c.y2), { class: 'net-cut' }));
  }

  /* 4. 折叠线（虚线） */
  for (const f of net.folds) {
    root.appendChild(line(X(f.x1), Y(f.y1), X(f.x2), Y(f.y2), { class: 'net-fold' }));
  }

  // 面板文字压在所有线之上，避免被折线/开槽线划过去
  for (const node of labelNodes) root.appendChild(node);

  /* 5. 尺寸线：总宽 / 总高 / L / W / H（图太小的时候只留总尺寸，避免文字打架） */
  const compact = drawW < 430;
  dimLine(root, {
    a: { x: X(0), y: Y(0) },
    b: { x: X(net.width), y: Y(0) },
    label: withUnit(net.width, unit),
    offset: 30,
    center,
    className: 'is-strong',
  });
  dimLine(root, {
    a: { x: X(0), y: Y(0) },
    b: { x: X(0), y: Y(net.height) },
    label: withUnit(net.height, unit),
    offset: 30,
    center,
    className: 'is-strong',
  });
  if (!compact) {
    dimLine(root, {
      a: { x: X(0), y: Y(net.height) },
      b: { x: X(net.dims.L), y: Y(net.height) },
      label: `L ${fmtLength(net.dims.L, unit)}`,
      offset: 32,
      center,
    });
    dimLine(root, {
      a: { x: X(net.dims.L), y: Y(net.height) },
      b: { x: X(net.dims.L + net.dims.W), y: Y(net.height) },
      label: `W ${fmtLength(net.dims.W, unit)}`,
      offset: 32,
      center,
    });
    dimLine(root, {
      a: { x: X(net.width), y: Y(net.bodyTop) },
      b: { x: X(net.width), y: Y(net.bodyBottom) },
      label:
        net.dims.Hfront != null
          ? `H 前 ${fmtLength(net.dims.Hfront, unit)} / 后 ${fmtLength(net.dims.Hback, unit)}`
          : `H ${fmtLength(net.dims.H, unit)}`,
      offset: 26,
      center,
    });
  }

  host.replaceChildren(root);

  const api = {
    select(key) {
      for (const [k, g] of groups) g.classList.toggle('is-selected', k === key);
    },
  };
  if (selected) api.select(selected);
  return api;
}
