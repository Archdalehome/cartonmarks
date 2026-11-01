/**
 * templates-ui.js —— 我的模板（M9）+ 模板分享
 *
 * 后端：GET/POST /api/templates、GET/DELETE /api/templates/:id、
 *       POST /api/templates/:id/share、DELETE /api/templates/:id/share/:shareId、
 *       GET /api/shared、GET/DELETE /api/shared/:shareId
 * 模板存服务端 KV，草稿仍是浏览器本地；互不覆盖。
 *
 * 交互：
 *  - 顶栏「我的模板」→ 弹层两个页签：我的 / 收到的
 *  - 我的：名称 + 更新时间 + 载入 / 分享 / 删除
 *  - 收到的：名称 + 来自谁 + 载入 / 删除（箱型没权限时载入会被后端 403 shape_locked）
 *  - 编辑器「保存为模板」→ 命名（≤40 字）→ POST
 */

import { api } from './api.js';

const el = (id) => document.getElementById(id);
const SHAPE_NAMES = { rsc: '矩形箱', lshape: 'L 形箱', bevel: '斜形箱', tiandi: '天地盖' };

export function createTemplatesUI({ onLoad, getTemplateData, toast, onError, onShapeLocked }) {
  const dom = {
    dialog: el('templatesDialog'),
    list: el('tplList'),
    status: el('tplStatus'),
    close: el('tplCloseBtn'),
    tabs: el('tplTabs'),
    shareDialog: el('tplShareDialog'),
    shareForm: el('tplShareForm'),
    shareTitle: el('tplShareTitle'),
    shareEmail: el('tplShareEmail'),
    shareError: el('tplShareError'),
    shareCancel: el('tplShareCancelBtn'),
    shareClose: el('tplShareCloseBtn'),
    nameDialog: el('tplNameDialog'),
    nameForm: el('tplNameForm'),
    nameInput: el('tplNameInput'),
    nameError: el('tplNameError'),
    nameCancel: el('tplNameCancelBtn'),
    nameClose: el('tplNameCloseBtn'),
  };
  if (!dom.dialog || !dom.list) return null;

  let items = []; // 我的模板
  let sharedItems = []; // 收到的分享
  let tab = 'mine';
  let sharingId = '';

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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[c]);
  }

  function renderTabs() {
    if (!dom.tabs) return;
    dom.tabs.querySelectorAll('button[data-tab]').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
  }

  function render(emptyText) {
    renderTabs();
    if (tab === 'shared') {
      if (!sharedItems.length) {
        dom.list.innerHTML = `<p class="tpl-empty">${escapeHtml(
          emptyText || '还没有收到分享。别人把模板分享给这个邮箱后会出现在这里。',
        )}</p>`;
        return;
      }
      dom.list.innerHTML = sharedItems
        .map(
          (t) => `
        <div class="tpl-item" data-id="${t.shareId}">
          <div class="tpl-main">
            <span class="tpl-name">${escapeHtml(t.name)}</span>
            <span class="tpl-time">来自 ${escapeHtml(t.fromEmail)} · ${escapeHtml(SHAPE_NAMES[t.shape] || t.shape || '')} · ${fmtTime(t.sharedAt)}</span>
          </div>
          <div class="tpl-actions">
            <button type="button" class="btn" data-act="load-shared">载入</button>
            <button type="button" class="btn btn-ghost" data-act="del-shared">删除</button>
          </div>
        </div>`,
        )
        .join('');
      return;
    }

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
            <button type="button" class="btn btn-ghost" data-act="share">分享</button>
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
    sharedItems = [];
    render(reason || undefined);
    say('');
    close();
  }

  async function refresh() {
    say('加载中…');
    if (tab === 'shared') {
      try {
        const data = await api.sharedTemplates();
        sharedItems = data.items || [];
        render();
        say(
          data.notice ||
            `收到 ${sharedItems.length} 个分享。载入时按箱型权限判断，没有该箱型权限会提示订阅。`,
        );
      } catch (err) {
        handle(err, '读取分享失败');
      }
      return;
    }
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
      sharedItems = [];
      render('订阅已失效，模板列表已清空。订阅后可以重新打开。');
      say('模板是订阅功能，请先订阅', true);
      return;
    }
    if (err && err.code === 'unauthorized') {
      items = [];
      sharedItems = [];
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

  function switchTab(next) {
    if (next !== 'shared') tab = 'mine';
    else tab = 'shared';
    render();
    refresh();
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

  async function loadShared(shareId) {
    try {
      const record = await api.sharedTemplate(shareId);
      const ok = onLoad(record.data, record.name || '未命名');
      if (ok) {
        close();
        toast(`已载入分享的模板：${record.name || '未命名'}`);
      }
    } catch (err) {
      if (err && err.code === 'shape_locked') {
        close();
        const shapeName = SHAPE_NAMES[(err.data && err.data.shape) || ''] || '这个箱型';
        if (onShapeLocked) onShapeLocked(err.data && err.data.shape, `这个模板是${shapeName}，需要订阅后才能使用`);
        return;
      }
      handle(err, '载入分享失败');
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

  async function removeShared(shareId) {
    const tpl = sharedItems.find((t) => t.shareId === shareId);
    if (!window.confirm(`从「收到的」里删除「${(tpl && tpl.name) || shareId}」？对方不受影响。`)) return;
    try {
      await api.deleteShared(shareId);
      sharedItems = sharedItems.filter((t) => t.shareId !== shareId);
      render();
      say(`已移除分享「${(tpl && tpl.name) || shareId}」，剩 ${sharedItems.length} 个`);
    } catch (err) {
      handle(err, '删除分享失败');
    }
  }

  /* 分享弹窗 */
  function openShareDialog(id) {
    const tpl = items.find((t) => t.id === id);
    sharingId = id;
    dom.shareError.textContent = '';
    dom.shareEmail.value = '';
    if (dom.shareTitle) dom.shareTitle.textContent = `分享「${(tpl && tpl.name) || '模板'}」`;
    if (typeof dom.shareDialog.showModal === 'function') dom.shareDialog.showModal();
    else dom.shareDialog.setAttribute('open', '');
    dom.shareEmail.focus();
  }

  function closeShareDialog() {
    dom.shareDialog.close?.();
  }

  dom.shareForm?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = dom.shareEmail.value.trim();
    if (!email) {
      dom.shareError.textContent = '请输入对方注册用的邮箱';
      return;
    }
    dom.shareError.textContent = '';
    try {
      const res = await api.shareTemplate(sharingId, email);
      closeShareDialog();
      toast(`已分享给 ${res.toEmail || email}`);
    } catch (err) {
      const code = err && err.code;
      if (code === 'user_not_found') {
        dom.shareError.textContent = '该用户不存在';
        return;
      }
      if (code === 'user_is_self') {
        dom.shareError.textContent = '不能分享给自己';
        return;
      }
      if (code === 'rate_limited') {
        dom.shareError.textContent = '分享太频繁了，等一会儿再试';
        return;
      }
      if (code === 'not_subscribed') {
        dom.shareError.textContent = '模板是订阅功能，订阅后才能分享';
        return;
      }
      if (code === 'tpl_not_found') {
        dom.shareError.textContent = '模板不存在（可能已被删除），刷新列表再试';
        return;
      }
      dom.shareError.textContent = `分享失败：${(err && err.message) || err}`;
    }
  });

  dom.shareCancel?.addEventListener('click', closeShareDialog);
  dom.shareClose?.addEventListener('click', closeShareDialog);

  dom.tabs?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-tab]');
    if (btn) switchTab(btn.dataset.tab);
  });

  dom.list.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const row = btn.closest('.tpl-item');
    if (!row) return;
    const id = row.dataset.id;
    if (btn.dataset.act === 'load') loadOne(id);
    else if (btn.dataset.act === 'del') removeOne(id);
    else if (btn.dataset.act === 'share') openShareDialog(id);
    else if (btn.dataset.act === 'load-shared') loadShared(id);
    else if (btn.dataset.act === 'del-shared') removeShared(id);
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
