/**
 * lib/api/auth.js —— 邮箱归一、密码哈希、会话
 */

import { SESSION_TTL, getCookie, SESSION_COOKIE } from './http.js';

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

export function randomBytes(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function bytesToBase64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

function base64url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function randomToken(byteLength = 32) {
  return base64url(randomBytes(byteLength));
}

export function randomId(prefix, byteLength = 9) {
  return `${prefix}${base64url(randomBytes(byteLength))}`;
}

export function randomDigits(length = 6) {
  const bytes = randomBytes(length);
  let out = '';
  for (const b of bytes) out += String(b % 10);
  return out;
}

/** PBKDF2-SHA256，100000 轮，16 字节盐 */
export async function hashPassword(password, saltB64) {
  const salt = base64ToBytes(saltB64);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

/** 恒定时间比较（长度也纳进来，不提前 return） */
export function timingSafeEqual(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  let diff = x.length ^ y.length;
  const max = Math.max(x.length, y.length, 1);
  for (let i = 0; i < max; i += 1) {
    diff |= x.charCodeAt(i % x.length || 0) ^ y.charCodeAt(i % y.length || 0);
  }
  return diff === 0;
}

export async function verifyPassword(password, saltB64, expectedHash) {
  const hash = await hashPassword(password, saltB64);
  return timingSafeEqual(hash, expectedHash);
}

/* ── 会话 ───────────────────────────────────────── */

export async function createSession(kv, uid, now = Date.now()) {
  const token = randomToken(32);
  await kv.put(
    `cm:sess:${token}`,
    JSON.stringify({ uid, createdAt: new Date(now).toISOString() }),
    { expirationTtl: SESSION_TTL },
  );
  return token;
}

export async function readSession(request, kv) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const record = await kv.get(`cm:sess:${token}`, 'json');
  if (!record || !record.uid) return null;
  // 改过密码之后旧会话一律作废（不靠 KV list，单键读取强一致）
  // 判定用「创建时间 <= 修改时间」：同一毫秒内建出来的旧会话也要算作废，
  // 重置时新会话用 now+1 建，所以它不会被自己误杀。
  const pwAt = await kv.get(`cm:pwAt:${record.uid}`);
  if (pwAt) {
    const changedAt = new Date(pwAt).getTime();
    const createdAt = new Date(record.createdAt || 0).getTime();
    if (Number.isFinite(changedAt) && Number.isFinite(createdAt) && createdAt <= changedAt) {
      await kv.delete(`cm:sess:${token}`);
      return null;
    }
  }
  return { token, uid: record.uid };
}

/** 记录「密码最后一次修改时间」；readSession 据此让旧会话失效 */
export async function markPasswordChanged(kv, uid, now = Date.now()) {
  await kv.put(`cm:pwAt:${uid}`, new Date(now).toISOString());
}

export async function destroySession(kv, token) {
  if (token) await kv.delete(`cm:sess:${token}`);
}

export async function getUserByEmail(kv, email) {
  return kv.get(`cm:user:${email}`, 'json');
}

export async function getUserById(kv, uid) {
  const email = await kv.get(`cm:uid2email:${uid}`);
  if (!email) return null;
  return getUserByEmail(kv, email);
}

/** 登录态解析：返回 { session, user } 或 null */
export async function requireUser(request, kv) {
  const session = await readSession(request, kv);
  if (!session) return null;
  const user = await getUserById(kv, session.uid);
  if (!user) return null;
  return { session, user };
}

export function publicUser(user) {
  return user ? { id: user.id, email: user.email, createdAt: user.createdAt } : null;
}
