/**
 * POST /api/auth/logout —— 删除会话并清 Cookie
 */
import { guard, clearSessionCookie, backendUnavailable, getKV, kvUnavailable } from '../../../lib/api/http.js';
import { readSession, destroySession } from '../../../lib/api/auth.js';

export const onRequestPost = guard(async ({ request, env }) => {
  const kv = getKV(env);
  if (!kv) return kvUnavailable();
  const session = await readSession(request, kv);
  if (session) await destroySession(kv, session.token);

  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': clearSessionCookie(), 'Cache-Control': 'no-store' },
  });
});
