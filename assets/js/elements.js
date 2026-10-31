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

/** 把元素夹在面板边界内（尺寸过大先缩到面板大小） */
export function clampElement(el, panelW, panelH) {
  el.w = clamp(Number(el.w) || 0, 3, panelW);
  el.h = clamp(Number(el.h) || 0, 3, panelH);
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

/** 深拷贝并换新 id —— 复制到别的面时用，改副本不能影响原件 */
export function deepCopyElement(el) {
  return { ...JSON.parse(JSON.stringify(el)), id: newId(el.type) };
}

export function elementLabel(el) {
  if (el.type === 'text') {
    const t = (el.text || '').replace(/\s+/g, ' ').trim();
    return t.length > 18 ? `${t.slice(0, 18)}…` : t || '文字';
  }
  return `${Math.round(el.w)} × ${Math.round(el.h)} mm`;
}

export function elementKindLabel(el) {
  return el.type === 'text' ? '文字' : '图片';
}
