/**
 * tools/test-functions.mjs —— Pages Functions 单测（假 KV + 假 Resend/Xorpay）
 * 用法：node tools/test-functions.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { md5 } from '../lib/api/md5.js';

let passed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      console.error(`  ✗ ${name}\n    ${err.message}`);
      process.exitCode = 1;
    });
}

/* ── 假环境 ─────────────────────────────────────── */

let clockNow = Date.now();
const clock = () => clockNow;
const dayOf = () => new Date(clockNow).toISOString().slice(0, 10).replace(/-/g, '');
const advance = (ms) => {
  clockNow += ms;
};

function makeFakeKV() {
  const map = new Map();
  return {
    _map: map,
    async get(key, type) {
      const entry = map.get(key);
      if (!entry) return null;
      if (entry.expiresAt && clock() > entry.expiresAt) {
        map.delete(key);
        return null;
      }
      if (type === 'json') {
        try {
          return JSON.parse(entry.value);
        } catch {
          return null;
        }
      }
      return entry.value;
    },
    async put(key, value, opts = {}) {
      const expiresAt = opts.expirationTtl ? clock() + opts.expirationTtl * 1000 : null;
      map.set(key, { value, expiresAt });
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

function makeEnv(overrides = {}) {
  return {
    CM_KV: makeFakeKV(),
    RESEND_API_KEY: 're_test',
    RESEND_FROM: 'Carton Mark <admin@support.qafield.com>',
    XORPAY_AID: 'aid_test',
    XORPAY_SECRET: 'secret_test',
    PUBLIC_BASE_URL: 'https://cartonmarks.pages.dev',
    ...overrides,
  };
}

function jsonRequest(method, url, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = `cm_sess=${cookie}`;
  return new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function getRequest(url, cookie, ip = '1.2.3.4') {
  const headers = { 'cf-connecting-ip': ip };
  if (cookie) headers.Cookie = `cm_sess=${cookie}`;
  return new Request(url, { method: 'GET', headers });
}

let fetchHandler = async () => new Response('{}', { status: 200 });
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => fetchHandler(String(url), opts);

function cookieToken(res) {
  const raw = res.headers.get('set-cookie') || '';
  const m = /cm_sess=([^;]+)/.exec(raw);
  return m ? m[1] : null;
}

async function jsonBody(res) {
  return res.json().catch(() => null);
}

/* ── 加载端点 ───────────────────────────────────── */

const codeEp = await import('../functions/api/auth/code.js');
const registerEp = await import('../functions/api/auth/register.js');
const loginEp = await import('../functions/api/auth/login.js');
const logoutEp = await import('../functions/api/auth/logout.js');
const resetCodeEp = await import('../functions/api/auth/reset-code.js');
const resetEp = await import('../functions/api/auth/reset.js');
const meEp = await import('../functions/api/me.js');
const payCreateEp = await import('../functions/api/pay/create.js');
const payStatusEp = await import('../functions/api/pay/status.js');
const payNotifyEp = await import('../functions/api/pay/notify.js');
const tplListEp = await import('../functions/api/templates/index.js');
const tplItemEp = await import('../functions/api/templates/[id].js');

/* ── MD5 ────────────────────────────────────────── */

console.log('MD5 / 签名');

await check('MD5 与 node:crypto 一致', () => {
  for (const s of ['', 'abc', '中文测试', 'cm_20261031_ab12cdsecret']) {
    assert.equal(md5(s), createHash('md5').update(s, 'utf8').digest('hex'));
  }
});

/* ── 验证码 ─────────────────────────────────────── */

console.log('验证码');

await check('缺 CM_KV → 503 backend_unavailable', async () => {
  const env = makeEnv({ CM_KV: undefined });
  const res = await codeEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/code', { email: 'a@b.com' }),
    env,
  });
  assert.equal(res.status, 503);
  const body = await jsonBody(res);
  assert.equal(body.error, 'backend_unavailable');
});

await check('CM_KV 被配成字符串（环境变量冒充绑定）→ 503 而不是 500', async () => {
  const env = makeEnv({ CM_KV: 'cartonmarks_kv' });
  const res = await codeEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/code', { email: 'a@b.com' }),
    env,
  });
  assert.equal(res.status, 503);
  const body = await jsonBody(res);
  assert.equal(body.error, 'backend_unavailable');
  assert.equal(body.hint, 'kv_binding');
  assert.ok(body.message.includes('绑定'));

  const meRes = await meEp.onRequestGet({
    request: getRequest('https://x/api/me'),
    env: makeEnv({ CM_KV: 'cartonmarks_kv' }),
  });
  assert.equal(meRes.status, 503);
});

await check('第一次发码成功，KV 里是 6 位码', async () => {
  const env = makeEnv();
  fetchHandler = async () => new Response('{"id":"ok"}', { status: 200 });
  const res = await codeEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/code', { email: 'A@B.com ' }),
    env,
  });
  assert.equal(res.status, 200);
  const body = await jsonBody(res);
  assert.equal(body.ok, true);
  assert.equal(body.retryAfter, 60);

  const stored = await env.CM_KV.get('cm:code:a@b.com', 'json');
  assert.ok(stored && /^\d{6}$/.test(stored.code));
  assert.equal(stored.tries, 0);
  assert.ok(env.CM_KV._map.has('cm:code_rl:a@b.com'));
});

await check('60 秒内重发 → 429 并给出 retryAfter', async () => {
  const env = makeEnv();
  fetchHandler = async () => new Response('{}', { status: 200 });
  await codeEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/code', { email: 'a@b.com' }),
    env,
  });
  const res = await codeEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/code', { email: 'a@b.com' }),
    env,
  });
  assert.equal(res.status, 429);
  const body = await jsonBody(res);
  assert.equal(body.error, 'rate_limited');
  assert.ok(body.retryAfter > 0 && body.retryAfter <= 60);
});

await check('同邮箱每天 10 次上限', async () => {
  const env = makeEnv();
  const day = dayOf();
  await env.CM_KV.put(`cm:code_day:a@b.com:${day}`, JSON.stringify({ count: 10 }), { expirationTtl: 86400 });
  const res = await codeEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/code', { email: 'a@b.com' }),
    env,
  });
  assert.equal(res.status, 429);
});

await check('同 IP 每天 20 次上限', async () => {
  const env = makeEnv();
  const day = dayOf();
  await env.CM_KV.put(`cm:code_ip:1.2.3.4:${day}`, JSON.stringify({ count: 20 }), { expirationTtl: 86400 });
  const ipReq = new Request('https://x/api/auth/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '1.2.3.4' },
    body: JSON.stringify({ email: 'c@b.com' }),
  });
  const res = await codeEp.onRequestPost({ request: ipReq, env });
  assert.equal(res.status, 429);
});

await check('Resend 失败 → 502 mail_failed', async () => {
  const env = makeEnv();
  fetchHandler = async () => new Response('nope', { status: 500 });
  const res = await codeEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/code', { email: 'd@b.com' }),
    env,
  });
  assert.equal(res.status, 502);
  assert.equal((await jsonBody(res)).error, 'mail_failed');
});

await check('邮箱格式不对 → 400 invalid_email', async () => {
  const res = await codeEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/code', { email: 'not-an-email' }),
    env: makeEnv(),
  });
  assert.equal(res.status, 400);
  assert.equal((await jsonBody(res)).error, 'invalid_email');
});

/* ── 注册 ───────────────────────────────────────── */

console.log('注册');

async function seedCode(env, email, code = '123456', tries = 0) {
  await env.CM_KV.put(
    `cm:code:${email}`,
    JSON.stringify({ code, tries, createdAt: new Date(clock()).toISOString() }),
    { expirationTtl: 600 },
  );
}

await check('验证码错 → code_invalid 且 attemptsLeft 递减', async () => {
  const env = makeEnv();
  await seedCode(env, 'a@b.com');
  const res = await registerEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/register', {
      email: 'a@b.com', code: '000000', password: 'password123',
    }),
    env,
  });
  assert.equal(res.status, 400);
  const body = await jsonBody(res);
  assert.equal(body.error, 'code_invalid');
  assert.equal(body.attemptsLeft, 4);
});

await check('连错 5 次后验证码作废', async () => {
  const env = makeEnv();
  await seedCode(env, 'a@b.com');
  let fifth = null;
  for (let i = 0; i < 5; i += 1) {
    fifth = await registerEp.onRequestPost({
      request: jsonRequest('POST', 'https://x/api/auth/register', {
        email: 'a@b.com', code: '000000', password: 'password123',
      }),
      env,
    });
  }
  // 第 5 次：attemptsLeft 归零
  assert.equal(fifth.status, 400);
  assert.equal((await jsonBody(fifth)).attemptsLeft, 0);

  // 第 6 次：验证码已被删掉
  const res = await registerEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/register', {
      email: 'a@b.com', code: '123456', password: 'password123',
    }),
    env,
  });
  assert.equal(res.status, 410);
  assert.equal((await jsonBody(res)).error, 'code_expired');
});

await check('验证码过期（超过 10 分钟）→ code_expired', async () => {
  const env = makeEnv();
  await env.CM_KV.put(
    'cm:code:a@b.com',
    JSON.stringify({ code: '123456', tries: 0, createdAt: new Date(clock() - 11 * 60 * 1000).toISOString() }),
    { expirationTtl: 600 },
  );
  const res = await registerEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/register', {
      email: 'a@b.com', code: '123456', password: 'password123',
    }),
    env,
  });
  assert.equal(res.status, 410);
  assert.equal((await jsonBody(res)).error, 'code_expired');
});

await check('密码太短 → invalid_request', async () => {
  const res = await registerEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/register', {
      email: 'a@b.com', code: '123456', password: 'short',
    }),
    env: makeEnv(),
  });
  assert.equal(res.status, 400);
});

await check('注册成功：201 + Set-Cookie + 密码存哈希', async () => {
  const env = makeEnv();
  await seedCode(env, 'a@b.com');
  const res = await registerEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/register', {
      email: 'a@b.com', code: '123456', password: 'password123', name: '测试',
    }),
    env,
  });
  assert.equal(res.status, 201);
  const body = await jsonBody(res);
  assert.equal(body.user.email, 'a@b.com');
  assert.ok(cookieToken(res));

  const user = await env.CM_KV.get('cm:user:a@b.com', 'json');
  assert.ok(user.hash && user.salt);
  assert.ok(!user.hash.includes('password123'));
  assert.equal(await env.CM_KV.get('cm:code:a@b.com'), null);
  assert.ok(env.CM_KV._map.has(`cm:uid2email:${user.id}`));
});

await check('重复邮箱 → 409 email_taken', async () => {
  const env = makeEnv();
  await seedCode(env, 'a@b.com');
  await registerEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/register', {
      email: 'a@b.com', code: '123456', password: 'password123',
    }),
    env,
  });
  await seedCode(env, 'a@b.com');
  const res = await registerEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/register', {
      email: 'a@b.com', code: '123456', password: 'password123',
    }),
    env,
  });
  assert.equal(res.status, 409);
  assert.equal((await jsonBody(res)).error, 'email_taken');
});

/* ── 登录 / 会话 ────────────────────────────────── */

console.log('登录与会话');

async function registerUser(env, email = 'a@b.com', password = 'password123') {
  await seedCode(env, email);
  const res = await registerEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/register', {
      email, code: '123456', password,
    }),
    env,
  });
  return cookieToken(res);
}

await check('密码错 5 次锁 15 分钟 → 423', async () => {
  const env = makeEnv();
  await registerUser(env);
  let last;
  for (let i = 0; i < 5; i += 1) {
    last = await loginEp.onRequestPost({
      request: jsonRequest('POST', 'https://x/api/auth/login', {
        email: 'a@b.com', password: 'wrong-password',
      }),
      env,
    });
  }
  assert.equal(last.status, 423);
  const body = await jsonBody(last);
  assert.equal(body.error, 'locked');
  assert.ok(body.retryAfter > 0);
});

await check('锁定期内即使密码对也拒绝', async () => {
  const env = makeEnv();
  await registerUser(env);
  for (let i = 0; i < 5; i += 1) {
    await loginEp.onRequestPost({
      request: jsonRequest('POST', 'https://x/api/auth/login', {
        email: 'a@b.com', password: 'wrong-password',
      }),
      env,
    });
  }
  const res = await loginEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/login', {
      email: 'a@b.com', password: 'password123',
    }),
    env,
  });
  assert.equal(res.status, 423);
});

await check('登录成功发会话 Cookie', async () => {
  const env = makeEnv();
  await registerUser(env);
  const res = await loginEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/login', {
      email: 'a@b.com', password: 'password123',
    }),
    env,
  });
  assert.equal(res.status, 200);
  assert.ok(cookieToken(res));
});

await check('未登录 /api/me 返回 user:null 而不是 401', async () => {
  const res = await meEp.onRequestGet({ request: getRequest('https://x/api/me'), env: makeEnv() });
  assert.equal(res.status, 200);
  const body = await jsonBody(res);
  assert.equal(body.user, null);
  assert.equal(body.subExpiresAt, null);
});

await check('登录后 /api/me 返回用户，会话过期后变 null', async () => {
  const env = makeEnv();
  const token = await registerUser(env);
  const res = await meEp.onRequestGet({
    request: getRequest('https://x/api/me', token),
    env,
  });
  const body = await jsonBody(res);
  assert.equal(body.user.email, 'a@b.com');

  advance(31 * 24 * 60 * 60 * 1000);
  const res2 = await meEp.onRequestGet({
    request: getRequest('https://x/api/me', token),
    env,
  });
  assert.equal((await jsonBody(res2)).user, null);
});

await check('会话还在但用户记录没了 → 401 session_stale（不是 200+null）', async () => {
  const env = makeEnv();
  const token = await registerUser(env);
  const user = await env.CM_KV.get('cm:user:a@b.com', 'json');
  // 模拟后台清数据误伤：只删 uid→email 映射
  await env.CM_KV.delete(`cm:uid2email:${user.id}`);

  const res = await meEp.onRequestGet({ request: getRequest('https://x/api/me', token), env });
  assert.equal(res.status, 401);
  const body = await jsonBody(res);
  assert.equal(body.error, 'session_stale');
  assert.ok(body.message.includes('重新登录'));

  // 死会话顺手删掉：再问一次就是正常游客态，不会一直 401
  const again = await meEp.onRequestGet({ request: getRequest('https://x/api/me', token), env });
  assert.equal(again.status, 200);
  assert.equal((await jsonBody(again)).user, null);
});

await check('登出后会话失效', async () => {
  const env = makeEnv();
  const token = await registerUser(env);
  const out = await logoutEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/logout', undefined, token),
    env,
  });
  assert.equal(out.status, 204);
  assert.ok((out.headers.get('set-cookie') || '').includes('Max-Age=0'));
  const me = await meEp.onRequestGet({ request: getRequest('https://x/api/me', token), env });
  assert.equal((await jsonBody(me)).user, null);
});

/* ── 找回密码 ───────────────────────────────────── */

console.log('找回密码');

const RESET_OK_HTML = async () => new Response('{"id":"re_ok"}', { status: 200 });

async function withMailCapture(fn) {
  const sent = [];
  fetchHandler = async (url, opts) => {
    if (String(url).includes('api.resend.com')) {
      sent.push({ body: JSON.parse(opts.body || '{}'), headers: opts.headers });
      return new Response('{"id":"re_ok"}', { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
  try {
    await fn();
  } finally {
    fetchHandler = RESET_OK_HTML;
  }
  return sent;
}

await check('找回密码发码：已注册邮箱 → 200 且真发信', async () => {
  const env = makeEnv();
  await registerUser(env, 'r@b.com');
  const sent = await withMailCapture(async () => {
    const res = await resetCodeEp.onRequestPost({
      request: jsonRequest('POST', 'https://x/api/auth/reset-code', { email: 'r@b.com' }),
      env,
    });
    assert.equal(res.status, 200);
    const body = await jsonBody(res);
    assert.equal(body.ok, true);
    assert.equal(body.retryAfter, 60);
  });
  assert.equal(sent.length, 1, '已注册邮箱要真发一封');
  assert.equal(sent[0].body.subject, 'Carton Mark 重置密码验证码');
  assert.deepEqual(sent[0].body.to, ['r@b.com']);

  const stored = await env.CM_KV.get('cm:code:r@b.com', 'json');
  assert.ok(stored && /^\d{6}$/.test(stored.code));
});

await check('找回密码发码：未注册邮箱也 200，但不发信也不落码（防枚举）', async () => {
  const env = makeEnv();
  const sent = await withMailCapture(async () => {
    const res = await resetCodeEp.onRequestPost({
      request: jsonRequest('POST', 'https://x/api/auth/reset-code', { email: 'nobody@b.com' }),
      env,
    });
    assert.equal(res.status, 200);
    const body = await jsonBody(res);
    assert.equal(body.ok, true);
  });
  assert.equal(sent.length, 0, '不存在的邮箱不该收到信（也不该暴露 404）');
  assert.equal(await env.CM_KV.get('cm:code:nobody@b.com'), null, '不该给不存在的邮箱落码');
});

await check('找回密码发码：60 秒冷却对已注册/未注册一视同仁（不给枚举信号）', async () => {
  const env = makeEnv();
  await registerUser(env, 'r2@b.com');
  fetchHandler = RESET_OK_HTML;
  const first = await resetCodeEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/reset-code', { email: 'r2@b.com' }),
    env,
  });
  assert.equal(first.status, 200);

  const known = await resetCodeEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/reset-code', { email: 'r2@b.com' }),
    env,
  });
  // 未注册邮箱：第一次 200（静默），紧接着再要一次也必须是 429——冷却对两种邮箱一致
  const ghostFirst = await resetCodeEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/reset-code', { email: 'ghost@b.com' }),
    env,
  });
  const ghostSecond = await resetCodeEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/reset-code', { email: 'ghost@b.com' }),
    env,
  });
  assert.equal(ghostFirst.status, 200);
  assert.equal(known.status, 429);
  assert.equal(ghostSecond.status, 429);
  assert.equal((await jsonBody(known)).error, (await jsonBody(ghostSecond)).error);});

await check('重置密码：验证码不对 → code_invalid，密码不变', async () => {
  const env = makeEnv();
  await registerUser(env, 'r3@b.com', 'oldpassword');
  await seedCode(env, 'r3@b.com', '111111');
  const res = await resetEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/reset', {
      email: 'r3@b.com', code: '999999', password: 'newpassword',
    }),
    env,
  });
  assert.equal(res.status, 400);
  const body = await jsonBody(res);
  assert.equal(body.error, 'code_invalid');
  assert.ok(body.attemptsLeft >= 0);

  const old = await loginEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/login', { email: 'r3@b.com', password: 'oldpassword' }),
    env,
  });
  assert.equal(old.status, 200, '验证码错的时候密码不能变');
});

await check('重置密码：成功 → 200 + Cookie，旧密码失效、新密码可登录', async () => {
  const env = makeEnv();
  await registerUser(env, 'r4@b.com', 'oldpassword');
  await seedCode(env, 'r4@b.com', '222222');
  const res = await resetEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/reset', {
      email: 'r4@b.com', code: '222222', password: 'newpassword1',
    }),
    env,
  });
  assert.equal(res.status, 200);
  assert.ok(cookieToken(res), '重置成功直接登录');
  assert.equal(await env.CM_KV.get('cm:code:r4@b.com'), null, '验证码用过就删，不能重放');

  const old = await loginEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/login', { email: 'r4@b.com', password: 'oldpassword' }),
    env,
  });
  assert.equal(old.status, 401);

  const next = await loginEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/login', { email: 'r4@b.com', password: 'newpassword1' }),
    env,
  });
  assert.equal(next.status, 200);
});

await check('重置密码：旧会话全部作废，只有新会话有效', async () => {
  const env = makeEnv();
  const oldToken = await registerUser(env, 'r5@b.com', 'oldpassword');
  await seedCode(env, 'r5@b.com', '333333');
  const res = await resetEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/reset', {
      email: 'r5@b.com', code: '333333', password: 'newpassword2',
    }),
    env,
  });
  const newToken = cookieToken(res);

  const meOld = await meEp.onRequestGet({ request: getRequest('https://x/api/me', oldToken), env });
  assert.equal((await jsonBody(meOld)).user, null, '改密码前的会话必须失效');

  const meNew = await meEp.onRequestGet({ request: getRequest('https://x/api/me', newToken), env });
  assert.equal(meNew.status, 200);
  assert.equal((await jsonBody(meNew)).user.email, 'r5@b.com');
});

await check('重置密码：未注册邮箱 → code_expired（不暴露邮箱是否存在）', async () => {
  const env = makeEnv();
  await seedCode(env, 'ghost2@b.com', '444444');
  const res = await resetEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/reset', {
      email: 'ghost2@b.com', code: '444444', password: 'newpassword3',
    }),
    env,
  });
  assert.equal(res.status, 410);
  assert.equal((await jsonBody(res)).error, 'code_expired');
});

await check('重置密码：密码太短 → 400', async () => {
  const env = makeEnv();
  await registerUser(env, 'r6@b.com');
  await seedCode(env, 'r6@b.com', '555555');
  const res = await resetEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/auth/reset', {
      email: 'r6@b.com', code: '555555', password: 'short',
    }),
    env,
  });
  assert.equal(res.status, 400);
  assert.equal((await jsonBody(res)).error, 'invalid_request');
});

/* ── 下单 / 查单 / 回调 ─────────────────────────── */

console.log('支付与订阅');

async function userWithToken(env) {
  return registerUser(env);
}

await check('未登录下单 → 401', async () => {
  const res = await payCreateEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/pay/create', {}),
    env: makeEnv(),
  });
  assert.equal(res.status, 401);
  assert.equal((await jsonBody(res)).error, 'unauthorized');
});

await check('下单金额写死 990，忽略前端传价', async () => {
  const env = makeEnv();
  const token = await userWithToken(env);
  let sentBody = '';
  fetchHandler = async (url, opts) => {
    sentBody = String(opts.body || '');
    return new Response(JSON.stringify({ status: 'ok', aoid: 'a_1', info: { qr: 'weixin://x' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const res = await payCreateEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/pay/create', { price: 1, amount: 1 }, token),
    env,
  });
  assert.equal(res.status, 200);
  const body = await jsonBody(res);
  assert.equal(body.amount, 990);
  assert.match(body.orderId, /^cm_\d{8}_[0-9a-f]{6}$/);
  assert.equal(body.qr, 'weixin://x');

  const form = new URLSearchParams(sentBody);
  assert.equal(form.get('price'), '990');
  assert.equal(form.get('pay_type'), 'native');
  assert.equal(form.get('notify_url'), 'https://cartonmarks.pages.dev/api/pay/notify');

  const order = await env.CM_KV.get(`cm:order:${body.orderId}`, 'json');
  assert.equal(order.amount, 990);
  assert.equal(order.credited, false);
});

await check('上游非 ok → 503 pay_unavailable', async () => {
  const env = makeEnv();
  const token = await userWithToken(env);
  fetchHandler = async () => new Response(JSON.stringify({ status: 'error' }), { status: 200 });
  const res = await payCreateEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/pay/create', {}, token),
    env,
  });
  assert.equal(res.status, 503);
  assert.equal((await jsonBody(res)).error, 'pay_unavailable');
});

async function makeOrder(env, uid, orderId = 'cm_20261031_abcdef') {
  await env.CM_KV.put(`cm:order:${orderId}`, JSON.stringify({
    uid, aoid: 'a_1', amount: 990, status: 'new', createdAt: new Date(clock()).toISOString(), credited: false,
  }));
  return orderId;
}

await check('查单成功加 365 天，连续查 5 次只加一次', async () => {
  const env = makeEnv();
  const token = await userWithToken(env);
  const me = await meEp.onRequestGet({ request: getRequest('https://x/api/me', token), env });
  const uid = (await jsonBody(me)).user.id;
  const orderId = await makeOrder(env, uid);

  fetchHandler = async () => new Response(JSON.stringify({ status: 'payed' }), { status: 200 });

  const first = await payStatusEp.onRequestGet({
    request: getRequest(`https://x/api/pay/status?orderId=${orderId}`, token),
    env,
  });
  const firstBody = await jsonBody(first);
  assert.equal(firstBody.status, 'success');
  const firstExpiry = firstBody.subExpiresAt;
  assert.ok(firstExpiry);

  for (let i = 0; i < 4; i += 1) {
    await payStatusEp.onRequestGet({
      request: getRequest(`https://x/api/pay/status?orderId=${orderId}`, token),
      env,
    });
  }

  const sub = await env.CM_KV.get(`cm:sub:${uid}`, 'json');
  assert.equal(sub.expiresAt, firstExpiry);
  assert.equal(new Date(sub.expiresAt).getTime(), new Date(firstExpiry).getTime());
  const order = await env.CM_KV.get(`cm:order:${orderId}`, 'json');
  assert.equal(order.credited, true);
});

await check('查别人的订单 → 404 order_not_found', async () => {
  const env = makeEnv();
  const tokenA = await userWithToken(env);
  const envB = makeEnv({ CM_KV: env.CM_KV });
  const tokenB = await registerUser(envB, 'other@b.com');
  const meA = await meEp.onRequestGet({ request: getRequest('https://x/api/me', tokenA), env });
  const uidA = (await jsonBody(meA)).user.id;
  const orderId = await makeOrder(env, uidA);

  const res = await payStatusEp.onRequestGet({
    request: getRequest(`https://x/api/pay/status?orderId=${orderId}`, tokenB),
    env,
  });
  assert.equal(res.status, 404);
  assert.equal((await jsonBody(res)).error, 'order_not_found');
});

await check('回调验签失败 → 400 且不入账', async () => {
  const env = makeEnv();
  const token = await userWithToken(env);
  const me = await meEp.onRequestGet({ request: getRequest('https://x/api/me', token), env });
  const uid = (await jsonBody(me)).user.id;
  const orderId = await makeOrder(env, uid);

  const form = new URLSearchParams({
    aoid: 'a_1', order_id: orderId, pay_price: '990', pay_time: '1761900000', sign: 'bad',
  });
  const res = await payNotifyEp.onRequestPost({
    request: new Request('https://x/api/pay/notify', { method: 'POST', body: form }),
    env,
  });
  assert.equal(res.status, 400);
  assert.equal(await env.CM_KV.get(`cm:sub:${uid}`), null);
});

await check('回调验签成功 → 200 ok 且入账', async () => {
  const env = makeEnv();
  const token = await userWithToken(env);
  const me = await meEp.onRequestGet({ request: getRequest('https://x/api/me', token), env });
  const uid = (await jsonBody(me)).user.id;
  const orderId = await makeOrder(env, uid);

  const aoid = 'a_1';
  const payPrice = '990';
  const payTime = '1761900000';
  const sign = md5(`${aoid}${orderId}${payPrice}${payTime}secret_test`);
  const form = new URLSearchParams({ aoid, order_id: orderId, pay_price: payPrice, pay_time: payTime, sign });

  const res = await payNotifyEp.onRequestPost({
    request: new Request('https://x/api/pay/notify', { method: 'POST', body: form }),
    env,
  });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
  const sub = await env.CM_KV.get(`cm:sub:${uid}`, 'json');
  assert.ok(sub && sub.expiresAt);
});

/* ── 模板 ───────────────────────────────────────── */

console.log('模板');

async function subscribedUser(env, email = 'sub@b.com') {
  const token = await registerUser(env, email);
  const me = await meEp.onRequestGet({ request: getRequest('https://x/api/me', token), env });
  const uid = (await jsonBody(me)).user.id;
  await env.CM_KV.put(`cm:sub:${uid}`, JSON.stringify({ expiresAt: new Date(clock() + 86_400_000).toISOString() }));
  return { token, uid };
}

await check('未登录 → 401', async () => {
  const res = await tplListEp.onRequestGet({ request: getRequest('https://x/api/templates'), env: makeEnv() });
  assert.equal(res.status, 401);
});

await check('已登录但未订阅 → 403 not_subscribed', async () => {
  const env = makeEnv();
  const token = await registerUser(env);
  const res = await tplListEp.onRequestGet({ request: getRequest('https://x/api/templates', token), env });
  assert.equal(res.status, 403);
  assert.equal((await jsonBody(res)).error, 'not_subscribed');
});

await check('订阅用户可增删查模板', async () => {
  const env = makeEnv();
  const { token } = await subscribedUser(env);

  const created = await tplListEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/templates', { name: '我的箱唛', data: { shape: 'rsc', dims: { L: 1, W: 1, H: 1 } } }, token),
    env,
  });
  assert.equal(created.status, 201);
  const { id } = await jsonBody(created);
  assert.match(id, /^t_/);

  const list = await tplListEp.onRequestGet({ request: getRequest('https://x/api/templates', token), env });
  const listBody = await jsonBody(list);
  assert.equal(listBody.items.length, 1);
  assert.equal(listBody.items[0].name, '我的箱唛');

  const item = await tplItemEp.onRequestGet({
    request: getRequest(`https://x/api/templates/${id}`, token),
    env,
    params: { id },
  });
  assert.equal(item.status, 200);
  assert.equal((await jsonBody(item)).name, '我的箱唛');

  const del = await tplItemEp.onRequestDelete({
    request: new Request(`https://x/api/templates/${id}`, { method: 'DELETE', headers: { Cookie: `cm_sess=${token}` } }),
    env,
    params: { id },
  });
  assert.equal(del.status, 204);

  const list2 = await tplListEp.onRequestGet({ request: getRequest('https://x/api/templates', token), env });
  assert.equal((await jsonBody(list2)).items.length, 0);
});

await check('模板超过 50 个 → 409 tpl_limit', async () => {
  const env = makeEnv();
  const { token, uid } = await subscribedUser(env);
  await env.CM_KV.put(
    `cm:tpls:${uid}`,
    JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ id: 't_' + i, name: 'n' + i, updatedAt: '' }))),
  );
  const res = await tplListEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/templates', { name: 'x', data: { a: 1 } }, token),
    env,
  });
  assert.equal(res.status, 409);
  assert.equal((await jsonBody(res)).error, 'tpl_limit');
});

await check('模板数据超过 512 KB → 413 too_large', async () => {
  const env = makeEnv();
  const { token } = await subscribedUser(env);
  const big = { blob: 'x'.repeat(520 * 1024) };
  const res = await tplListEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/templates', { name: 'big', data: big }, token),
    env,
  });
  assert.equal(res.status, 413);
  assert.equal((await jsonBody(res)).error, 'too_large');
});

/* ── 收尾 ───────────────────────────────────────── */

console.log('模板分享');

const shareEp = await import('../functions/api/templates/[id]/share.js');
const shareRevokeEp = await import('../functions/api/templates/[id]/share/[shareId].js');
const sharedListEp = await import('../functions/api/shared/index.js');
const sharedItemEp = await import('../functions/api/shared/[shareId].js');

/** 建一个模板，返回模板 id */
async function makeTemplate(env, token, name, data) {
  const res = await tplListEp.onRequestPost({
    request: jsonRequest('POST', 'https://x/api/templates', { name, data }, token),
    env,
  });
  assert.equal(res.status, 201);
  return (await jsonBody(res)).id;
}

function shareKeyCount(env) {
  return [...env.CM_KV._map.keys()].filter((k) => k.startsWith('cm:shared') || k.startsWith('cm:shareOut')).length;
}

async function shareTo(env, token, tplId, email) {
  return shareEp.onRequestPost({
    request: jsonRequest('POST', `https://x/api/templates/${tplId}/share`, { email }, token),
    env,
    params: { id: tplId },
  });
}

await check('分享给未注册邮箱 → 404 user_not_found，且 KV 里没写入任何东西', async () => {
  const env = makeEnv();
  const sender = await subscribedUser(env, 'sender@b.com');
  const tplId = await makeTemplate(env, sender.token, '方箱', { shape: 'rsc', dims: { L: 600, W: 400, H: 300 } });
  const before = shareKeyCount(env);
  const res = await shareTo(env, sender.token, tplId, 'nobody@nowhere.com');
  assert.equal(res.status, 404);
  const body404 = await jsonBody(res);
  assert.equal(body404.error, 'user_not_found');
  assert.equal(body404.message, '该用户不存在');
  assert.equal(shareKeyCount(env), before, '不该写入任何 cm:shared / cm:shareOut 键');
});

await check('分享给自己 → 400 user_is_self', async () => {
  const env = makeEnv();
  const sender = await subscribedUser(env, 'self@b.com');
  const tplId = await makeTemplate(env, sender.token, '自用', { shape: 'rsc' });
  const res = await shareTo(env, sender.token, tplId, ' SELF@b.com ');
  assert.equal(res.status, 400);
  assert.equal((await jsonBody(res)).error, 'user_is_self');
});

await check('未订阅的发件人不能分享 → 403 not_subscribed', async () => {
  const env = makeEnv();
  const sender = await registerUser(env, 'free@b.com');
  await registerUser(env, 'recv0@b.com');
  const res = await shareTo(env, sender, 't_x', 'recv0@b.com');
  assert.equal(res.status, 403);
  assert.equal((await jsonBody(res)).error, 'not_subscribed');
});

await check('收到矩形箱模板：未订阅的收件人也能载入', async () => {
  const env = makeEnv();
  const sender = await subscribedUser(env, 'sender2@b.com');
  const recvToken = await registerUser(env, 'recv2@b.com');
  const data = { shape: 'rsc', dims: { L: 600, W: 400, H: 300 }, panels: { front: { elements: [] } } };
  const tplId = await makeTemplate(env, sender.token, '矩形模板', data);

  const res = await shareTo(env, sender.token, tplId, 'recv2@b.com');
  assert.equal(res.status, 200);
  const { shareId } = await jsonBody(res);
  assert.match(shareId, /^sh_/);

  const list = await sharedListEp.onRequestGet({ request: getRequest('https://x/api/shared', recvToken), env });
  assert.equal(list.status, 200);
  const listBody = await jsonBody(list);
  assert.equal(listBody.items.length, 1);
  assert.equal(listBody.items[0].name, '矩形模板');
  assert.equal(listBody.items[0].shape, 'rsc');
  assert.equal(listBody.items[0].fromEmail, 'sender2@b.com');

  const one = await sharedItemEp.onRequestGet({
    request: getRequest(`https://x/api/shared/${shareId}`, recvToken),
    env,
    params: { shareId },
  });
  assert.equal(one.status, 200);
  const body = await jsonBody(one);
  assert.equal(body.shape, 'rsc');
  assert.deepEqual(body.data, data);
});

await check('权限分开：未订阅用户 GET /api/shared → 200，GET /api/templates → 403', async () => {
  const env = makeEnv();
  const sender = await subscribedUser(env, 'sender6@b.com');
  const recvToken = await registerUser(env, 'recv6@b.com');
  const tplId = await makeTemplate(env, sender.token, '矩形模板2', { shape: 'rsc', dims: { L: 1, W: 1, H: 1 } });
  await shareTo(env, sender.token, tplId, 'recv6@b.com');

  const mine = await tplListEp.onRequestGet({ request: getRequest('https://x/api/templates', recvToken), env });
  assert.equal(mine.status, 403);
  assert.equal((await jsonBody(mine)).error, 'not_subscribed');

  const received = await sharedListEp.onRequestGet({ request: getRequest('https://x/api/shared', recvToken), env });
  assert.equal(received.status, 200);
  assert.equal((await jsonBody(received)).items.length, 1);
});

await check('收到 L 形模板：未订阅的收件人 403 shape_locked（带 shape）', async () => {
  const env = makeEnv();
  const sender = await subscribedUser(env, 'sender3@b.com');
  const recvToken = await registerUser(env, 'recv3@b.com');
  const tplId = await makeTemplate(env, sender.token, 'L 形模板', { shape: 'lshape', dims: { L: 600 } });

  const res = await shareTo(env, sender.token, tplId, 'recv3@b.com');
  const { shareId } = await jsonBody(res);

  const one = await sharedItemEp.onRequestGet({
    request: getRequest(`https://x/api/shared/${shareId}`, recvToken),
    env,
    params: { shareId },
  });
  assert.equal(one.status, 403);
  const body = await jsonBody(one);
  assert.equal(body.error, 'shape_locked');
  assert.equal(body.shape, 'lshape');
});

await check('收件人订阅后，同一个 L 形模板就能载入', async () => {
  const env = makeEnv();
  const sender = await subscribedUser(env, 'sender4@b.com');
  const recvToken = await registerUser(env, 'recv4@b.com');
  const tplId = await makeTemplate(env, sender.token, 'L 形模板2', { shape: 'lshape' });
  const { shareId } = await jsonBody(await shareTo(env, sender.token, tplId, 'recv4@b.com'));

  const me = await meEp.onRequestGet({ request: getRequest('https://x/api/me', recvToken), env });
  const uid = (await jsonBody(me)).user.id;
  await env.CM_KV.put(`cm:sub:${uid}`, JSON.stringify({ expiresAt: new Date(clock() + 86_400_000).toISOString() }));

  const one = await sharedItemEp.onRequestGet({
    request: getRequest(`https://x/api/shared/${shareId}`, recvToken),
    env,
    params: { shareId },
  });
  assert.equal(one.status, 200);
  assert.equal((await jsonBody(one)).shape, 'lshape');
});

await check('快照语义：发件人改了模板，收件人手里那份不变', async () => {
  const env = makeEnv();
  const sender = await subscribedUser(env, 'sender5@b.com');
  const recvToken = await registerUser(env, 'recv5@b.com');
  const tplId = await makeTemplate(env, sender.token, '快照', { shape: 'rsc', note: '分享时的版本' });
  const { shareId } = await jsonBody(await shareTo(env, sender.token, tplId, 'recv5@b.com'));

  // 模拟发件人后来改了模板
  await env.CM_KV.put(
    `cm:tpl:${sender.uid}:${tplId}`,
    JSON.stringify({ id: tplId, name: '快照', data: { shape: 'rsc', note: '改过之后' }, updatedAt: new Date(clock()).toISOString() }),
  );

  const one = await sharedItemEp.onRequestGet({
    request: getRequest(`https://x/api/shared/${shareId}`, recvToken),
    env,
    params: { shareId },
  });
  assert.equal((await jsonBody(one)).data.note, '分享时的版本');
});

await check('重复分享给同一人：覆盖，不新增一条', async () => {
  const env = makeEnv();
  const sender = await subscribedUser(env, 'sender6@b.com');
  const recvToken = await registerUser(env, 'recv6@b.com');
  const tplId = await makeTemplate(env, sender.token, '重复', { shape: 'rsc' });
  const first = await jsonBody(await shareTo(env, sender.token, tplId, 'recv6@b.com'));
  const second = await jsonBody(await shareTo(env, sender.token, tplId, 'recv6@b.com'));
  assert.equal(first.shareId, second.shareId);
  const list = await sharedListEp.onRequestGet({ request: getRequest('https://x/api/shared', recvToken), env });
  assert.equal((await jsonBody(list)).items.length, 1);
});

await check('收件人删除自己那份：自己列表少一条，发件人发出记录还在', async () => {
  const env = makeEnv();
  const sender = await subscribedUser(env, 'sender7@b.com');
  const recvToken = await registerUser(env, 'recv7@b.com');
  const tplId = await makeTemplate(env, sender.token, '删除测试', { shape: 'rsc' });
  const { shareId } = await jsonBody(await shareTo(env, sender.token, tplId, 'recv7@b.com'));

  const del = await sharedItemEp.onRequestDelete({
    request: new Request(`https://x/api/shared/${shareId}`, { method: 'DELETE', headers: { Cookie: `cm_sess=${recvToken}` } }),
    env,
    params: { shareId },
  });
  assert.equal(del.status, 204);

  const list = await sharedListEp.onRequestGet({ request: getRequest('https://x/api/shared', recvToken), env });
  assert.equal((await jsonBody(list)).items.length, 0);
  assert.ok(await env.CM_KV.get(`cm:shareOut:${sender.uid}:${shareId}`, 'json'), '发件人的发出记录应还在');
});

await check('发件人撤销：收件人那份消失', async () => {
  const env = makeEnv();
  const sender = await subscribedUser(env, 'sender8@b.com');
  const recvToken = await registerUser(env, 'recv8@b.com');
  const tplId = await makeTemplate(env, sender.token, '撤销测试', { shape: 'rsc' });
  const { shareId } = await jsonBody(await shareTo(env, sender.token, tplId, 'recv8@b.com'));

  const revoke = await shareRevokeEp.onRequestDelete({
    request: new Request(`https://x/api/templates/${tplId}/share/${shareId}`, {
      method: 'DELETE',
      headers: { Cookie: `cm_sess=${sender.token}` },
    }),
    env,
    params: { id: tplId, shareId },
  });
  assert.equal(revoke.status, 204);

  const list = await sharedListEp.onRequestGet({ request: getRequest('https://x/api/shared', recvToken), env });
  assert.equal((await jsonBody(list)).items.length, 0);
  const one = await sharedItemEp.onRequestGet({
    request: getRequest(`https://x/api/shared/${shareId}`, recvToken),
    env,
    params: { shareId },
  });
  assert.equal(one.status, 404);
});

await check('分享限速：每分钟第 11 次 → 429', async () => {
  const env = makeEnv();
  const sender = await subscribedUser(env, 'sender9@b.com');
  const recvToken = await registerUser(env, 'recv9@b.com');
  const tplId = await makeTemplate(env, sender.token, '限速', { shape: 'rsc' });
  for (let i = 0; i < 10; i += 1) {
    const ok = await shareTo(env, sender.token, tplId, 'recv9@b.com');
    assert.equal(ok.status, 200, `第 ${i + 1} 次应该成功`);
  }
  const blocked = await shareTo(env, sender.token, tplId, 'recv9@b.com');
  assert.equal(blocked.status, 429);
  assert.equal((await jsonBody(blocked)).error, 'rate_limited');
  assert.ok(recvToken);
});

/* ── 收尾 ───────────────────────────────────────── */

globalThis.fetch = originalFetch;
console.log(`\n${passed} 项通过${process.exitCode ? '，存在失败' : '，全部通过'}`);
