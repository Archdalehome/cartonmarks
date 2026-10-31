/**
 * lib/api/pay.js —— Xorpay 签名、订单、订阅加时（幂等）
 *
 * 金额一律用「分」：9.9 元/年 = 990 分，写死在服务端。
 */

import { md5 } from './md5.js';

export const PRICE_CENTS = 990;
export const SUB_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 下单签名：MD5(name + pay_type + price + order_id + notify_url + secret)，纯 value 拼接 */
export function xorpayCreateSign({ name, payType, price, orderId, notifyUrl, secret }) {
  return md5(`${name}${payType}${price}${orderId}${notifyUrl}${secret}`);
}

/** 查单签名：MD5(order_id + secret) */
export function xorpayQuerySign(orderId, secret) {
  return md5(`${orderId}${secret}`);
}

/** 回调签名：MD5(aoid + order_id + pay_price + pay_time + secret) */
export function xorpayNotifySign({ aoid, orderId, payPrice, payTime, secret }) {
  return md5(`${aoid}${orderId}${payPrice}${payTime}${secret}`);
}

export function makeOrderId(now = Date.now()) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
  let rnd = '';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (const b of bytes) rnd += (b % 16).toString(16);
  return `cm_${stamp}_${rnd}`;
}

/** Xorpay 状态归一 */
export function normalizeStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (['payed', 'success', 'paid', 'ok'].includes(s)) return s === 'success' ? 'success' : 'payed';
  if (['expire', 'expired'].includes(s)) return 'expire';
  if (['not_exist', 'notexist', 'not found'].includes(s)) return 'not_exist';
  if (['new', 'wait', 'pending', 'created'].includes(s)) return 'new';
  return 'new';
}

export function isPaidStatus(status) {
  return status === 'payed' || status === 'success';
}

/** 订阅到期时间：未过期在原到期日 +365 天；已过期从今天 +365 天 */
export function nextExpiry(currentExpiresAt, now = Date.now()) {
  const current = currentExpiresAt ? new Date(currentExpiresAt).getTime() : 0;
  const base = Number.isFinite(current) && current > now ? current : now;
  return new Date(base + SUB_DAYS * DAY_MS).toISOString();
}

/**
 * 入账（幂等）：无论回调还是前端轮询，都走这里。
 * 写前再读一次订单，`credited === true` 直接返回，绝不重复加 365 天。
 */
export async function settleOrder(kv, orderId, now = Date.now()) {
  const order = await kv.get(`cm:order:${orderId}`, 'json');
  if (!order) return null;
  if (order.credited) return order;

  // 写前再读一次，缩小并发窗口
  const fresh = await kv.get(`cm:order:${orderId}`, 'json');
  if (!fresh) return null;
  if (fresh.credited) return fresh;

  const sub = await kv.get(`cm:sub:${fresh.uid}`, 'json');
  const expiresAt = nextExpiry(sub && sub.expiresAt, now);

  await kv.put(`cm:sub:${fresh.uid}`, JSON.stringify({ expiresAt }));
  const updated = {
    ...fresh,
    status: 'success',
    credited: true,
    creditedAt: new Date(now).toISOString(),
    subExpiresAt: expiresAt,
  };
  await kv.put(`cm:order:${orderId}`, JSON.stringify(updated));
  return updated;
}
