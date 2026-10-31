/**
 * POST /api/pay/notify —— Xorpay 异步回调，成功必须 200 纯文本 ok
 */
import { guard, requireEnv, backendUnavailable, getKV, kvUnavailable } from '../../../lib/api/http.js';
import { xorpayNotifySign, settleOrder } from '../../../lib/api/pay.js';

function text(body, status) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export const onRequestPost = guard(async ({ request, env }) => {
  const kv = getKV(env);
  if (!kv) return kvUnavailable();
  const missing = requireEnv(env, ['XORPAY_SECRET']);
  if (missing.length) return backendUnavailable(missing);

  let form;
  try {
    form = await request.formData();
  } catch {
    return text('bad request', 400);
  }

  const aoid = String(form.get('aoid') || '');
  const orderId = String(form.get('order_id') || '');
  const payPrice = String(form.get('pay_price') || '');
  const payTime = String(form.get('pay_time') || '');
  const sign = String(form.get('sign') || '').toLowerCase();

  const expected = xorpayNotifySign({
    aoid,
    orderId,
    payPrice,
    payTime,
    secret: env.XORPAY_SECRET,
  });

  if (!sign || sign !== expected.toLowerCase()) {
    console.error('[api] notify bad sign', orderId);
    return text('bad sign', 400);
  }

  const order = await kv.get(`cm:order:${orderId}`, 'json');
  if (!order) {
    console.error('[api] notify order not found', orderId);
    return text('order not found', 404);
  }

  if (Number(payPrice) !== Number(order.amount)) {
    console.error('[api] notify amount mismatch', orderId, payPrice, order.amount);
  }

  await settleOrder(kv, orderId);
  return text('ok', 200);
});
