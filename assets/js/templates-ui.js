/**
 * templates-ui.js —— 我的模板（M9）
 *
 * 后端：GET /api/templates、POST /api/templates、GET/DELETE /api/templates/:id
 * 模板和草稿是两套东西：模板存在服务端 KV，草稿仍是浏览器本地；互不覆盖。
 *
 * 交互：
 *  - 顶栏「我的模板」→ 列表（名称 + 更新时间 + 载入 + 删除）
 *  - 编辑器「保存为模板」→ 命名（≤40 字）→ POST
 *  - 载入会把箱型/尺寸/所有面的元素整体换掉，由调用方做状态替换
 */

import { api } from './api.js';

const el = (id) => document.getElementById(id);

export function createTemplatesUI({ onLoad, getTemplateData, toast, onError }) {
  const dom = {
    dialog: el('templatesDialog'),
    list: el('tplList'),
    status: el('tplStatus'),
    close: el('tplCloseBtn'),
    nameDialog: el('tplNameDialog'),
    nameForm: el('tplNameForm'),
    nameInput: el('tplNameInput'),
    nameError: el('tplNameError'),
    nameCancel: el('tplNameCancelBtn'),
    nameClose: el('tplNameCloseBtn'),
  };
  if (!dom.dialog || !dom.list) return null;

  let items = [];

  function say(text, isError = false) {
    dom.status.textContent = text || '';
    dom.status.classList.toggle('is-error', Boolean(isError));
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function render(emptyText) {
    if (!items.length) {
      dom.list.innerHTML = `<p class="tpl-empty">${escapeHtml(
        emptyText || '还没有模板。在编辑器里点「保存为模板」把当前箱唛存下来。',
      )}</p>`;
      return;
    }
    dom.list.innerHTML = items
      .map(
        (t) => `
        <div class="tpl-item" data-id="${t.id}">
          <div class="tpl-main">
            <span class="tpl-name">${escapeHtml(t.name)}</span>
            <span class="tpl-time">更新于 ${fmtTime(t.updatedAt)}</span>
          </div>
          <div class="tpl-actions">
            <button type="button" class="btn" data-act="load">载入</button>
            <button type="button" class="btn btn-ghost" data-act="del">删除</button>
          </div>
        </div>`,
      )
      .join('');
  }

  /**
   * 订阅失效 / 退出登录时调用：把缓存里的列表一起收掉并关窗，
   * 不能出现「按钮灰了但列表还挂着上次的名字」这种半截状态。
   */
  function reset(reason) {
    items = [];
    render(reason || undefined);
    say('');
    close();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[c]);
  }

  async function refresh() {
    say('加载中…');
    try {
      const data = await api.templates();
      items = data.items || [];
      render();
      say(`共 ${items.length} 个模板（上限 50 个）`);
    } catch (err) {
      handle(err, '读取模板失败');
    }
  }

  function handle(err, prefix) {
    if (onError) onError(err);
    if (err && err.code === 'not_subscribed') {
      // 订阅失效：列表一起清掉，别让旧名字留在界面上
      items = [];
      render('订阅已失效，模板列表已清空。订阅后可以重新打开。');
      say('模板是订阅功能，请先订阅', true);
      return;
    }
    if (err && err.code === 'unauthorized') {
      items = [];
      render('登录已过期，模板列表已清空。重新登录后再打开。');
      say('请先登录后再用模板', true);
      return;
    }
    say(`${prefix}：${(err && err.message) || err}`, true);
  }

  async function open() {
    if (typeof dom.dialog.showModal === 'function') dom.dialog.showModal();
    else dom.dialog.setAttribute('open', '');
    await refresh();
  }

  function close() {
    dom.dialog.close?.();
  }

  async function loadOne(id) {
    const tpl = items.find((t) => t.id === id);
    try {
      const record = await api.template(id);
      if (!record || !record.data) {
        say('模板内容读取失败', true);
        return;
      }
      const ok = onLoad(record.data, record.name || (tpl && tpl.name) || '未命名');
      if (ok) {
        close();
        toast(`已载入模板：${record.name || '未命名'}`);
      }
    } catch (err) {
      handle(err, '载入模板失败');
    }
  }

  async function removeOne(id) {
    const tpl = items.find((t) => t.id === id);
    if (!window.confirm(`删除模板「${(tpl && tpl.name) || id}」？删除后无法恢复。`)) return;
    try {
      await api.deleteTemplate(id);
      items = items.filter((t) => t.id !== id);
      render();
      say(`已删除「${(tpl && tpl.name) || id}」，剩 ${items.length} 个`);
    } catch (err) {
      handle(err, '删除模板失败');
    }
  }

  dom.list.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const row = btn.closest('.tpl-item');
    if (!row) return;
    if (btn.dataset.act === 'load') loadOne(row.dataset.id);
    else removeOne(row.dataset.id);
  });

  dom.close?.addEventListener('click', close);
  dom.dialog.addEventListener('click', (ev) => {
    if (ev.target === dom.dialog) close();
  });

  /* 命名弹窗 */
  let afterSave = null;

  function openNameDialog(after) {
    afterSave = after || null;
    dom.nameError.textContent = '';
    dom.nameInput.value = '';
    if (typeof dom.nameDialog.showModal === 'function') dom.nameDialog.showModal();
    else dom.nameDialog.setAttribute('open', '');
    dom.nameInput.focus();
  }

  function closeNameDialog() {
    dom.nameDialog.close?.();
  }

  dom.nameForm?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = dom.nameInput.value.trim();
    if (!name) {
      dom.nameError.textContent = '请给模板起个名字';
      return;
    }
    if (name.length > 40) {
      dom.nameError.textContent = '名称最多 40 个字';
      return;
    }
    const data = getTemplateData();
    if (!data) {
      dom.nameError.textContent = '当前没有可保存的内容';
      return;
    }
    dom.nameError.textContent = '';
    try {
      await api.createTemplate({ name, data });
      closeNameDialog();
      toast(`已保存模板：${name}`);
      if (dom.dialog.open) await refresh();
      if (afterSave) afterSave(name);
    } catch (err) {
      if (err && err.code === 'tpl_limit') {
        dom.nameError.textContent = '模板数量已达上限（50 个），先删掉一些再存';
        return;
      }
      if (err && err.code === 'too_large') {
        dom.nameError.textContent = '模板数据超过 512 KB（图片太大），先压缩图片再存';
        return;
      }
      if (err && err.code === 'not_subscribed') {
        dom.nameError.textContent = '模板是订阅功能，请先订阅';
        return;
      }
      if (err && err.code === 'unauthorized') {
        dom.nameError.textContent = '请先登录后再保存模板';
        return;
      }
      dom.nameError.textContent = `保存失败：${(err && err.message) || err}`;
    }
  });

  dom.nameCancel?.addEventListener('click', closeNameDialog);
  dom.nameClose?.addEventListener('click', closeNameDialog);

  return { open, refresh, reset, openNameDialog };
}
