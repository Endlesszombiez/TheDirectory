import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FilesError } from './files';

export type Paste = { id: string; text: string; created: string };
export const MAX_PASTE_BYTES = 1024 * 1024;
const root = () => join(resolve(process.env.DATA_DIR || './data'), 'pastes');
function pastePath(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new FilesError('Invalid paste ID.');
  return join(root(), `${id}.json`);
}
export async function listPastes(): Promise<Paste[]> {
  await mkdir(root(), { recursive: true, mode: 0o700 });
  const entries = await readdir(root());
  const pastes: Paste[] = [];
  for (const name of entries.filter((name) =>
    /^[a-f0-9-]{36}\.json$/.test(name),
  )) {
    try {
      pastes.push(JSON.parse(await readFile(join(root(), name), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return pastes.sort(
    (a, b) => b.created.localeCompare(a.created) || b.id.localeCompare(a.id),
  );
}
export async function createPaste(text: string): Promise<Paste> {
  if (!text.trim()) throw new FilesError('Paste some text first.');
  if (Buffer.byteLength(text, 'utf8') > MAX_PASTE_BYTES)
    throw new FilesError('Pastes must be 1 MB or smaller.', 413);
  const paste = { id: randomUUID(), text, created: new Date().toISOString() };
  await mkdir(root(), { recursive: true, mode: 0o700 });
  const target = pastePath(paste.id);
  const temp = `${target}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(paste), { flag: 'wx', mode: 0o600 });
    await rename(temp, target);
  } finally {
    await unlink(temp).catch(() => {});
  }
  return paste;
}
export async function deletePaste(id: string) {
  await unlink(pastePath(id));
}
