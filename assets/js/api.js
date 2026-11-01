/**
 * api.js —— /api 客户端
 * 统一把 HTTP 错误转成 ApiError（带 status / code / data），页面按 code 决定弹登录还是订阅。
 */

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'network_error', data = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export function isBackendDown(err) {
  return Boolean(err && (err.code === 'backend_unavailable' || err.status === 503));
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new ApiError('网络连接失败，请检查网络后重试', { code: 'network_error' });
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError((data && data.message) || `请求失败（${res.status}）`, {
      status: res.status,
      code: (data && data.error) || 'http_error',
      data,
    });
  }
  return data;
}

export const api = {
  me: () => request('/api/me'),
  sendCode: (email) => request('/api/auth/code', { method: 'POST', body: { email } }),
  register: (payload) => request('/api/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/api/auth/login', { method: 'POST', body: payload }),
  resetCode: (email) => request('/api/auth/reset-code', { method: 'POST', body: { email } }),
  resetPassword: (payload) => request('/api/auth/reset', { method: 'POST', body: payload }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  payCreate: () => request('/api/pay/create', { method: 'POST', body: {} }),
  payStatus: (orderId) => request(`/api/pay/status?orderId=${encodeURIComponent(orderId)}`),
  templates: () => request('/api/templates'),
  template: (id) => request(`/api/templates/${encodeURIComponent(id)}`),
  createTemplate: (payload) => request('/api/templates', { method: 'POST', body: payload }),
  deleteTemplate: (id) => request(`/api/templates/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  // 模板分享：发出侧
  shareTemplate: (id, email) =>
    request(`/api/templates/${encodeURIComponent(id)}/share`, { method: 'POST', body: { email } }),
  revokeShare: (id, shareId) =>
    request(`/api/templates/${encodeURIComponent(id)}/share/${encodeURIComponent(shareId)}`, { method: 'DELETE' }),
  // 模板分享：收到侧
  sharedTemplates: () => request('/api/shared'),
  sharedTemplate: (shareId) => request(`/api/shared/${encodeURIComponent(shareId)}`),
  deleteShared: (shareId) => request(`/api/shared/${encodeURIComponent(shareId)}`, { method: 'DELETE' }),
};
