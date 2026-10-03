import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { AIError, apiModels } from './ai-provider';

const accountSchema = z.object({
  id: z.string(),
  label: z.string().min(1).max(80),
  apiKey: z.string(),
});
const databaseSchema = z.object({
  version: z.literal(2),
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
    const value = JSON.parse(plain.toString('utf8'));
    // OAuth registrations cannot authenticate API-key requests.
    if (value.version === 1) return { version: 2, users: {} };
    return databaseSchema.parse(value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { version: 2, users: {} };
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
      label: a.label,
      active: a.id === user?.activeId,
      connected: true,
    })),
  };
}
export async function importConnection(userId: string, value: unknown) {
  const parsed = z
    .object({
      apiKey: z
        .string()
        .trim()
        .min(20)
        .max(512)
        .regex(/^sk-[A-Za-z0-9_-]+$/),
      label: z.string().trim().min(1).max(80),
    })
    .strict()
    .safeParse(value);
  if (!parsed.success)
    throw new AIError(
      'Enter a valid OpenAI API key and a label (up to 80 characters).',
      400,
    );
  await apiModels(parsed.data.apiKey);
  await mutate((database) => {
    const user = (database.users[userId] ||= { activeId: null, accounts: [] });
    let account = user.accounts.find((a) => a.apiKey === parsed.data.apiKey);
    if (!account) {
      if (user.accounts.length >= 10)
        throw new AIError(
          'You can save at most 10 API keys. Remove a key first.',
          400,
        );
      account = { id: randomUUID(), ...parsed.data };
      user.accounts.push(account);
    } else account.label = parsed.data.label;
    user.activeId = account.id;
  });
  return connectionStatus(userId);
}
export async function selectConnection(userId: string, accountId: string) {
  await mutate((database) => {
    const user = database.users[userId];
    if (!user?.accounts.some((a) => a.id === accountId))
      throw new AIError('API key not found.', 404);
    user.activeId = accountId;
  });
  return connectionStatus(userId);
}
export async function disconnectConnection(userId: string, accountId: string) {
  await mutate((database) => {
    const user = database.users[userId];
    if (!user?.accounts.some((a) => a.id === accountId))
      throw new AIError('API key not found.', 404);
    user.accounts = user.accounts.filter((a) => a.id !== accountId);
    if (user.activeId === accountId) user.activeId = null;
  });
  return connectionStatus(userId);
}
export async function activeCredentials(userId: string) {
  await queue;
  const database = await readDatabase();
  const user = database.users[userId];
  const account = user?.accounts.find((a) => a.id === user.activeId);
  if (!account)
    throw new AIError('Add an OpenAI API key in AI settings first.', 400);
  return { apiKey: account.apiKey };
}
export type AIConnectionStatus = Awaited<ReturnType<typeof connectionStatus>>;
