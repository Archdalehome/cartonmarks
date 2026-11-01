/**
 * templates-ui.js —— 我的模板（M9）+ 模板分享
 *
 * 后端：GET/POST /api/templates、GET/DELETE /api/templates/:id、
 *       POST /api/templates/:id/share、DELETE /api/templates/:id/share/:shareId、
 *       GET /api/shared、GET/DELETE /api/shared/:shareId
 * 模板存服务端 KV，草稿仍是浏览器本地；互不覆盖。
 *
 * 交互（收到的分享直接并进同一个列表，不再分页签）：
 *  - 顶栏「我的模板」→ 一个列表：自己的在前（按更新时间倒序）、收到的在后（按分享时间倒序）
 *  - 自己的：名称 + 更新时间 + 载入 / 分享 / 删除
 *  - 收到的：名称前带「分享」角标、副行「来自 x@y.com · 箱型 · 分享于 11-01」+ 载入 / 删除
 *    （不给「分享」，避免模板被链式转发；要转发请原作者再分享一次）
 *  - 未订阅也能打开看收到的分享；载入时箱型没权限 → 后端 403 shape_locked → 弹订阅层
 *  - 编辑器「保存为模板」→ 命名（≤40 字）→ POST
 */

import { api } from './api.js';

const el = (id) => document.getElementById(id);
const SHAPE_NAMES = { rsc: '矩形箱', lshape: 'L 形箱', bevel: '斜形箱', tiandi: '天地盖' };
const MAX_MINE = 50;

export function createTemplatesUI({ onLoad, getTemplateData, toast, onError, onShapeLocked, onSubscribe }) {
  const dom = {
    dialog: el('templatesDialog'),
    list: el('tplList'),
    status: el('tplStatus'),
    close: el('tplCloseBtn'),
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
  let ownLocked = ''; // '' | 'not_subscribed' | 'unauthorized' | 'error'
  let sharingId = '';

  function say(text, isError = false) {
    dom.status.textContent = text || '';
    dom.status.classList.toggle('is-error', Boolean(isError));
  }

  const timeVal = (iso) => {
    const t = iso ? new Date(iso).getTime() : 0;
    return Number.isNaN(t) ? 0 : t;
  };

  function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** 分享日期只到日：11-01 */
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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

  function mineRow(t) {
    return `
        <div class="tpl-item" data-id="${escapeHtml(t.id)}" data-kind="mine">
          <div class="tpl-main">
            <span class="tpl-name">${escapeHtml(t.name)}</span>
            <span class="tpl-time">更新于 ${fmtTime(t.updatedAt)}</span>
          </div>
          <div class="tpl-actions">
            <button type="button" class="btn btn-ghost" data-act="share">分享</button>
            <button type="button" class="btn" data-act="load">载入</button>
            <button type="button" class="btn btn-ghost" data-act="del">删除</button>
          </div>
        </div>`;
  }

  function sharedRow(t) {
    const shapeName = SHAPE_NAMES[t.shape] || t.shape || '';
    const meta = [`来自 ${escapeHtml(t.fromEmail || '')}`, shapeName, `分享于 ${fmtDate(t.sharedAt)}`]
      .filter(Boolean)
      .join(' · ');
    return `
        <div class="tpl-item tpl-item-shared" data-id="${escapeHtml(t.shareId)}" data-kind="shared">
          <div class="tpl-main">
            <span class="tpl-name"><span class="tpl-badge">分享</span>${escapeHtml(t.name)}</span>
            <span class="tpl-time">${meta}</span>
          </div>
          <div class="tpl-actions">
            <button type="button" class="btn" data-act="load">载入</button>
            <button type="button" class="btn btn-ghost" data-act="del">删除</button>
          </div>
        </div>`;
  }

  function render(emptyText) {
    const mine = items.slice().sort((a, b) => timeVal(b.updatedAt) - timeVal(a.updatedAt));
    const shared = sharedItems
      .slice()
      .sort((a, b) => timeVal(b.sharedAt) - timeVal(a.sharedAt));

    if (!mine.length && !shared.length) {
      if (ownLocked === 'not_subscribed' && !emptyText) {
        dom.list.innerHTML = `
          <div class="tpl-locked-note">
            <span>模板保存是订阅功能，订阅后可以把箱唛存成模板。别人分享给你的模板会出现在这里，可以直接载入。</span>
            <button type="button" class="btn btn-ghost" data-act="subscribe">去订阅</button>
          </div>`;
        return;
      }
      const fallback =
        ownLocked === 'not_subscribed'
          ? '模板保存是订阅功能，订阅后可以把箱唛存成模板。别人分享给你的模板会出现在这里。'
          : '还没有模板。在编辑器里点「保存为模板」把当前箱唛存下来；别人分享给你的模板也会出现在这里。';
      dom.list.innerHTML = `<p class="tpl-empty">${escapeHtml(emptyText || fallback)}</p>`;
      return;
    }

    const parts = [];
    if (mine.length) {
      parts.push(mine.map(mineRow).join(''));
    } else if (ownLocked === 'not_subscribed') {
      parts.push(`
        <div class="tpl-locked-note">
          <span>自己的模板需要订阅；下面收到的分享可以直接载入（箱型没权限时才会提示订阅）。</span>
          <button type="button" class="btn btn-ghost" data-act="subscribe">去订阅</button>
        </div>`);
    } else {
      parts.push('<p class="tpl-empty tpl-empty-sm">还没有自己的模板。在编辑器里点「保存为模板」把当前箱唛存下来。</p>');
    }

    if (shared.length) {
      parts.push('<div class="tpl-divider"><span>收到的分享</span></div>');
      parts.push(shared.map(sharedRow).join(''));
    }
    dom.list.innerHTML = parts.join('');
  }

  /**
   * 订阅失效 / 退出登录时调用：把缓存里的列表一起收掉并关窗，
   * 不能出现「按钮灰了但列表还挂着上次的名字」这种半截状态。
   */
  function reset(reason) {
    items = [];
    sharedItems = [];
    ownLocked = '';
    render(reason || undefined);
    say('');
    close();
  }

  async function refresh() {
    say('加载中…');
    const [mineRes, sharedRes] = await Promise.allSettled([api.templates(), api.sharedTemplates()]);
    let errorText = '';

    // 自己的模板：未订阅会 403，但收到的分享照常显示，所以两路分开处理
    ownLocked = '';
    items = [];
    if (mineRes.status === 'fulfilled') {
      items = mineRes.value.items || [];
    } else {
      const err = mineRes.reason;
      const code = err && err.code;
      if (code === 'not_subscribed') {
        // 只锁「自己的模板」这一块，不能顺手弹订阅层——用户可能只是想载入收到的分享
        ownLocked = 'not_subscribed';
      } else if (code === 'unauthorized') {
        ownLocked = 'unauthorized';
        if (onError) onError(err); // 会话过期：顶栏落回游客
      } else {
        ownLocked = 'error';
        errorText = `读取模板失败：${(err && err.message) || err}`;
      }
    }

    sharedItems = [];
    let notice = '';
    if (sharedRes.status === 'fulfilled') {
      sharedItems = sharedRes.value.items || [];
      notice = sharedRes.value.notice || '';
    } else {
      const err = sharedRes.reason;
      if (onError) onError(err);
      if (!errorText) errorText = `读取收到的分享失败：${(err && err.message) || err}`;
    }

    render();
    const count = `我的 ${items.length} 个 · 收到 ${sharedItems.length} 个（我的上限 ${MAX_MINE}）`;
    const extra = [notice, ownLocked === 'not_subscribed' ? '保存模板需订阅' : '', errorText].filter(Boolean);
    say(extra.length ? `${count} · ${extra.join(' · ')}` : count, Boolean(errorText));
  }

  /** 操作失败时的状态行文案（列表照旧，不清空） */
  function failStatus(err, prefix) {
    if (onError) onError(err);
    const code = err && err.code;
    if (code === 'not_subscribed') {
      say('模板是订阅功能，请先订阅', true);
      return;
    }
    if (code === 'unauthorized') {
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

  function isOpen() {
    return Boolean(dom.dialog.open);
  }

  function findMine(id) {
    return items.find((t) => t.id === id);
  }

  function findShared(shareId) {
    return sharedItems.find((t) => t.shareId === shareId);
  }

  async function loadOne(id) {
    const tpl = findMine(id);
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
      failStatus(err, '载入模板失败');
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
        if (onShapeLocked) {
          onShapeLocked(err.data && err.data.shape, `这个模板是${shapeName}，需要订阅后才能使用`);
        }
        return;
      }
      failStatus(err, '载入分享失败');
    }
  }

  async function removeOne(id) {
    const tpl = findMine(id);
    if (!window.confirm(`删除模板「${(tpl && tpl.name) || id}」？删除后无法恢复。`)) return;
    try {
      await api.deleteTemplate(id);
      items = items.filter((t) => t.id !== id);
      render();
      say(`已删除「${(tpl && tpl.name) || id}」，剩 ${items.length} 个 · 收到 ${sharedItems.length} 个`);
    } catch (err) {
      failStatus(err, '删除模板失败');
    }
  }

  async function removeShared(shareId) {
    const tpl = findShared(shareId);
    if (!window.confirm(`删除收到的分享「${(tpl && tpl.name) || shareId}」？对方不受影响。`)) return;
    try {
      await api.deleteShared(shareId);
      sharedItems = sharedItems.filter((t) => t.shareId !== shareId);
      render();
      say(`已移除分享「${(tpl && tpl.name) || shareId}」，剩 ${sharedItems.length} 个 · 我的 ${items.length} 个`);
    } catch (err) {
      failStatus(err, '删除分享失败');
    }
  }

  /* 分享弹窗 */
  function openShareDialog(id) {
    const tpl = findMine(id);
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

  dom.list.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    // 「去订阅」在列表的锁定说明里，不属于任何一张卡片
    if (btn.dataset.act === 'subscribe') {
      if (onSubscribe) onSubscribe();
      return;
    }
    const row = btn.closest('.tpl-item');
    if (!row) return;
    const id = row.dataset.id;
    const shared = row.dataset.kind === 'shared';
    if (btn.dataset.act === 'load') {
      if (shared) loadShared(id);
      else loadOne(id);
    } else if (btn.dataset.act === 'del') {
      if (shared) removeShared(id);
      else removeOne(id);
    } else if (btn.dataset.act === 'share' && !shared) {
      openShareDialog(id);
    }
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

  return { open, refresh, reset, openNameDialog, isOpen };
}
