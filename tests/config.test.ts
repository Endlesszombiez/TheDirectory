import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from '../src/lib/defaults';
import { configSchema } from '../src/lib/schema';
import { ConflictError, readConfig, saveConfig } from '../src/lib/store';

test('configuration rejects unsafe links, duplicate IDs, and invalid layouts', () => {
  const withUrl = (url: string) => {
    const c = structuredClone(defaultConfig);
    c.boards[0].services[0].url = url;
    return c;
  };
  assert.equal(
    configSchema.safeParse(withUrl('javascript:alert(1)')).success,
    false,
  );
  assert.equal(
    configSchema.safeParse(withUrl('file:///etc/passwd')).success,
    false,
  );
  assert.equal(
    configSchema.safeParse(withUrl('http://192.168.1.20:8096')).success,
    true,
  );
  const duplicates = structuredClone(defaultConfig);
  duplicates.boards.push(structuredClone(duplicates.boards[0]));
  assert.equal(configSchema.safeParse(duplicates).success, false);
  assert.equal(
    configSchema.safeParse({ ...defaultConfig, columns: 10 }).success,
    false,
  );
});

test('persists configuration atomically and prevents concurrent lost updates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'directory-test-'));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = directory;
  try {
    assert.deepEqual(await readConfig(), defaultConfig);
    const next = { ...structuredClone(defaultConfig), title: 'My test lab' };
    const results = await Promise.allSettled([
      saveConfig(next),
      saveConfig(next),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const rejected = results.find((r) => r.status === 'rejected');
    assert.ok(
      rejected &&
        rejected.status === 'rejected' &&
        rejected.reason instanceof ConflictError,
    );
    const saved = await readConfig();
    assert.equal(saved.title, 'My test lab');
    assert.equal(saved.revision, 1);
    const raw = await readFile(join(directory, 'dashboard.json'), 'utf8');
    assert.equal(JSON.parse(raw).revision, 1);
    await saveConfig({ ...saved, theme: 'light' });
    assert.equal((await readConfig()).revision, 2);
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
