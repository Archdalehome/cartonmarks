/**
 * POST /api/auth/register —— 验证码注册，成功即登录
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
  hashPassword,
  randomBytes,
  randomId,
  bytesToBase64,
  createSession,
  getUserByEmail,
  publicUser,
} from '../../../lib/api/auth.js';

const CODE_TTL = 600;
const MAX_TRIES = 5;

export const onRequestPost = guard(async ({ request, env }) => {
  if (!env.CM_KV) return backendUnavailable(['CM_KV']);
  const kv = env.CM_KV;

  const body = await readJsonBody(request);
  if (!body) return fail('invalid_request', '请求格式不对', 400);

  const email = normalizeEmail(body.email);
  const code = String(body.code || '').trim();
  const password = String(body.password || '');
  const name = String(body.name || '').trim().slice(0, 40);

  if (!isValidEmail(email)) return fail('invalid_email', '邮箱格式不对', 400);
  if (!/^\d{6}$/.test(code)) return fail('invalid_request', '验证码是 6 位数字', 400);
  if (password.length < 8 || password.length > 72) {
    return fail('invalid_request', '密码长度需在 8–72 位之间', 400);
  }

  if (await getUserByEmail(kv, email)) {
    return fail('email_taken', '这个邮箱已经注册过了，直接登录吧', 409);
  }

  const record = await kv.get(`cm:code:${email}`, 'json');
  if (!record) return fail('code_expired', '验证码已过期，请重新获取', 410);

  const createdAt = new Date(record.createdAt || 0).getTime();
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > CODE_TTL * 1000) {
    await kv.delete(`cm:code:${email}`);
    return fail('code_expired', '验证码已过期，请重新获取', 410);
  }

  const tries = Number(record.tries || 0);
  if (tries >= MAX_TRIES) {
    await kv.delete(`cm:code:${email}`);
    return fail('code_invalid', '验证码尝试次数过多，请重新获取', 400, { attemptsLeft: 0 });
  }

  if (code !== record.code) {
    const nextTries = tries + 1;
    if (nextTries >= MAX_TRIES) {
      await kv.delete(`cm:code:${email}`);
    } else {
      await kv.put(
        `cm:code:${email}`,
        JSON.stringify({ ...record, tries: nextTries }),
        { expirationTtl: CODE_TTL },
      );
    }
    return fail('code_invalid', '验证码不对', 400, { attemptsLeft: Math.max(0, MAX_TRIES - nextTries) });
  }

  // 建号
  const uid = randomId('u_');
  const salt = bytesToBase64(randomBytes(16));
  const hash = await hashPassword(password, salt);
  const now = Date.now();
  const user = {
    id: uid,
    email,
    name,
    hash,
    salt,
    createdAt: new Date(now).toISOString(),
  };

  await kv.put(`cm:user:${email}`, JSON.stringify(user));
  await kv.put(`cm:uid2email:${uid}`, email);
  await kv.delete(`cm:code:${email}`);

  const token = await createSession(kv, uid, now);
  return json({ user: publicUser(user) }, 201, { 'Set-Cookie': sessionCookie(token) });
});
