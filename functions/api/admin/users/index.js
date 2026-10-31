/**
 * GET /api/admin/users —— 用户列表（管理员）
 *
 * 查询：?cursor=…&limit=50&q=邮箱片段
 * 分页：KV list({ prefix: 'cm:user:' }) 的游标；limit 1–100，默认 50
 * 只返回邮箱 / 创建时间 / 订阅到期 / 是否 admin，绝不带 hash、salt
 */
import { guard, fail, json, getKV, kvUnavailable } from '../../../../lib/api/http.js';
import { requireAdmin, rateLimitAdmin, readSubExpiry } from '../../../../lib/api/admin.js';

const PREFIX = 'cm:user:';
const MAX_LIMIT = 100;
const SCAN_PAGE = 200;
const MAX_SCAN = 2000;

export const onRequestGet = guard(async ({ request, env }) => {
  const kv = getKV(env);
  if (!kv) return kvUnavailable();

  const { error } = await requireAdmin(request, kv);
  if (error) return error;
  const limited = await rateLimitAdmin(request, kv);
  if (limited.error) return limited.error;

  const url = new URL(request.url);
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 100);
  const limitRaw = Number(url.searchParams.get('limit') || 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(MAX_LIMIT, Math.max(1, Math.round(limitRaw))) : 50;

  const items = [];
  let cursor = url.searchParams.get('cursor') || undefined;
  let scanned = 0;
  let complete = false;

  while (items.length < limit && !complete && scanned < MAX_SCAN) {
    // 每页只取「还差多少」，这样中途停下时 KV 的 cursor 正好指向下一个没读到的键
    const pageSize = Math.max(1, limit - items.length);
    const page = await kv.list({ prefix: PREFIX, cursor, limit: pageSize });
    const keys = page.keys || [];
    scanned += keys.length;
    if (keys.length === 0) break;

    for (const key of keys) {
      const email = key.name.slice(PREFIX.length);
      if (q && !email.includes(q)) continue;
      const user = await kv.get(key.name, 'json');
      if (!user) continue;
      const expiry = await readSubExpiry(kv, user.id);
      items.push({
        id: user.id,
        email: user.email || email,
        createdAt: user.createdAt || null,
        subExpiresAt: expiry > Date.now() ? new Date(expiry).toISOString() : null,
        isAdmin: user.admin === true,
      });
    }

    complete = Boolean(page.list_complete);
    cursor = page.cursor;
    if (!cursor) complete = true;
  }

  if (scanned >= MAX_SCAN) {
    return fail('scan_limit', '这一页里符合条件的用户太多，请用邮箱搜索缩小范围', 413);
  }

  return json({
    items,
    nextCursor: complete ? null : cursor || null,
    scanned,
  });
});
