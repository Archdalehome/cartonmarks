/**
 * lib/api/http.js —— 响应、错误、Cookie 工具（Pages Functions 共用）
 */

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function fail(code, message, status, extra = {}) {
  return json({ error: code, message, ...extra }, status);
}

export function backendUnavailable(missing) {
  return fail('backend_unavailable', '服务端尚未配置完成，请稍后再试', 503, {
    missing: missing.join(','),
  });
}

export function methodNotAllowed(allow) {
  return new Response(JSON.stringify({ error: 'method_not_allowed', message: '不支持的请求方法' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: allow },
  });
}

/** 统一兜底：未捕获异常返回 500，日志留 stack，不把细节透给前端 */
export function guard(handler) {
  return async (context) => {
    try {
      return await handler(context);
    } catch (err) {
      console.error('[api] unhandled', (err && err.stack) || err);
      return fail('internal', '服务器内部错误', 500);
    }
  };
}

export function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export const SESSION_COOKIE = 'cm_sess';
export const SESSION_TTL = 2592000; // 30 天

export function sessionCookie(token, maxAge = SESSION_TTL) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function readJsonBody(request) {
  try {
    const data = await request.json();
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

export function yyyymmdd(now = Date.now()) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
}

export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
}

export function requireEnv(env, names) {
  return names.filter((n) => !env || typeof env[n] !== 'string' || !env[n]);
}
