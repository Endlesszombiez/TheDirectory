import { createHash, randomBytes } from 'node:crypto';
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  lstat,
  readdir,
  open,
  rm,
  link,
  unlink,
} from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { z } from 'zod';
import { hashPassword, verifyPassword } from './auth';

export class FilesError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const FILES_COOKIE = 'directory_files';
const settingsSchema = z.object({
  pinHash: z.string().default(''),
  maxFileMB: z.number().int().min(1).max(102400).default(1024),
  allowedExtensions: z.string().max(1000).default(''),
  autoUpload: z.boolean().default(false),
  showFileList: z.boolean().default(true),
});
export type FileSettings = z.infer<typeof settingsSchema>;
const dataDir = () => resolve(process.env.DATA_DIR || './data');
const root = () => join(dataDir(), 'files');
const sessions = new Map<string, { fingerprint: string; until: number }>();
let attempts = { count: 0, until: 0 };
let queue: Promise<unknown> = Promise.resolve();
function mutate<T>(work: () => Promise<T>): Promise<T> {
  const task = queue.then(work);
  queue = task.catch(() => {});
  return task;
}
export async function fileSettings(): Promise<FileSettings> {
  try {
    return settingsSchema.parse(
      JSON.parse(
        await readFile(join(dataDir(), 'files-settings.json'), 'utf8'),
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const pin = process.env.FILES_PIN || '';
  if (pin && (pin.length < 4 || pin.length > 128))
    throw new FilesError('FILES_PIN must contain 4–128 characters.', 503);
  // Cache the expensive environment PIN derivation without persisting the plaintext.
  if (pin !== envPin) {
    envPin = pin;
    envHash = pin ? hashPassword(pinSecret(pin)) : Promise.resolve('');
  }
  return settingsSchema.parse({ pinHash: await envHash });
}
let envPin: string | undefined;
let envHash: Promise<string> = Promise.resolve('');
const pinSecret = (pin: string) =>
  createHash('sha256').update(`directory-files:${pin}`).digest('hex');
const fingerprint = (settings: FileSettings) =>
  createHash('sha256').update(settings.pinHash).digest('hex');
export async function saveFileSettings(input: unknown) {
  const parsed = settingsSchema
    .omit({ pinHash: true })
    .extend({ pin: z.string().min(4).max(128).optional() })
    .parse(input);
  return mutate(async () => {
    const current = await fileSettings();
    const { pin, ...rest } = parsed;
    const saved = {
      ...rest,
      pinHash: pin ? await hashPassword(pinSecret(pin)) : current.pinHash,
    };
    if (!saved.pinHash)
      throw new FilesError(
        'Set a PIN or password to enable guest file access.',
      );
    await mkdir(dataDir(), { recursive: true });
    const temp = join(
      dataDir(),
      `files-settings.${randomBytes(16).toString('hex')}.tmp`,
    );
    await writeFile(
      temp,
      JSON.stringify(saved, null, 2).replace(/\n/g, '\r\n') + '\r\n',
      { mode: 0o600 },
    );
    await rename(temp, join(dataDir(), 'files-settings.json'));
    return saved;
  });
}
export function filesUnlocked(
  token: string | undefined,
  settings: FileSettings,
) {
  if (!token || !settings.pinHash) return false;
  const session = sessions.get(token);
  return (
    !!session &&
    session.until > Date.now() &&
    session.fingerprint === fingerprint(settings)
  );
}
export async function unlockFiles(pin: string, settings: FileSettings) {
  const now = Date.now();
  if (attempts.until <= now) attempts = { count: 0, until: now + 15 * 60_000 };
  if (attempts.count >= 30)
    throw new FilesError(
      'Too many PIN attempts. Try again in 15 minutes.',
      429,
    );
  attempts.count++;
  if (
    !settings.pinHash ||
    pin.length < 4 ||
    pin.length > 128 ||
    !(await verifyPassword(pinSecret(pin), settings.pinHash))
  )
    throw new FilesError('Incorrect PIN or password.', 401);
  for (const [key, value] of sessions)
    if (value.until <= now) sessions.delete(key);
  if (sessions.size >= 10000)
    throw new FilesError(
      'Too many active file sessions. Try again later.',
      503,
    );
  const token = randomBytes(32).toString('hex');
  sessions.set(token, {
    fingerprint: fingerprint(settings),
    until: now + 12 * 60 * 60_000,
  });
  return token;
}
export function lockFiles(token?: string) {
  if (token) sessions.delete(token);
}
export function validateFilePath(path: string) {
  const parts = path.split('/');
  if (
    !path ||
    path.length > 1000 ||
    parts.length > 32 ||
    parts.some(
      (p) =>
        !p ||
        p === '.' ||
        p === '..' ||
        /[\\<>:"|?*\x00-\x1f\x7f]/.test(p) ||
        /[. ]$/.test(p) ||
        p.length > 200 ||
        /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p),
    )
  )
    throw new FilesError('Invalid file or folder path.');
  return parts;
}
async function safePath(path: string, createParents = false) {
  const parts = validateFilePath(path);
  await mkdir(root(), { recursive: true, mode: 0o700 });
  if ((await lstat(root())).isSymbolicLink())
    throw new FilesError('Linked storage is not supported.', 403);
  let current = root();
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    if (createParents && i < parts.length - 1)
      await mkdir(current, { mode: 0o700 }).catch((error) => {
        if (error.code !== 'EEXIST') throw error;
      });
    try {
      const stat = await lstat(current);
      if (
        stat.isSymbolicLink() ||
        (i < parts.length - 1 && !stat.isDirectory())
      )
        throw new FilesError('Invalid storage path.', 403);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return current;
}
export type StoredFile = {
  path: string;
  size: number;
  directory: boolean;
  modified: string;
};
export async function listFiles() {
  await mkdir(root(), { recursive: true, mode: 0o700 });
  if ((await lstat(root())).isSymbolicLink())
    throw new FilesError('Linked storage is not supported.', 403);
  const entries: StoredFile[] = [];
  let totalBytes = 0,
    totalFiles = 0;
  async function walk(base: string) {
    for (const entry of await readdir(join(root(), base), {
      withFileTypes: true,
    })) {
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()))
        continue;
      const path = base ? `${base}/${entry.name}` : entry.name;
      const stat = await lstat(join(root(), path));
      if (stat.isSymbolicLink()) continue;
      if (entries.length >= 10000)
        throw new FilesError('File listing exceeds 10,000 entries.', 503);
      entries.push({
        path,
        size: stat.size,
        directory: stat.isDirectory(),
        modified: stat.mtime.toISOString(),
      });
      if (stat.isDirectory()) await walk(path);
      else {
        totalBytes += stat.size;
        totalFiles++;
      }
    }
  }
  await walk('');
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { entries, totalBytes, totalFiles };
}
export async function uploadFile(
  request: Request,
  path: string,
  settings: FileSettings,
) {
  validateFilePath(path);
  const allowed = settings.allowedExtensions
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length && !allowed.includes(extname(path).toLowerCase()))
    throw new FilesError('This file type is not allowed.', 415);
  const limit = settings.maxFileMB * 1024 * 1024;
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > limit)
    throw new FilesError('File exceeds the upload size limit.', 413);
  // Stream to a private staging file: incomplete uploads never appear in listings.
  const staging = join(dataDir(), 'file-staging');
  await mkdir(staging, { recursive: true, mode: 0o700 });
  if ((await lstat(staging)).isSymbolicLink())
    throw new FilesError('Linked storage is not supported.', 403);
  const temp = join(staging, randomBytes(24).toString('hex'));
  const handle = await open(temp, 'wx', 0o600);
  let size = 0;
  const reader =
    request.headers.get('content-length') === '0'
      ? undefined
      : request.body?.getReader();
  let complete = false;
  try {
    if (reader)
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          complete = true;
          break;
        }
        size += value.byteLength;
        if (size > limit)
          throw new FilesError('File exceeds the upload size limit.', 413);
        let offset = 0;
        while (offset < value.length) {
          const result = await handle.write(value, offset);
          offset += result.bytesWritten;
        }
      }
    if (request.signal.aborted) throw new FilesError('Upload cancelled.');
    await handle.close();
    const saved = await mutate(async () => {
      const destination = await safePath(path, true);
      // Hard-link publication is atomic and never overwrites an existing file.
      try {
        await link(temp, destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
          throw new FilesError(
            'A file with this name already exists. Rename it and retry.',
            409,
          );
        throw error;
      }
      return { path, size };
    });
    void notifyUpload(path, size);
    return saved;
  } finally {
    if (!complete) await reader?.cancel().catch(() => {});
    reader?.releaseLock();
    await handle.close().catch(() => {});
    await unlink(temp).catch(() => {});
  }
}
export async function downloadFile(path: string) {
  const handle = await open(await safePath(path), 'r');
  const stat = await handle.stat();
  if (!stat.isFile()) {
    await handle.close();
    throw new FilesError('Select a file to download.');
  }
  return { handle, size: stat.size };
}
export async function deleteFile(path: string) {
  return mutate(async () => {
    const target = await safePath(path);
    await lstat(target);
    await rm(target, { recursive: true });
  });
}
async function notifyUpload(path: string, size: number) {
  if (!process.env.FILES_APPRISE_URL) return;
  try {
    const url = new URL(process.env.FILES_APPRISE_URL);
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error('Expected HTTP(S) Apprise API URL');
    const storage = (await listFiles()).totalBytes;
    const message = (
      process.env.FILES_APPRISE_MESSAGE ||
      'New file uploaded {filename} ({size} bytes), Storage used {storage} bytes'
    )
      .replaceAll('{filename}', path)
      .replaceAll('{size}', String(size))
      .replaceAll('{storage}', String(storage));
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: message }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Notification failed');
  } catch {
    console.error('File upload notification failed. Check FILES_APPRISE_URL.');
  }
}
