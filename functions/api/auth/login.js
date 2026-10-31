/**
 * POST /api/auth/login —— 5 次失败锁 15 分钟
 */
import {
  guard,
  fail,
  json,
  readJsonBody,
  sessionCookie,
  backendUnavailable,
} from '../../../lib/api/http.js';
import {
  normalizeEmail,
  isValidEmail,
  verifyPassword,
  createSession,
  getUserByEmail,
  publicUser,
} from '../../../lib/api/auth.js';

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

export const onRequestPost = guard(async ({ request, env }) => {
  if (!env.CM_KV) return backendUnavailable(['CM_KV']);
  const kv = env.CM_KV;

  const body = await readJsonBody(request);
  if (!body) return fail('invalid_request', '请求格式不对', 400);

  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  if (!isValidEmail(email)) return fail('invalid_email', '邮箱格式不对', 400);
  if (!password) return fail('invalid_request', '请输入密码', 400);

  const now = Date.now();
  const failKey = `cm:login_fail:${email}`;
  const failRecord = await kv.get(failKey, 'json');

  if (failRecord && failRecord.lockedUntil && failRecord.lockedUntil > now) {
    const retryAfter = Math.ceil((failRecord.lockedUntil - now) / 1000);
    return fail('locked', `尝试次数过多，请 ${Math.ceil(retryAfter / 60)} 分钟后再试`, 423, { retryAfter });
  }

  const user = await getUserByEmail(kv, email);
  let ok = false;
  if (user) ok = await verifyPassword(password, user.salt, user.hash);

  if (!ok) {
    const count = (failRecord && failRecord.count ? failRecord.count : 0) + 1;
    const lockedUntil = count >= MAX_FAILS ? now + LOCK_MS : 0;
    await kv.put(
      failKey,
      JSON.stringify({ count, lockedUntil: lockedUntil || 0 }),
      { expirationTtl: 900 },
    );

    if (lockedUntil) {
      return fail('locked', '尝试次数过多，请 15 分钟后再试', 423, { retryAfter: Math.ceil(LOCK_MS / 1000) });
    }
    return fail('bad_credentials', '邮箱或密码不对', 401, { attemptsLeft: Math.max(0, MAX_FAILS - count) });
  }

  await kv.delete(failKey);
  const token = await createSession(kv, user.id, now);
  return json({ user: publicUser(user) }, 200, { 'Set-Cookie': sessionCookie(token) });
});
