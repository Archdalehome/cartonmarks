/**
 * properties.js —— 右侧属性面板
 * 纯 DOM 渲染 + 回调，不持有状态。
 */

import { elementKindLabel, elementLabel, normalizeRotation } from './elements.js';
import { SLOT_LABELS } from './project.js';
import { fmt } from './units.js';

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/**
 * @param {HTMLElement} host
 * @param {object} ctx
 * @param {string} ctx.panelKey
 * @param {{label:string, slot:string}} ctx.panelMeta
 * @param {{w:number,h:number}} ctx.geo 面板真实毫米尺寸
 * @param {Array} ctx.elements
 * @param {string|null} ctx.selectedId
 * @param {object} ctx.callbacks
 */
export function renderProperties(host, ctx) {
  const { panelMeta, geo, elements, selectedId, callbacks } = ctx;
  const selected = elements.find((e) => e.id === selectedId) || null;

  host.replaceChildren();

  /* 面板信息 */
  host.appendChild(
    h('div', { class: 'prop-section' }, [
      h('h3', { text: '面板' }),
      h('div', { class: 'prop-row' }, [h('label', { text: '名称' }), h('span', { text: panelMeta.label })]),
      h('div', { class: 'prop-row' }, [
        h('label', { text: '类型' }),
        h('span', { text: panelMeta.slotLabel || SLOT_LABELS[panelMeta.slot] || '' }),
      ]),
      h('div', { class: 'prop-row' }, [
        h('label', { text: '尺寸' }),
        h('span', { text: `${fmt(geo.w)} × ${fmt(geo.h)} mm` }),
      ]),
      h('div', { class: 'prop-row' }, [
        h('label', { text: '元素' }),
        h('span', { text: `${elements.length} 个` }),
      ]),
      h('div', { class: 'prop-actions' }, [
        h('button', { type: 'button', class: 'btn', text: '+ 文字', onclick: () => callbacks.addText() }),
        h('button', { type: 'button', class: 'btn', text: '+ 图片', onclick: () => callbacks.addImage() }),
        h('button', { type: 'button', class: 'btn', text: '+ 线条', onclick: () => callbacks.addLine() }),
        h('button', { type: 'button', class: 'btn btn-ghost', text: '清空本面', onclick: () => callbacks.clear() }),
      ]),
    ]),
  );

  /* 元素列表 */
  const list = h('ul', { class: 'prop-list' });
  if (!elements.length) {
    list.appendChild(h('li', { class: 'props-empty', text: '这一面还没有内容。点面板空白处，或上面的「+ 文字 / + 图片」。' }));
  } else {
    for (const el of elements) {
      const item = h(
        'li',
        {},
        [
          h('button', {
            type: 'button',
            class: `prop-item${el.id === selectedId ? ' is-active' : ''}`,
            'data-element-id': el.id,
            onclick: () => callbacks.select(el.id),
          }, [
            h('span', { class: 'kind', text: elementKindLabel(el) }),
            h('span', { class: 'name', text: elementLabel(el) }),
          ]),
        ],
      );
      list.appendChild(item);
    }
  }
  host.appendChild(h('div', { class: 'prop-section' }, [h('h3', { text: '元素列表' }), list]));

  /* 选中元素 */
  if (!selected) {
    host.appendChild(
      h('div', { class: 'prop-section' }, [
        h('h3', { text: '选中元素' }),
        h('p', { class: 'props-empty', text: '点画布里的元素选中它，就可以改位置、尺寸和文字。' }),
      ]),
    );
    return;
  }

  const patch = (values, key) => callbacks.patch(selected.id, values, key);

  const numberField = (id, label, key) =>
    h('div', { class: 'field' }, [
      h('label', { class: 'label', for: id, text: label }),
      h('input', {
        id,
        type: 'number',
        step: '1',
        value: String(Math.round(selected[key])),
        oninput: (ev) => {
          const v = Number(ev.target.value);
          if (Number.isFinite(v)) patch({ [key]: v }, `prop-${key}-${selected.id}`);
        },
      }),
    ]);

  const section = h('div', { class: 'prop-section' }, [
    h('h3', { text: '选中元素' }),
    h('div', { class: 'prop-row' }, [
      h('label', { text: '类型' }),
      h('span', { text: `${elementKindLabel(selected)}${selected.type === 'image' ? ' · 拖角等比缩放' : ''}` }),
    ]),
    h('div', { class: 'prop-row' }, [
      h('label', { text: '旋转' }),
      h('span', { text: `${normalizeRotation(selected.rotation)}°` }),
    ]),
    h('div', { class: 'prop-actions', style: 'margin-top:6px' }, [
      h('button', {
        type: 'button',
        class: 'btn btn-ghost',
        title: '以元素中心为轴逆时针转 90°',
        text: '↺ 逆时针 90°',
        onclick: () => callbacks.rotate(selected.id, -1),
      }),
      h('button', {
        type: 'button',
        class: 'btn btn-ghost',
        title: '以元素中心为轴顺时针转 90°',
        text: '↻ 顺时针 90°',
        onclick: () => callbacks.rotate(selected.id, 1),
      }),
    ]),
    h('div', { class: 'prop-grid' }, [
      numberField('propX', 'X（mm）', 'x'),
      numberField('propY', 'Y（mm）', 'y'),
      numberField('propW', '宽（mm）', 'w'),
      numberField('propH', '高（mm）', 'h'),
    ]),
  ]);

  if (selected.type === 'text') {
    section.appendChild(
      h('div', { class: 'field' }, [
        h('label', { class: 'label', for: 'propText', text: '文字内容' }),
        h('textarea', {
          id: 'propText',
          rows: '3',
          oninput: (ev) => patch({ text: ev.target.value }, `prop-text-${selected.id}`),
        }, [selected.text || '']),
      ]),
    );
    section.appendChild(
      h('div', { class: 'prop-grid' }, [
        h('div', { class: 'field' }, [
          h('label', { class: 'label', for: 'propFontSize', text: '字号（mm）' }),
          h('input', {
            id: 'propFontSize',
            type: 'number',
            min: '3',
            max: '300',
            step: '1',
            value: String(Math.round(selected.fontSize)),
            oninput: (ev) => {
              const v = Number(ev.target.value);
              if (Number.isFinite(v) && v > 0) patch({ fontSize: v }, `prop-font-${selected.id}`);
            },
          }),
        ]),
        h('div', { class: 'field' }, [
          h('label', { class: 'label', for: 'propAlign', text: '对齐' }),
          h('select', {
            id: 'propAlign',
            onchange: (ev) => callbacks.patch(selected.id, { align: ev.target.value }, ''),
          }, [
            h('option', { value: 'left', text: '左对齐' }),
            h('option', { value: 'center', text: '居中' }),
            h('option', { value: 'right', text: '右对齐' }),
          ]),
        ]),
      ]),
    );
    section.querySelector('#propAlign').value = selected.align || 'left';
    section.appendChild(
      h('label', { class: 'check', style: 'margin-top:8px;display:inline-flex' }, [
        h('input', {
          type: 'checkbox',
          id: 'propBold',
          onchange: (ev) => callbacks.patch(selected.id, { bold: ev.target.checked }, ''),
        }),
        h('span', { text: '加粗' }),
      ]),
    );
    const boldInput = section.querySelector('#propBold');
    boldInput.checked = Boolean(selected.bold);
  }

  if (selected.type === 'line') {
    const thickness = selected.orientation === 'vertical' ? selected.w : selected.h;
    section.appendChild(
      h('div', { class: 'prop-grid' }, [
        h('div', { class: 'field' }, [
          h('label', { class: 'label', for: 'propLineOrientation', text: '方向' }),
          h('select', {
            id: 'propLineOrientation',
            onchange: (ev) => callbacks.setLineOrientation(selected.id, ev.target.value),
          }, [
            h('option', { value: 'horizontal', text: '横线' }),
            h('option', { value: 'vertical', text: '竖线' }),
          ]),
        ]),
        h('div', { class: 'field' }, [
          h('label', { class: 'label', for: 'propLineThickness', text: '粗细（mm）' }),
          h('input', {
            id: 'propLineThickness',
            type: 'number',
            min: '0.5',
            max: '50',
            step: '0.5',
            value: String(Math.round(thickness * 10) / 10),
            oninput: (ev) => {
              const t = Number(ev.target.value);
              if (!Number.isFinite(t) || t < 0.5 || t > 50) return;
              callbacks.patch(
                selected.id,
                selected.orientation === 'vertical' ? { w: t } : { h: t },
                `prop-thick-${selected.id}`,
              );
            },
          }),
        ]),
      ]),
    );
    section.querySelector('#propLineOrientation').value = selected.orientation;

    section.appendChild(
      h('div', { class: 'field', style: 'margin-top:8px' }, [
        h('label', { class: 'label', for: 'propLineColor', text: '颜色' }),
        h('input', {
          id: 'propLineColor',
          type: 'color',
          value: selected.color || '#000000',
          oninput: (ev) => callbacks.patch(selected.id, { color: ev.target.value }, `prop-color-${selected.id}`),
        }),
      ]),
    );
  }

  if (selected.type === 'image') {
    section.appendChild(
      h('div', { class: 'field', style: 'margin-top:8px' }, [
        h('label', { class: 'label', for: 'propImage' , text: '替换图片' }),
        h('input', {
          id: 'propImage',
          type: 'file',
          accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml',
          onchange: (ev) => {
            const file = ev.target.files && ev.target.files[0];
            if (file) callbacks.replaceImage(selected.id, file);
            ev.target.value = '';
          },
        }),
      ]),
    );
  }

  section.appendChild(
    h('div', { class: 'prop-actions', style: 'margin-top:10px' }, [
      h('button', {
        type: 'button',
        class: 'btn',
        text: '删除元素',
        onclick: () => callbacks.remove(selected.id),
      }),
    ]),
  );

  host.appendChild(section);
}

/** 拖动时把 X/Y 输入框同步成最新值（不动正在输入的框） */
export function syncNumberFields(host, el) {
  const map = { propX: 'x', propY: 'y', propW: 'w', propH: 'h' };
  for (const [id, key] of Object.entries(map)) {
    const input = host.querySelector(`#${id}`);
    if (input && document.activeElement !== input) input.value = String(Math.round(el[key]));
  }
}
