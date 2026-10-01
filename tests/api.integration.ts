import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

async function start(directory: string, extra: Record<string, string> = {}) {
  const allocator = createServer();
  allocator.listen(0, '127.0.0.1');
  await once(allocator, 'listening');
  const port = (allocator.address() as { port: number }).port;
  await new Promise<void>((r) => allocator.close(() => r()));
  const origin = `http://127.0.0.1:${port}`;
  let output = '';
  const server = spawn(process.execPath, [resolve('dist/server/entry.mjs')], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: directory,
      DASHBOARD_USERNAME: 'tester',
      DASHBOARD_PASSWORD: 'integration-password',
      APP_ORIGIN: origin,
      ...extra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => {
    output += chunk;
  });
  server.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const stop = async () => {
    if (server.exitCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
  };
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return { origin, stop };
    } catch {}
    if (server.exitCode !== null) throw new Error(output);
    await new Promise((r) => setTimeout(r, 100));
  }
  await stop();
  throw new Error(`Server did not start: ${output}`);
}
const cookieFrom = (response: Response) =>
  response.headers.get('set-cookie')!.split(';')[0];

test('production server enforces session auth, viewer restrictions, revocation, origin checks and persistent accounts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'directory-api-'));
  let server = await start(directory);
  try {
    let origin = server.origin;
    const request = (path: string, cookie = '', init: RequestInit = {}) =>
      fetch(`${origin}${path}`, {
        ...init,
        redirect: 'manual',
        headers: { ...(cookie ? { Cookie: cookie } : {}), ...init.headers },
      });
    const form = (
      path: string,
      body: Record<string, string>,
      cookie = '',
      requestOrigin = origin,
    ) =>
      request(path, cookie, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: requestOrigin,
        },
        body: new URLSearchParams(body),
      });
    const login = (username: string, password: string) =>
      form('/api/auth/login', { username, password });
    assert.equal((await request('/')).status, 302);
    assert.equal((await request('/api/config')).status, 401);
    assert.equal((await request('/api/status')).status, 401);
    assert.equal((await request('/login')).status, 200);
    assert.equal(
      (
        await form(
          '/api/auth/login',
          { username: 'tester', password: 'integration-password' },
          '',
          'https://untrusted.example',
        )
      ).status,
      403,
    );
    const bad = await login('tester', 'incorrect');
    assert.equal(bad.status, 303);
    assert.equal(bad.headers.get('set-cookie'), null);
    assert.match(bad.headers.get('location')!, /Invalid%20username/);
    const signedIn = await login('tester', 'integration-password');
    assert.equal(signedIn.status, 303);
    assert.match(signedIn.headers.get('set-cookie')!, /HttpOnly/i);
    assert.match(signedIn.headers.get('set-cookie')!, /SameSite=Strict/i);
    let admin = cookieFrom(signedIn);
    assert.equal((await request('/', admin)).status, 200);
    const config = await (await request('/api/config', admin)).json();
    const save = (body: unknown, cookie: string, requestOrigin?: string) =>
      request('/api/config', cookie, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(requestOrigin ? { Origin: requestOrigin } : {}),
        },
        body: JSON.stringify(body),
      });
    assert.equal((await save(config, admin)).status, 403);
    assert.equal(
      (await save(config, admin, 'https://untrusted.example')).status,
      403,
    );
    assert.equal(
      (await save({ ...config, boards: [] }, admin, origin)).status,
      400,
    );
    assert.equal(
      (await save({ ...config, title: 'Integration lab' }, admin, origin))
        .status,
      200,
    );
    assert.equal((await save(config, admin, origin)).status, 409);
    assert.equal(
      (
        await form(
          '/api/users',
          {
            action: 'create',
            username: 'guest',
            password: 'viewer-password-123',
            role: 'viewer',
          },
          admin,
        )
      ).status,
      303,
    );
    let viewer = cookieFrom(await login('guest', 'viewer-password-123'));
    assert.equal((await request('/', viewer)).status, 200);
    const viewerHtml = await (await request('/', viewer)).text();
    assert.match(viewerHtml, /Viewer access/);
    assert.doesNotMatch(viewerHtml, />Edit dashboard</);
    assert.doesNotMatch(viewerHtml, />Create a board</);
    assert.equal((await request('/api/users', viewer)).status, 403);
    assert.equal((await request('/users', viewer)).status, 403);
    for (const path of ['/users/', '/%75sers', '/api/users/', '/api/%75sers'])
      assert.equal((await request(path, viewer)).status, 403);
    for (const path of ['/api/config/', '/api/%63onfig'])
      assert.equal(
        (
          await request(path, viewer, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Origin: origin },
            body: JSON.stringify(config),
          })
        ).status,
        403,
      );
    assert.equal((await save(config, viewer, origin)).status, 403);
    assert.equal(
      (
        await form(
          '/api/users',
          {
            action: 'create',
            username: 'hacker',
            password: 'hacker-password-123',
            role: 'admin',
          },
          viewer,
        )
      ).status,
      403,
    );
    const users = await (await request('/api/users', admin)).json();
    assert.equal(users.length, 2);
    assert.ok(
      users.every((u: Record<string, unknown>) => !('passwordHash' in u)),
    );
    const guestId = users.find(
      (u: { username: string }) => u.username === 'guest',
    ).id;
    const adminId = users.find(
      (u: { username: string }) => u.username === 'tester',
    ).id;
    const selfDelete = await form(
      '/api/users',
      { action: 'delete', userId: adminId },
      admin,
    );
    assert.match(selfDelete.headers.get('location')!, /error=/);
    await form('/api/users', { action: 'revoke', userId: guestId }, admin);
    assert.equal((await request('/api/config', viewer)).status, 401);
    viewer = cookieFrom(await login('guest', 'viewer-password-123'));
    const passwordChange = await form(
      '/api/auth/password',
      {
        currentPassword: 'viewer-password-123',
        newPassword: 'new-viewer-password-123',
      },
      viewer,
    );
    assert.equal(passwordChange.status, 303);
    assert.equal((await request('/api/config', viewer)).status, 401);
    assert.equal(
      (await login('guest', 'viewer-password-123')).headers.get('set-cookie'),
      null,
    );
    viewer = cookieFrom(await login('guest', 'new-viewer-password-123'));
    await form(
      '/api/users',
      { action: 'role', userId: guestId, value: 'admin' },
      admin,
    );
    assert.equal((await request('/api/users', viewer)).status, 401);
    viewer = cookieFrom(await login('guest', 'new-viewer-password-123'));
    assert.equal((await request('/api/users', viewer)).status, 200);
    await form('/api/users', { action: 'delete', userId: guestId }, admin);
    assert.equal((await request('/api/config', viewer)).status, 401);
    await form('/api/auth/logout', {}, admin);
    assert.equal((await request('/api/config', admin)).status, 401);
    admin = cookieFrom(await login('tester', 'integration-password'));
    await server.stop();
    server = await start(directory, {
      DASHBOARD_PASSWORD: 'changed-env-password',
    });
    origin = server.origin;
    assert.equal((await request('/api/config', admin)).status, 200);
    assert.equal(
      (await (await request('/api/config', admin)).json()).title,
      'Integration lab',
    );
    assert.equal(
      (await login('tester', 'changed-env-password')).headers.get('set-cookie'),
      null,
    );
    for (let i = 0; i < 15; i++)
      assert.equal((await login('nonexistent', 'bad-password')).status, 303);
    assert.equal((await login('nonexistent', 'bad-password')).status, 429);
  } finally {
    await server.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('unconfigured first run stays locked and HTTPS reverse proxy origin sets secure cookies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'directory-proxy-'));
  let server = await start(directory, {
    DASHBOARD_USERNAME: '',
    DASHBOARD_PASSWORD: '',
  });
  try {
    assert.equal((await fetch(`${server.origin}/api/config`)).status, 503);
    assert.equal((await fetch(`${server.origin}/login`)).status, 503);
    await server.stop();
    server = await start(directory, { APP_ORIGIN: 'https://lab.example' });
    const post = (origin: string) =>
      fetch(`${server.origin}/api/auth/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Origin: origin,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          username: 'tester',
          password: 'integration-password',
        }),
      });
    assert.equal((await post(server.origin)).status, 403);
    const response = await post('https://lab.example');
    assert.equal(response.status, 303);
    assert.match(response.headers.get('set-cookie')!, /Secure/i);
    assert.match(response.headers.get('strict-transport-security')!, /max-age/);
    assert.match(
      response.headers.get('content-security-policy')!,
      /frame-ancestors 'none'/,
    );
  } finally {
    await server.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
