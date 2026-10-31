/**
 * GET  /api/templates —— 模板列表
 * POST /api/templates —— 新建模板（订阅期内）
 */
import {
  guard,
  fail,
  json,
  readJsonBody,
  backendUnavailable,
} from '../../../lib/api/http.js';
import { requireUser, randomId } from '../../../lib/api/auth.js';

const MAX_TEMPLATES = 50;
const MAX_BYTES = 512 * 1024;
const MAX_NAME = 40;

async function requireSubscribed(request, kv) {
  const auth = await requireUser(request, kv);
  if (!auth) return { error: fail('unauthorized', '请先登录', 401) };
  const sub = await kv.get(`cm:sub:${auth.user.id}`, 'json');
  const now = Date.now();
  if (!sub || !sub.expiresAt || new Date(sub.expiresAt).getTime() <= now) {
    return { error: fail('not_subscribed', '这是订阅功能，请先订阅', 403) };
  }
  return { auth, sub };
}

export const onRequestGet = guard(async ({ request, env }) => {
  if (!env.CM_KV) return backendUnavailable(['CM_KV']);
  const { auth, error } = await requireSubscribed(request, env.CM_KV);
  if (error) return error;

  const items = (await env.CM_KV.get(`cm:tpls:${auth.user.id}`, 'json')) || [];
  return json({ items });
});

export const onRequestPost = guard(async ({ request, env }) => {
  if (!env.CM_KV) return backendUnavailable(['CM_KV']);
  const { auth, error } = await requireSubscribed(request, env.CM_KV);
  if (error) return error;

  const body = await readJsonBody(request);
  if (!body) return fail('invalid_request', '请求格式不对', 400);

  const name = String(body.name || '').trim().slice(0, MAX_NAME);
  if (!name) return fail('invalid_request', '请给模板起个名字', 400);
  if (!body.data || typeof body.data !== 'object') {
    return fail('invalid_request', '缺少模板数据', 400);
  }

  let dataJson;
  try {
    dataJson = JSON.stringify(body.data);
  } catch {
    return fail('invalid_request', '模板数据无法序列化', 400);
  }
  const bytes = new TextEncoder().encode(dataJson).length;
  if (bytes > MAX_BYTES) return fail('too_large', '模板数据超过 512 KB', 413);

  const list = (await env.CM_KV.get(`cm:tpls:${auth.user.id}`, 'json')) || [];
  if (list.length >= MAX_TEMPLATES) {
    return fail('tpl_limit', `模板数量已达上限（${MAX_TEMPLATES} 个）`, 409);
  }

  const id = randomId('t_');
  const now = new Date().toISOString();
  const record = { id, name, data: body.data, updatedAt: now };

  await env.CM_KV.put(`cm:tpl:${auth.user.id}:${id}`, JSON.stringify(record));
  await env.CM_KV.put(
    `cm:tpls:${auth.user.id}`,
    JSON.stringify([...list, { id, name, updatedAt: now }]),
  );

  return json({ id }, 201);
});
