/**
 * svg.js —— 极简 SVG 构造助手 + 尺寸线
 * 只做 DOM 拼接，不持有状态。
 */

const NS = 'http://www.w3.org/2000/svg';

/** 宿主容器的内容宽度（扣掉 padding），用于按容器宽度等比缩放 */
export function contentWidth(host) {
  const cs = getComputedStyle(host);
  const pl = parseFloat(cs.paddingLeft) || 0;
  const pr = parseFloat(cs.paddingRight) || 0;
  return Math.max(160, (host.clientWidth || 0) - pl - pr);
}

export function svgEl(width, height, attrs = {}) {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('xmlns', NS);
  el.setAttribute('width', String(Math.round(width)));
  el.setAttribute('height', String(Math.round(height)));
  el.setAttribute('viewBox', `0 0 ${Math.round(width)} ${Math.round(height)}`);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export function node(tag, attrs = {}, children = []) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    el.setAttribute(k, String(v));
  }
  for (const child of children) el.appendChild(child);
  return el;
}

export function line(x1, y1, x2, y2, attrs = {}) {
  return node('line', { x1, y1, x2, y2, ...attrs });
}

export function rectEl(x, y, w, h, attrs = {}) {
  return node('rect', { x, y, width: w, height: h, ...attrs });
}

export function textEl(x, y, str, attrs = {}) {
  const el = node('text', { x, y, ...attrs });
  el.textContent = str;
  return el;
}

export function pathEl(d, attrs = {}) {
  return node('path', { d, ...attrs });
}

/** 每个画布只放一次箭头 marker */
export function ensureDefs(root) {
  let defs = root.querySelector('defs');
  if (!defs) {
    defs = node('defs');
    root.appendChild(defs);
  }
  if (!root.ownerDocument.getElementById('cm-dim-arrow')) {
    const marker = node(
      'marker',
      {
        id: 'cm-dim-arrow',
        viewBox: '0 0 10 10',
        refX: '9',
        refY: '5',
        markerWidth: '7',
        markerHeight: '7',
        orient: 'auto-start-reverse',
      },
      [node('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#8a94a6' })],
    );
    defs.appendChild(marker);
  }
  return defs;
}

/**
 * 画一条带箭头的尺寸线，文字自动贴在线的外侧。
 *
 * @param {SVGElement} root
 * @param {object} p
 * @param {{x:number,y:number}} p.a 起点
 * @param {{x:number,y:number}} p.b 终点
 * @param {string} p.label 文字
 * @param {number} [p.offset=24] 相对被标注对象的偏移（像素，正负由 center 决定朝外）
 * @param {{x:number,y:number}} [p.center] 参考中心，用于让尺寸线朝外避让
 * @param {string} [p.className] 文字附加类名
 */
export function dimLine(root, { a, b, label, offset = 24, center = null, className = '' }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;

  if (center) {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    if ((mx - center.x) * nx + (my - center.y) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
  }

  const oa = { x: a.x + nx * offset, y: a.y + ny * offset };
  const ob = { x: b.x + nx * offset, y: b.y + ny * offset };

  root.appendChild(line(a.x, a.y, oa.x, oa.y, { class: 'dim-ext' }));
  root.appendChild(line(b.x, b.y, ob.x, ob.y, { class: 'dim-ext' }));
  root.appendChild(
    line(oa.x, oa.y, ob.x, ob.y, {
      class: 'dim-line',
      'marker-start': 'url(#cm-dim-arrow)',
      'marker-end': 'url(#cm-dim-arrow)',
    }),
  );

  const mx = (oa.x + ob.x) / 2;
  const my = (oa.y + ob.y) / 2;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const rot = horizontal ? 0 : -90;
  // 文字再往外挪一点，避免压在线上
  const tx = mx + nx * 10;
  const ty = my + ny * 10;

  const text = textEl(tx, ty, label, {
    class: `dim-text ${className}`.trim(),
    'text-anchor': 'middle',
    'dominant-baseline': 'middle',
  });
  if (rot) text.setAttribute('transform', `rotate(${rot} ${tx} ${ty})`);
  root.appendChild(text);
  recordLabel(root, label, tx, ty, rot);

  // 尺寸线两端（偏移后的位置），供「尺寸线平行于被标棱」的断言使用
  return { a: oa, b: ob };
}

/**
 * 记下每条标注文字的位置与估算尺寸，供「标注文字包围盒不许相交」的断言使用。
 * 宽度按字符数粗估（中文/数字混排够用），再按旋转角取轴对齐包围盒。
 * @param {number} rotate 文字旋转角（度）
 */
export function recordLabel(root, text, x, y, rotate = 0) {
  const w = String(text).length * 6.2 + 4;
  const h = 12;
  const rad = ((Math.abs(rotate) % 180) * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  root.__dimLabels = root.__dimLabels || [];
  root.__dimLabels.push({
    text: String(text),
    x,
    y,
    width: w * c + h * s,
    height: w * s + h * c,
  });
}
