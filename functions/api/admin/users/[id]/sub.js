/**
 * POST /api/admin/users/:id/sub —— 调整某用户的订阅期（管理员）
 * body: { days }  正数加、负数减；范围 ±3650 天
 *
 * 规则：不能改自己的订阅；没有订阅记录时从今天起算。
 */
import { guard, fail, json, readJsonBody, getKV, kvUnavailable } from '../../../../../lib/api/http.js';
import { getUserById } from '../../../../../lib/api/auth.js';
import {
  requireAdmin,
  rateLimitAdmin,
  readSubExpiry,
  writeSubExpiry,
} from '../../../../../lib/api/admin.js';

const DAY = 86400000;
const MAX_DAYS = 3650;

export const onRequestPost = guard(async ({ request, env, params }) => {
  const kv = getKV(env);
  if (!kv) return kvUnavailable();

  const { auth, error } = await requireAdmin(request, kv);
  if (error) return error;
  const limited = await rateLimitAdmin(request, kv);
  if (limited.error) return limited.error;

  const id = String((params && params.id) || '');
  if (!id) return fail('user_not_found', '用户不存在', 404);
  if (id === auth.user.id) {
    return fail('self_not_allowed', '不能改自己的订阅期', 400);
  }

  const body = await readJsonBody(request);
  if (!body) return fail('invalid_request', '请求格式不对', 400);
  const days = Number(body.days);
  if (!Number.isFinite(days) || days === 0 || Math.abs(days) > MAX_DAYS) {
    return fail('invalid_request', `days 需要是 ±1…${MAX_DAYS} 之间的整数`, 400);
  }

  const user = await getUserById(kv, id);
  if (!user) return fail('user_not_found', '用户不存在', 404);

  const now = Date.now();
  const current = await readSubExpiry(kv, id);
  const base = current > now ? current : now;
  const expiresAt = await writeSubExpiry(kv, id, base + Math.round(days) * DAY);

  if (expiresAt && expiresAt !== null && new Date(expiresAt).getTime() < now) {
    return fail('invalid_request', '调整后到期时间早于现在，已按取消订阅处理', 400);
  }

  return json({
    id,
    email: user.email,
    subExpiresAt: expiresAt,
    changedDays: Math.round(days),
  });
});
