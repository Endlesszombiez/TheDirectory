import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { containerSchema, dockerConnectionError } from '../src/lib/docker';
import { discoverContainer, discoverServices } from '../src/lib/discovery';
import { importDiscoveredServices } from '../src/lib/dashboard-setup';
import { defaultConfig } from '../src/lib/defaults';

const container = (extra: Record<string, unknown> = {}) =>
  containerSchema.parse({
    Id: 'container-one',
    Names: ['/jellyfin'],
    Image: 'jellyfin/jellyfin:latest',
    State: 'running',
    Labels: {},
    Ports: [
      { PrivatePort: 8096, PublicPort: 18096, Type: 'tcp', IP: '0.0.0.0' },
    ],
    ...extra,
  });

test('Docker connection failures give distinct actionable diagnostics', () => {
  for (const [code, text] of [
    ['ENOENT', /socket was not found/],
    ['EACCES', /permission denied/],
    ['EPERM', /group_add/],
    ['ECONNREFUSED', /proxy refused/],
    ['ENOTFOUND', /same Docker network/],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', /trusted certificate/],
  ] as const) {
    assert.match(
      dockerConnectionError(Object.assign(new Error(), { code }), true).message,
      text,
    );
  }
  assert.match(
    dockerConnectionError(
      Object.assign(new Error(), { code: 'ECONNREFUSED' }),
      false,
    ).message,
    /socket refused/,
  );
});

test('discovery prioritizes explicit URLs, supports Traefik, and avoids non-web and inaccessible ports', () => {
  const published = discoverContainer(container(), 'https://nas.home')!;
  assert.equal(published.service.url, 'http://nas.home:18096/');
  assert.equal(published.service.check, false);
  assert.equal(published.service.group, 'Media');
  const labeled = discoverContainer(
    container({
      Labels: {
        'directory.url': 'https://media.home',
        'directory.name': 'Movies',
        'directory.group': 'Entertainment',
        'secret.label': 'not-for-export',
      },
    }),
    'http://nas.home',
  )!;
  assert.equal(labeled.source, 'label');
  assert.equal(labeled.service.name, 'Movies');
  assert.equal(labeled.service.url, 'https://media.home/');
  assert.ok(!JSON.stringify(labeled).includes('not-for-export'));
  assert.equal(
    discoverContainer(
      container({ Labels: { 'directory.enable': 'false' } }),
      'http://nas.home',
    ),
    null,
  );
  const traefik = discoverContainer(
    container({
      Labels: {
        'traefik.http.routers.media.rule': 'Host(`media.home`)',
        'traefik.http.routers.media.tls': 'true',
      },
    }),
    'http://nas.home',
  )!;
  assert.equal(traefik.service.url, 'https://media.home/');
  assert.equal(traefik.source, 'traefik');
  const database = discoverContainer(
    container({
      Image: 'postgres:17',
      Ports: [{ PrivatePort: 5432, PublicPort: 5432, Type: 'tcp' }],
    }),
    'http://nas.home',
  )!;
  assert.equal(database.service.url, '');
  const local = discoverContainer(
    container({
      Ports: [
        { PrivatePort: 8096, PublicPort: 8096, Type: 'tcp', IP: '127.0.0.1' },
      ],
    }),
    'http://nas.home',
  )!;
  assert.equal(local.service.url, '');
  assert.match(local.reason, /loopback/);
  const invalid = discoverContainer(
    container({
      Labels: { 'directory.url': 'https://admin:password@media.home' },
    }),
    'http://nas.home',
  )!;
  assert.equal(invalid.service.url, '');
  assert.equal(
    discoverContainer(
      container({
        Ports: [],
        Labels: {
          'traefik.http.routers.media.rule':
            'Host(`media.home`) && PathPrefix(`/jellyfin`)',
        },
      }),
      'http://nas.home',
    )!.service.url,
    '',
  );
});

test('Docker proxy and Swarm discovery issue only allowed GETs and report manager failures', async () => {
  const previous = process.env.DOCKER_API_URL;
  const calls: string[] = [];
  let fail = false;
  const server = createServer((request, response) => {
    calls.push(`${request.method} ${request.url}`);
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/containers/json?all=true')
      response.end(JSON.stringify([container()]));
    else if (request.url === '/services' && !fail)
      response.end(
        JSON.stringify([
          {
            ID: 'swarm-one',
            Spec: {
              Name: 'media',
              Labels: { 'directory.url': 'https://swarm.home' },
              TaskTemplate: {
                ContainerSpec: { Image: 'jellyfin/jellyfin@sha256:test' },
              },
            },
            Endpoint: {
              Ports: [
                { TargetPort: 8096, PublishedPort: 8096, Protocol: 'tcp' },
              ],
            },
          },
        ]),
      );
    else {
      response.statusCode = 503;
      response.end('{}');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    process.env.DOCKER_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const containers = await discoverServices('containers', 'http://nas.home');
    assert.equal(containers.length, 1);
    const swarm = await discoverServices('swarm', 'http://nas.home');
    assert.equal(swarm[0].service.url, 'https://swarm.home/');
    fail = true;
    await assert.rejects(
      discoverServices('swarm', 'http://nas.home'),
      /manager/,
    );
    assert.deepEqual(calls, [
      'GET /containers/json?all=true',
      'GET /services',
      'GET /services',
    ]);
    await assert.rejects(
      discoverServices('containers', 'http://nas.home/path'),
      /origin/,
    );
  } finally {
    if (previous === undefined) delete process.env.DOCKER_API_URL;
    else process.env.DOCKER_API_URL = previous;
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('bulk import skips duplicate URLs and preserves existing dashboard data', () => {
  const config = structuredClone(defaultConfig);
  const candidate = discoverContainer(container(), 'http://nas.home')!.service;
  const first = importDiscoveredServices(config, config.boards[0].id, [
    candidate,
    { ...candidate, id: 'other', url: candidate.url.replace(/\/$/, '') },
  ]);
  assert.equal(first.added, 1);
  assert.equal(first.skipped, 1);
  assert.equal(
    config.boards[0].services.length + 1,
    first.config.boards[0].services.length,
  );
  const repeated = importDiscoveredServices(first.config, config.boards[0].id, [
    candidate,
  ]);
  assert.equal(repeated.added, 0);
  assert.deepEqual(repeated.config, first.config);
  assert.equal(first.config.revision, config.revision);
  assert.equal(first.config.customCss, config.customCss);
  assert.throws(
    () => importDiscoveredServices(config, 'missing-board', [candidate]),
    /still exists/,
  );
});
