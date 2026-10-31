/**
 * tools/test-admin.mjs —— 后台管理接口单测（假 KV）
 * 用法：node tools/test-admin.mjs
 *
 * 覆盖：401/403 区分、列表字段不含 hash/salt、游标分页、邮箱搜索、
 *      订阅加减、不能改自己、内置管理员不可删、删号连带清理、每分 30 次限速、404 与 403 区分
 */
import assert from 'node:assert/strict';

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

/* ── 假 KV（带 list 游标） ───────────────────────── */

function makeFakeKV() {
  const map = new Map();
  return {
    _map: map,
    async get(key, type) {
      const entry = map.get(key);
      if (!entry) return null;
      if (type === 'json') {
        try {
          return JSON.parse(entry);
        } catch {
          return null;
        }
      }
      return entry;
    },
    async put(key, value) {
      map.set(key, String(value));
    },
    async delete(key) {
      map.delete(key);
    },
    async list({ prefix = '', cursor, limit = 100 } = {}) {
      const names = [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? names.indexOf(cursor) : 0;
      const from = start < 0 ? 0 : start;
      const slice = names.slice(from, from + limit);
      const listComplete = from + slice.length >= names.length;
      return {
        keys: slice.map((name) => ({ name })),
        list_complete: listComplete,
        cursor: listComplete ? undefined : names[from + slice.length],
      };
    },
  };
}

function makeEnv() {
  return { CM_KV: makeFakeKV() };
}

function req(url, { method = 'GET', body, cookie, ip = '9.9.9.9' } = {}) {
  const headers = { 'cf-connecting-ip': ip };
  if (cookie) headers.Cookie = `cm_sess=${cookie}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const BASE = 'https://cartonmarks.pages.dev';

async function seed(kv, { id, email, admin = false, sub = null }) {
  await kv.put(
    `cm:user:${email}`,
    JSON.stringify({
      id,
      email,
      hash: 'HASHSECRET',
      salt: 'SALTSECRET',
      createdAt: '2026-10-01T00:00:00.000Z',
      ...(admin ? { admin: true } : {}),
    }),
  );
  await kv.put(`cm:uid2email:${id}`, email);
  if (sub) await kv.put(`cm:sub:${id}`, JSON.stringify({ expiresAt: sub }));
}

async function login(kv, token, uid) {
  await kv.put(`cm:sess:${token}`, JSON.stringify({ uid, createdAt: new Date().toISOString() }));
}

const usersList = (await import('../functions/api/admin/users/index.js')).onRequestGet;
const userDelete = (await import('../functions/api/admin/users/[id].js')).onRequestDelete;
const userSub = (await import('../functions/api/admin/users/[id]/sub.js')).onRequestPost;

/* ── 场景 ───────────────────────────────────────── */

async function scene() {
  const env = makeEnv();
  const kv = env.CM_KV;
  await seed(kv, { id: 'u_admin', email: 'admin@support.qafield.com', admin: true, sub: '2027-10-31T00:00:00.000Z' });
  await seed(kv, { id: 'u_alice', email: 'alice@example.com' });
  await seed(kv, { id: 'u_bob', email: 'bob@example.com', sub: '2026-12-01T00:00:00.000Z' });
  await login(kv, 'tok_admin', 'u_admin');
  await login(kv, 'tok_alice', 'u_alice');

  console.log('后台接口 · 鉴权');

  await check('未登录 → 401 unauthorized（不是 403）', async () => {
    const res = await usersList({ request: req(`${BASE}/api/admin/users`), env });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, 'unauthorized');
  });

  await check('普通用户 → 403 admin_only（明确说没权限，不是不存在）', async () => {
    const res = await usersList({ request: req(`${BASE}/api/admin/users`, { cookie: 'tok_alice' }), env });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'admin_only');
  });

  console.log('后台接口 · 列表');

  await check('管理员能列用户，只返回邮箱/时间/订阅/身份，不带 hash/salt', async () => {
    const res = await usersList({
      request: req(`${BASE}/api/admin/users`, { cookie: 'tok_admin', ip: '8.8.8.1' }),
      env,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.items.length, 3);
    const raw = JSON.stringify(data);
    assert.ok(!raw.includes('HASHSECRET'), '响应里不能出现 hash');
    assert.ok(!raw.includes('SALTSECRET'), '响应里不能出现 salt');
    const admin = data.items.find((u) => u.email === 'admin@support.qafield.com');
    assert.equal(admin.isAdmin, true);
    assert.equal(admin.subExpiresAt, '2027-10-31T00:00:00.000Z');
    const alice = data.items.find((u) => u.email === 'alice@example.com');
    assert.equal(alice.isAdmin, false);
    assert.equal(alice.subExpiresAt, null);
  });

  await check('邮箱搜索 q 只返回匹配项', async () => {
    const res = await usersList({
      request: req(`${BASE}/api/admin/users?q=alice`, { cookie: 'tok_admin', ip: '8.8.8.2' }),
      env,
    });
    const data = await res.json();
    assert.deepEqual(data.items.map((u) => u.email), ['alice@example.com']);
  });

  await check('游标分页：limit=2 → 剩 1 个 + nextCursor', async () => {
    const first = await (
      await usersList({ request: req(`${BASE}/api/admin/users?limit=2`, { cookie: 'tok_admin', ip: '8.8.8.3' }), env })
    ).json();
    assert.equal(first.items.length, 2);
    assert.ok(first.nextCursor, '应返回 nextCursor');
    const second = await (
      await usersList({
        request: req(`${BASE}/api/admin/users?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`, {
          cookie: 'tok_admin',
          ip: '8.8.8.3',
        }),
        env,
      })
    ).json();
    assert.equal(second.items.length, 1);
    assert.equal(second.nextCursor, null);
  });

  console.log('后台接口 · 调订阅期');

  await check('给用户 +30 天：从现在起算', async () => {
    const res = await userSub({
      request: req(`${BASE}/api/admin/users/u_alice/sub`, {
        method: 'POST',
        body: { days: 30 },
        cookie: 'tok_admin',
        ip: '8.8.8.4',
      }),
      env,
      params: { id: 'u_alice' },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    const days = Math.round((new Date(data.subExpiresAt).getTime() - Date.now()) / 86400000);
    assert.equal(days, 30);
  });

  await check('再 +30 天：在原到期日上叠加 = 60 天', async () => {
    const res = await userSub({
      request: req(`${BASE}/api/admin/users/u_alice/sub`, {
        method: 'POST',
        body: { days: 30 },
        cookie: 'tok_admin',
        ip: '8.8.8.5',
      }),
      env,
      params: { id: 'u_alice' },
    });
    const data = await res.json();
    const days = Math.round((new Date(data.subExpiresAt).getTime() - Date.now()) / 86400000);
    assert.equal(days, 60);
  });

  await check('−60 天把订阅退掉（到期早于今天 → 键被删）', async () => {
    const res = await userSub({
      request: req(`${BASE}/api/admin/users/u_alice/sub`, {
        method: 'POST',
        body: { days: -60 },
        cookie: 'tok_admin',
        ip: '8.8.8.6',
      }),
      env,
      params: { id: 'u_alice' },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.subExpiresAt, null);
    assert.equal(await kv.get('cm:sub:u_alice'), null);
  });

  await check('不能改自己的订阅期 → 400 self_not_allowed', async () => {
    const res = await userSub({
      request: req(`${BASE}/api/admin/users/u_admin/sub`, {
        method: 'POST',
        body: { days: 30 },
        cookie: 'tok_admin',
        ip: '8.8.8.7',
      }),
      env,
      params: { id: 'u_admin' },
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'self_not_allowed');
  });

  await check('不存在的用户 → 404 user_not_found（和 403 区分开）', async () => {
    const res = await userSub({
      request: req(`${BASE}/api/admin/users/u_nope/sub`, {
        method: 'POST',
        body: { days: 30 },
        cookie: 'tok_admin',
        ip: '8.8.8.8',
      }),
      env,
      params: { id: 'u_nope' },
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, 'user_not_found');
  });

  await check('days=0 或超范围 → 400 invalid_request', async () => {
    for (const days of [0, 99999]) {
      const res = await userSub({
        request: req(`${BASE}/api/admin/users/u_alice/sub`, {
          method: 'POST',
          body: { days },
          cookie: 'tok_admin',
          ip: '8.8.8.9',
        }),
        env,
        params: { id: 'u_alice' },
      });
      assert.equal(res.status, 400);
    }
  });

  console.log('后台接口 · 删号');

  await check('内置管理员账号不可删除 → 409 protected_user', async () => {
    const res = await userDelete({
      request: req(`${BASE}/api/admin/users/u_admin`, { method: 'DELETE', cookie: 'tok_admin', ip: '8.8.9.1' }),
      env,
      params: { id: 'u_admin' },
    });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, 'protected_user');
  });

  await check('删号连带清理 user/uid2email/sub/会话/模板', async () => {
    await seed(kv, { id: 'u_bob', email: 'bob@example.com', sub: '2026-12-01T00:00:00.000Z' });
    await login(kv, 'tok_bob', 'u_bob');
    await kv.put('cm:tpl:u_bob:t1', JSON.stringify({ id: 't1', name: '样张' }));
    await kv.put('cm:tpls:u_bob', JSON.stringify([{ id: 't1', name: '样张' }]));

    const res = await userDelete({
      request: req(`${BASE}/api/admin/users/u_bob`, { method: 'DELETE', cookie: 'tok_admin', ip: '8.8.9.2' }),
      env,
      params: { id: 'u_bob' },
    });
    assert.equal(res.status, 204);
    assert.equal(await kv.get('cm:user:bob@example.com'), null);
    assert.equal(await kv.get('cm:uid2email:u_bob'), null);
    assert.equal(await kv.get('cm:sub:u_bob'), null);
    assert.equal(await kv.get('cm:tpl:u_bob:t1'), null);
    assert.equal(await kv.get('cm:tpls:u_bob'), null);
    assert.equal(await kv.get('cm:sess:tok_bob'), null);
  });

  await check('删自己 → 409 self_not_allowed', async () => {
    await seed(kv, { id: 'u_admin2', email: 'admin2@example.com', admin: true });
    await login(kv, 'tok_admin2', 'u_admin2');
    const res = await userDelete({
      request: req(`${BASE}/api/admin/users/u_admin2`, { method: 'DELETE', cookie: 'tok_admin2', ip: '8.8.9.3' }),
      env,
      params: { id: 'u_admin2' },
    });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, 'self_not_allowed');
  });

  console.log('后台接口 · 限速');

  await check('同一 IP 每分钟 30 次，第 31 次 429 rate_limited', async () => {
    const ip = '7.7.7.7';
    for (let i = 0; i < 30; i += 1) {
      const res = await usersList({ request: req(`${BASE}/api/admin/users?limit=1`, { cookie: 'tok_admin', ip }), env });
      assert.equal(res.status, 200, `第 ${i + 1} 次应放行`);
    }
    const res = await usersList({ request: req(`${BASE}/api/admin/users?limit=1`, { cookie: 'tok_admin', ip }), env });
    assert.equal(res.status, 429);
    assert.equal((await res.json()).error, 'rate_limited');
  });

  console.log(`\n${passed} 项通过${process.exitCode ? '，存在失败' : '，全部通过'}`);
}

scene().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
