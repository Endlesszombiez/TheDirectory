import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { defaultConfig } from '../src/lib/defaults';
import { checkServices, dockerInfo } from '../src/lib/monitor';

test('checks real HTTP services, recognizes authenticated endpoints, and skips disabled checks', async () => {
  const server = createServer((request, response) => {
    response.writeHead(
      request.url === '/auth' ? 401 : request.url === '/broken' ? 503 : 200,
    );
    response.end('test');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const config = structuredClone(defaultConfig);
    config.boards[0].services = config.boards[0].services
      .slice(0, 4)
      .map((s, i) => ({
        ...s,
        url: `${base}/${['ok', 'auth', 'broken', 'skip'][i]}`,
        ...(i === 0
          ? { localUrl: `${base}/ok`, webUrl: `${base}/broken` }
          : i === 1
            ? { localUrl: '', webUrl: `${base}/auth` }
            : {}),
        check: i !== 3,
      }));
    const status = await checkServices(config);
    assert.equal(status['home:proxmox'].state, 'up');
    assert.equal(status['home:portainer'].state, 'up');
    assert.equal(status['home:homeassistant'].state, 'down');
    assert.equal(status['home:jellyfin'].state, 'unchecked');
    assert.equal(status['home:portainer'].code, 401);
    assert.equal(typeof status['home:proxmox'].latency, 'number');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Docker is opt-in and reports unavailable sockets', async () => {
  const previous = process.env.DOCKER_SOCKET;
  try {
    delete process.env.DOCKER_SOCKET;
    assert.deepEqual(await dockerInfo(), { configured: false });
    process.env.DOCKER_SOCKET = '/nonexistent-directory-test/docker.sock';
    const result = await dockerInfo();
    assert.equal(result.configured, true);
    assert.ok(result.error);
  } finally {
    if (previous === undefined) delete process.env.DOCKER_SOCKET;
    else process.env.DOCKER_SOCKET = previous;
  }
});

test('duplicate cards and simultaneous polls share in-flight checks and cache failures', async () => {
  let hits = 0;
  const server = createServer((request, response) => {
    hits++;
    setTimeout(() => {
      response.writeHead(request.url === '/broken' ? 503 : 200);
      response.end('test');
    }, 30);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const config = structuredClone(defaultConfig);
    config.boards = [config.boards[0]];
    config.boards[0].services = [0, 1, 2].map((i) => ({
      ...defaultConfig.boards[0].services[0],
      id: String(i),
      url: base,
      localUrl: base,
      webUrl: '',
      check: true,
    }));
    const results = await Promise.all([
      checkServices(config),
      checkServices(config),
    ]);
    assert.equal(hits, 1);
    for (const result of results) {
      assert.equal(Object.keys(result).length, 3);
      assert.ok(Object.values(result).every((health) => health.state === 'up'));
    }
    await checkServices(config);
    assert.equal(hits, 1);
    for (const service of config.boards[0].services) {
      service.url = service.localUrl = `${base}/broken`;
    }
    const failures = await Promise.all([
      checkServices(config),
      checkServices(config),
    ]);
    assert.equal(hits, 2);
    assert.ok(
      failures.every((result) =>
        Object.values(result).every(
          (health) => health.state === 'down' && health.code === 503,
        ),
      ),
    );
    await checkServices(config);
    assert.equal(hits, 2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
