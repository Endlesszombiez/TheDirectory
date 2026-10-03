import { clientId } from './client-id';
import { serviceDestinations } from './service-links';
import {
  configSchema,
  serviceSchema,
  type Config,
  type Service,
} from './schema';
export function normalizedServiceUrl(value: string) {
  const url = new URL(value);
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.href;
}
export function importDiscoveredServices(
  config: Config,
  boardId: string,
  services: Service[],
) {
  const board = config.boards.find((b) => b.id === boardId);
  if (!board) throw new Error('Choose a board that still exists.');
  const urls = new Set(
    board.services.flatMap((s) =>
      Object.values(serviceDestinations(s))
        .filter(Boolean)
        .map(normalizedServiceUrl),
    ),
  );
  const ids = new Set(board.services.map((s) => s.id));
  const added: Service[] = [];
  for (const candidate of services) {
    const service = serviceSchema.parse(candidate);
    const url = new URL(service.url);
    if (url.username || url.password)
      throw new Error('Use service URLs without embedded credentials.');
    const normalized = normalizedServiceUrl(service.url);
    if (urls.has(normalized)) continue;
    urls.add(normalized);
    if (ids.has(service.id)) service.id = clientId();
    ids.add(service.id);
    added.push(service);
  }
  return {
    config: configSchema.parse({
      ...config,
      boards: config.boards.map((b) =>
        b.id === boardId ? { ...b, services: [...b.services, ...added] } : b,
      ),
    }),
    added: added.length,
    skipped: services.length - added.length,
  };
}
