/**
 * POST /api/auth/code —— 发送 6 位注册验证码
 * 限速与校验规则都在 lib/api/codes.js（与找回密码共用一套）
 */
import {
  guard,
  fail,
  json,
  readJsonBody,
  requireEnv,
  backendUnavailable, getKV, kvUnavailable,
} from '../../../lib/api/http.js';
import { normalizeEmail, isValidEmail } from '../../../lib/api/auth.js';
import { issueCode } from '../../../lib/api/codes.js';

function emailHtml(code) {
  return `<div style="font:14px/1.7 system-ui,'Microsoft YaHei',sans-serif;color:#0f172a">
  <p>你的 Carton Mark 注册验证码是：</p>
  <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:12px 0">${code}</p>
  <p>10 分钟内有效，最多尝试 5 次。不是本人操作请忽略这封邮件。</p>
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

  const out = await issueCode({
    kv,
    env,
    request,
    email,
    mail: {
      subject: 'Carton Mark 注册验证码',
      html: emailHtml,
      text: (code) => `你的 Carton Mark 注册验证码是 ${code}，10 分钟内有效，最多尝试 5 次。`,
    },
  });
  if (out.error) return out.error;
  return json({ ok: true, retryAfter: out.retryAfter });
});
