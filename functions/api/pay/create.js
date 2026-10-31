/**
 * POST /api/pay/create —— 创建 9.9 元/年订阅订单，金额服务端固定，不读前端价格
 */
import {
  guard,
  fail,
  json,
  requireEnv,
  backendUnavailable, getKV, kvUnavailable,
} from '../../../lib/api/http.js';
import { requireUser } from '../../../lib/api/auth.js';
import { PRICE_CENTS, makeOrderId, xorpayCreateSign } from '../../../lib/api/pay.js';

const PLAN_NAME = 'Carton Mark 年订阅';

export const onRequestPost = guard(async ({ request, env }) => {
  const kv = getKV(env);
  if (!kv) return kvUnavailable();
  const missing = requireEnv(env, ['XORPAY_AID', 'XORPAY_SECRET', 'PUBLIC_BASE_URL']);
  if (missing.length) return backendUnavailable(missing);

  const auth = await requireUser(request, kv);
  if (!auth) return fail('unauthorized', '请先登录', 401);

  // 注意：这里不读取任何请求体里的价格，金额写死
  const price = PRICE_CENTS;
  const orderId = makeOrderId();
  const notifyUrl = `${String(env.PUBLIC_BASE_URL).replace(/\/+$/, '')}/api/pay/notify`;
  const sign = xorpayCreateSign({
    name: PLAN_NAME,
    payType: 'native',
    price,
    orderId,
    notifyUrl,
    secret: env.XORPAY_SECRET,
  });

  const form = new URLSearchParams({
    name: PLAN_NAME,
    pay_type: 'native',
    price: String(price),
    order_id: orderId,
    notify_url: notifyUrl,
    sign,
  });

  let upstream;
  let data = null;
  try {
    upstream = await fetch(`https://xorpay.com/api/pay/${env.XORPAY_AID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    data = await upstream.json().catch(() => null);
  } catch (err) {
    console.error('[api] xorpay create failed', err);
    return fail('pay_unavailable', '支付通道暂时不可用，请稍后再试', 503, { upstream: 'network' });
  }

  if (!upstream.ok || !data || data.status !== 'ok') {
    console.error('[api] xorpay create status', upstream.status, data && data.status);
    return fail('pay_unavailable', '支付通道暂时不可用，请稍后再试', 503, {
      upstream: (data && data.status) || String(upstream.status),
    });
  }

  const qr = (data.info && data.info.qr) || data.qr;
  if (!qr) {
    return fail('pay_unavailable', '支付通道没有返回二维码，请稍后再试', 503, { upstream: 'no_qr' });
  }

  await kv.put(
    `cm:order:${orderId}`,
    JSON.stringify({
      uid: auth.user.id,
      aoid: data.aoid || '',
      amount: price,
      status: 'new',
      createdAt: new Date().toISOString(),
      credited: false,
    }),
  );

  return json({ orderId, qr, expiresIn: 7200, amount: price });
});
