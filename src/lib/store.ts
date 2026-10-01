import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { configSchema, type Config } from './schema';
import { defaultConfig } from './defaults';
const dir = () => resolve(process.env.DATA_DIR || './data');
let queue: Promise<unknown> = Promise.resolve();
export async function readConfig(): Promise<Config> {
  try {
    return configSchema.parse(
      JSON.parse(await readFile(join(dir(), 'dashboard.json'), 'utf8')),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return structuredClone(defaultConfig);
    throw error;
  }
}
export class ConflictError extends Error {}
export function saveConfig(config: Config): Promise<Config> {
  const task = queue.then(async () => {
    const current = await readConfig();
    if (config.revision !== current.revision)
      throw new ConflictError(
        'The dashboard changed in another tab. Reload before saving.',
      );
    const saved = configSchema.parse({
      ...config,
      revision: current.revision + 1,
    });
    await mkdir(dir(), { recursive: true });
    const temp = join(dir(), `dashboard.${randomUUID()}.tmp`);
    await writeFile(
      temp,
      JSON.stringify(saved, null, 2).replace(/\n/g, '\r\n') + '\r\n',
      {
        mode: 0o600,
      },
    );
    await rename(temp, join(dir(), 'dashboard.json'));
    return saved;
  });
  queue = task.catch(() => {});
  return task;
}
