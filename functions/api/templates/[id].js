/**
 * GET    /api/templates/:id
 * DELETE /api/templates/:id
 */
import { guard, fail, json, getKV, kvUnavailable } from '../../../lib/api/http.js';
import { requireUser } from '../../../lib/api/auth.js';

async function requireSubscribed(request, kv) {
  const auth = await requireUser(request, kv);
  if (!auth) return { error: fail('unauthorized', '请先登录', 401) };
  const sub = await kv.get(`cm:sub:${auth.user.id}`, 'json');
  const now = Date.now();
  if (!sub || !sub.expiresAt || new Date(sub.expiresAt).getTime() <= now) {
    return { error: fail('not_subscribed', '这是订阅功能，请先订阅', 403) };
  }
  return { auth };
}

export const onRequestGet = guard(async ({ request, env, params }) => {
  const kv = getKV(env);
  if (!kv) return kvUnavailable();
  const { auth, error } = await requireSubscribed(request, kv);
  if (error) return error;

  const id = String((params && params.id) || '');
  if (!id) return fail('tpl_not_found', '模板不存在', 404);

  const record = await kv.get(`cm:tpl:${auth.user.id}:${id}`, 'json');
  if (!record) return fail('tpl_not_found', '模板不存在', 404);

  return json(record);
});

export const onRequestDelete = guard(async ({ request, env, params }) => {
  const kv = getKV(env);
  if (!kv) return kvUnavailable();
  const { auth, error } = await requireSubscribed(request, kv);
  if (error) return error;

  const id = String((params && params.id) || '');
  const key = `cm:tpl:${auth.user.id}:${id}`;
  const record = await kv.get(key, 'json');
  if (!record) return fail('tpl_not_found', '模板不存在', 404);

  await kv.delete(key);
  const list = (await kv.get(`cm:tpls:${auth.user.id}`, 'json')) || [];
  await kv.put(
    `cm:tpls:${auth.user.id}`,
    JSON.stringify(list.filter((item) => item.id !== id)),
  );

  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
});
