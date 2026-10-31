/**
 * net-view.js —— 展开图（8 面板）绘制
 *
 * 输入：computeNet() 的毫米坐标结果
 * 输出：一张按容器宽度等比缩放的 SVG，面板可点击/键盘选中
 */

import { svgEl, node, ensureDefs, line, rectEl, textEl, pathEl, dimLine, contentWidth } from './svg.js';
import { PANELS } from './project.js';
import { fmt } from './units.js';

const PAD_TOP = 56;
const PAD_BOTTOM = 66;
const PAD_LEFT = 76;
const PAD_RIGHT = 58;

/**
 * @param {HTMLElement} host
 * @param {ReturnType<import('./geometry.js').computeNet>} net
 * @param {{selected?:string|null, onSelect?:(key:string)=>void}} [opts]
 */
export function renderNet(host, net, opts = {}) {
  const { selected = null, onSelect = () => {} } = opts;

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

  /* 1. 裁切轮廓 */
  const d = net.outline
    .map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${X(px).toFixed(2)},${Y(py).toFixed(2)}`)
    .join(' ') + ' Z';
  root.appendChild(pathEl(d, { class: 'net-outline' }));

  /* 2. 8 个面板（可点击），最后画折叠线压在上面 */
  const groups = new Map();
  for (const meta of PANELS) {
    const p = net.panels[meta.key];
    if (!p) continue;

    const x = X(p.x);
    const y = Y(p.y);
    const w = p.w * scale;
    const h = p.h * scale;

    const g = node('g', {
      class: 'panel',
      'data-panel': meta.key,
      tabindex: '0',
      role: 'button',
      'aria-label': `${meta.label}，${Math.round(p.w)} × ${Math.round(p.h)} 毫米`,
    });

    g.appendChild(rectEl(x, y, w, h, { class: 'panel-bg' }));
    g.appendChild(rectEl(x, y, w, h, { class: 'panel-hover' }));
    g.appendChild(rectEl(x, y, w, h, { class: 'panel-edge' }));

    const showName = w >= 54 && h >= 20;
    const showSize = w >= 88 && h >= 40;
    const cx = x + w / 2;
    const cy = y + h / 2;

    if (showName) {
      const dy = showSize ? -7 : 0;
      g.appendChild(
        textEl(cx, cy + dy, meta.label, {
          class: 'panel-label',
          'text-anchor': 'middle',
          'dominant-baseline': 'middle',
        }),
      );
    }
    if (showSize) {
      g.appendChild(
        textEl(cx, cy + 9, `${fmt(p.w)} × ${fmt(p.h)}`, {
          class: 'panel-size',
          'text-anchor': 'middle',
          'dominant-baseline': 'middle',
        }),
      );
    }

    g.addEventListener('click', () => onSelect(meta.key));
    g.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        onSelect(meta.key);
      }
    });

    groups.set(meta.key, g);
    root.appendChild(g);
  }

  /* 3. 折叠线 */
  for (const f of net.folds) {
    root.appendChild(
      line(X(f.x1), Y(f.y1), X(f.x2), Y(f.y2), { class: 'net-fold' }),
    );
  }

  /* 4. 尺寸线：总宽 / 总高 / L / W / H */
  dimLine(root, {
    a: { x: X(0), y: Y(0) },
    b: { x: X(net.width), y: Y(0) },
    label: `${fmt(net.width)} mm`,
    offset: 30,
    center,
    className: 'is-strong',
  });
  dimLine(root, {
    a: { x: X(0), y: Y(0) },
    b: { x: X(0), y: Y(net.height) },
    label: `${fmt(net.height)} mm`,
    offset: 30,
    center,
    className: 'is-strong',
  });
  dimLine(root, {
    a: { x: X(0), y: Y(net.height) },
    b: { x: X(net.dims.L), y: Y(net.height) },
    label: `L ${fmt(net.dims.L)}`,
    offset: 32,
    center,
  });
  dimLine(root, {
    a: { x: X(net.dims.L), y: Y(net.height) },
    b: { x: X(net.dims.L + net.dims.W), y: Y(net.height) },
    label: `W ${fmt(net.dims.W)}`,
    offset: 32,
    center,
  });
  dimLine(root, {
    a: { x: X(net.width), y: Y(net.bodyTop) },
    b: { x: X(net.width), y: Y(net.bodyBottom) },
    label: `H ${fmt(net.dims.H)}`,
    offset: 26,
    center,
  });

  host.replaceChildren(root);

  const api = {
    select(key) {
      for (const [k, g] of groups) g.classList.toggle('is-selected', k === key);
    },
  };
  if (selected) api.select(selected);
  return api;
}
