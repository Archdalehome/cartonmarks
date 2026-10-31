/**
 * auth-ui.js —— 登录/注册、订阅弹层、账号状态
 *
 * 页面只通过这里拿账号状态：currentAccount() / isSubscribed()。
 * 任何 401 弹登录、403 弹订阅、503 显示「服务暂不可用」，都不白屏。
 */

import { api, isBackendDown } from './api.js';
import { drawQr } from './qr.js';

const state = {
  user: null,
  subExpiresAt: null,
  backendDown: false,
  loading: false,
};

let notify = () => {};
let countdownTimer = 0;
let pollTimer = 0;
let pollTries = 0;
let currentOrderId = '';

const dom = {};

export function currentAccount() {
  return { ...state, subscribed: isSubscribed() };
}

export function isSubscribed() {
  return Boolean(state.subExpiresAt) && new Date(state.subExpiresAt).getTime() > Date.now();
}

export function backendDown() {
  return state.backendDown;
}

export function initAccountUI({ onChange } = {}) {
  notify = typeof onChange === 'function' ? onChange : () => {};
  cacheDom();
  bind();
  renderAccount();
  return refreshAccount();
}

function cacheDom() {
  dom.accountBox = document.getElementById('accountBox');
  dom.templatesBtn = document.getElementById('templatesBtn');
  dom.authDialog = document.getElementById('authDialog');
  dom.authForm = document.getElementById('authForm');
  dom.authTitle = document.getElementById('authTitle');
  dom.authTabs = document.getElementById('authTabs');
  dom.authEmail = document.getElementById('authEmail');
  dom.authPassword = document.getElementById('authPassword');
  dom.authPasswordField = document.getElementById('authPasswordField');
  dom.authCode = document.getElementById('authCode');
  dom.authCodeField = document.getElementById('authCodeField');
  dom.authName = document.getElementById('authName');
  dom.authNameField = document.getElementById('authNameField');
  dom.sendCodeBtn = document.getElementById('sendCodeBtn');
  dom.authError = document.getElementById('authError');
  dom.authSubmit = document.getElementById('authSubmit');
  dom.authCancel = document.getElementById('authCancel');
  dom.authClose = document.getElementById('authClose');

  dom.subDialog = document.getElementById('subDialog');
  dom.subStatus = document.getElementById('subStatus');
  dom.subPayArea = document.getElementById('subPayArea');
  dom.subQr = document.getElementById('subQr');
  dom.subError = document.getElementById('subError');
  dom.subPayBtn = document.getElementById('subPayBtn');
  dom.subClose = document.getElementById('subClose');
  dom.subCloseBtn = document.getElementById('subCloseBtn');
  dom.subExpiry = document.getElementById('subExpiry');
  dom.subTimer = document.getElementById('subTimer');
}

function bind() {
  dom.accountBox.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'login') openLogin('login');
    if (btn.dataset.action === 'logout') logout();
  });

  dom.authTabs.addEventListener('click', (ev) => {
    const tab = ev.target.closest('button[data-auth-tab]');
    if (tab) setAuthTab(tab.dataset.authTab);
  });

  dom.sendCodeBtn.addEventListener('click', sendCode);
  dom.authForm.addEventListener('submit', submitAuth);
  dom.authCancel.addEventListener('click', () => dom.authDialog.close());
  dom.authClose.addEventListener('click', () => dom.authDialog.close());

  dom.subPayBtn.addEventListener('click', startPay);
  const closeSub = () => {
    stopPolling();
    stopOrderTimer();
    dom.subDialog.close();
  };
  dom.subClose.addEventListener('click', closeSub);
  dom.subCloseBtn.addEventListener('click', closeSub);
}

/* ── 账号状态 ───────────────────────────────────── */

export async function refreshAccount() {
  state.loading = true;
  try {
    const data = await api.me();
    state.user = data.user || null;
    state.subExpiresAt = data.subExpiresAt || null;
    state.backendDown = false;
  } catch (err) {
    state.user = null;
    state.subExpiresAt = null;
    state.backendDown = isBackendDown(err);
  } finally {
    state.loading = false;
  }
  renderAccount();
  return currentAccount();
}

function renderAccount() {
  if (!dom.accountBox) return;
  const box = dom.accountBox;
  box.replaceChildren();

  if (state.user) {
    const email = document.createElement('span');
    email.className = 'account-email';
    email.textContent = state.user.email;
    email.title = state.user.email;

    const badge = document.createElement('span');
    badge.className = `tag${isSubscribed() ? ' tag--ok' : ''}`;
    badge.textContent = isSubscribed() ? '已订阅' : '未订阅';

    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'btn btn-ghost';
    out.dataset.action = 'logout';
    out.textContent = '退出';

    box.append(email, badge, out);
  } else {
    const login = document.createElement('button');
    login.type = 'button';
    login.className = 'btn';
    login.dataset.action = 'login';
    login.textContent = '登录 / 注册';
    box.append(login);
  }

  if (dom.templatesBtn) {
    dom.templatesBtn.classList.toggle('is-locked', !isSubscribed());
    dom.templatesBtn.textContent = isSubscribed() ? '模板' : '模板 🔒';
  }

  notify(currentAccount());
}

async function logout() {
  try {
    await api.logout();
  } catch (err) {
    console.warn('登出请求失败，按本地登出处理', err);
  }
  await refreshAccount();
  toast('已退出登录');
}

/* ── 登录 / 注册 ───────────────────────────────── */

export function openLogin(tab = 'login') {
  setAuthTab(tab);
  dom.authError.textContent = '';
  dom.authEmail.value = state.user ? state.user.email : '';
  dom.authPassword.value = '';
  dom.authCode.value = '';
  dom.authName.value = '';
  dom.authSubmit.disabled = false;
  dom.sendCodeBtn.disabled = false;
  if (typeof dom.authDialog.showModal === 'function') dom.authDialog.showModal();
  else dom.authDialog.setAttribute('open', '');
  dom.authEmail.focus();
}

function setAuthTab(tab) {
  const isRegister = tab === 'register';
  dom.authDialog.dataset.tab = isRegister ? 'register' : 'login';
  dom.authTitle.textContent = isRegister ? '注册（邮箱验证码）' : '登录';
  dom.authSubmit.textContent = isRegister ? '注册并登录' : '登录';
  dom.authPasswordField.hidden = isRegister;
  dom.authCodeField.hidden = !isRegister;
  dom.authNameField.hidden = !isRegister;
  dom.authError.textContent = '';
  dom.authTabs.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.authTab === (isRegister ? 'register' : 'login');
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', String(on));
  });
}

function describeError(err) {
  const retryAfter = err && err.data && err.data.retryAfter;
  const attemptsLeft = err && err.data && err.data.attemptsLeft;
  switch (err && err.code) {
    case 'invalid_email':
      return '邮箱格式不对';
    case 'code_invalid':
      return `验证码不对${attemptsLeft != null ? `，还能试 ${attemptsLeft} 次` : ''}`;
    case 'code_expired':
      return '验证码已过期，请重新获取';
    case 'rate_limited':
      return `操作太频繁，请 ${retryAfter || 60} 秒后再试`;
    case 'email_taken':
      return '这个邮箱已经注册过了，直接登录即可';
    case 'bad_credentials':
      return `邮箱或密码不对${attemptsLeft != null ? `，还能试 ${attemptsLeft} 次` : ''}`;
    case 'locked':
      return `尝试次数过多，请 ${Math.ceil((retryAfter || 900) / 60)} 分钟后再试`;
    case 'backend_unavailable':
      return '服务暂不可用，稍后再试';
    case 'network_error':
      return '网络连接失败，请检查网络后重试';
    default:
      return (err && err.message) || '操作失败，请稍后再试';
  }
}

async function sendCode() {
  const email = dom.authEmail.value.trim().toLowerCase();
  if (!email) {
    dom.authError.textContent = '请先填邮箱';
    dom.authEmail.focus();
    return;
  }
  dom.sendCodeBtn.disabled = true;
  dom.sendCodeBtn.textContent = '发送中…';
  dom.authError.textContent = '';
  try {
    const res = await api.sendCode(email);
    startCountdown(res && res.retryAfter ? res.retryAfter : 60);
  } catch (err) {
    dom.sendCodeBtn.disabled = false;
    dom.sendCodeBtn.textContent = '发送验证码';
    dom.authError.textContent = describeError(err);
  }
}

function startCountdown(seconds) {
  clearInterval(countdownTimer);
  let left = Math.max(1, Number(seconds) || 60);
  dom.sendCodeBtn.disabled = true;
  const tick = () => {
    dom.sendCodeBtn.textContent = `${left} 秒后重发`;
    if (left <= 0) {
      clearInterval(countdownTimer);
      dom.sendCodeBtn.disabled = false;
      dom.sendCodeBtn.textContent = '发送验证码';
      return;
    }
    left -= 1;
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

async function submitAuth(ev) {
  ev.preventDefault();
  const isRegister = dom.authDialog.dataset.tab === 'register';
  const email = dom.authEmail.value.trim().toLowerCase();
  const password = dom.authPassword.value;
  const code = dom.authCode.value.trim();
  dom.authError.textContent = '';

  if (!email) {
    dom.authError.textContent = '请填邮箱';
    return;
  }

  dom.authSubmit.disabled = true;
  try {
    if (isRegister) {
      if (password.length < 8) {
        dom.authError.textContent = '密码至少 8 位';
        return;
      }
      if (!/^\d{6}$/.test(code)) {
        dom.authError.textContent = '验证码是 6 位数字';
        return;
      }
      await api.register({ email, code, password, name: dom.authName.value.trim() });
      toast('注册成功，已登录');
    } else {
      if (!password) {
        dom.authError.textContent = '请填密码';
        return;
      }
      await api.login({ email, password });
      toast('登录成功');
    }
    await refreshAccount();
    dom.authDialog.close();
  } catch (err) {
    dom.authError.textContent = describeError(err);
  } finally {
    dom.authSubmit.disabled = false;
  }
}

/* ── 订阅 ───────────────────────────────────────── */

export function openSubscribe() {
  if (!state.user) {
    openLogin('login');
    toast('订阅前先登录');
    return;
  }
  stopPolling();
  currentOrderId = '';
  dom.subError.textContent = '';
  dom.subPayArea.hidden = true;
  dom.subPayBtn.disabled = false;
  dom.subPayBtn.textContent = '微信支付 ¥9.9';

  if (isSubscribed()) {
    dom.subStatus.textContent = `已订阅至 ${formatDate(state.subExpiresAt)}，可继续续费（在原到期日上加一年）。`;
    dom.subPayBtn.textContent = '续费 ¥9.9';
  } else {
    dom.subStatus.textContent = '当前未订阅：L 形箱、斜形箱与模板保存需要订阅后使用。';
  }

  if (typeof dom.subDialog.showModal === 'function') dom.subDialog.showModal();
  else dom.subDialog.setAttribute('open', '');
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function startPay() {
  dom.subError.textContent = '';
  dom.subPayBtn.disabled = true;
  dom.subPayBtn.textContent = '生成二维码…';
  try {
    const res = await api.payCreate();
    currentOrderId = res.orderId;
    drawQr(dom.subQr, res.qr, { size: 220, margin: 4 });
    dom.subPayArea.hidden = false;
    dom.subPayBtn.textContent = '等待支付…';
    startOrderTimer(res.expiresIn);
    startPolling();
  } catch (err) {
    dom.subPayBtn.disabled = false;
    dom.subPayBtn.textContent = '微信支付 ¥9.9';
    dom.subError.textContent = describeError(err);
  }
}

function startPolling() {
  stopPolling();
  pollTries = 0;
  const tick = async () => {
    pollTries += 1;
    if (pollTries > 100) {
      // 5 分钟
      stopPolling();
      dom.subPayBtn.disabled = false;
      dom.subPayBtn.textContent = '重新生成二维码';
      dom.subError.textContent = '等待超时，请重新生成二维码';
      return;
    }
    try {
      const res = await api.payStatus(currentOrderId);
      if (res.status === 'success') {
        stopPolling();
        stopOrderTimer();
        dom.subTimer.hidden = true;
        await refreshAccount();
        dom.subPayArea.hidden = true;
        dom.subStatus.textContent = `订阅成功，有效期至 ${formatDate(state.subExpiresAt)}`;
        dom.subPayBtn.textContent = '已订阅';
        dom.subPayBtn.disabled = true;
        toast('订阅成功，L 形/斜形箱和模板已解锁');
        notify(currentAccount());
        return;
      }
      if (res.status === 'expire') {
        stopPolling();
        dom.subPayArea.hidden = true;
        dom.subPayBtn.disabled = false;
        dom.subPayBtn.textContent = '微信支付 ¥9.9';
        dom.subError.textContent = '订单已过期，请重新下单';
        return;
      }
    } catch (err) {
      if (isBackendDown(err)) {
        stopPolling();
        dom.subPayBtn.disabled = false;
        dom.subPayBtn.textContent = '重新生成二维码';
        dom.subError.textContent = '服务暂不可用，稍后再试';
        return;
      }
    }
    pollTimer = setTimeout(tick, 3000);
  };
  pollTimer = setTimeout(tick, 3000);
}

function stopPolling() {
  clearTimeout(pollTimer);
  pollTimer = 0;
}

let orderTimer = 0;
let orderDeadline = 0;

/** 二维码有效期倒计时：用后端返回的 expiresIn，过期提示重新下单 */
function startOrderTimer(seconds) {
  stopOrderTimer();
  orderDeadline = Date.now() + Math.max(60, Number(seconds) || 7200) * 1000;
  dom.subTimer.hidden = false;
  const tick = () => {
    const left = Math.max(0, Math.round((orderDeadline - Date.now()) / 1000));
    const mm = String(Math.floor(left / 60)).padStart(2, '0');
    const ss = String(left % 60).padStart(2, '0');
    dom.subTimer.textContent = `二维码有效期 ${mm}:${ss}`;
    if (left <= 0) {
      stopOrderTimer();
      stopPolling();
      dom.subPayArea.hidden = true;
      dom.subPayBtn.disabled = false;
      dom.subPayBtn.textContent = '重新生成二维码';
      dom.subError.textContent = '二维码已过期，请重新生成';
      return;
    }
    orderTimer = setTimeout(tick, 1000);
  };
  tick();
}

function stopOrderTimer() {
  clearTimeout(orderTimer);
  orderTimer = 0;
}

/* ── 统一错误处理：401 弹登录、403 弹订阅、503 提示 ── */

export function handleApiError(err) {
  if (!err) return;
  if (err.status === 401) {
    openLogin('login');
    return;
  }
  if (err.status === 403 && err.code === 'not_subscribed') {
    openSubscribe();
    return;
  }
  if (isBackendDown(err)) {
    toast('服务暂不可用，稍后再试');
    return;
  }
  toast(describeError(err));
}

/* ── 小提示（独立于主 app 的 toast 也能用） ──────── */

function toast(message) {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    node.hidden = true;
  }, 2400);
}
