/**
 * POST /api/auth/reset-code —— 找回密码发码
 *
 * 防枚举：无论邮箱是否注册，一律返回 200 { ok, retryAfter }；只有已注册用户才真发邮件。
 * 限速 / 冷却 / 每日上限 与注册发码完全共用 lib/api/codes.js，不给「这个邮箱存不存在」留信号。
 */
import {
  guard,
  fail,
  json,
  readJsonBody,
  requireEnv,
  backendUnavailable, getKV, kvUnavailable,
} from '../../../lib/api/http.js';
import { normalizeEmail, isValidEmail, getUserByEmail } from '../../../lib/api/auth.js';
import { issueCode } from '../../../lib/api/codes.js';

function emailHtml(code) {
  return `<div style="font:14px/1.7 system-ui,'Microsoft YaHei',sans-serif;color:#0f172a">
  <p>你正在重置 Carton Mark 的登录密码，验证码是：</p>
  <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:12px 0">${code}</p>
  <p>10 分钟内有效，最多尝试 5 次。密码重置后，其它设备上的登录会全部失效。</p>
  <p>不是你本人操作就忽略这封邮件，密码不会变。</p>
  <p style="color:#64748b;font-size:12px">Carton Mark · 箱唛设计工具</p>
</div>`;
}

export const onRequestPost = guard(async ({ request, env }) => {
  const kv = getKV(env);
  if (!kv) return kvUnavailable();
  const missing = requireEnv(env, ['RESEND_API_KEY', 'RESEND_FROM']);
  if (missing.length) return backendUnavailable(missing);

  const body = await readJsonBody(request);
  const email = normalizeEmail(body && body.email);
  if (!isValidEmail(email)) return fail('invalid_email', '邮箱格式不对', 400);

  const user = await getUserByEmail(kv, email);
  const out = await issueCode({
    kv,
    env,
    request,
    email,
    mail: {
      shouldSend: Boolean(user),
      subject: 'Carton Mark 重置密码验证码',
      html: emailHtml,
      text: (code) => `你的 Carton Mark 密码重置验证码是 ${code}，10 分钟内有效，最多尝试 5 次。`,
    },
  });
  if (out.error) return out.error;
  return json({ ok: true, retryAfter: out.retryAfter });
});
