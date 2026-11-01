/**
 * GET    /api/shared/:shareId —— 取分享内容（这里是箱型权限校验的地方）
 * DELETE /api/shared/:shareId —— 收件人移除自己的副本
 *
 * GET 的 403 shape_locked 带 { shape }，前端据此弹订阅层并说明是哪种箱型。
 */
import { guard, fail, json, getKV, kvUnavailable } from '../../../lib/api/http.js';
import { requireUser } from '../../../lib/api/auth.js';
import { needsSubscription, isSubscribed, removeShared } from '../../../lib/api/share.js';

const SHAPE_NAMES = { rsc: '矩形箱', lshape: 'L 形箱', bevel: '斜形箱', tiandi: '天地盖' };

export const onRequestGet = guard(async ({ request, env, params }) => {
  const kv = getKV(env);
  if (!kv) return kvUnavailable();

  const auth = await requireUser(request, kv);
  if (!auth) return fail('unauthorized', '请先登录', 401);

  const shareId = String((params && params.shareId) || '');
  if (!shareId) return fail('share_not_found', '分享不存在', 404);

  const record = await kv.get(`cm:shared:${auth.user.id}:${shareId}`, 'json');
  if (!record) return fail('share_not_found', '分享不存在或已被撤销', 404);

  // 箱型权限：订阅专属箱型 + 当前用户没订阅 → 不能用
  if (needsSubscription(record.shape) && !(await isSubscribed(kv, auth.user.id))) {
    return fail('shape_locked', `这个模板是${SHAPE_NAMES[record.shape] || '订阅'}专属，需要订阅后才能使用`, 403, {
      shape: record.shape,
    });
  }

  return json({ name: record.name, shape: record.shape, data: record.data, fromEmail: record.fromEmail });
});

export const onRequestDelete = guard(async ({ request, env, params }) => {
  const kv = getKV(env);
  if (!kv) return kvUnavailable();

  const auth = await requireUser(request, kv);
  if (!auth) return fail('unauthorized', '请先登录', 401);

  const shareId = String((params && params.shareId) || '');
  if (!shareId) return fail('share_not_found', '分享不存在', 404);

  const record = await removeShared(kv, auth.user.id, shareId);
  if (!record) return fail('share_not_found', '分享不存在', 404);

  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
});
