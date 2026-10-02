import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ISSUER,
  RESOURCE,
  ChatGPTError,
  createAuthorization,
  completeAuthorization,
  validateCredentials,
} from '../scripts/connect-chatgpt.mjs';
import {
  activeCredentials,
  connectionStatus,
  disconnectConnection,
  importConnection,
  selectConnection,
} from '../src/lib/ai-connections';
import {
  applyAIPlan,
  proposeDashboard,
  readAIStream,
  serviceKey,
} from '../src/lib/ai';
import { defaultConfig } from '../src/lib/defaults';
import type { Config } from '../src/lib/schema';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = {
  ...keys.publicKey.export({ format: 'jwk' }),
  kid: 'test-key',
  alg: 'RS256',
  use: 'sig',
};
const directScopes =
  'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
function jwt(claims: Record<string, unknown>) {
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', kid: 'test-key' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: ISSUER,
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claims,
    }),
  ).toString('base64url');
  return `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), keys.privateKey).toString('base64url')}`;
}
function credentials(
  client = 'oaiapp_a',
  subject = 'account-a',
  seconds = 3600,
  scope = directScopes,
  nonce = 'test-nonce',
) {
  return {
    client_id: client,
    id_token: jwt({
      aud: client,
      sub: subject,
      email: `${subject}@example.test`,
      nonce,
    }),
    access_token: jwt({
      aud: RESOURCE,
      sub: subject,
      client_id: client,
      scope,
      exp: Math.floor(Date.now() / 1000) + seconds,
    }),
    refresh_token: 'private-refresh-token',
    token_type: 'Bearer',
    scope,
  };
}
const json = (value: unknown, status = 200) => Response.json(value, { status });
function identityFetch(url: string | URL | Request) {
  const address = String(url);
  if (address.endsWith('/.well-known/openid-configuration'))
    return json({
      issuer: ISSUER,
      jwks_uri: `${ISSUER}/jwks`,
      revocation_endpoint: `${ISSUER}/revoke`,
    });
  if (address === `${ISSUER}/jwks`) return json({ keys: [jwk] });
  throw new Error(`Unexpected mock request: ${address}`);
}
const identity = (async (url) => identityFetch(url)) as typeof fetch;

test('OAuth uses PKCE, validates state and issued registration, signature, nonce, identity, audience, and plan permission', async () => {
  const attempt = createAuthorization(
    'urn:uuid:test-host',
    'http://127.0.0.1:1455/auth/callback',
  );
  const auth = new URL(attempt.url);
  assert.equal(auth.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(auth.searchParams.get('resource'), RESOURCE);
  assert.equal(auth.searchParams.get('agent_name_hint'), 'The Directory');
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.notEqual(auth.searchParams.get('code_challenge'), attempt.verifier);
  const mock = (async (url, init) => {
    if (String(url).endsWith('/oauth/token')) {
      const body = new URLSearchParams(init?.body as URLSearchParams);
      assert.equal(body.get('client_id'), 'oaiapp_a');
      assert.equal(body.get('code_verifier'), attempt.verifier);
      assert.equal(body.get('redirect_uri'), attempt.redirectUri);
      return json(
        credentials('oaiapp_a', 'account-a', 3600, directScopes, attempt.nonce),
      );
    }
    return identityFetch(url);
  }) as typeof fetch;
  const callback = `${attempt.redirectUri}?state=${attempt.state}&code=code&client_id=oaiapp_a`;
  const saved = await completeAuthorization(attempt, callback, mock);
  assert.equal(saved.subject, 'account-a');
  assert.ok(saved.scopes.includes('chatgpt.tokens.use.direct'));
  await assert.rejects(
    completeAuthorization(
      attempt,
      callback.replace(attempt.state, 'wrong'),
      mock,
    ),
    /state/,
  );
  await assert.rejects(
    completeAuthorization(
      attempt,
      `${attempt.redirectUri}?state=${attempt.state}&code=code`,
      mock,
    ),
    /registration/,
  );
  await assert.rejects(
    validateCredentials(credentials(), { nonce: 'wrong' }, identity),
    /verify/,
  );
  await assert.rejects(
    validateCredentials(
      {
        ...credentials(),
        access_token: jwt({
          aud: 'wrong',
          sub: 'account-a',
          client_id: 'oaiapp_a',
          scope: directScopes,
        }),
      },
      {},
      identity,
    ),
    /verify/,
  );
  await assert.rejects(
    validateCredentials(
      {
        ...credentials(),
        access_token: jwt({
          aud: RESOURCE,
          sub: 'account-b',
          client_id: 'oaiapp_a',
          scope: directScopes,
        }),
      },
      {},
      identity,
    ),
    /verify/,
  );
  await assert.rejects(
    validateCredentials(
      {
        ...credentials(),
        id_token: jwt({ aud: 'oaiapp_a', sub: 'account-a' }).replace(
          /.$/,
          (c) => (c === 'A' ? 'B' : 'A'),
        ),
      },
      {},
      identity,
    ),
    /verify/,
  );
  const declined = await validateCredentials(
    credentials('oaiapp_a', 'account-a', 3600, 'openid profile email'),
    {},
    identity,
  );
  assert.ok(!declined.scopes.includes('chatgpt.tokens.use.direct'));
  const returning = createAuthorization(
    'urn:uuid:test-host',
    attempt.redirectUri,
    saved,
  );
  assert.equal(
    new URL(returning.url).searchParams.get('client_id'),
    'oaiapp_a',
  );
  assert.equal(
    new URL(returning.url).searchParams.get('agent_name_hint'),
    null,
  );
});

function planFor(config: Config) {
  const { title, subtitle, theme, accent, columns, compact, widgets } = config;
  return {
    appearance: { title, subtitle, theme, accent, columns, compact, widgets },
    boards: config.boards.map((b) => ({
      id: b.id,
      name: b.name,
      services: b.services.map((s) => ({
        key: serviceKey(b.id, s.id),
        name: s.name,
        description: s.description,
        icon: s.icon,
        color: s.color,
        group: 'Organized',
      })),
    })),
  };
}
test('AI proposals preserve service URLs, checks, notes, backgrounds, revisions and CSS while rejecting data loss or invented services', () => {
  const config = structuredClone(defaultConfig);
  config.customCss = '.example { color: red; }';
  config.backgroundUrl = 'https://example.test/background.jpg';
  config.boards[0].notes = 'private board notes';
  config.boards[0].services[0].check = true;
  const plan = planFor(config);
  plan.appearance.accent = 'purple';
  const proposal = applyAIPlan(config, plan);
  assert.equal(proposal.accent, 'purple');
  assert.equal(proposal.revision, config.revision);
  assert.equal(proposal.customCss, config.customCss);
  assert.equal(proposal.backgroundUrl, config.backgroundUrl);
  assert.equal(proposal.boards[0].notes, config.boards[0].notes);
  assert.deepEqual(
    proposal.boards.flatMap((b) =>
      b.services.map((s) => [s.id, s.url, s.check]),
    ),
    config.boards.flatMap((b) => b.services.map((s) => [s.id, s.url, s.check])),
  );
  const dropped = planFor(config);
  dropped.boards[0].services.pop();
  assert.throws(() => applyAIPlan(config, dropped), /omitted/);
  const invented = planFor(config);
  invented.boards[0].services[0].key = 'invented';
  assert.throws(() => applyAIPlan(config, invented), /invented/);
  const duplicate = planFor(config);
  duplicate.boards[0].services.push(duplicate.boards[0].services[0]);
  assert.throws(() => applyAIPlan(config, duplicate), /duplicated/);
  const injected = planFor(config);
  Object.assign(injected.boards[0].services[0], {
    url: 'http://attacker.test',
  });
  assert.throws(() => applyAIPlan(config, injected), /format/);
});

function stream(events: unknown[], finish = true) {
  const text =
    events.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join('') +
    (finish ? 'data: [DONE]\r\n\r\n' : '');
  // Split UTF-8 and event delimiters across chunks like a real network stream.
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7)
          controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'x-request-id': 'request-test',
      },
    },
  );
}
test('streaming requires completed inference and surfaces late plan-limit failures instead of accepting partial output', async () => {
  const delta = {
    type: 'response.output_text.delta',
    delta: '{"name":"café"}',
  };
  assert.deepEqual(
    await readAIStream(
      stream([
        delta,
        { type: 'response.completed', response: { status: 'completed' } },
      ]),
    ),
    { name: 'café' },
  );
  await assert.rejects(readAIStream(stream([delta])), /did not finish/);
  await assert.rejects(
    readAIStream(
      stream([
        delta,
        {
          type: 'response.failed',
          response: {
            error: { code: 'subscription_sharing_usage_limit_exceeded' },
          },
        },
      ]),
    ),
    (error: unknown) =>
      error instanceof ChatGPTError &&
      error.status === 429 &&
      error.code === 'subscription_sharing_usage_limit_exceeded' &&
      error.requestId === 'request-test',
  );
  await assert.rejects(
    readAIStream(stream([{ type: 'response.incomplete' }])),
    /before completing/,
  );
});

test('connections isolate users, encrypt credentials, serialize rotating refreshes, revoke sessions, and keep inference previews unsaved', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'directory-ai-'));
  const previousData = process.env.DATA_DIR,
    previousFetch = globalThis.fetch;
  let permissionRemoved = false,
    transientRefresh = false;
  let renewals = 0,
    revoke = true,
    terminalRefresh = false,
    inference = false;
  const config = structuredClone(defaultConfig);
  config.customCss = 'private-css';
  config.boards[0].services[0].url =
    'https://admin:urlpassword-secret@example.test/path?token=query-secret#fragment-secret';
  config.boards[0].notes = 'private-notes';
  globalThis.fetch = (async (url, init) => {
    const address = String(url);
    if (address.endsWith('/oauth/token')) {
      const body = new URLSearchParams(init?.body as URLSearchParams);
      assert.equal(body.get('grant_type'), 'refresh_token');
      assert.equal(body.get('resource'), RESOURCE);
      renewals++;
      if (transientRefresh)
        return json(
          { error: { code: 'subscription_sharing_usage_unavailable' } },
          503,
        );
      if (terminalRefresh) return json({ error: 'invalid_grant' }, 400);
      return json({
        ...credentials(
          body.get('client_id')!,
          'account-a',
          3600,
          permissionRemoved ? 'openid profile email' : directScopes,
        ),
        refresh_token: 'rotated-private-token',
      });
    }
    if (address === `${ISSUER}/revoke`)
      return new Response(null, { status: revoke ? 200 : 503 });
    if (address === `${RESOURCE}/models`)
      return json({
        models: [
          {
            slug: 'test-model',
            display_name: 'Test Model',
            visibility: 'list',
          },
        ],
      });
    if (address === `${RESOURCE}/responses`) {
      inference = true;
      const body = JSON.parse(init?.body as string);
      assert.equal(body.store, false);
      assert.equal(body.stream, true);
      assert.equal(body.model, 'test-model');
      assert.ok(body.instructions);
      assert.ok(!JSON.stringify(body.input).includes('private-notes'));
      assert.ok(!JSON.stringify(body.input).includes('private-css'));
      assert.ok(!JSON.stringify(body.input).includes('private-refresh-token'));
      for (const secret of [
        'urlpassword-secret',
        'query-secret',
        'fragment-secret',
      ])
        assert.ok(!JSON.stringify(body.input).includes(secret));
      return stream([
        {
          type: 'response.output_text.delta',
          delta: JSON.stringify(planFor(config)),
        },
        { type: 'response.completed', response: { status: 'completed' } },
      ]);
    }
    return identityFetch(url);
  }) as typeof fetch;
  process.env.DATA_DIR = directory;
  try {
    const userA = await importConnection(
      'user-a',
      credentials('oaiapp_a', 'account-a', 30),
    );
    const accountA = userA.accounts[0].id;
    assert.deepEqual(await connectionStatus('user-b'), { accounts: [] });
    await assert.rejects(selectConnection('user-b', accountA), /Connect/);
    const tokens = await Promise.all([
      activeCredentials('user-a'),
      activeCredentials('user-a'),
    ]);
    assert.equal(renewals, 1);
    assert.equal(tokens[0].refresh_token, 'rotated-private-token');
    const disk = await readFile(join(directory, 'ai-connections.json'), 'utf8');
    assert.ok(!disk.includes('rotated-private-token'));
    assert.ok(!disk.includes(tokens[0].access_token));
    assert.ok(
      !JSON.stringify(await connectionStatus('user-a')).includes(
        'refresh_token',
      ),
    );
    const proposal = await proposeDashboard(
      'user-a',
      'test-model',
      'Organize services',
      config,
    );
    assert.ok(inference);
    assert.equal(proposal.boards[0].services[0].group, 'Organized');
    await assert.rejects(readFile(join(directory, 'dashboard.json')), {
      code: 'ENOENT',
    });
    await assert.rejects(
      proposeDashboard('user-a', 'unknown-model', 'Arrange', config),
      /available/,
    );
    assert.equal(
      (await disconnectConnection('user-a', accountA)).revocationConfirmed,
      true,
    );
    await assert.rejects(activeCredentials('user-a'), /Connect/);
    await importConnection('user-a', credentials('oaiapp_a', 'account-a', 30));
    terminalRefresh = true;
    await assert.rejects(activeCredentials('user-a'), /expired/);
    assert.equal(
      (await connectionStatus('user-a')).accounts[0].connected,
      false,
    );
    await importConnection('user-a', credentials('oaiapp_a', 'account-a', 30));
    transientRefresh = true;
    await assert.rejects(activeCredentials('user-a'), /temporarily/);
    assert.equal(
      (await connectionStatus('user-a')).accounts[0].connected,
      true,
    );
    transientRefresh = false;
    terminalRefresh = false;
    permissionRemoved = true;
    await assert.rejects(activeCredentials('user-a'), /permission was removed/);
    assert.equal(
      (await connectionStatus('user-a')).accounts[0].connected,
      true,
    );
    assert.equal(
      (await connectionStatus('user-a')).accounts[0].planEnabled,
      false,
    );
    permissionRemoved = false;
    await importConnection('user-a', credentials());
    revoke = false;
    assert.equal(
      (await disconnectConnection('user-a', accountA)).revocationConfirmed,
      false,
    );
    const noPermission = await importConnection(
      'user-b',
      credentials('oaiapp_b', 'account-b', 3600, 'openid profile email'),
    );
    assert.equal(noPermission.accounts[0].planEnabled, false);
    await assert.rejects(activeCredentials('user-b'), /permission/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousData === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousData;
    await rm(directory, { recursive: true, force: true });
  }
});
