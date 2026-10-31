/**
 * tools/dom-shim.mjs —— 极简 DOM 垫片
 * 只够让 assets/js 里的 SVG 绘制代码在 Node 里跑起来，用于自动化检查。
 * 不模拟布局，只模拟"元素树 + 属性"。
 */

class ClassList {
  constructor(el) {
    this.el = el;
    this.set = new Set();
  }
  _sync() {
    this.el.attrs.class = [...this.set].join(' ');
  }
  add(...names) {
    for (const n of names) this.set.add(n);
    this._sync();
  }
  remove(...names) {
    for (const n of names) this.set.delete(n);
    this._sync();
  }
  contains(name) {
    return this.set.has(name);
  }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : Boolean(force);
    if (on) this.set.add(name);
    else this.set.delete(name);
    this._sync();
    return on;
  }
}

const idRegistry = new Map();

export class El {
  constructor(tagName) {
    this.tagName = tagName;
    this.attrs = {};
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.classList = new ClassList(this);
    this._text = '';
    this.clientWidth = 0;
  }

  setAttribute(name, value) {
    const v = String(value);
    this.attrs[name] = v;
    if (name === 'id') idRegistry.set(v, this);
    if (name === 'class') {
      this.classList.set = new Set(v.split(/\s+/).filter(Boolean));
    }
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...nodes) {
    this.children = [];
    for (const n of nodes) this.appendChild(n);
  }

  get textContent() {
    return this._text;
  }

  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }

  get ownerDocument() {
    return doc;
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  dispatch(type, event = {}) {
    for (const fn of this.listeners.get(type) || []) fn(event);
  }

  querySelector(selector) {
    const tag = selector.replace(/^[a-z]+/i, (s) => s);
    return this.find((n) => n.tagName === tag) || null;
  }

  querySelectorAll(selector) {
    const tag = selector;
    return this.filter((n) => n.tagName === tag);
  }

  find(pred) {
    for (const c of this.children) {
      if (pred(c)) return c;
      const deeper = c.find ? c.find(pred) : null;
      if (deeper) return deeper;
    }
    return null;
  }

  filter(pred, out = []) {
    for (const c of this.children) {
      if (pred(c)) out.push(c);
      c.filter?.(pred, out);
    }
    return out;
  }

  /** 深度遍历所有后代 */
  walk(out = []) {
    for (const c of this.children) {
      out.push(c);
      c.walk(out);
    }
    return out;
  }
}

const doc = {
  createElement: (tag) => new El(tag),
  createElementNS: (_ns, tag) => new El(tag),
  getElementById: (id) => idRegistry.get(id) || null,
};

export function installDom() {
  globalThis.document = doc;
  globalThis.window = { innerHeight: 900 };
  globalThis.getComputedStyle = () => ({ paddingLeft: '0px', paddingRight: '0px' });
  return doc;
}

export function makeHost(width = 760) {
  const host = new El('div');
  host.clientWidth = width;
  return host;
}
