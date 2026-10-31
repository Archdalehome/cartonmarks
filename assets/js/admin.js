/**
 * admin.js —— 后台管理页：用户列表 / 调订阅期 / 删号
 *
 * 所有请求都走同域 /api，Cookie 是 HttpOnly 的 cm_sess；
 * 401 → 请先登录，403 admin_only → 没有管理员权限，两者分开提示。
 */

const el = (id) => document.getElementById(id);
const dom = {
  who: el('who'),
  q: el('q'),
  searchBtn: el('searchBtn'),
  resetBtn: el('resetBtn'),
  refreshBtn: el('refreshBtn'),
  status: el('status'),
  tableHost: el('tableHost'),
  moreBtn: el('moreBtn'),
};

let me = null;
let cursor = null;
let rows = [];

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && data.message) || `请求失败（${res.status}）`);
    err.status = res.status;
    err.code = data && data.error;
    throw err;
  }
  return data;
}

function setStatus(text, isError = false) {
  dom.status.textContent = text || '';
  dom.status.classList.toggle('is-error', Boolean(isError));
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function subTag(iso) {
  if (!iso) return '<span class="tag">未订阅</span>';
  const soon = new Date(iso).getTime() - Date.now() < 30 * 86400000;
  return `<span class="tag ${soon ? 'tag--danger' : 'tag--ok'}">到 ${fmtTime(iso)}</span>`;
}

function render() {
  if (!rows.length) {
    dom.tableHost.innerHTML = '<div class="empty">没有匹配的用户</div>';
    dom.moreBtn.hidden = true;
    return;
  }
  const body = rows
    .map(
      (u) => `
      <tr data-id="${u.id}">
        <td>${u.email}</td>
        <td>${fmtTime(u.createdAt)}</td>
        <td>${subTag(u.subExpiresAt)}</td>
        <td>${u.isAdmin ? '<span class="tag tag--ok">管理员</span>' : '—'}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="btn" data-act="sub" data-days="30">+30 天</button>
            <button type="button" class="btn" data-act="sub" data-days="365">+365 天</button>
            <button type="button" class="btn" data-act="sub" data-days="-30">−30 天</button>
            <button type="button" class="btn btn-ghost" data-act="del">删除</button>
          </div>
        </td>
      </tr>`,
    )
    .join('');

  dom.tableHost.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr><th>邮箱</th><th>注册时间</th><th>订阅</th><th>身份</th><th>操作</th></tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
  dom.moreBtn.hidden = !cursor;
  dom.moreBtn.style.display = cursor ? '' : 'none';
}

async function load({ append = false } = {}) {
  setStatus(append ? '载入更多…' : '加载中…');
  const q = dom.q.value.trim();
  const params = new URLSearchParams({ limit: '50' });
  if (q) params.set('q', q);
  if (append && cursor) params.set('cursor', cursor);
  try {
    const data = await api(`/api/admin/users?${params.toString()}`);
    rows = append ? [...rows, ...data.items] : data.items;
    cursor = data.nextCursor || null;
    render();
    setStatus(`共显示 ${rows.length} 个用户${q ? `（搜索：${q}）` : ''}`);
  } catch (err) {
    fail(err, '加载用户列表失败');
  }
}

/** 统一错误提示：401/403/429 分别说人话 */
function fail(err, prefix) {
  if (err.status === 401) {
    setStatus('请先登录：回到工作台用邮箱登录后再打开后台', true);
    dom.tableHost.innerHTML = '';
    return;
  }
  if (err.status === 403) {
    setStatus('当前账号不是管理员（403 admin_only）', true);
    dom.tableHost.innerHTML = '';
    return;
  }
  if (err.status === 429) {
    setStatus('请求太频繁了，后台接口每分钟限 30 次，歇一会儿再来', true);
    return;
  }
  setStatus(`${prefix}：${err.message}`, true);
}

async function changeSub(id, days) {
  const action = days > 0 ? `加 ${days} 天` : `减 ${Math.abs(days)} 天`;
  if (!window.confirm(`确定给这个用户${action}吗？`)) return;
  try {
    const data = await api(`/api/admin/users/${encodeURIComponent(id)}/sub`, {
      method: 'POST',
      body: JSON.stringify({ days }),
    });
    setStatus(`已调整：${data.email} → ${data.subExpiresAt ? `订阅到 ${fmtTime(data.subExpiresAt)}` : '订阅已取消'}`);
    await load();
  } catch (err) {
    fail(err, '调整订阅失败');
  }
}

async function removeUser(id, email) {
  if (!window.confirm(`删除用户 ${email}？模板、订阅、会话会一并清理，不能恢复。`)) return;
  try {
    await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
    setStatus(`已删除 ${email}`);
    await load();
  } catch (err) {
    fail(err, '删除用户失败');
  }
}

function onTableClick(ev) {
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  const row = btn.closest('tr');
  const id = row && row.dataset.id;
  const item = rows.find((u) => u.id === id);
  if (!id || !item) return;

  if (btn.dataset.act === 'sub') {
    changeSub(id, Number(btn.dataset.days));
  } else if (btn.dataset.act === 'del') {
    if (item.isAdmin) {
      setStatus('管理员账号受保护，不能删除', true);
      return;
    }
    removeUser(id, item.email);
  }
}

async function init() {
  dom.who.textContent = '检查登录态…';
  try {
    const data = await api('/api/me');
    me = data && data.user;
  } catch (err) {
    fail(err, '读取账号失败');
    return;
  }
  if (!me) {
    dom.who.textContent = '未登录';
    setStatus('请先登录：回到工作台用邮箱登录后再打开后台', true);
    return;
  }
  if (!me.isAdmin) {
    dom.who.textContent = me.email;
    setStatus('当前账号不是管理员（403 admin_only）', true);
    return;
  }
  dom.who.textContent = `${me.email} · 管理员`;
  await load();
}

dom.searchBtn.addEventListener('click', () => {
  cursor = null;
  load();
});
dom.q.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    cursor = null;
    load();
  }
});
dom.resetBtn.addEventListener('click', () => {
  dom.q.value = '';
  cursor = null;
  load();
});
dom.refreshBtn.addEventListener('click', () => load());
dom.moreBtn.addEventListener('click', () => load({ append: true }));
dom.tableHost.addEventListener('click', onTableClick);

init();
