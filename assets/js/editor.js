/**
 * editor.js 鈥斺€?闈㈡澘鏀惧ぇ缂栬緫鐢诲竷
 *
 * 鑱岃矗锛氭妸鏌愪竴闈㈢殑鍏冪礌鎸夌湡瀹炴绫?脳 缂╂斁鐢诲嚭鏉ワ紝澶勭悊閫変腑銆佹嫋鍔ㄣ€佸洓瑙掔缉鏀俱€佸榻愯緟鍔╃嚎銆? * 鍏冪礌鍧愭爣濮嬬粓鏄绫筹紝杩欓噷鍙湪璇诲啓 DOM 鏃朵箻 scale銆? */

import { clamp } from './elements.js';

const HANDLES = ['nw', 'ne', 'sw', 'se'];
const MIN_SIZE_MM = 3;
const SNAP_MM = 2;

export function createEditor({ host, callbacks }) {
  let panelKey = null;
  let geo = null;
  let elements = [];
  let selectedId = null;
  let scale = 1;
  let canvas = null;
  let guideV = null;
  let guideH = null;

  /* 鈹€鈹€ 闈㈡澘鍒囨崲 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

  function setPanel(key, geometry, els) {
    panelKey = key;
    geo = geometry;
    elements = els;
    selectedId = null;
    render();
  }

  function setElements(els) {
    elements = els;
    if (selectedId && !els.some((e) => e.id === selectedId)) selectedId = null;
    render();
  }

  function getSelected() {
    return elements.find((e) => e.id === selectedId) || null;
  }

  function select(id) {
    if (selectedId === id) return;
    selectedId = id;
    render();
    callbacks.onSelectionChange(id);
  }

  /* 鈹€鈹€ 娓叉煋 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

  function render() {
    if (!geo || !panelKey) {
      host.replaceChildren();
      canvas = null;
      return;
    }

    const availW = Math.max(200, (host.clientWidth || 640) - 28);
    const maxH = Math.max(220, Math.min(520, (window.innerHeight || 800) * 0.55));
    scale = Math.min(availW / geo.w, maxH / geo.h);
    if (!Number.isFinite(scale) || scale <= 0.01) scale = 0.2;

    canvas = document.createElement('div');
    canvas.className = 'ed-canvas';
    canvas.dataset.panel = panelKey;
    canvas.style.width = `${Math.max(60, Math.round(geo.w * scale))}px`;
    canvas.style.height = `${Math.max(60, Math.round(geo.h * scale))}px`;

    guideV = document.createElement('div');
    guideV.className = 'ed-guide ed-guide--v';
    guideH = document.createElement('div');
    guideH.className = 'ed-guide ed-guide--h';

    for (const el of elements) canvas.appendChild(buildElement(el));
    canvas.appendChild(guideV);
    canvas.appendChild(guideH);

    canvas.addEventListener('click', (ev) => {
      if (ev.target !== canvas) return;
      if (selectedId) {
        selectedId = null;
        callbacks.onSelectionChange(null);
        render();
      }
      callbacks.onRequestNew();
    });

    host.replaceChildren(canvas);
  }

  function buildElement(el) {
    const node = document.createElement('div');
    node.className = `ed-el${el.id === selectedId ? ' is-selected' : ''}`;
    node.dataset.id = el.id;
    applyNodeBox(node, el);

    if (el.type === 'text') {
      const t = document.createElement('div');
      t.className = 'ed-text';
      t.textContent = el.text || '';
      t.style.fontSize = `${Math.max(1, el.fontSize * scale)}px`;
      t.style.fontWeight = el.bold ? '700' : '400';
      t.style.textAlign = el.align || 'left';
      node.appendChild(t);
    } else {
      const img = document.createElement('img');
      img.className = 'ed-img';
      img.src = el.src;
      img.alt = '绠卞敍鍥剧墖';
      img.draggable = false;
      node.appendChild(img);
    }

    node.addEventListener('pointerdown', (ev) => startDrag(ev, el));

    if (el.id === selectedId) {
      for (const corner of HANDLES) {
        const handle = document.createElement('div');
        handle.className = 'ed-handle';
        handle.dataset.corner = corner;
        handle.addEventListener('pointerdown', (ev) => startResize(ev, el, corner));
        node.appendChild(handle);
      }
    }
    return node;
  }

  function applyNodeBox(node, el) {
    if (!node) return;
    node.style.left = `${el.x * scale}px`;
    node.style.top = `${el.y * scale}px`;
    node.style.width = `${el.w * scale}px`;
    node.style.height = `${el.h * scale}px`;
  }

  function nodeOf(id) {
    return canvas ? canvas.querySelector(`.ed-el[data-id="${id}"]`) : null;
  }

  /* 鈹€鈹€ 鎷栧姩绉诲姩 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

  function startDrag(ev, el) {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    ev.preventDefault();

    if (selectedId !== el.id) {
      selectedId = el.id;
      render();
      callbacks.onSelectionChange(el.id);
    }

    const node = nodeOf(el.id);
    if (!node) return;

    const startX = ev.clientX;
    const startY = ev.clientY;
    const origin = { x: el.x, y: el.y };
    let moved = false;

    try { node.setPointerCapture(ev.pointerId); } catch { /* 合成事件或已释放指针时忽略 */ }
    node.classList.add('is-dragging');

    const onMove = (e) => {
      const dx = (e.clientX - startX) / scale;
      const dy = (e.clientY - startY) / scale;
      if (!moved && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      moved = true;

      let nx = origin.x + dx;
      let ny = origin.y + dy;
      nx = clamp(nx, 0, Math.max(0, geo.w - el.w));
      ny = clamp(ny, 0, Math.max(0, geo.h - el.h));

      const snap = snapPosition(nx, ny, el);
      el.x = snap.x;
      el.y = snap.y;
      applyNodeBox(node, el);
      showGuides(snap.guides);
      callbacks.onElementMove(el);
    };

    const finish = () => {
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', finish);
      node.removeEventListener('pointercancel', finish);
      node.classList.remove('is-dragging');
      hideGuides();
      if (moved) callbacks.onChange('move');
    };

    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', finish);
    node.addEventListener('pointercancel', finish);
  }

  /* 鈹€鈹€ 鍥涜缂╂斁 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

  function startResize(ev, el, corner) {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    ev.preventDefault();

    const node = nodeOf(el.id);
    if (!node) return;

    const startX = ev.clientX;
    const startY = ev.clientY;
    const origin = { x: el.x, y: el.y, w: el.w, h: el.h };
    const ratio = origin.w / origin.h || 1;
    let moved = false;

    try { node.setPointerCapture(ev.pointerId); } catch { /* 合成事件或已释放指针时忽略 */ }

    const onMove = (e) => {
      const dx = (e.clientX - startX) / scale;
      const dy = (e.clientY - startY) / scale;

      let nx = origin.x;
      let ny = origin.y;
      let nw = origin.w;
      let nh = origin.h;

      if (el.type === 'image') {
        const horizontal = corner.includes('e') || corner.includes('w');
        let w = horizontal ? (corner.includes('w') ? origin.w - dx : origin.w + dx) : origin.w + dy * ratio;
        w = clamp(w, MIN_SIZE_MM, geo.w);
        let h = w / ratio;
        if (h > geo.h) {
          h = geo.h;
          w = h * ratio;
        }
        nw = w;
        nh = h;
        nx = corner.includes('w') ? origin.x + (origin.w - w) : origin.x;
        ny = corner.includes('n') ? origin.y + (origin.h - h) : origin.y;
      } else {
        if (corner.includes('e')) nw = origin.w + dx;
        if (corner.includes('s')) nh = origin.h + dy;
        if (corner.includes('w')) {
          nw = origin.w - dx;
          nx = origin.x + dx;
        }
        if (corner.includes('n')) {
          nh = origin.h - dy;
          ny = origin.y + dy;
        }
        nw = clamp(nw, MIN_SIZE_MM, geo.w);
        nh = clamp(nh, MIN_SIZE_MM, geo.h);
      }

      nx = clamp(nx, 0, Math.max(0, geo.w - nw));
      ny = clamp(ny, 0, Math.max(0, geo.h - nh));

      el.x = nx;
      el.y = ny;
      el.w = nw;
      el.h = nh;
      applyNodeBox(node, el);
      moved = true;
      callbacks.onElementMove(el);
    };

    const finish = () => {
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', finish);
      node.removeEventListener('pointercancel', finish);
      if (moved) callbacks.onChange('resize');
    };

    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', finish);
    node.addEventListener('pointercancel', finish);
  }

  /* 鈹€鈹€ 瀵归綈杈呭姪绾?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

  function snapPosition(x, y, el) {
    const linesX = [0, geo.w / 2, geo.w];
    const linesY = [0, geo.h / 2, geo.h];
    for (const other of elements) {
      if (other.id === el.id) continue;
      linesX.push(other.x, other.x + other.w / 2, other.x + other.w);
      linesY.push(other.y, other.y + other.h / 2, other.y + other.h);
    }

    const pickX = nearest([
      { at: x + el.w / 2, delta: el.w / 2 },
      { at: x, delta: 0 },
      { at: x + el.w, delta: el.w },
    ], linesX);
    const pickY = nearest([
      { at: y + el.h / 2, delta: el.h / 2 },
      { at: y, delta: 0 },
      { at: y + el.h, delta: el.h },
    ], linesY);

    const nextX = clamp(pickX ? x + (pickX.line - pickX.at) : x, 0, Math.max(0, geo.w - el.w));
    const nextY = clamp(pickY ? y + (pickY.line - pickY.at) : y, 0, Math.max(0, geo.h - el.h));

    return {
      x: nextX,
      y: nextY,
      guides: {
        x: pickX && Math.abs(pickX.line - pickX.at) <= SNAP_MM ? pickX.line : null,
        y: pickY && Math.abs(pickY.line - pickY.at) <= SNAP_MM ? pickY.line : null,
      },
    };
  }

  function nearest(candidates, lines) {
    let best = null;
    for (const c of candidates) {
      for (const line of lines) {
        const d = Math.abs(line - c.at);
        if (d <= SNAP_MM && (!best || d < best.d)) best = { d, line, at: c.at };
      }
    }
    return best;
  }

  function showGuides(guides) {
    if (!canvas) return;
    if (guides.x !== null && guides.x !== undefined) {
      guideV.style.display = 'block';
      guideV.style.left = `${guides.x * scale}px`;
    } else {
      guideV.style.display = 'none';
    }
    if (guides.y !== null && guides.y !== undefined) {
      guideH.style.display = 'block';
      guideH.style.top = `${guides.y * scale}px`;
    } else {
      guideH.style.display = 'none';
    }
  }

  function hideGuides() {
    if (guideV) guideV.style.display = 'none';
    if (guideH) guideH.style.display = 'none';
  }

  /* 鈹€鈹€ 閿洏寰皟 / 鍒犻櫎 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

  function nudge(dx, dy) {
    const el = getSelected();
    if (!el) return false;
    el.x = clamp(el.x + dx, 0, Math.max(0, geo.w - el.w));
    el.y = clamp(el.y + dy, 0, Math.max(0, geo.h - el.h));
    applyNodeBox(nodeOf(el.id), el);
    callbacks.onElementMove(el);
    callbacks.onChange('nudge');
    return true;
  }

  function deleteSelected() {
    const index = elements.findIndex((e) => e.id === selectedId);
    if (index < 0) return false;
    elements.splice(index, 1);
    selectedId = null;
    render();
    callbacks.onSelectionChange(null);
    callbacks.onChange('delete');
    return true;
  }

  function destroy() {
    host.replaceChildren();
    canvas = null;
  }

  return { setPanel, setElements, select, getSelected, getSelectedId: () => selectedId, render, nudge, deleteSelected, destroy };
}
