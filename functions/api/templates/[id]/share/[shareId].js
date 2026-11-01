/**
 * DELETE /api/templates/:id/share/:shareId —— 发件人撤销分享
 *
 * 204：收件人那份一起删掉，发出记录也清掉
 */
import { guard, fail, getKV, kvUnavailable } from '../../../../../lib/api/http.js';
import { requireUser } from '../../../../../lib/api/auth.js';
import { isSubscribed, removeShared, removeShareOut } from '../../../../../lib/api/share.js';

export const onRequestDelete = guard(async ({ request, env, params }) => {
  const kv = getKV(env);
  if (!kv) return kvUnavailable();

  const auth = await requireUser(request, kv);
  if (!auth) return fail('unauthorized', '请先登录', 401);
  if (!(await isSubscribed(kv, auth.user.id))) {
    return fail('not_subscribed', '模板是订阅功能，请先订阅', 403);
  }

  const shareId = String((params && params.shareId) || '');
  if (!shareId) return fail('share_not_found', '分享不存在', 404);

  const out = await kv.get(`cm:shareOut:${auth.user.id}:${shareId}`, 'json');
  if (!out) return fail('share_not_found', '分享不存在', 404);

  // 收件人那份也一起收掉（撤销 ≠ 只是不显示）
  if (out.toUid) await removeShared(kv, out.toUid, shareId);
  await removeShareOut(kv, auth.user.id, shareId);

  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
});
