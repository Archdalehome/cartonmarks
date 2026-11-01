/**
 * POST /api/templates/:id/share  —— 把模板分享给另一个注册用户
 *
 * body: { email }
 * 200: { shareId, toEmail }
 * 404 user_not_found —— 该邮箱不是注册用户（此时 KV 里什么都不写）
 * 400 user_is_self   —— 分享给自己
 * 403 not_subscribed —— 发件人必须是订阅用户（模板本来就是订阅功能）
 * 429 rate_limited   —— 每用户每分钟 10 次
 *
 * 分享时存快照：之后发件人改模板，收件人手里那份不变。
 */
import { guard, fail, json, readJsonBody, getKV, kvUnavailable } from '../../../../lib/api/http.js';
import { requireUser, normalizeEmail, isValidEmail, getUserByEmail } from '../../../../lib/api/auth.js';
import {
  isSubscribed,
  rateLimitShare,
  makeShareId,
  putShared,
  putShareOut,
} from '../../../../lib/api/share.js';

export const onRequestPost = guard(async ({ request, env, params }) => {
  const kv = getKV(env);
  if (!kv) return kvUnavailable();

  const auth = await requireUser(request, kv);
  if (!auth) return fail('unauthorized', '请先登录', 401);
  if (!(await isSubscribed(kv, auth.user.id))) {
    return fail('not_subscribed', '模板是订阅功能，请先订阅', 403);
  }

  const limited = await rateLimitShare(kv, auth.user.id);
  if (limited.error) return limited.error;

  const body = await readJsonBody(request);
  if (!body) return fail('invalid_request', '请求格式不对', 400);

  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) return fail('invalid_request', '请输入正确的邮箱', 400);

  // 自己分享给自己
  if (email === normalizeEmail(auth.user.email)) {
    return fail('user_is_self', '不能分享给自己', 400);
  }

  // 收件人必须是注册用户；查不到就直接返回，不写任何 KV
  const target = await getUserByEmail(kv, email);
  if (!target || !target.id) {
    return fail('user_not_found', '该用户不存在', 404);
  }

  const id = String((params && params.id) || '');
  const tpl = await kv.get(`cm:tpl:${auth.user.id}:${id}`, 'json');
  if (!tpl) return fail('tpl_not_found', '模板不存在', 404);

  const data = tpl.data && typeof tpl.data === 'object' ? tpl.data : null;
  if (!data) return fail('tpl_not_found', '模板内容读取失败', 404);

  const shape = String(data.shape || 'rsc');
  const now = Date.now();
  const shareId = await makeShareId(auth.user.id, target.id, id);
  const fromEmail = normalizeEmail(auth.user.email);

  const record = {
    shareId,
    fromUid: auth.user.id,
    fromEmail,
    name: String(tpl.name || '未命名').slice(0, 40),
    shape,
    data,
    sharedAt: new Date(now).toISOString(),
    version: 1,
  };

  // 收到侧（快照 + 索引）
  await putShared(kv, target.id, record);
  // 发出侧（记录 + 索引）
  await putShareOut(kv, {
    shareId,
    fromUid: auth.user.id,
    fromEmail,
    toUid: target.id,
    toEmail: email,
    name: record.name,
    shape,
    sharedAt: record.sharedAt,
  });

  return json({ shareId, toEmail: email });
});
