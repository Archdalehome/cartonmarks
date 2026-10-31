/**
 * DELETE /api/admin/users/:id —— 删号（管理员）
 *
 * 连带清理：cm:user:{email}、cm:uid2email:{uid}、cm:sub:{uid}、
 *          cm:tpls:{uid} 与该用户所有 cm:tpl:{uid}:{id}、以及该用户的会话
 * 保护：内置管理员 admin@support.qafield.com 和操作者自己都不能删
 */
import { guard, fail, getKV, kvUnavailable } from '../../../../lib/api/http.js';
import { getUserById } from '../../../../lib/api/auth.js';
import {
  requireAdmin,
  rateLimitAdmin,
  PROTECTED_ADMIN_EMAIL,
  purgeSessions,
} from '../../../../lib/api/admin.js';

const NO_CONTENT = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

export const onRequestDelete = guard(async ({ request, env, params }) => {
  const kv = getKV(env);
  if (!kv) return kvUnavailable();

  const { auth, error } = await requireAdmin(request, kv);
  if (error) return error;
  const limited = await rateLimitAdmin(request, kv);
  if (limited.error) return limited.error;

  const id = String((params && params.id) || '');
  if (!id) return fail('user_not_found', '用户不存在', 404);

  const user = await getUserById(kv, id);
  if (!user) return fail('user_not_found', '用户不存在', 404);

  const email = String(user.email || '').toLowerCase();
  if (email === PROTECTED_ADMIN_EMAIL) {
    return fail('protected_user', '内置管理员账号不能删除', 409);
  }
  if (id === auth.user.id) {
    return fail('self_not_allowed', '不能删除自己的账号', 409);
  }

  // 模板：先删正文，再删索引
  const list = (await kv.get(`cm:tpls:${id}`, 'json')) || [];
  for (const item of list) {
    if (item && item.id) await kv.delete(`cm:tpl:${id}:${item.id}`);
  }
  await kv.delete(`cm:tpls:${id}`);

  await kv.delete(`cm:user:${email}`);
  await kv.delete(`cm:uid2email:${id}`);
  await kv.delete(`cm:sub:${id}`);
  const sessions = await purgeSessions(kv, id);

  return new Response(null, {
    status: 204,
    headers: {
      'Cache-Control': 'no-store',
      'X-Removed-Sessions': String(sessions),
    },
  });
});
