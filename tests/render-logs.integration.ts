import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { connect } from 'node:tls';
import { once } from 'node:events';

async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test('production startup accepts pushed TLS logs and exposes them through the authenticated administrator API', async (t) => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
  } catch {
    t.skip('OpenSSL is required for the TLS certificate fixture');
    return;
  }
  const directory = await mkdtemp(
    join(tmpdir(), 'directory-render-production-'),
  );
  let server: ReturnType<typeof spawn> | undefined;
  try {
    const cert = join(directory, 'cert.pem');
    const key = join(directory, 'key.pem');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        cert,
        '-subj',
        '/CN=localhost',
        '-days',
        '1',
      ],
      { stdio: 'ignore' },
    );
    const port = await freePort();
    const logPort = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    let output = '';
    server = spawn(process.execPath, [resolve('scripts/start.mjs')], {
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(port),
        APP_ORIGIN: origin,
        DATA_DIR: directory,
        DASHBOARD_USERNAME: 'tester',
        DASHBOARD_PASSWORD: 'integration-password',
        RENDER_LOG_PORT: String(logPort),
        RENDER_LOG_HOST: '127.0.0.1',
        RENDER_LOG_TLS_CERT: cert,
        RENDER_LOG_TLS_KEY: key,
        RENDER_LOG_ALLOWED_IPS: '127.0.0.1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout!.on('data', (chunk) => {
      output += chunk;
    });
    server.stderr!.on('data', (chunk) => {
      output += chunk;
    });
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try {
        if ((await fetch(`${origin}/api/health`)).ok) {
          ready = true;
          break;
        }
      } catch {}
      if (server.exitCode !== null) throw new Error(output);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, output);
    assert.equal((await fetch(`${origin}/api/render/logs`)).status, 401);
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
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const socket = connect({
      host: '127.0.0.1',
      port: logPort,
      ca: await readFile(cert),
      servername: 'localhost',
    });
    await once(socket, 'secureConnect');
    const closed = once(socket, 'close');
    socket.end(
      '<14>1 2026-10-15T20:00:00Z render-service srv-test 42 srv-test - production TLS delivery\n',
    );
    await closed;
    let received = false;
    for (let i = 0; i < 30; i++) {
      const response = await fetch(`${origin}/api/render/logs`, {
        headers: { Cookie: cookie },
      });
      assert.equal(response.status, 200);
      const data = await response.json();
      if (
        data.logs.some(
          (log: { message: string }) =>
            log.message === 'production TLS delivery',
        )
      ) {
        received = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(received, 'Pushed message must reach the production read API');
    const page = await (
      await fetch(`${origin}/ai`, { headers: { Cookie: cookie } })
    ).text();
    assert.match(page, /Render log drain/);
  } finally {
    if (server && server.exitCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
