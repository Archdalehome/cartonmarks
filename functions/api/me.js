/**
 * GET /api/me —— 当前用户与订阅到期时间
 *
 * 三种结果，刻意区分开，别让「没登录」和「登录残了」看起来一样：
 *   - 没有会话 cookie / 会话已过期 → 200 { user: null }（正常游客）
 *   - 会话有效但用户查不到（cm:uid2email 或 cm:user 记录缺失，通常是清数据误伤）
 *     → 401 { error: "session_stale" }，同时把这个会话删掉；前端据此清本地账号态并提示重新登录
 *   - 正常 → 200 { user, subExpiresAt }
 */
import { guard, fail, json, getKV, kvUnavailable } from '../../lib/api/http.js';
import { readSession, getUserById, destroySession, publicUser } from '../../lib/api/auth.js';

export const onRequestGet = guard(async ({ request, env }) => {
  const kv = getKV(env);
  if (!kv) return kvUnavailable();

  const session = await readSession(request, kv);
  if (!session) return json({ user: null, subExpiresAt: null });

  const user = await getUserById(kv, session.uid);
  if (!user) {
    // 会话还在但用户记录没了：清掉这个死会话，明确告诉前端要重新登录
    await destroySession(kv, session.token);
    return fail('session_stale', '登录状态已失效，请重新登录', 401);
  }

  const sub = await kv.get(`cm:sub:${session.uid}`, 'json');
  const now = Date.now();
  const expiresAt = sub && sub.expiresAt && new Date(sub.expiresAt).getTime() > now
    ? sub.expiresAt
    : null;

  return json({
    user: { ...publicUser(user), isAdmin: user.admin === true },
    subExpiresAt: expiresAt,
  });
});
