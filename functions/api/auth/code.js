/**
 * POST /api/auth/code —— 发送 6 位邮箱验证码
 * 规则：同邮箱 60 秒冷却；同邮箱每天 10 次；同 IP 每天 20 次；TTL 600 秒。
 */
import {
  guard,
  fail,
  json,
  readJsonBody,
  yyyymmdd,
  clientIp,
  requireEnv,
  backendUnavailable,
} from '../../../lib/api/http.js';
import { normalizeEmail, isValidEmail, randomDigits } from '../../../lib/api/auth.js';

const CODE_TTL = 600;
const COOLDOWN = 60;
const EMAIL_DAILY = 10;
const IP_DAILY = 20;

function emailHtml(code) {
  return `<div style="font:14px/1.7 system-ui,'Microsoft YaHei',sans-serif;color:#0f172a">
  <p>你的 Carton Mark 注册验证码是：</p>
  <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:12px 0">${code}</p>
  <p>10 分钟内有效，最多尝试 5 次。不是本人操作请忽略这封邮件。</p>
  <p style="color:#64748b;font-size:12px">Carton Mark · 箱唛设计工具</p>
</div>`;
}

export const onRequestPost = guard(async ({ request, env }) => {
  if (!env.CM_KV) return backendUnavailable(['CM_KV']);
  const missing = requireEnv(env, ['RESEND_API_KEY', 'RESEND_FROM']);
  if (missing.length) return backendUnavailable(missing);

  const body = await readJsonBody(request);
  const email = normalizeEmail(body && body.email);
  if (!isValidEmail(email)) return fail('invalid_email', '邮箱格式不对', 400);

  const kv = env.CM_KV;
  const now = Date.now();
  const day = yyyymmdd(now);

  // 同邮箱 60 秒冷却
  const rl = await kv.get(`cm:code_rl:${email}`, 'json');
  if (rl && rl.lastSentAt && now - rl.lastSentAt < COOLDOWN * 1000) {
    const retryAfter = Math.ceil((COOLDOWN * 1000 - (now - rl.lastSentAt)) / 1000);
    return fail('rate_limited', `发送太频繁，请 ${retryAfter} 秒后再试`, 429, { retryAfter });
  }

  // 同邮箱每天 10 次
  const emailDayKey = `cm:code_day:${email}:${day}`;
  const emailDay = await kv.get(emailDayKey, 'json');
  if (emailDay && emailDay.count >= EMAIL_DAILY) {
    return fail('rate_limited', '这个邮箱今天取验证码的次数已用完', 429, { retryAfter: 3600 });
  }

  // 同 IP 每天 20 次
  const ip = clientIp(request);
  const ipKey = `cm:code_ip:${ip}:${day}`;
  const ipDay = await kv.get(ipKey, 'json');
  if (ipDay && ipDay.count >= IP_DAILY) {
    return fail('rate_limited', '当前网络今天取验证码的次数已用完', 429, { retryAfter: 3600 });
  }

  const code = randomDigits(6);

  await kv.put(
    `cm:code:${email}`,
    JSON.stringify({ code, tries: 0, createdAt: new Date(now).toISOString() }),
    { expirationTtl: CODE_TTL },
  );
  await kv.put(`cm:code_rl:${email}`, JSON.stringify({ lastSentAt: now }), { expirationTtl: 3600 });
  await kv.put(emailDayKey, JSON.stringify({ count: (emailDay?.count || 0) + 1 }), {
    expirationTtl: 86400,
  });
  await kv.put(ipKey, JSON.stringify({ count: (ipDay?.count || 0) + 1 }), { expirationTtl: 86400 });

  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: [email],
        subject: 'Carton Mark 注册验证码',
        html: emailHtml(code),
        text: `你的 Carton Mark 注册验证码是 ${code}，10 分钟内有效，最多尝试 5 次。`,
      }),
    });
  } catch (err) {
    console.error('[api] resend fetch failed', err);
    return fail('mail_failed', '验证码邮件发送失败，请稍后再试', 502);
  }

  if (!res.ok) {
    console.error('[api] resend status', res.status);
    return fail('mail_failed', '验证码邮件发送失败，请稍后再试', 502);
  }

  return json({ ok: true, retryAfter: COOLDOWN });
});
