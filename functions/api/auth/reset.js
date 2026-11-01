/**
 * POST /api/auth/reset —— 用验证码重置密码，成功即登录
 *
 * 安全要点：重置成功会把 cm:pwAt:{uid} 更新为当前时间，
 * readSession 读到「会话创建时间早于密码修改时间」就一律作废——
 * 这样密码泄露后改密码，别人手上的旧会话立刻失效（不依赖 KV list，强一致）。
 */
import {
  guard,
  fail,
  json,
  readJsonBody,
  sessionCookie,
  getKV,
  kvUnavailable,
} from '../../../lib/api/http.js';
import {
  normalizeEmail,
  isValidEmail,
  hashPassword,
  randomBytes,
  bytesToBase64,
  createSession,
  markPasswordChanged,
  getUserByEmail,
  publicUser,
} from '../../../lib/api/auth.js';
import { verifyCode } from '../../../lib/api/codes.js';

export const onRequestPost = guard(async ({ request, env }) => {
  const kv = getKV(env);
  if (!kv) return kvUnavailable();
  const body = await readJsonBody(request);
  if (!body) return fail('invalid_request', '请求格式不对', 400);

  const email = normalizeEmail(body.email);
  const code = String(body.code || '').trim();
  const password = String(body.password || '');

  if (!isValidEmail(email)) return fail('invalid_email', '邮箱格式不对', 400);
  if (!/^\d{6}$/.test(code)) return fail('invalid_request', '验证码是 6 位数字', 400);
  if (password.length < 8 || password.length > 72) {
    return fail('invalid_request', '密码长度需在 8–72 位之间', 400);
  }

  const user = await getUserByEmail(kv, email);
  // 邮箱没注册：和「验证码过期」同一个回复，不暴露邮箱是否存在
  if (!user) return fail('code_expired', '验证码已过期，请重新获取', 410);

  const checked = await verifyCode({ kv, email, code });
  if (checked.error) return checked.error;

  const now = Date.now();
  const salt = bytesToBase64(randomBytes(16));
  const hash = await hashPassword(password, salt);
  const next = { ...user, salt, hash };
  await kv.put(`cm:user:${email}`, JSON.stringify(next));

  // 先记修改时间再建新会话：新会话刻意晚 1ms，好让「创建时间 <= 修改时间 → 作废」
  // 这条判定不会把它自己杀掉（同一毫秒内的旧会话则会被杀）
  await markPasswordChanged(kv, user.id, now);
  const token = await createSession(kv, user.id, now + 1);

  // 顺手清掉这个邮箱的登录失败计数，免得刚改完密码还被锁着
  await kv.delete(`cm:login_fail:${email}`);

  return json({ user: publicUser(next) }, 200, { 'Set-Cookie': sessionCookie(token) });
});
