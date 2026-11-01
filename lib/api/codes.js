/**
 * lib/api/codes.js —— 邮箱验证码的发送与校验（注册、找回密码共用）
 *
 * 限速口径（三个入口完全一致，便于「注册」和「找回密码」对外表现相同，防枚举）：
 *   同邮箱 60 秒冷却；同邮箱每天 10 次；同 IP 每天 20 次；验证码 TTL 600 秒、最多输错 5 次。
 */
import { fail, yyyymmdd, clientIp } from './http.js';
import { randomDigits } from './auth.js';

export const CODE_TTL = 600;
export const MAX_TRIES = 5;
const COOLDOWN = 60;
const EMAIL_DAILY = 10;
const IP_DAILY = 20;

/**
 * 发码。
 * `mail.shouldSend === false` 时（比如找回密码但邮箱没注册）不落码、不发信，
 * 但仍然消耗冷却和每日限额，保证外部只能看到 200 / 429 的差别。
 */
export async function issueCode({ kv, env, request, email, mail }) {
  const now = Date.now();
  const day = yyyymmdd(now);

  const rl = await kv.get(`cm:code_rl:${email}`, 'json');
  if (rl && rl.lastSentAt && now - rl.lastSentAt < COOLDOWN * 1000) {
    const retryAfter = Math.ceil((COOLDOWN * 1000 - (now - rl.lastSentAt)) / 1000);
    return { error: fail('rate_limited', `发送太频繁，请 ${retryAfter} 秒后再试`, 429, { retryAfter }) };
  }

  const emailDayKey = `cm:code_day:${email}:${day}`;
  const emailDay = await kv.get(emailDayKey, 'json');
  if (emailDay && emailDay.count >= EMAIL_DAILY) {
    return { error: fail('rate_limited', '这个邮箱今天取验证码的次数已用完', 429, { retryAfter: 3600 }) };
  }

  const ip = clientIp(request);
  const ipKey = `cm:code_ip:${ip}:${day}`;
  const ipDay = await kv.get(ipKey, 'json');
  if (ipDay && ipDay.count >= IP_DAILY) {
    return { error: fail('rate_limited', '当前网络今天取验证码的次数已用完', 429, { retryAfter: 3600 }) };
  }

  await kv.put(`cm:code_rl:${email}`, JSON.stringify({ lastSentAt: now }), { expirationTtl: 3600 });
  await kv.put(emailDayKey, JSON.stringify({ count: (emailDay?.count || 0) + 1 }), { expirationTtl: 86400 });
  await kv.put(ipKey, JSON.stringify({ count: (ipDay?.count || 0) + 1 }), { expirationTtl: 86400 });

  if (mail.shouldSend === false) return { ok: true, retryAfter: COOLDOWN, sent: false };

  const code = randomDigits(6);
  await kv.put(
    `cm:code:${email}`,
    JSON.stringify({ code, tries: 0, createdAt: new Date(now).toISOString() }),
    { expirationTtl: CODE_TTL },
  );

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
        subject: mail.subject,
        html: mail.html(code),
        text: mail.text(code),
      }),
    });
  } catch (err) {
    console.error('[api] resend fetch failed', err);
    return { error: fail('mail_failed', '验证码邮件发送失败，请稍后再试', 502) };
  }

  if (!res.ok) {
    console.error('[api] resend status', res.status);
    return { error: fail('mail_failed', '验证码邮件发送失败，请稍后再试', 502) };
  }

  return { ok: true, retryAfter: COOLDOWN, sent: true };
}

/** 校验验证码：返回 { ok:true } 或 { error: Response }（成功时码已被删掉，不能重放） */
export async function verifyCode({ kv, email, code }) {
  const record = await kv.get(`cm:code:${email}`, 'json');
  if (!record) return { error: fail('code_expired', '验证码已过期，请重新获取', 410) };

  const createdAt = new Date(record.createdAt || 0).getTime();
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > CODE_TTL * 1000) {
    await kv.delete(`cm:code:${email}`);
    return { error: fail('code_expired', '验证码已过期，请重新获取', 410) };
  }

  const tries = Number(record.tries || 0);
  if (tries >= MAX_TRIES) {
    await kv.delete(`cm:code:${email}`);
    return { error: fail('code_invalid', '验证码尝试次数过多，请重新获取', 400, { attemptsLeft: 0 }) };
  }

  if (code !== record.code) {
    const nextTries = tries + 1;
    if (nextTries >= MAX_TRIES) {
      await kv.delete(`cm:code:${email}`);
    } else {
      await kv.put(`cm:code:${email}`, JSON.stringify({ ...record, tries: nextTries }), { expirationTtl: CODE_TTL });
    }
    return {
      error: fail('code_invalid', '验证码不对', 400, { attemptsLeft: Math.max(0, MAX_TRIES - nextTries) }),
    };
  }

  await kv.delete(`cm:code:${email}`);
  return { ok: true };
}
