import type { APIRoute } from 'astro';
import { logout, SESSION_COOKIE } from '../../../lib/auth';
import { clearSession } from '../../../lib/auth-http';
export const POST: APIRoute = async (context) => {
  await logout(context.cookies.get(SESSION_COOKIE)?.value);
  clearSession(context);
  return context.redirect('/login', 303);
};
