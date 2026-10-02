import { dockerConfigured, listContainers } from './docker';
import os from 'node:os';
import type { Config } from './schema';
export type Health = {
  state: 'up' | 'down' | 'unchecked';
  latency?: number;
  code?: number;
};
const cache = new Map<string, { at: number; health: Health }>();
export async function checkServices(
  config: Config,
): Promise<Record<string, Health>> {
  const jobs = config.boards.flatMap((board) =>
    board.services.map((service) => ({
      key: `${board.id}:${service.id}`,
      service,
    })),
  );
  const result: Record<string, Health> = {};
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, jobs.length) }, async () => {
      while (index < jobs.length) {
        const { key, service } = jobs[index++];
        if (!service.check) {
          result[key] = { state: 'unchecked' };
          continue;
        }
        const cached = cache.get(service.url);
        if (cached && Date.now() - cached.at < 30_000) {
          result[key] = cached.health;
          continue;
        }
        const started = performance.now();
        let health: Health;
        try {
          const response = await fetch(service.url, {
            signal: AbortSignal.timeout(3500),
            redirect: 'manual',
          });
          health = {
            state:
              response.status < 400 ||
              response.status === 401 ||
              response.status === 403
                ? 'up'
                : 'down',
            latency: Math.round(performance.now() - started),
            code: response.status,
          };
          await response.body?.cancel();
        } catch {
          health = { state: 'down' };
        }
        cache.set(service.url, { at: Date.now(), health });
        result[key] = health;
      }
    }),
  );
  if (cache.size > 1200) cache.clear();
  return result;
}
export function systemInfo() {
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    uptime: os.uptime(),
    memoryUsed: os.totalmem() - os.freemem(),
    memoryTotal: os.totalmem(),
    cpus: os.cpus().length,
    load: os.loadavg()[0],
  };
}
export function dockerInfo(): Promise<{
  configured: boolean;
  containers?: {
    id: string;
    name: string;
    image: string;
    state: string;
    status: string;
  }[];
  error?: string;
}> {
  if (!dockerConfigured()) return Promise.resolve({ configured: false });
  return listContainers().then(
    (containers) => ({
      configured: true,
      containers: containers.map((c) => ({
        id: c.Id,
        name: c.Names[0]?.replace(/^\//, '') || c.Id.slice(0, 12),
        image: c.Image,
        state: c.State,
        status: c.Status,
      })),
    }),
    () => ({
      configured: true,
      error: 'Docker unavailable. Check its path, connection, and permissions.',
    }),
  );
}
