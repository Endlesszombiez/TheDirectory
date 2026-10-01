import { scrypt, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Operator-only recovery. Stop the application before running this command.
try {
  const username = process.env.DASHBOARD_USERNAME?.trim().toLowerCase();
  const password = process.env.DASHBOARD_PASSWORD || '';
  if (!username || password.length < 12 || password.length > 128)
    throw new Error(
      'Set DASHBOARD_USERNAME and a 12–128 character DASHBOARD_PASSWORD.',
    );
  const directory = resolve(process.env.DATA_DIR || './data');
  const path = join(directory, 'auth.json');
  const database = JSON.parse(await readFile(path, 'utf8'));
  const user = database.users.find(
    (u) => u.username === username && u.role === 'admin',
  );
  if (!user)
    throw new Error(
      'An existing administrator with this username was not found.',
    );
  const salt = randomBytes(16).toString('hex');
  const key = await new Promise((resolve, reject) =>
    scrypt(password, salt, 64, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
  user.passwordHash = `scrypt:${salt}:${key.toString('hex')}`;
  database.sessions = database.sessions.filter((s) => s.userId !== user.id);
  const temporary = join(directory, `auth.${randomUUID()}.tmp`);
  await writeFile(
    temporary,
    JSON.stringify(database, null, 2).replace(/\n/g, '\r\n') + '\r\n',
    { mode: 0o600 },
  );
  await rename(temporary, path);
  console.log('Administrator password reset. Existing sessions revoked.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
