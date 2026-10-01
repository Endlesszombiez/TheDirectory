import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  hashPassword,
  verifyPassword,
  ensureBootstrap,
  login,
  sessionUser,
  listUsers,
} from '../src/lib/auth';

test('password hashes use distinct salts and verify the correct password only', async () => {
  const first = await hashPassword('a-long-test-password');
  const second = await hashPassword('a-long-test-password');
  assert.notEqual(first, second);
  assert.ok(await verifyPassword('a-long-test-password', first));
  assert.equal(await verifyPassword('incorrect', first), false);
  assert.equal(await verifyPassword('a-long-test-password', 'corrupt'), false);
  await assert.rejects(hashPassword('short'));
});

test('session storage contains hashes only and expired or invented sessions are rejected', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'directory-auth-'));
  const previous = {
    DATA_DIR: process.env.DATA_DIR,
    DASHBOARD_USERNAME: process.env.DASHBOARD_USERNAME,
    DASHBOARD_PASSWORD: process.env.DASHBOARD_PASSWORD,
  };
  Object.assign(process.env, {
    DATA_DIR: directory,
    DASHBOARD_USERNAME: 'admin',
    DASHBOARD_PASSWORD: 'a-long-admin-password',
  });
  try {
    assert.equal(await ensureBootstrap(), true);
    const token = await login('admin', 'a-long-admin-password');
    assert.equal((await sessionUser(token))?.role, 'admin');
    assert.equal(await sessionUser('0'.repeat(64)), null);
    const raw = await readFile(join(directory, 'auth.json'), 'utf8');
    assert.ok(!raw.includes(token));
    assert.ok(!raw.includes('a-long-admin-password'));
    assert.ok(!('passwordHash' in (await listUsers())[0]));
    const database = JSON.parse(raw);
    database.sessions[0].expiresAt = Date.now() - 1;
    await writeFile(join(directory, 'auth.json'), JSON.stringify(database));
    assert.equal(await sessionUser(token), null);
    const recovery = await promisify(execFile)(
      process.execPath,
      ['scripts/reset-admin.mjs'],
      {
        env: { ...process.env, DASHBOARD_PASSWORD: 'recovered-admin-password' },
      },
    );
    assert.match(recovery.stdout, /sessions revoked/i);
    const recovered = await login('admin', 'recovered-admin-password');
    assert.equal((await sessionUser(recovered))?.username, 'admin');
    const tokens = [recovered];
    for (let i = 0; i < 10; i++)
      tokens.push(await login('admin', 'recovered-admin-password'));
    assert.equal(await sessionUser(tokens[0]), null);
    assert.ok(await sessionUser(tokens.at(-1)));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
