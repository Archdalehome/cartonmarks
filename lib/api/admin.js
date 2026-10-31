/**
 * lib/api/admin.js —— 后台管理接口的公共件
 *
 * 规则：
 *  - 只有 session 用户的 KV 记录里 admin === true 才放行，否则 403 admin_only
 *  - 未登录是 401 unauthorized，两者不混
 *  - 每 IP 每分钟最多 30 次（KV 计数，按分钟分桶）
 *  - 内置管理员账号 admin@support.qafield.com 不允许删除（防手滑）
 */

import { fail, clientIp } from './http.js';
import { requireUser } from './auth.js';

export const PROTECTED_ADMIN_EMAIL = 'admin@support.qafield.com';
export const ADMIN_RATE_MAX = 30;
export const ADMIN_RATE_WINDOW = 60; // 秒

/** 校验管理员身份；返回 { auth } 或 { error } */
export async function requireAdmin(request, kv) {
  const auth = await requireUser(request, kv);
  if (!auth) return { error: fail('unauthorized', '请先登录', 401) };
  if (auth.user.admin !== true) {
    return { error: fail('admin_only', '只有管理员可以访问这个接口', 403) };
  }
  return { auth };
}

/** 每 IP 每分钟 30 次；超限 429 */
export async function rateLimitAdmin(request, kv) {
  const ip = clientIp(request);
  const bucket = Math.floor(Date.now() / 60000);
  const key = `cm:adminrate:${ip}:${bucket}`;
  const used = Number((await kv.get(key)) || 0);
  if (used >= ADMIN_RATE_MAX) {
    return { error: fail('rate_limited', '请求太频繁，请稍后再试', 429, { limit: ADMIN_RATE_MAX }) };
  }
  await kv.put(key, String(used + 1), { expirationTtl: ADMIN_RATE_WINDOW * 2 });
  return {};
}

/** 读某用户的订阅到期时间（毫秒），没有就返回 0 */
export async function readSubExpiry(kv, uid) {
  const sub = await kv.get(`cm:sub:${uid}`, 'json');
  const t = sub && sub.expiresAt ? new Date(sub.expiresAt).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

/** 写订阅到期时间；<= now 视为取消，直接删键 */
export async function writeSubExpiry(kv, uid, atMs) {
  if (!(atMs > Date.now())) {
    await kv.delete(`cm:sub:${uid}`);
    return null;
  }
  const expiresAt = new Date(atMs).toISOString();
  await kv.put(`cm:sub:${uid}`, JSON.stringify({ expiresAt }), { expirationTtl: 86400 * 730 });
  return expiresAt;
}

/** 删掉某用户的所有会话（KV 里按 uid 过滤） */
export async function purgeSessions(kv, uid, maxScan = 2000) {
  let cursor;
  let scanned = 0;
  let removed = 0;
  for (;;) {
    const page = await kv.list({ prefix: 'cm:sess:', cursor, limit: 200 });
    for (const key of page.keys || []) {
      scanned += 1;
      const record = await kv.get(key.name, 'json');
      if (record && record.uid === uid) {
        await kv.delete(key.name);
        removed += 1;
      }
    }
    cursor = page.cursor;
    if (!page.list_complete || !cursor || scanned >= maxScan) break;
  }
  return removed;
}
