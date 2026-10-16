import { appOrigins, requestAppOrigin } from './lib/app-origins';
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
  const publicRoute =
    path === '/files' ||
    /^\/api\/files\/(status|unlock|lock|settings|list|upload|download|delete|pastes)$/.test(
      path,
    ) ||
    ['/api/health', '/login', '/api/auth/login'].includes(path);
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(context.request.method);
  let origins: string[];
  try {
    origins = appOrigins(context.url);
  } catch {
    return new Response(
      'APP_ORIGIN must be a comma-separated list of HTTP(S) origins without trailing slashes or paths.',
      { status: 503 },
    );
  }
  const expectedOrigin = requestAppOrigin(
    context.request,
    context.url,
    origins,
  );
  const finish = (response: Response) => {
    response.headers.set('X-Content-Type-Options', 'nosniff');
    // Preserve Origin on same-origin form POSTs; no-referrer can produce Origin: null.
    response.headers.set('Referrer-Policy', 'same-origin');
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
  // Machine-to-machine ingestion uses its own bearer token, never a session.
  // Only this exact POST route can omit Origin; browser mutations retain CSRF checks.
  if (
    path === '/api/uplinks/receive' &&
    context.request.method === 'POST' &&
    !context.request.headers.has('origin')
  )
    return finish(await next());
  if (
    mutation &&
    !origins.includes(context.request.headers.get('origin') || '')
  )
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
