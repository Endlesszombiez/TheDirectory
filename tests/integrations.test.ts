import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  authorizeUplink,
  createUplink,
  integrationStatus,
  receiveUplink,
  renderKey,
  revokeUplink,
  setRenderKey,
  uplinkValuesSchema,
} from '../src/lib/integrations';
import {
  clearRenderCache,
  listRenderServices,
  renderStatus,
} from '../src/lib/render';
import { POST as renderPost } from '../src/pages/api/render';
import { readConfig } from '../src/lib/store';
import { serviceSchema } from '../src/lib/schema';

test('uplinks persist encrypted data, enforce per-token limits, and revoke without exposing credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'directory-uplinks-'));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = directory;
  try {
    await setRenderKey('rnd-test-secret');
    assert.equal(await renderKey(), 'rnd-test-secret');
    const created = await createUplink({ name: 'Worker', staleAfter: 300 });
    await authorizeUplink(created.token);
    await assert.rejects(
      authorizeUplink('x'.repeat(43)),
      /Invalid uplink token/,
    );
    await receiveUplink(created.token, {
      queueDepth: 8,
      active: true,
      detail: null,
    });
    await assert.rejects(
      receiveUplink(created.token, { queueDepth: 9 }),
      (error: any) => error.status === 429,
    );
    const status = await integrationStatus();
    assert.equal(status.renderConnected, true);
    assert.equal(status.uplinks[0].stale, false);
    assert.equal(status.uplinks[0].values?.queueDepth, 8);
    assert.equal('tokenHash' in status.uplinks[0], false);
    assert.equal(JSON.stringify(status).includes(created.token), false);
    const stored = await readFile(join(directory, 'integrations.json'), 'utf8');
    for (const secret of [
      'rnd-test-secret',
      created.token,
      'queueDepth',
      'Worker',
    ])
      assert.equal(stored.includes(secret), false);
    await Promise.all([
      createUplink({ name: 'A', staleAfter: 60 }),
      createUplink({ name: 'B', staleAfter: 60 }),
    ]);
    assert.equal((await integrationStatus()).uplinks.length, 3);
    assert.equal((await integrationStatus()).uplinks[1].stale, true);
    await revokeUplink(created.id);
    await assert.rejects(
      authorizeUplink(created.token),
      /Invalid uplink token/,
    );
    await assert.rejects(
      receiveUplink(created.token, { count: 1 }),
      /Invalid uplink token/,
    );
    await setRenderKey(null);
    assert.equal((await integrationStatus()).renderConnected, false);
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test('uplink summaries reject nested values, oversized keys/text, unsafe keys, and too many fields', () => {
  for (const value of [
    {},
    { nested: { value: 1 } },
    { list: [1] },
    { big: 'a'.repeat(201) },
    { ['a'.repeat(41)]: 1 },
    { '<script>': 1 },
    { bad: Infinity },
    Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`field${i}`, i])),
  ])
    assert.equal(uplinkValuesSchema.safeParse(value).success, false);
  assert.equal(
    uplinkValuesSchema.safeParse({
      jobs: 1,
      ready: false,
      message: '<script>text</script>',
      missing: null,
    }).success,
    true,
  );
});

test('Render dashboard links reject malformed URLs, credentials, and destinations outside Render', () => {
  const schema = serviceSchema.shape.renderDashboardUrl;
  for (const url of [
    'not a URL',
    'javascript:alert(1)',
    'https://evil.example/web/srv-one',
    'https://dashboard.render.com.evil.example/',
    'https://user:password@dashboard.render.com/web/srv-one',
  ])
    assert.equal(schema.safeParse(url).success, false);
  assert.equal(
    schema.safeParse('https://dashboard.render.com/worker/srv-one').success,
    true,
  );
});

test('Render discovery paginates and maps private services; imports are idempotent and detect conflicts; deployment polls deduplicate and invalidate on disconnect', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'directory-render-'));
  const previous = process.env.DATA_DIR;
  const originalFetch = globalThis.fetch;
  process.env.DATA_DIR = directory;
  let deployHits = 0;
  let fail = false;
  const urls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    urls.push(url);
    assert.equal(
      new Headers(init?.headers).get('authorization'),
      'Bearer rnd-test',
    );
    assert.ok(url.startsWith('https://api.render.com/v1/'));
    if (fail)
      return Response.json({ secret: 'do-not-expose' }, { status: 401 });
    if (url.includes('/deploys?')) {
      deployHits++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return Response.json([
        {
          deploy: {
            id: 'dep-test',
            status: 'live',
            createdAt: new Date().toISOString(),
            commit: { id: 'abcdef123456', message: 'Ship' },
          },
        },
      ]);
    }
    if (url.includes('cursor='))
      return Response.json([
        {
          service: {
            id: 'srv-worker',
            name: 'Worker',
            type: 'background_worker',
            dashboardUrl: 'https://evil.example/test',
          },
        },
      ]);
    return Response.json(
      Array.from({ length: 100 }, (_, i) => ({
        cursor: `cursor-${i}`,
        service: {
          id: `srv-${i}`,
          name: `App ${i}`,
          type: 'web_service',
          serviceDetails: {
            url: i === 0 ? 'https://app.onrender.com' : 'javascript:alert(1)',
          },
        },
      })),
    );
  };
  try {
    const services = await listRenderServices('rnd-test');
    assert.equal(services.length, 101);
    assert.ok(urls[1].includes('cursor=cursor-99'));
    assert.equal(services[0].service.webUrl, 'https://app.onrender.com/');
    assert.equal(services[0].service.check, false);
    assert.equal(
      services.at(-1)?.service.url,
      'https://dashboard.render.com/worker/srv-worker',
    );
    await setRenderKey('rnd-test');
    clearRenderCache();
    const post = (body: object, role = 'admin') =>
      renderPost({
        locals: { user: { role } },
        request: new Request('http://localhost/api/render', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      } as any);
    assert.equal((await post({ action: 'disconnect' }, 'viewer')).status, 403);
    let config = await readConfig();
    const originalCount = config.boards[0].services.length;
    let response = await post({
      action: 'import',
      boardId: config.boards[0].id,
      revision: config.revision,
      serviceIds: ['srv-0', 'srv-worker', 'srv-0'],
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).imported, 2);
    config = await readConfig();
    assert.equal(config.boards[0].services.length, originalCount + 2);
    response = await post({
      action: 'import',
      boardId: config.boards[0].id,
      revision: config.revision,
      serviceIds: ['srv-0'],
    });
    assert.equal((await response.json()).imported, 0);
    response = await post({
      action: 'import',
      boardId: config.boards[0].id,
      revision: config.revision,
      serviceIds: ['srv-0'],
    });
    assert.equal(response.status, 409);
    config = await readConfig();
    // Copies across boards share the same remote deployment request.
    config.boards.push({
      id: 'copy',
      name: 'Copy',
      notes: '',
      services: [services[0].service],
    });
    const [first, second] = await Promise.all([
      renderStatus(config),
      renderStatus(config),
    ]);
    assert.equal(deployHits, 2);
    assert.equal(first.services['srv-0'].deployment?.status, 'live');
    assert.deepEqual(first, second);
    await renderStatus(config);
    assert.equal(deployHits, 2);
    const originalNow = Date.now;
    try {
      const future = Date.now() + 61_000;
      Date.now = () => future;
      fail = true;
      const unavailable = await renderStatus(config);
      assert.match(unavailable.services['srv-0'].error || '', /rejected/);
      assert.equal(unavailable.services['srv-0'].deployment?.status, 'live');
      assert.equal(
        unavailable.services['srv-0'].checkedAt,
        first.services['srv-0'].checkedAt,
      );
    } finally {
      Date.now = originalNow;
    }
    await setRenderKey(null);
    clearRenderCache();
    assert.equal((await renderStatus(config)).configured, false);
    assert.equal(deployHits, 2);
    fail = true;
    response = await post({ action: 'connect', apiKey: 'rnd-test' });
    assert.equal(response.status, 502);
    assert.equal(
      JSON.stringify(await response.json()).includes('do-not-expose'),
      false,
    );
    assert.equal(await renderKey(), null);
  } finally {
    globalThis.fetch = originalFetch;
    clearRenderCache();
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
