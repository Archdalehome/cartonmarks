/**
 * tools/test-image-ratio.mjs —— 属性面板：图片改宽/高时另一个等比联动
 *
 * 只测纯前端逻辑（极简 DOM 垫片）：
 *  - 图片改 W → H 按当前框比例联动，比例误差 < 0.1%
 *  - 图片改 H → W 同理
 *  - 连续改 5 次不漂移（每次都按最初的比例算，不是拿被取整过的值再算）
 *  - 文字 / 线条改 W 不影响 H
 */

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}`);
  }
};

/* ── 极简 DOM：够 properties.js 的 h()/querySelector('#id') 用 ── */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.listeners = new Map();
    this._text = '';
    this.className = '';
    this.parentNode = null;
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  dispatch(type, ev) {
    for (const fn of this.listeners.get(type) || []) fn(ev);
  }
  appendChild(child) {
    if (child && child.__text) {
      this._text += child._text;
      return child;
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  replaceChildren(...nodes) {
    this.children = [];
    this._text = '';
    for (const n of nodes) this.appendChild(n);
  }
  get textContent() {
    return this._text || this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  walk(out = []) {
    for (const c of this.children) {
      out.push(c);
      c.walk?.(out);
    }
    return out;
  }
  querySelector(sel) {
    const all = this.walk();
    if (sel.startsWith('#')) return all.find((n) => n.attrs.id === sel.slice(1)) || null;
    return all.find((n) => n.tagName === sel.toUpperCase()) || null;
  }
  querySelectorAll(sel) {
    const all = this.walk();
    if (sel.startsWith('#')) return all.filter((n) => n.attrs.id === sel.slice(1));
    return all.filter((n) => n.tagName === sel.toUpperCase());
  }
}

globalThis.document = {
  createElement: (tag) => new El(tag),
  createTextNode: (text) => ({ __text: String(text), textContent: String(text) }),
};

const { renderProperties } = await import('../assets/js/properties.js');

function makeCtx(el, geo = { w: 600, h: 300 }) {
  const patches = [];
  const host = new El('div');
  renderProperties(host, {
    panelKey: 'front',
    panelMeta: { label: '前箱唛', slot: 'front' },
    geo,
    elements: [el],
    selectedId: el.id,
    callbacks: {
      patch: (id, values, key) => patches.push({ id, values, key }),
      select() {},
      addText() {},
      addImage() {},
      addLine() {},
      clear() {},
      remove() {},
      rotate() {},
      duplicate() {},
      setLineOrientation() {},
      replaceImage() {},
    },
  });
  return { host, patches };
}

const image = () => ({
  id: 'e1',
  type: 'image',
  x: 10,
  y: 10,
  w: 200,
  h: 100,
  rotation: 0,
  src: 'data:image/png;base64,xx',
});

const near = (a, b, tol = 0.001) => Math.abs(a - b) <= Math.abs(b) * tol;

console.log('图片等比：属性面板改宽/高');

{
  const el = image();
  const { host, patches } = makeCtx(el);
  const w = host.querySelector('#propW');
  const h = host.querySelector('#propH');
  ok(Boolean(w) && Boolean(h), '面板里有宽/高输入框');

  w.dispatch('input', { target: { value: '300' } });
  const got = patches.at(-1).values;
  ok(got.w === 300 && near(got.h, 150), `改宽 300 → 高 ${got.h}（应为 150）`);
  ok(h.value === '150', `另一个输入框同步显示 ${h.value}`);
  ok(patches.length === 1, '一次输入只触发一次 patch（没有互踢循环）');
}

{
  const el = image();
  const { host, patches } = makeCtx(el);
  const h = host.querySelector('#propH');
  h.dispatch('input', { target: { value: '50' } });
  const got = patches.at(-1).values;
  ok(got.h === 50 && near(got.w, 100), `改高 50 → 宽 ${got.w}（应为 100）`);
  ok(host.querySelector('#propW').value === '100', '宽输入框同步显示 100');
}

{
  const el = image();
  const { host, patches } = makeCtx(el);
  const w = host.querySelector('#propW');
  // 连续 5 次：每次都用最初 200×100 的比例（2:1），不该越算越歪
  for (const v of [220, 260, 300, 340, 400]) w.dispatch('input', { target: { value: String(v) } });
  const last = patches.at(-1).values;
  ok(patches.length === 5, '5 次输入 = 5 次 patch');
  ok(near(last.w / last.h, 2), `连续改 5 次比例仍是 2:1（实际 ${(last.w / last.h).toFixed(4)}）`);
  ok(last.w === 400 && near(last.h, 200), `最后一次 400×${last.h}`);
}

{
  const el = image();
  el.w = 300;
  el.h = 120; // 用户之前拖成 2.5:1
  const { host, patches } = makeCtx(el);
  host.querySelector('#propW').dispatch('input', { target: { value: '150' } });
  const got = patches.at(-1).values;
  ok(near(got.h, 60), `基准取当前框比例 2.5:1：改宽 150 → 高 ${got.h}（应为 60）`);
}

{
  const text = { id: 't1', type: 'text', x: 0, y: 0, w: 200, h: 40, rotation: 0, text: '箱唛', fontSize: 20 };
  const { host, patches } = makeCtx(text);
  host.querySelector('#propW').dispatch('input', { target: { value: '260' } });
  const got = patches.at(-1).values;
  ok(got.w === 260 && got.h === undefined, `文字改宽不影响高（patch: ${JSON.stringify(got)}）`);
}

{
  const line = { id: 'l1', type: 'line', x: 0, y: 0, w: 270, h: 10, rotation: 0, orientation: 'horizontal' };
  const { host, patches } = makeCtx(line);
  host.querySelector('#propW').dispatch('input', { target: { value: '150' } });
  const got = patches.at(-1).values;
  ok(got.w === 150 && got.h === undefined, '线条改宽不影响高（自由缩放）');
}

{
  const el = image();
  const { host, patches } = makeCtx(el, { w: 600, h: 300 });
  // 输入一个在面板里放不下的宽度：两边一起缩，比例不能坏
  host.querySelector('#propW').dispatch('input', { target: { value: '2000' } });
  const got = patches.at(-1).values;
  ok(got.w === 600 && near(got.h, 300), `超界等比收边：2000 → ${got.w}×${got.h}（600×300）`);
  ok(near(got.w / got.h, 2), '收边后比例仍是 2:1');
}

console.log(`\n${pass} 项通过${fail ? `，${fail} 项失败` : '，全部通过'}`);
process.exit(fail ? 1 : 0);
