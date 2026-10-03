import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createCipheriv, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AIError, RESOURCE } from '../src/lib/ai-provider';
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

const json = (value: unknown, status = 200) => Response.json(value, { status });
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
test('streaming requires completed inference and surfaces late API quota failures instead of accepting partial output', async () => {
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
            error: { code: 'insufficient_quota' },
          },
        },
      ]),
    ),
    (error: unknown) =>
      error instanceof AIError &&
      error.status === 429 &&
      error.code === 'insufficient_quota' &&
      error.requestId === 'request-test',
  );
  await assert.rejects(
    readAIStream(stream([{ type: 'response.incomplete' }])),
    /before completing/,
  );
});

test('API keys isolate users, encrypt secrets, validate before saving, remove locally, and keep inference previews unsaved', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'directory-ai-'));
  const previousData = process.env.DATA_DIR,
    previousFetch = globalThis.fetch;
  const key = 'sk-test-private-key-123456';
  let rejected = false,
    inference = false;
  const config = structuredClone(defaultConfig);
  config.customCss = 'private-css';
  config.boards[0].notes = 'private-notes';
  config.boards[0].services[0].url =
    'https://admin:urlpassword-secret@example.test/path?token=query-secret#fragment-secret';
  globalThis.fetch = (async (url, init) => {
    assert.equal(
      new Headers(init?.headers).get('Authorization'),
      'Bearer ' + key,
    );
    if (String(url) === RESOURCE + '/models') {
      if (rejected)
        return json({ error: { code: 'invalid_api_key', message: key } }, 401);
      return json({
        data: [
          { id: 'gpt-test' },
          { id: 'text-embedding-test' },
          { id: 'gpt-audio-test' },
        ],
      });
    }
    assert.equal(String(url), RESOURCE + '/responses');
    inference = true;
    const body = JSON.parse(init?.body as string);
    assert.equal(body.store, false);
    assert.equal(body.stream, true);
    assert.equal(body.model, 'gpt-test');
    for (const secret of [
      key,
      'private-notes',
      'private-css',
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
  }) as typeof fetch;
  process.env.DATA_DIR = directory;
  try {
    rejected = true;
    await assert.rejects(
      importConnection('user-a', { apiKey: key, label: 'My key' }),
      /rejected/,
    );
    assert.deepEqual(await connectionStatus('user-a'), { accounts: [] });
    rejected = false;
    const status = await importConnection('user-a', {
      apiKey: key,
      label: 'My key',
    });
    const id = status.accounts[0].id;
    assert.equal(status.accounts[0].active, true);
    assert.ok(!JSON.stringify(status).includes(key));
    assert.ok(
      !(
        await readFile(join(directory, 'ai-connections.json'), 'utf8')
      ).includes(key),
    );
    assert.deepEqual(await connectionStatus('user-b'), { accounts: [] });
    await assert.rejects(selectConnection('user-b', id), /not found/);
    await assert.rejects(disconnectConnection('user-b', id), /not found/);
    await assert.rejects(activeCredentials('user-b'), /Add an OpenAI API key/);
    assert.deepEqual(await activeCredentials('user-a'), { apiKey: key });
    const proposal = await proposeDashboard(
      'user-a',
      'gpt-test',
      'Organize',
      config,
    );
    assert.ok(inference);
    assert.equal(proposal.boards[0].services[0].group, 'Organized');
    await assert.rejects(readFile(join(directory, 'dashboard.json')), {
      code: 'ENOENT',
    });
    await assert.rejects(
      proposeDashboard('user-a', 'text-embedding-test', 'Organize', config),
      /available/,
    );
    await importConnection('user-a', { apiKey: key, label: 'Renamed' });
    assert.equal((await connectionStatus('user-a')).accounts.length, 1);
    assert.equal(
      (await connectionStatus('user-a')).accounts[0].label,
      'Renamed',
    );
    await disconnectConnection('user-a', id);
    assert.deepEqual(await connectionStatus('user-a'), { accounts: [] });
    await assert.rejects(activeCredentials('user-a'), /Add an OpenAI API key/);
    // Upgrades must ignore OAuth tokens and accept new API keys.
    const storageKey = await readFile(join(directory, 'ai.key'));
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', storageKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(
        JSON.stringify({
          version: 1,
          hostId: 'old-host',
          users: {
            'user-a': {
              activeId: 'legacy',
              accounts: [{ credentials: { access_token: 'legacy-secret' } }],
            },
          },
        }),
      ),
      cipher.final(),
    ]);
    await writeFile(
      join(directory, 'ai-connections.json'),
      JSON.stringify({
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: encrypted.toString('base64'),
      }),
    );
    assert.deepEqual(await connectionStatus('user-a'), { accounts: [] });
    await importConnection('user-a', { apiKey: key, label: 'After upgrade' });
    assert.deepEqual(await activeCredentials('user-a'), { apiKey: key });
    assert.deepEqual(await readFile(join(directory, 'ai.key')), storageKey);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousData === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousData;
    await rm(directory, { recursive: true, force: true });
  }
});
