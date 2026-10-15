import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';

export class IntegrationError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const uplinkValuesSchema = z
  .record(
    z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-zA-Z0-9 _.-]+$/),
    z.union([z.string().max(200), z.number(), z.boolean(), z.null()]),
  )
  .refine(
    (v) => Object.keys(v).length >= 1 && Object.keys(v).length <= 12,
    'Send 1–12 values.',
  );
const uplinkSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(60),
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  staleAfter: z.number().int().min(60).max(86400),
  receivedAt: z.string().nullable(),
  values: uplinkValuesSchema.nullable(),
});
const databaseSchema = z.object({
  version: z.literal(1),
  renderKey: z.string().nullable(),
  uplinks: z.array(uplinkSchema).max(20),
});
type Database = z.infer<typeof databaseSchema>;
const directory = () => resolve(process.env.DATA_DIR || './data');
let queue: Promise<unknown> = Promise.resolve();
async function encryptionKey() {
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  const path = join(directory(), 'integrations.key');
  try {
    await writeFile(path, randomBytes(32), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const key = await readFile(path);
  if (key.length !== 32) throw new Error('Invalid integration storage key');
  return key;
}
async function readDatabase(): Promise<Database> {
  try {
    const encrypted = JSON.parse(
      await readFile(join(directory(), 'integrations.json'), 'utf8'),
    );
    const decipher = createDecipheriv(
      'aes-256-gcm',
      await encryptionKey(),
      Buffer.from(encrypted.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
    return databaseSchema.parse(
      JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(encrypted.data, 'base64')),
          decipher.final(),
        ]).toString('utf8'),
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { version: 1, renderKey: null, uplinks: [] };
    throw error;
  }
}
function mutate<T>(change: (database: Database) => T): Promise<T> {
  const task = queue.then(async () => {
    const database = await readDatabase();
    const result = change(database);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', await encryptionKey(), iv);
    const data = Buffer.concat([
      cipher.update(JSON.stringify(databaseSchema.parse(database)), 'utf8'),
      cipher.final(),
    ]);
    const temp = join(directory(), `integrations.${randomUUID()}.tmp`);
    await writeFile(
      temp,
      JSON.stringify({
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64'),
      }) + '\r\n',
      { mode: 0o600 },
    );
    await rename(temp, join(directory(), 'integrations.json'));
    return result;
  });
  queue = task.catch(() => {});
  return task;
}
export const renderKey = async () => (await readDatabase()).renderKey;
export const setRenderKey = (key: string | null) =>
  mutate((database) => {
    database.renderKey = key;
  });
export async function integrationStatus() {
  const database = await readDatabase();
  return {
    renderConnected: !!database.renderKey,
    uplinks: database.uplinks.map(({ tokenHash: _, ...uplink }) => ({
      ...uplink,
      stale:
        !uplink.receivedAt ||
        Date.now() - Date.parse(uplink.receivedAt) > uplink.staleAfter * 1000,
    })),
  };
}
export type IntegrationStatus = Awaited<ReturnType<typeof integrationStatus>>;
export function createUplink(input: unknown) {
  const settings = uplinkSchema
    .pick({ name: true, staleAfter: true })
    .parse(input);
  const token = randomBytes(32).toString('base64url');
  return mutate((database) => {
    if (database.uplinks.length >= 20)
      throw new IntegrationError('Maximum of 20 uplinks reached.');
    const id = randomUUID();
    database.uplinks.push({
      ...settings,
      id,
      tokenHash: hash(token),
      receivedAt: null,
      values: null,
    });
    return { id, token };
  });
}
export function revokeUplink(id: string) {
  return mutate((database) => {
    database.uplinks = database.uplinks.filter((u) => u.id !== id);
  });
}
const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
function findUplink(database: Database, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new IntegrationError('Invalid uplink token.', 401);
  const digest = Buffer.from(hash(token), 'hex');
  const uplink = database.uplinks.find((u) =>
    timingSafeEqual(Buffer.from(u.tokenHash, 'hex'), digest),
  );
  if (!uplink) throw new IntegrationError('Invalid uplink token.', 401);
  return uplink;
}
export async function authorizeUplink(token: string) {
  findUplink(await readDatabase(), token);
}
export function receiveUplink(token: string, input: unknown) {
  const values = uplinkValuesSchema.parse(input);
  return mutate((database) => {
    const uplink = findUplink(database, token);
    if (uplink.receivedAt && Date.now() - Date.parse(uplink.receivedAt) < 5000)
      throw new IntegrationError(
        'Send updates at most once every five seconds.',
        429,
      );
    uplink.values = values;
    uplink.receivedAt = new Date().toISOString();
  });
}
