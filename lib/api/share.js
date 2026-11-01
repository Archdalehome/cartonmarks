/**
 * lib/api/share.js —— 模板分享的公共件
 *
 * KV：
 *   收到的快照  cm:shared:{toUid}:{shareId}   { shareId, fromUid, fromEmail, name, shape, data, sharedAt, version }
 *   收到的索引  cm:sharedList:{toUid}         [{ shareId, fromEmail, name, shape, sharedAt }]
 *   发出的记录  cm:shareOut:{fromUid}:{shareId}{ toUid, toEmail, name, shape, sharedAt }
 *   发出的索引  cm:shareOutList:{fromUid}     [{ shareId, toEmail, name, shape, sharedAt }]
 *
 * shareId 由 (发件人, 收件人, 模板) 三元组决定：同一模板重复分享给同一人只覆盖，
 * 不会在对方的列表里长出第二条。
 */

import { fail } from './http.js';

/** 订阅专属箱型：收到这类模板但自己没订阅 → 不能用 */
export const SUBSCRIBER_SHAPES = ['lshape', 'bevel', 'tiandi'];

export const MAX_SHARED = 100;
export const SHARE_RATE_MAX = 10; // 每用户每分钟

export function needsSubscription(shape) {
  return SUBSCRIBER_SHAPES.includes(String(shape || ''));
}

/** 订阅是否在有效期内 */
export async function isSubscribed(kv, uid, now = Date.now()) {
  const sub = await kv.get(`cm:sub:${uid}`, 'json');
  const t = sub && sub.expiresAt ? new Date(sub.expiresAt).getTime() : 0;
  return Number.isFinite(t) && t > now;
}

/** 每用户每分钟 10 次分享；超了 429 */
export async function rateLimitShare(kv, uid, now = Date.now()) {
  const bucket = Math.floor(now / 60000);
  const key = `cm:sharerate:${uid}:${bucket}`;
  const used = Number((await kv.get(key)) || 0);
  if (used >= SHARE_RATE_MAX) {
    return { error: fail('rate_limited', '分享太频繁，请稍后再试', 429, { limit: SHARE_RATE_MAX }) };
  }
  await kv.put(key, String(used + 1), { expirationTtl: 120 });
  return {};
}

/** 由三元组推出稳定的 shareId（同一模板+同一收件人 → 同一个 id） */
export async function makeShareId(fromUid, toUid, templateId) {
  const raw = `${fromUid}|${toUid}|${templateId}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const bytes = new Uint8Array(digest).slice(0, 12);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return `sh_${btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

/** 把一条记录塞进索引数组（同 shareId 覆盖） */
function upsert(list, entry) {
  const out = (Array.isArray(list) ? list : []).filter((item) => item && item.shareId !== entry.shareId);
  out.unshift(entry);
  return out;
}

export async function readList(kv, key) {
  const list = await kv.get(key, 'json');
  return Array.isArray(list) ? list : [];
}

/** 写「收到侧」：快照 + 索引 */
export async function putShared(vk, toUid, record) {
  await vk.put(`cm:shared:${toUid}:${record.shareId}`, JSON.stringify(record));
  const list = await readList(vk, `cm:sharedList:${toUid}`);
  await vk.put(
    `cm:sharedList:${toUid}`,
    JSON.stringify(
      upsert(list, {
        shareId: record.shareId,
        fromEmail: record.fromEmail,
        name: record.name,
        shape: record.shape,
        sharedAt: record.sharedAt,
      }),
    ),
  );
}

/** 写「发出侧」：记录 + 索引 */
export async function putShareOut(vk, record) {
  await vk.put(`cm:shareOut:${record.fromUid}:${record.shareId}`, JSON.stringify(record));
  const list = await readList(vk, `cm:shareOutList:${record.fromUid}`);
  await vk.put(
    `cm:shareOutList:${record.fromUid}`,
    JSON.stringify(
      upsert(list, {
        shareId: record.shareId,
        toEmail: record.toEmail,
        name: record.name,
        shape: record.shape,
        sharedAt: record.sharedAt,
      }),
    ),
  );
}

/** 删掉「收到侧」一条（快照 + 索引） */
export async function removeShared(vk, toUid, shareId) {
  const key = `cm:shared:${toUid}:${shareId}`;
  const record = await vk.get(key, 'json');
  await vk.delete(key);
  const list = await readList(vk, `cm:sharedList:${toUid}`);
  await vk.put(
    `cm:sharedList:${toUid}`,
    JSON.stringify(list.filter((item) => item && item.shareId !== shareId)),
  );
  return record;
}

/** 删掉「发出侧」一条（记录 + 索引） */
export async function removeShareOut(vk, fromUid, shareId) {
  const key = `cm:shareOut:${fromUid}:${shareId}`;
  const record = await vk.get(key, 'json');
  await vk.delete(key);
  const list = await readList(vk, `cm:shareOutList:${fromUid}`);
  await vk.put(
    `cm:shareOutList:${fromUid}`,
    JSON.stringify(list.filter((item) => item && item.shareId !== shareId)),
  );
  return record;
}
