/**
 * POST /api/auth/logout —— 删除会话并清 Cookie
 */
import { guard, clearSessionCookie, backendUnavailable } from '../../../lib/api/http.js';
import { readSession, destroySession } from '../../../lib/api/auth.js';

export const onRequestPost = guard(async ({ request, env }) => {
  if (!env.CM_KV) return backendUnavailable(['CM_KV']);
  const session = await readSession(request, env.CM_KV);
  if (session) await destroySession(env.CM_KV, session.token);

  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': clearSessionCookie(), 'Cache-Control': 'no-store' },
  });
});
