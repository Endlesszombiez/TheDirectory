import type { Board, BoardModule } from './schema';

// Resolve service additions/removals without disturbing widgets or deliberate gaps.
export function boardModules(board: Board): BoardModule[] {
  const serviceIds = new Set(board.services.map((service) => service.id));
  const layout = (board.layout || []).filter(
    (item) => item.kind !== 'service' || serviceIds.has(item.serviceId),
  );
  const placed = new Set(
    layout.flatMap((item) => (item.kind === 'service' ? [item.serviceId] : [])),
  );
  const used = new Set(layout.map((item) => item.id));
  for (const service of board.services) {
    if (placed.has(service.id)) continue;
    let id = `service:${service.id}`;
    while (used.has(id)) id += ':';
    used.add(id);
    layout.push({ id, kind: 'service', serviceId: service.id, span: 1 });
  }
  return layout;
}

export function moveModule(items: BoardModule[], from: number, to: number) {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length)
    return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
