import { defineMiddleware } from 'astro:middleware';
import { ensureBootstrap, sessionUser, SESSION_COOKIE } from './lib/auth';

export const onRequest = defineMiddleware(async (context, next) => {
  let path: string;
  try {
    path = decodeURIComponent(context.url.pathname).replace(/\/+$/, '') || '/';
  } catch {
    return new Response('Invalid URL', { status: 400 });
  }
  const api = path.startsWith('/api/');
  const publicRoute = ['/api/health', '/login', '/api/auth/login'].includes(
    path,
  );
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(context.request.method);
  const expectedOrigin = process.env.APP_ORIGIN || context.url.origin;
  try {
    const parsed = new URL(expectedOrigin);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.origin !== expectedOrigin
    )
      throw new Error('Invalid APP_ORIGIN');
  } catch {
    return new Response(
      'APP_ORIGIN must be an HTTP(S) origin without a trailing slash or path.',
      { status: 503 },
    );
  }
  const finish = (response: Response) => {
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set(
      'Content-Security-Policy',
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    );
    if (expectedOrigin.startsWith('https://'))
      response.headers.set('Strict-Transport-Security', 'max-age=31536000');
    return response;
  };
  if (mutation && context.request.headers.get('origin') !== expectedOrigin)
    return finish(Response.json({ error: 'Invalid origin' }, { status: 403 }));
  context.locals.user = null;
  if (path !== '/api/health') {
    try {
      const ready = await ensureBootstrap();
      if (!ready && path !== '/login')
        return finish(
          api
            ? Response.json(
                { error: 'Administrator setup required' },
                { status: 503 },
              )
            : context.redirect('/login'),
        );
      context.locals.user = await sessionUser(
        context.cookies.get(SESSION_COOKIE)?.value,
      );
    } catch (error) {
      console.error('Authentication store unavailable', error);
      return finish(
        new Response(
          'Authentication unavailable. Check server configuration and storage.',
          { status: 503 },
        ),
      );
    }
  }
  if (!publicRoute && !context.locals.user)
    return finish(
      api
        ? Response.json({ error: 'Sign in required' }, { status: 401 })
        : context.redirect('/login'),
    );
  const adminRoute =
    path === '/api/users' ||
    path === '/users' ||
    (path === '/api/config' && mutation);
  if (adminRoute && context.locals.user?.role !== 'admin')
    return finish(
      api
        ? Response.json(
            { error: 'Administrator access required' },
            { status: 403 },
          )
        : new Response('Administrator access required', { status: 403 }),
    );
  return finish(await next());
});
