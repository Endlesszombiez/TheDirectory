import {
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';

export const SESSION_COOKIE = 'directory_session';
export const SESSION_SECONDS = 12 * 60 * 60;
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_.-]{2,39}$/);
export const passwordSchema = z.string().min(12).max(128);
const userSchema = z.object({
  id: z.string(),
  username: usernameSchema,
  role: z.enum(['admin', 'viewer']),
  passwordHash: z.string(),
  createdAt: z.string(),
});
const databaseSchema = z.object({
  version: z.literal(1),
  users: z.array(userSchema).max(100),
  sessions: z.array(
    z.object({
      digest: z.string(),
      userId: z.string(),
      expiresAt: z.number(),
      createdAt: z.number(),
    }),
  ),
});
type User = z.infer<typeof userSchema>;
type Database = z.infer<typeof databaseSchema>;
export type PublicUser = Pick<User, 'id' | 'username' | 'role' | 'createdAt'>;
export class AuthError extends Error {}
const publicUser = ({ passwordHash: _, ...user }: User): PublicUser => user;
const directory = () => resolve(process.env.DATA_DIR || './data');
let queue: Promise<unknown> = Promise.resolve();
const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, 64, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
export async function hashPassword(password: string) {
  passwordSchema.parse(password);
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, hash: string) {
  const [algorithm, salt, expected] = hash.split(':');
  if (
    algorithm !== 'scrypt' ||
    !/^[0-9a-f]{32}$/.test(salt || '') ||
    !/^[0-9a-f]{128}$/.test(expected || '') ||
    password.length > 128
  )
    return false;
  return timingSafeEqual(
    await derive(password, salt),
    Buffer.from(expected, 'hex'),
  );
}
const digest = (token: string) =>
  createHash('sha256').update(token).digest('hex');
async function readDatabase(): Promise<Database> {
  try {
    return databaseSchema.parse(
      JSON.parse(await readFile(join(directory(), 'auth.json'), 'utf8')),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { version: 1, users: [], sessions: [] };
    throw error;
  }
}
async function writeDatabase(database: Database) {
  await mkdir(directory(), { recursive: true });
  const path = join(directory(), `auth.${randomUUID()}.tmp`);
  await writeFile(
    path,
    JSON.stringify(databaseSchema.parse(database), null, 2).replace(
      /\n/g,
      '\r\n',
    ) + '\r\n',
    { mode: 0o600 },
  );
  await rename(path, join(directory(), 'auth.json'));
}
function mutate<T>(work: (database: Database) => Promise<T> | T): Promise<T> {
  const task = queue.then(async () => {
    const database = await readDatabase();
    database.sessions = database.sessions.filter(
      (s) => s.expiresAt > Date.now(),
    );
    const result = await work(database);
    await writeDatabase(database);
    return result;
  });
  queue = task.catch(() => {});
  return task;
}
export async function ensureBootstrap(): Promise<boolean> {
  if ((await readDatabase()).users.length) return true;
  const username = usernameSchema.safeParse(process.env.DASHBOARD_USERNAME);
  const password = passwordSchema.safeParse(process.env.DASHBOARD_PASSWORD);
  if (!username.success || !password.success) return false;
  await mutate(async (database) => {
    if (!database.users.length)
      database.users.push({
        id: randomUUID(),
        username: username.data,
        passwordHash: await hashPassword(password.data),
        role: 'admin',
        createdAt: new Date().toISOString(),
      });
  });
  return true;
}
export async function sessionUser(token?: string): Promise<PublicUser | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const database = await readDatabase();
  const session = database.sessions.find(
    (s) => s.digest === digest(token) && s.expiresAt > Date.now(),
  );
  const user = session && database.users.find((u) => u.id === session.userId);
  return user ? publicUser(user) : null;
}
const attempts = new Map<string, { count: number; until: number }>();
let globalAttempts = { count: 0, until: 0 };
export class RateLimitError extends AuthError {}
function consumeAttempt(username: string) {
  const now = Date.now();
  if (globalAttempts.until < now)
    globalAttempts = { count: 0, until: now + 15 * 60_000 };
  const entry = attempts.get(username);
  const current =
    entry && entry.until > now ? entry : { count: 0, until: now + 15 * 60_000 };
  if (current.count >= 15 || globalAttempts.count >= 100)
    throw new RateLimitError('Too many attempts. Try again in 15 minutes.');
  current.count++;
  globalAttempts.count++;
  attempts.set(username, current);
  if (attempts.size > 2000)
    for (const [key, value] of attempts)
      if (value.until < now) attempts.delete(key);
}
let dummy: Promise<string> | undefined;
export async function login(username: string, password: string) {
  const normalized = username.toLowerCase().trim().slice(0, 40);
  consumeAttempt(normalized);
  const database = await readDatabase();
  const user = database.users.find((u) => u.username === normalized);
  dummy ||= hashPassword(randomBytes(32).toString('hex'));
  const valid = await verifyPassword(
    password,
    user?.passwordHash || (await dummy),
  );
  if (!user || !valid) throw new AuthError('Invalid username or password.');
  const token = randomBytes(32).toString('hex');
  await mutate((database) => {
    const current = database.users.find((u) => u.id === user.id);
    if (!current || current.passwordHash !== user.passwordHash)
      throw new AuthError('Invalid username or password.');
    const sessions = database.sessions
      .filter((s) => s.userId === user.id)
      .sort((a, b) => b.createdAt - a.createdAt);
    const keep = new Set(sessions.slice(0, 9).map((s) => s.digest));
    database.sessions = database.sessions.filter(
      (s) => s.userId !== user.id || keep.has(s.digest),
    );
    database.sessions.push({
      digest: digest(token),
      userId: user.id,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_SECONDS * 1000,
    });
  });
  attempts.delete(normalized);
  return token;
}
export async function logout(token?: string) {
  if (!token) return;
  await mutate((database) => {
    database.sessions = database.sessions.filter(
      (s) => s.digest !== digest(token),
    );
  });
}
export async function listUsers(): Promise<PublicUser[]> {
  return (await readDatabase()).users.map(publicUser);
}
export async function createUser(
  actorId: string,
  username: string,
  password: string,
  role: string,
) {
  const normalized = usernameSchema.safeParse(username);
  if (!normalized.success)
    throw new AuthError(
      'Username must be 3–40 lowercase letters, numbers, dots, dashes, or underscores.',
    );
  if (!passwordSchema.safeParse(password).success)
    throw new AuthError('Password must be 12–128 characters.');
  if (role !== 'admin' && role !== 'viewer')
    throw new AuthError('Invalid role.');
  const passwordHash = await hashPassword(password);
  return mutate((database) => {
    if (database.users.find((u) => u.id === actorId)?.role !== 'admin')
      throw new AuthError('Administrator access required.');
    if (database.users.length >= 100)
      throw new AuthError('Account limit reached.');
    if (database.users.some((u) => u.username === normalized.data))
      throw new AuthError('Username already exists.');
    const user: User = {
      id: randomUUID(),
      username: normalized.data,
      passwordHash,
      role,
      createdAt: new Date().toISOString(),
    };
    database.users.push(user);
    return publicUser(user);
  });
}
export async function manageUser(
  actorId: string,
  userId: string,
  action: string,
  value: string,
) {
  const passwordHash =
    action === 'password'
      ? await hashPassword(passwordSchema.parse(value))
      : undefined;
  return mutate((database) => {
    const actor = database.users.find((u) => u.id === actorId);
    if (actor?.role !== 'admin')
      throw new AuthError('Administrator access required.');
    const user = database.users.find((u) => u.id === userId);
    if (!user) throw new AuthError('Account not found.');
    if (action === 'delete' || (action === 'role' && value !== 'admin')) {
      if (actorId === userId)
        throw new AuthError(
          'Use another administrator to change or delete your own administrator account.',
        );
      if (
        user.role === 'admin' &&
        database.users.filter((u) => u.role === 'admin').length === 1
      )
        throw new AuthError('Keep at least one administrator.');
    }
    if (action === 'role') {
      if (value !== 'viewer' && value !== 'admin')
        throw new AuthError('Invalid role.');
      user.role = value;
    } else if (action === 'delete')
      database.users = database.users.filter((u) => u.id !== userId);
    else if (action === 'password') user.passwordHash = passwordHash!;
    else if (action !== 'revoke') throw new AuthError('Invalid action.');
    database.sessions = database.sessions.filter((s) => s.userId !== userId);
  });
}
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
) {
  consumeAttempt(`password:${userId}`);
  const user = (await readDatabase()).users.find((u) => u.id === userId);
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash)))
    throw new AuthError('Current password is incorrect.');
  if (!passwordSchema.safeParse(newPassword).success)
    throw new AuthError('Password must be 12–128 characters.');
  const passwordHash = await hashPassword(newPassword);
  await mutate((database) => {
    const current = database.users.find((u) => u.id === userId);
    if (!current || current.passwordHash !== user.passwordHash)
      throw new AuthError('Account changed. Please sign in again.');
    current.passwordHash = passwordHash;
    database.sessions = database.sessions.filter((s) => s.userId !== userId);
  });
}
