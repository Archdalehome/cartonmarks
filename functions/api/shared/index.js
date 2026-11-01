/**
 * GET /api/shared —— 我收到的模板分享（列表，不含模板内容）
 * 收件人不需要订阅；能不能用看载入时按箱型判定。
 */
import { guard, fail, json, getKV, kvUnavailable } from '../../../lib/api/http.js';
import { requireUser } from '../../../lib/api/auth.js';
import { readList, MAX_SHARED } from '../../../lib/api/share.js';

export const onRequestGet = guard(async ({ request, env }) => {
  const kv = getKV(env);
  if (!kv) return kvUnavailable();

  const auth = await requireUser(request, kv);
  if (!auth) return fail('unauthorized', '请先登录', 401);

  const items = await readList(kv, `cm:sharedList:${auth.user.id}`);
  const over = items.length > MAX_SHARED;
  return json({
    items: items.slice(0, MAX_SHARED),
    total: items.length,
    limit: MAX_SHARED,
    notice: over ? `收到的分享超过 ${MAX_SHARED} 条，建议删掉一些不用的` : '',
  });
});
