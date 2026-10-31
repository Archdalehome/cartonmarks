/**
 * elements.js —— 箱唛元素的纯数据操作
 *
 * 所有坐标、尺寸、字号都是毫米（相对面板左上角），换算是视图层的事。
 */

let seq = 0;

export function newId(prefix = 'el') {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

export function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

/** 线条元素的默认值与范围（毫米） */
export const LINE_DEFAULT_THICKNESS = 10;
export const LINE_MIN_THICKNESS = 0.5;
export const LINE_MAX_THICKNESS = 50;
export const LINE_LENGTH_RATIO = 0.45;
export const LINE_DEFAULT_COLOR = '#000000';

/** 把元素夹在面板边界内（尺寸过大先缩到面板大小） */
export function clampElement(el, panelW, panelH) {
  const minSide = el.type === 'line' ? LINE_MIN_THICKNESS : 3;
  el.w = clamp(Number(el.w) || 0, minSide, panelW);
  el.h = clamp(Number(el.h) || 0, minSide, panelH);
  el.x = clamp(Number(el.x) || 0, 0, Math.max(0, panelW - el.w));
  el.y = clamp(Number(el.y) || 0, 0, Math.max(0, panelH - el.h));
  el.rotation = Number(el.rotation) || 0;
  return el;
}

function estimateTextWidth(text, fontSize) {
  // 粗估：中日韩字符按 1 个字号宽，拉丁字符按 0.58 个字号宽
  let w = 0;
  for (const ch of String(text)) {
    w += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? fontSize : fontSize * 0.58;
  }
  return Math.max(fontSize * 2, w);
}

export function createTextElement(panelW, panelH, data = {}) {
  const text = String(data.text || '').trim() || '文字';
  const fontSize = clamp(Number(data.fontSize) || 20, 3, 300);
  const lines = text.split('\n');
  const w = clamp(estimateTextWidth(text, fontSize) * 1.08, 20, panelW);
  const h = clamp(fontSize * 1.32 * Math.max(1, lines.length), fontSize, panelH);
  const el = {
    id: newId('text'),
    type: 'text',
    x: clamp((panelW - w) / 2, 0, panelW),
    y: clamp((panelH - h) / 2, 0, panelH),
    w,
    h,
    rotation: 0,
    text,
    fontSize,
    bold: Boolean(data.bold),
    align: ['left', 'center', 'right'].includes(data.align) ? data.align : 'left',
    src: '',
  };
  return clampElement(el, panelW, panelH);
}

export function createImageElement(panelW, panelH, data = {}) {
  const ratio = Number(data.width) && Number(data.height) ? data.width / data.height : 1;
  let w = Math.min(panelW * 0.55, 320);
  let h = w / (ratio || 1);
  if (h > panelH * 0.6) {
    h = panelH * 0.6;
    w = h * ratio;
  }
  const el = {
    id: newId('img'),
    type: 'image',
    x: clamp((panelW - w) / 2, 0, panelW),
    y: clamp((panelH - h) / 2, 0, panelH),
    w,
    h,
    rotation: 0,
    text: '',
    fontSize: 0,
    bold: false,
    align: 'left',
    src: String(data.src || ''),
  };
  return clampElement(el, panelW, panelH);
}

/**
 * 线条元素：横线 / 竖线，默认黑色、粗细 10 mm。
 * 横线长度取所在面板宽度的 45%，竖线取高度的 45%；w/h 仍是毫米包围盒。
 */
export function createLineElement(panelW, panelH, data = {}) {
  const orientation = data.orientation === 'vertical' ? 'vertical' : 'horizontal';
  const thickness = clamp(
    Number(data.thickness) || LINE_DEFAULT_THICKNESS,
    LINE_MIN_THICKNESS,
    Math.min(LINE_MAX_THICKNESS, orientation === 'horizontal' ? panelH : panelW),
  );
  const length = orientation === 'horizontal' ? panelW * LINE_LENGTH_RATIO : panelH * LINE_LENGTH_RATIO;
  const w = orientation === 'horizontal' ? length : thickness;
  const h = orientation === 'horizontal' ? thickness : length;

  return clampElement({
    id: newId('line'),
    type: 'line',
    x: (panelW - w) / 2,
    y: (panelH - h) / 2,
    w,
    h,
    rotation: 0,
    orientation,
    color: /^#[0-9a-f]{6}$/i.test(String(data.color || '')) ? data.color : LINE_DEFAULT_COLOR,
    text: '',
    fontSize: 0,
    bold: false,
    align: 'left',
    src: '',
  }, panelW, panelH);
}

/** 深拷贝并换新 id —— 复制到别的面时用，改副本不能影响原件 */
export function deepCopyElement(el) {
  return { ...JSON.parse(JSON.stringify(el)), id: newId(el.type) };
}

export function elementLabel(el) {
  if (el.type === 'text') {
    const t = (el.text || '').replace(/\s+/g, ' ').trim();
    return t.length > 18 ? `${t.slice(0, 18)}…` : t || '文字';
  }
  if (el.type === 'line') {
    const thickness = el.orientation === 'vertical' ? el.w : el.h;
    return `${el.orientation === 'vertical' ? '竖线' : '横线'} · ${Math.round(thickness * 10) / 10} mm`;
  }
  return `${Math.round(el.w)} × ${Math.round(el.h)} mm`;
}

export function elementKindLabel(el) {
  if (el.type === 'text') return '文字';
  if (el.type === 'line') return '线条';
  return '图片';
}
