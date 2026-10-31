/**
 * GET /api/pay/status?orderId= —— 后端去 Xorpay 查单，成功则入账（幂等）
 */
import {
  guard,
  fail,
  json,
  requireEnv,
  backendUnavailable, getKV, kvUnavailable,
} from '../../../lib/api/http.js';
import { requireUser } from '../../../lib/api/auth.js';
import { xorpayQuerySign, normalizeStatus, isPaidStatus, settleOrder } from '../../../lib/api/pay.js';

export const onRequestGet = guard(async ({ request, env }) => {
  const kv = getKV(env);
  if (!kv) return kvUnavailable();
  const missing = requireEnv(env, ['XORPAY_AID', 'XORPAY_SECRET']);
  if (missing.length) return backendUnavailable(missing);

  const auth = await requireUser(request, kv);
  if (!auth) return fail('unauthorized', '请先登录', 401);

  const orderId = new URL(request.url).searchParams.get('orderId') || '';
  if (!orderId) return fail('invalid_request', '缺少 orderId', 400);
  const order = await kv.get(`cm:order:${orderId}`, 'json');
  if (!order || order.uid !== auth.user.id) return fail('order_not_found', '订单不存在', 404);

  if (order.credited) {
    return json({ status: 'success', subExpiresAt: order.subExpiresAt || null });
  }

  const sign = xorpayQuerySign(orderId, env.XORPAY_SECRET);
  let data = null;
  try {
    const res = await fetch(
      `https://xorpay.com/api/query2/${env.XORPAY_AID}?order_id=${encodeURIComponent(orderId)}&sign=${sign}`,
    );
    data = await res.json().catch(() => null);
  } catch (err) {
    console.error('[api] xorpay query failed', err);
    return fail('pay_unavailable', '查单失败，请稍后重试', 503, { upstream: 'network' });
  }

  const rawStatus = (data && (data.status || (data.info && data.info.status))) || '';
  const status = normalizeStatus(rawStatus);

  if (isPaidStatus(status)) {
    const settled = await settleOrder(kv, orderId);
    return json({
      status: 'success',
      subExpiresAt: (settled && settled.subExpiresAt) || null,
    });
  }

  // 只回写归一后的状态，不动 credited
  if (order.status !== status) {
    await kv.put(`cm:order:${orderId}`, JSON.stringify({ ...order, status }));
  }

  return json({ status, subExpiresAt: null });
});
