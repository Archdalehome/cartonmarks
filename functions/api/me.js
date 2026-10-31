/**
 * GET /api/me —— 当前用户与订阅到期时间；未登录返回 null（不返回 401）
 */
import { guard, json, backendUnavailable } from '../../lib/api/http.js';
import { readSession, getUserById, publicUser } from '../../lib/api/auth.js';

export const onRequestGet = guard(async ({ request, env }) => {
  if (!env.CM_KV) return backendUnavailable(['CM_KV']);
  const kv = env.CM_KV;

  const session = await readSession(request, kv);
  if (!session) return json({ user: null, subExpiresAt: null });

  const user = await getUserById(kv, session.uid);
  if (!user) return json({ user: null, subExpiresAt: null });

  const sub = await kv.get(`cm:sub:${session.uid}`, 'json');
  const now = Date.now();
  const expiresAt = sub && sub.expiresAt && new Date(sub.expiresAt).getTime() > now
    ? sub.expiresAt
    : null;

  return json({ user: publicUser(user), subExpiresAt: expiresAt });
});
