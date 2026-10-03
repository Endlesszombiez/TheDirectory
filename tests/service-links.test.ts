import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '../src/lib/defaults';
import { configSchema } from '../src/lib/schema';
import {
  serviceDestinations,
  serviceDestination,
  serviceIconSources,
  isLocalHostname,
} from '../src/lib/service-links';
import { clientId } from '../src/lib/client-id';
import { importDiscoveredServices } from '../src/lib/dashboard-setup';

const original = defaultConfig.boards[0].services[0];
test('legacy services keep their destination and dual links favor the access environment', () => {
  assert.deepEqual(serviceDestinations(original), {
    local: original.url,
    web: '',
  });
  const service = {
    ...original,
    localUrl: 'http://10.0.0.3:8096',
    webUrl: 'https://media.example.com',
  };
  assert.equal(serviceDestination(service, true), service.localUrl);
  assert.equal(serviceDestination(service, false), service.webUrl);
  assert.equal(
    serviceDestination({ ...service, localUrl: '' }, true),
    service.webUrl,
  );
  assert.equal(
    serviceDestination({ ...service, webUrl: '' }, false),
    service.localUrl,
  );
  assert.deepEqual(serviceDestinations({ ...original, url: service.webUrl }), {
    local: '',
    web: service.webUrl,
  });
  for (const host of [
    '10.0.0.3',
    '192.168.1.3',
    '172.16.0.2',
    'localhost',
    'server.home',
    '[::1]',
    '[fd00::3]',
  ])
    assert.equal(isLocalHostname(host), true, host);
  for (const host of [
    'service.com',
    '172.32.0.3',
    '8.8.8.8',
    '[2606:4700::1111]',
  ])
    assert.equal(isLocalHostname(host), false, host);
});

test('automatic icons use bundled logos or destination favicons and respect overrides', () => {
  const service = {
    ...original,
    name: 'Portainer',
    localUrl: 'http://10.0.0.3:9443',
    webUrl: 'https://portainer.example.com',
  };
  assert.deepEqual(serviceIconSources(service), [
    '/service-icons/portainer.svg',
    'https://portainer.example.com/favicon.ico',
  ]);
  assert.deepEqual(
    serviceIconSources({
      ...service,
      name: 'Custom',
      webUrl: 'https://custom.example.com',
    }),
    ['https://custom.example.com/favicon.ico'],
  );
  assert.deepEqual(serviceIconSources({ ...service, iconMode: 'manual' }), []);
  assert.deepEqual(
    serviceIconSources({ ...service, iconUrl: 'https://example.com/logo.png' }),
    ['https://example.com/logo.png'],
  );
});

test('destination and icon settings survive validation; unsafe or missing links are rejected', () => {
  const config = structuredClone(defaultConfig);
  const service = config.boards[0].services[0];
  service.localUrl = service.url;
  service.webUrl = 'https://service.example.com';
  service.iconUrl = 'https://example.com/logo.png';
  assert.deepEqual(configSchema.parse(config), config);
  for (const field of ['localUrl', 'webUrl', 'iconUrl'] as const) {
    const invalid = structuredClone(config);
    invalid.boards[0].services[0][field] = 'javascript:alert(1)';
    assert.equal(configSchema.safeParse(invalid).success, false);
  }
  service.localUrl = '';
  service.webUrl = '';
  assert.equal(configSchema.safeParse(config).success, false);
});

test('service creation works when randomUUID is unavailable on a LAN HTTP origin', () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis.crypto,
    'randomUUID',
  );
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: undefined,
    configurable: true,
  });
  try {
    const first = clientId(),
      second = clientId();
    assert.match(
      first,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.notEqual(first, second);
  } finally {
    if (descriptor)
      Object.defineProperty(globalThis.crypto, 'randomUUID', descriptor);
    else delete (globalThis.crypto as Partial<Crypto>).randomUUID;
  }
});

test('discovery does not duplicate an existing secondary destination', () => {
  const config = structuredClone(defaultConfig);
  config.boards[0].services[0].localUrl = original.url;
  config.boards[0].services[0].webUrl = 'https://service.example.com';
  const result = importDiscoveredServices(config, 'home', [
    { ...original, id: 'new', url: 'https://service.example.com' },
  ]);
  assert.equal(result.added, 0);
  assert.equal(result.skipped, 1);
});
