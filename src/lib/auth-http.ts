import type { APIContext } from 'astro';
import {
  AuthError,
  RateLimitError,
  SESSION_COOKIE,
  SESSION_SECONDS,
} from './auth';
export async function formData(request: Request) {
  if (
    !request.headers
      .get('content-type')
      ?.startsWith('application/x-www-form-urlencoded')
  )
    throw new AuthError('Expected a form submission.');
  const text = await request.text();
  if (Buffer.byteLength(text) > 4096) throw new AuthError('Form is too large.');
  return new URLSearchParams(text);
}
export function setSession(context: APIContext, token: string) {
  context.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: (process.env.APP_ORIGIN || context.url.origin).startsWith(
      'https://',
    ),
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_SECONDS,
  });
}
export function clearSession(context: APIContext) {
  context.cookies.delete(SESSION_COOKIE, { path: '/' });
}
export function authFailure(context: APIContext, error: unknown, page: string) {
  if (error instanceof RateLimitError)
    return new Response(error.message, {
      status: 429,
      headers: { 'Retry-After': '900' },
    });
  const message =
    error instanceof AuthError
      ? error.message
      : 'Unable to complete this action. Check the fields and try again.';
  if (!(error instanceof AuthError))
    console.error('Account action failed', error);
  return context.redirect(`${page}?error=${encodeURIComponent(message)}`, 303);
}
