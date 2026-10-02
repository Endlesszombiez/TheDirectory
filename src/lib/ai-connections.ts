import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  ChatGPTError,
  refreshCredentials,
  revokeCredentials,
  validateCredentials,
} from '../../scripts/connect-chatgpt.mjs';

const credentialSchema = z.object({
  client_id: z.string(),
  subject: z.string(),
  email: z.string(),
  issuer: z.string(),
  id_token: z.string(),
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.string(),
  scopes: z.array(z.string()),
  expires_at: z.number(),
  saved_at: z.string(),
});
const accountSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  subject: z.string(),
  email: z.string(),
  credentials: credentialSchema.nullable(),
});
const databaseSchema = z.object({
  version: z.literal(1),
  hostId: z.string(),
  users: z.record(
    z.string(),
    z.object({
      activeId: z.string().nullable(),
      accounts: z.array(accountSchema).max(10),
    }),
  ),
});
type ConnectionDatabase = z.infer<typeof databaseSchema>;
const directory = () => resolve(process.env.DATA_DIR || './data');
let queue: Promise<unknown> = Promise.resolve();
async function encryptionKey() {
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  const path = join(directory(), 'ai.key');
  try {
    await writeFile(path, randomBytes(32), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const key = await readFile(path);
  if (key.length !== 32) throw new Error('Invalid AI storage key');
  return key;
}
async function readDatabase(): Promise<ConnectionDatabase> {
  try {
    const encrypted = JSON.parse(
      await readFile(join(directory(), 'ai-connections.json'), 'utf8'),
    );
    const decipher = createDecipheriv(
      'aes-256-gcm',
      await encryptionKey(),
      Buffer.from(encrypted.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(encrypted.data, 'base64')),
      decipher.final(),
    ]);
    return databaseSchema.parse(JSON.parse(plain.toString('utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { version: 1, hostId: `urn:uuid:${randomUUID()}`, users: {} };
    throw error;
  }
}
async function writeDatabase(database: ConnectionDatabase) {
  const key = await encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(databaseSchema.parse(database)), 'utf8'),
    cipher.final(),
  ]);
  const temp = join(directory(), `ai.${randomUUID()}.tmp`);
  await writeFile(
    temp,
    JSON.stringify({
      version: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    }) + '\r\n',
    { mode: 0o600 },
  );
  await rename(temp, join(directory(), 'ai-connections.json'));
}
function mutate<T>(
  work: (database: ConnectionDatabase) => Promise<T> | T,
): Promise<T> {
  const task = queue.then(async () => {
    const database = await readDatabase();
    const result = await work(database);
    await writeDatabase(database);
    return result;
  });
  queue = task.catch(() => {});
  return task;
}
export async function connectionStatus(userId: string) {
  await queue;
  const database = await readDatabase();
  const user = database.users[userId];
  return {
    accounts: (user?.accounts || []).map((a) => ({
      id: a.id,
      email: a.email,
      label: `${a.email || 'ChatGPT account'} · ${a.id.slice(0, 8)}`,
      active: a.id === user?.activeId,
      connected: !!a.credentials,
      planEnabled: !!a.credentials?.scopes.includes(
        'chatgpt.tokens.use.direct',
      ),
    })),
  };
}
export async function importConnection(userId: string, value: unknown) {
  const credentials = await validateCredentials(value);
  await mutate((database) => {
    const user = (database.users[userId] ||= { activeId: null, accounts: [] });
    let account = user.accounts.find(
      (a) =>
        a.clientId === credentials.client_id &&
        a.subject === credentials.subject,
    );
    if (!account) {
      if (user.accounts.length >= 10)
        throw new ChatGPTError(
          'You can save at most 10 ChatGPT connections.',
          400,
        );
      account = {
        id: randomUUID(),
        clientId: credentials.client_id,
        subject: credentials.subject,
        email: credentials.email,
        credentials,
      };
      user.accounts.push(account);
    } else {
      account.credentials = credentials;
      account.email = credentials.email;
    }
    user.activeId = account.id;
  });
  return connectionStatus(userId);
}
export async function selectConnection(userId: string, accountId: string) {
  await mutate((database) => {
    const user = database.users[userId];
    if (!user?.accounts.some((a) => a.id === accountId && a.credentials))
      throw new ChatGPTError(
        'Connect this ChatGPT account again before selecting it.',
        400,
      );
    user.activeId = accountId;
  });
  return connectionStatus(userId);
}
export async function disconnectConnection(userId: string, accountId: string) {
  const confirmed = await mutate(async (database) => {
    const user = database.users[userId];
    const account = user?.accounts.find((a) => a.id === accountId);
    if (!account) throw new ChatGPTError('ChatGPT connection not found.', 404);
    const confirmed =
      !account.credentials || (await revokeCredentials(account.credentials));
    account.credentials = null;
    if (user.activeId === accountId) user.activeId = null;
    return confirmed;
  });
  return {
    ...(await connectionStatus(userId)),
    revocationConfirmed: confirmed,
  };
}
export async function activeCredentials(userId: string) {
  return mutate(async (database) => {
    const user = database.users[userId];
    const account = user?.accounts.find((a) => a.id === user.activeId);
    if (!account?.credentials)
      throw new ChatGPTError(
        'Connect your ChatGPT account in AI settings first.',
        400,
      );
    if (!account.credentials.scopes.includes('chatgpt.tokens.use.direct'))
      throw new ChatGPTError(
        'This connection does not have permission to use your ChatGPT plan. Sign in again and grant plan usage.',
        403,
      );
    if (account.credentials.expires_at <= Date.now() + 60_000) {
      try {
        account.credentials = await refreshCredentials(account.credentials);
      } catch (error) {
        if (
          error instanceof ChatGPTError &&
          [
            'invalid_grant',
            'invalid_refresh_token',
            'token_expired',
            'refresh_token_expired',
            'refresh_token_invalidated',
            'refresh_token_reused',
          ].includes(error.code)
        ) {
          account.credentials = null;
          // Persist terminal invalidation even though the request itself fails.
          await writeDatabase(database);
        }
        throw error;
      }
    }
    if (!account.credentials.scopes.includes('chatgpt.tokens.use.direct')) {
      await writeDatabase(database);
      throw new ChatGPTError(
        'ChatGPT plan permission was removed. Sign in again to enable it.',
        403,
      );
    }
    return structuredClone(account.credentials);
  });
}
export type AIConnectionStatus = Awaited<ReturnType<typeof connectionStatus>>;
