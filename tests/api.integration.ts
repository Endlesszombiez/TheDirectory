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
      DOCKER_SOCKET: '',
      DOCKER_API_URL: '',
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
      if ((await fetch(`${origin}/api/health`)).ok)
        return { origin, stop, output: () => output };
    } catch {}
    if (server.exitCode !== null) throw new Error(output);
    await new Promise((r) => setTimeout(r, 100));
  }
  await stop();
  throw new Error(`Server did not start: ${output}`);
}
const cookieFrom = (response: Response) =>
  response.headers.get('set-cookie')!.split(';')[0];

test('guest file sharing requires a PIN and isolates management from Directory accounts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'directory-files-api-'));
  let server = await start(directory);
  try {
    let origin = server.origin;
    const request = (
      action: string,
      method = 'GET',
      body?: BodyInit,
      cookie?: string,
      csrf = origin,
    ) =>
      fetch(`${origin}/api/files/${action}`, {
        method,
        body,
        headers: {
          ...(method === 'GET' ? {} : { Origin: csrf }),
          ...(action.startsWith('upload?')
            ? { 'Content-Type': 'application/octet-stream' }
            : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        redirect: 'manual',
      }).catch((error) => {
        throw new Error(`${method} files/${action} failed`, { cause: error });
      });
    const login = await fetch(`${origin}/api/auth/login`, {
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
    const admin = cookieFrom(login);
    const json = (
      action: string,
      body: unknown,
      cookie?: string,
      method = 'POST',
    ) =>
      fetch(`${origin}/api/files/${action}`, {
        method,
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify(body),
      });
    assert.equal((await fetch(`${origin}/files`)).status, 200);
    assert.equal((await request('list')).status, 401);
    assert.equal((await request('download?path=secret.txt')).status, 401);
    assert.equal(
      (await request('upload?path=test.txt', 'POST', 'secret')).status,
      401,
    );
    const config = {
      pin: '123456',
      maxFileMB: 1,
      allowedExtensions: '.txt',
      autoUpload: false,
      showFileList: true,
    };
    assert.equal(
      (await json('settings', config, undefined, 'PUT')).status,
      403,
    );
    assert.equal((await json('settings', config, admin, 'PUT')).status, 200);
    const status = await (await request('status')).json();
    assert.equal(status.configured, true);
    assert.equal(status.unlocked, false);
    assert.equal('pinHash' in status, false);
    assert.equal((await json('unlock', { pin: 'wrong' })).status, 401);
    const unlocked = await json('unlock', { pin: config.pin });
    assert.equal(unlocked.status, 200);
    assert.match(unlocked.headers.get('set-cookie')!, /HttpOnly/i);
    const guest = cookieFrom(unlocked);
    assert.equal(
      (await fetch(`${origin}/api/config`, { headers: { Cookie: guest } }))
        .status,
      401,
    );
    assert.equal((await json('settings', config, guest, 'PUT')).status, 403);
    assert.equal(
      (
        await request(
          'upload?path=test.txt',
          'POST',
          'secret',
          guest,
          'https://evil.example',
        )
      ).status,
      403,
    );
    for (const path of [
      '../secret.txt',
      'a/../../secret.txt',
      'a\\secret.txt',
      'NUL.txt',
      'a:secret.txt',
      '/secret.txt',
    ]) {
      assert.equal(
        (
          await request(
            `upload?path=${encodeURIComponent(path)}`,
            'POST',
            'secret',
            guest,
          )
        ).status,
        400,
        path,
      );
      assert.equal(
        (
          await request(
            `delete?path=${encodeURIComponent(path)}`,
            'DELETE',
            undefined,
            guest,
          )
        ).status,
        400,
        path,
      );
    }
    assert.equal(
      (await request('upload?path=test.html', 'POST', '<script/>', guest))
        .status,
      415,
    );
    assert.equal(
      (await request('upload?path=big.txt', 'POST', 'x'.repeat(1048577), guest))
        .status,
      413,
    );
    assert.equal(
      (
        await request(
          'upload?path=folder/test.txt',
          'POST',
          'hello world',
          guest,
        )
      ).status,
      201,
    );
    assert.equal(
      (await request('upload?path=folder/empty.txt', 'POST', '', guest)).status,
      201,
    );
    assert.equal(
      (await request('upload?path=folder/test.txt', 'POST', 'overwrite', guest))
        .status,
      409,
    );
    const listing = await (
      await request('list', 'GET', undefined, guest)
    ).json();
    assert.equal(listing.totalFiles, 2);
    assert.equal(listing.totalBytes, 11);
    assert.ok(
      listing.entries.some(
        (e: { path: string; directory: boolean }) =>
          e.path === 'folder' && e.directory,
      ),
    );
    const download = await request(
      'download?path=folder/test.txt',
      'GET',
      undefined,
      guest,
    );
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition')!, /attachment/);
    assert.equal(await download.text(), 'hello world');
    assert.equal(
      (await json('settings', { ...config, pin: '654321' }, admin, 'PUT'))
        .status,
      200,
    );
    assert.equal((await request('list', 'GET', undefined, guest)).status, 401);
    const newGuest = cookieFrom(await json('unlock', { pin: '654321' }));
    assert.equal(
      (await request('delete?path=folder', 'DELETE', undefined, newGuest))
        .status,
      200,
    );
    assert.equal(
      (await (await request('list', 'GET', undefined, newGuest)).json())
        .totalFiles,
      0,
    );
    assert.equal(
      (await request('delete?path=', 'DELETE', undefined, newGuest)).status,
      400,
    );
    assert.equal(
      (await request('lock', 'POST', undefined, newGuest)).status,
      200,
    );
    assert.equal(
      (await request('list', 'GET', undefined, newGuest)).status,
      401,
    );
    const pinCookie = cookieFrom(await json('unlock', { pin: '654321' }));
    await server.stop();
    server = await start(directory);
    origin = server.origin;
    assert.equal((await (await request('status')).json()).configured, true);
    assert.equal(
      (await request('list', 'GET', undefined, pinCookie)).status,
      401,
    );
    const restored = cookieFrom(await json('unlock', { pin: '654321' }));
    assert.equal(
      (await request('list', 'GET', undefined, restored)).status,
      200,
    );
  } catch (error) {
    console.error(server.output());
    throw error;
  } finally {
    await server.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('uplink ingestion uses scoped bearer tokens while management retains sessions, administrator roles and origin checks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'directory-uplink-api-'));
  let server = await start(directory);
  try {
    let origin = server.origin;
    const request = (path: string, init: RequestInit = {}) =>
      fetch(`${origin}${path}`, { redirect: 'manual', ...init });
    const login = await request('/api/auth/login', {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        username: 'tester',
        password: 'integration-password',
      }),
    });
    const admin = cookieFrom(login);
    const connectionsPage = await (
      await request('/ai', { headers: { Cookie: admin } })
    ).text();
    assert.match(connectionsPage, /Render API key/);
    assert.match(connectionsPage, /Data uplinks/);
    const post = (
      path: string,
      body: unknown,
      extra: Record<string, string> = {},
    ) =>
      request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...extra },
        body: JSON.stringify(body),
      });
    for (const path of ['/api/render', '/api/uplinks'])
      assert.equal((await request(path)).status, 401);
    assert.equal(
      (
        await post(
          '/api/uplinks',
          { action: 'create', name: 'Worker', staleAfter: 60 },
          { Cookie: admin },
        )
      ).status,
      403,
    );
    const response = await post(
      '/api/uplinks',
      { action: 'create', name: 'Worker', staleAfter: 60 },
      { Cookie: admin, Origin: origin },
    );
    assert.equal(response.status, 200);
    const { created } = await response.json();
    const tokenHeaders = { Authorization: `Bearer ${created.token}` };
    assert.equal((await post('/api/uplinks/receive', { jobs: 2 })).status, 401);
    assert.equal(
      (
        await post(
          '/api/uplinks/receive',
          { jobs: 2 },
          { Authorization: 'Bearer invalid' },
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await post(
          '/api/uplinks/receive',
          { jobs: 2 },
          { ...tokenHeaders, Origin: 'https://evil.example' },
        )
      ).status,
      403,
    );
    assert.equal((await post('/api/config', {}, tokenHeaders)).status, 403);
    assert.equal(
      (await request('/api/config', { headers: tokenHeaders })).status,
      401,
    );
    assert.equal(
      (
        await post(
          '/api/uplinks/receive',
          { nested: { jobs: 2 } },
          tokenHeaders,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          '/api/uplinks/receive',
          { big: 'a'.repeat(4100) },
          tokenHeaders,
        )
      ).status,
      413,
    );
    assert.equal(
      (
        await post(
          '/api/uplinks/receive',
          { jobs: 2, active: true },
          tokenHeaders,
        )
      ).status,
      200,
    );
    assert.equal(
      (await post('/api/uplinks/receive', { jobs: 3 }, tokenHeaders)).status,
      429,
    );
    const read = await request('/api/uplinks', { headers: { Cookie: admin } });
    const status = await read.json();
    assert.equal(status.uplinks[0].values.jobs, 2);
    assert.equal('tokenHash' in status.uplinks[0], false);
    assert.equal(JSON.stringify(status).includes(created.token), false);
    const config = await (
      await request('/api/config', { headers: { Cookie: admin } })
    ).json();
    assert.equal(
      (
        await request('/api/config', {
          method: 'PUT',
          headers: {
            Cookie: admin,
            Origin: origin,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ...config, widgets: ['uplinks'] }),
        })
      ).status,
      200,
    );
    const dashboard = await (
      await request('/api/status', { headers: { Cookie: admin } })
    ).json();
    assert.equal(dashboard.uplinks[0].values.jobs, 2);
    assert.equal(JSON.stringify(dashboard).includes(created.token), false);
    const user = await request('/api/users', {
      method: 'POST',
      headers: {
        Cookie: admin,
        Origin: origin,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        action: 'create',
        username: 'uplinkviewer',
        password: 'viewer-password',
        role: 'viewer',
      }),
    });
    assert.equal(user.status, 303);
    const viewerLogin = await request('/api/auth/login', {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        username: 'uplinkviewer',
        password: 'viewer-password',
      }),
    });
    const viewer = cookieFrom(viewerLogin);
    const viewerPage = await (
      await request('/ai', { headers: { Cookie: viewer } })
    ).text();
    assert.equal(viewerPage.includes('Render API key'), false);
    assert.equal(viewerPage.includes('Create uplink'), false);
    for (const path of ['/api/render', '/api/uplinks']) {
      assert.equal(
        (await request(path, { headers: { Cookie: viewer } })).status,
        403,
      );
      assert.equal(
        (
          await post(
            path,
            { action: 'disconnect' },
            { Cookie: viewer, Origin: origin },
          )
        ).status,
        403,
      );
    }
    assert.equal(
      (await request('/api/status', { headers: { Cookie: viewer } })).status,
      200,
    );
    await server.stop();
    server = await start(directory);
    origin = server.origin;
    const signedIn = await request('/api/auth/login', {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        username: 'tester',
        password: 'integration-password',
      }),
    });
    const restartedAdmin = cookieFrom(signedIn);
    const persisted = await (
      await request('/api/uplinks', { headers: { Cookie: restartedAdmin } })
    ).json();
    assert.equal(persisted.uplinks[0].values.jobs, 2);
    assert.equal(
      (
        await post(
          '/api/uplinks',
          { action: 'revoke', id: created.id },
          { Cookie: restartedAdmin, Origin: origin },
        )
      ).status,
      200,
    );
    assert.equal(
      (await post('/api/uplinks/receive', { jobs: 4 }, tokenHeaders)).status,
      401,
    );
  } finally {
    await server.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

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
    assert.equal((await request('/settings')).status, 302);
    assert.equal((await request('/api/config')).status, 401);
    assert.equal((await request('/api/status')).status, 401);
    for (const path of [
      '/api/discovery',
      '/api/ai/connections',
      '/api/ai/models',
    ])
      assert.equal((await request(path)).status, 401);
    const loginPage = await request('/login');
    assert.equal(loginPage.status, 200);
    assert.equal(loginPage.headers.get('referrer-policy'), 'same-origin');
    assert.equal(
      (
        await form(
          '/api/auth/login',
          { username: 'tester', password: 'integration-password' },
          '',
          'null',
        )
      ).status,
      403,
    );
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
    assert.equal((await request('/ai', admin)).status, 200);
    assert.deepEqual(
      await (await request('/api/ai/connections', admin)).json(),
      { accounts: [] },
    );
    assert.equal((await request('/api/ai/models', admin)).status, 400);
    assert.equal((await request('/api/discovery', admin)).status, 503);
    const aiPost = (
      path: string,
      body: unknown,
      cookie: string,
      requestOrigin = origin,
    ) =>
      request(path, cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: requestOrigin },
        body: JSON.stringify(body),
      });
    assert.equal(
      (
        await aiPost(
          '/api/ai/connections',
          { action: 'import', credentials: {} },
          admin,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await aiPost(
          '/api/ai/connections',
          { action: 'import', credentials: {} },
          admin,
          'https://untrusted.example',
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await aiPost(
          '/api/ai/plan',
          { model: 'fake-model', prompt: 'Arrange', revision: config.revision },
          admin,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await aiPost(
          '/api/ai/plan',
          {
            model: 'fake-model',
            prompt: 'Arrange',
            revision: config.revision + 1,
          },
          admin,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await aiPost(
          '/api/ai/plan',
          { model: 'fake-model', prompt: 'Arrange', revision: config.revision },
          admin,
          'https://untrusted.example',
        )
      ).status,
      403,
    );

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
      (
        await save(
          {
            ...config,
            title: 'Integration lab',
            theme: 'light',
            accent: 'blue',
          },
          admin,
          origin,
        )
      ).status,
      200,
    );
    assert.equal((await save(config, admin, origin)).status, 409);
    // All settings surfaces and login inherit the saved dashboard palette.
    for (const path of [
      '/',
      '/settings',
      '/settings?section=boards',
      '/settings?section=backup',
      '/account',
      '/ai',
      '/users',
      '/login',
    ]) {
      const response = await request(path, path === '/login' ? '' : admin);
      assert.equal(response.status, 200, path);
      const html = await response.text();
      assert.match(html, /data-theme="light"/, path);
      assert.match(html, /data-accent="blue"/, path);
      if (path !== '/' && path !== '/login')
        assert.match(html, /aria-label="Settings"/, path);
    }

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
    assert.doesNotMatch(viewerHtml, />Edit</);
    assert.doesNotMatch(viewerHtml, />New board</);
    assert.equal((await request('/api/users', viewer)).status, 403);
    assert.equal((await request('/users', viewer)).status, 403);
    assert.equal((await request('/api/discovery', viewer)).status, 403);
    assert.equal((await request('/ai', viewer)).status, 200);
    assert.deepEqual(
      await (await request('/api/ai/connections', viewer)).json(),
      { accounts: [] },
    );
    assert.equal(
      (
        await aiPost(
          '/api/ai/plan',
          { model: 'fake-model', prompt: 'Arrange', revision: config.revision },
          viewer,
        )
      ).status,
      403,
    );
    assert.doesNotMatch(viewerHtml, />Discover</);
    const viewerSettings = await request('/settings', viewer);
    assert.equal(viewerSettings.status, 302);
    assert.equal(viewerSettings.headers.get('location'), '/account');
    const viewerAccount = await (await request('/account', viewer)).text();
    assert.doesNotMatch(viewerAccount, />Appearance<|>Users<|>Backup</);
    assert.match(viewerAccount, />Connections</);

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

test('multiple configured origins allow LAN and HTTPS logins with separate cookie security', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'directory-origins-'));
  const server = await start(directory, {
    APP_ORIGIN: 'http://10.0.0.3, https://thecolony.cloud',
  });
  try {
    const post = (origin?: string) =>
      fetch(`${server.origin}/api/auth/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(origin ? { Origin: origin } : {}),
        },
        body: new URLSearchParams({
          username: 'tester',
          password: 'integration-password',
        }),
      });
    const local = await post('http://10.0.0.3');
    assert.equal(local.status, 303);
    assert.doesNotMatch(local.headers.get('set-cookie')!, /Secure/i);
    assert.equal(local.headers.get('strict-transport-security'), null);
    const publicLogin = await post('https://thecolony.cloud');
    assert.equal(publicLogin.status, 303);
    assert.match(publicLogin.headers.get('set-cookie')!, /Secure/i);
    assert.match(
      publicLogin.headers.get('strict-transport-security')!,
      /max-age/,
    );
    for (const origin of [
      undefined,
      'null',
      'https://evil.example',
      'http://thecolony.cloud',
      'http://10.0.0.3:4321',
    ])
      assert.equal((await post(origin)).status, 403);
    const cookie = cookieFrom(local);
    const config = await (
      await fetch(`${server.origin}/api/config`, {
        headers: { Cookie: cookie },
      })
    ).json();
    const save = await fetch(`${server.origin}/api/config`, {
      method: 'PUT',
      headers: {
        Cookie: cookie,
        Origin: 'http://10.0.0.3',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    });
    assert.equal(save.status, 200);
  } finally {
    await server.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('guest pastes preserve text and separate entries across restarts with PIN and origin protection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'directory-pastes-api-'));
  const options = { FILES_PIN: 'paste-pin' };
  let server = await start(directory, options);
  try {
    const request = (
      action: string,
      method = 'GET',
      body?: unknown,
      cookie?: string,
      origin = server.origin,
    ) =>
      fetch(`${server.origin}/api/files/${action}`, {
        method,
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const unlock = async () =>
      cookieFrom(await request('unlock', 'POST', { pin: options.FILES_PIN }));
    assert.equal((await request('pastes')).status, 401);
    assert.equal(
      (await request('pastes', 'POST', { text: 'private' })).status,
      401,
    );
    assert.equal((await request('pastes?id=anything', 'DELETE')).status, 401);
    const guest = await unlock();
    const text = '  Hello\n<script>alert("text only")</script>\n\u4e16\u754c  ';
    const created = await request('pastes', 'POST', { text }, guest);
    assert.equal(created.status, 201);
    const paste = await created.json();
    assert.equal(paste.text, text);
    const second = await (
      await request('pastes', 'POST', { text }, guest)
    ).json();
    assert.notEqual(paste.id, second.id);
    assert.equal(
      (await request('pastes', 'POST', { text: '  ' }, guest)).status,
      400,
    );
    assert.equal(
      (await request('pastes', 'POST', { text: 'x'.repeat(1048577) }, guest))
        .status,
      413,
    );
    assert.equal(
      (await request('pastes', 'POST', { text }, guest, 'https://evil.example'))
        .status,
      403,
    );
    assert.equal(
      (await request('pastes?id=../files-settings', 'DELETE', undefined, guest))
        .status,
      400,
    );
    const listing = await (
      await request('pastes', 'GET', undefined, guest)
    ).json();
    assert.equal(listing.pastes.length, 2);
    await request('lock', 'POST', undefined, guest);
    assert.equal(
      (await request('pastes', 'GET', undefined, guest)).status,
      401,
    );
    await server.stop();
    server = await start(directory, options);
    const restored = await unlock();
    const saved = (
      await (await request('pastes', 'GET', undefined, restored)).json()
    ).pastes;
    assert.equal(saved.length, 2);
    assert.equal(
      saved.find((entry: { id: string }) => entry.id === paste.id).text,
      text,
    );
    assert.equal(
      (await request(`pastes?id=${paste.id}`, 'DELETE', undefined, restored))
        .status,
      200,
    );
    assert.equal(
      (await (await request('pastes', 'GET', undefined, restored)).json())
        .pastes.length,
      1,
    );
    assert.equal(
      (await request(`pastes?id=${paste.id}`, 'DELETE', undefined, restored))
        .status,
      404,
    );
  } finally {
    await server.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
