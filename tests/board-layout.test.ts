import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardModules, moveModule } from '../src/lib/board-layout';
import { boardSchema, configSchema, type BoardModule } from '../src/lib/schema';
import { defaultConfig } from '../src/lib/defaults';

test('legacy boards retain every service in their existing order', () => {
  const board = structuredClone(defaultConfig.boards[0]);
  assert.equal(board.layout, undefined);
  const modules = boardModules(board);
  assert.deepEqual(
    modules.map((item) => item.kind === 'service' && item.serviceId),
    board.services.map((service) => service.id),
  );
  assert.equal(configSchema.safeParse(defaultConfig).success, true);
  assert.equal(board.layout, undefined);
});

test('reconcile deleted and added services without moving widgets and spaces', () => {
  const board = structuredClone(defaultConfig.boards[0]);
  board.services = board.services.slice(0, 2);
  board.layout = [
    { id: 'gap', kind: 'spacer', span: 2 },
    {
      id: 'tasks',
      kind: 'widget',
      widget: 'checklist',
      text: '[x] Backup\nUpgrade',
      span: 1,
    },
    { id: 'card', kind: 'service', serviceId: board.services[1].id, span: 2 },
    { id: 'deleted', kind: 'service', serviceId: 'removed-service', span: 1 },
  ];
  const original = structuredClone(board.layout);
  const modules = boardModules(board);
  assert.deepEqual(modules.slice(0, 3), original.slice(0, 3));
  assert.equal(modules.length, 4);
  assert.deepEqual(modules[3], {
    id: `service:${board.services[0].id}`,
    kind: 'service',
    serviceId: board.services[0].id,
    span: 1,
  });
  assert.deepEqual(board.layout, original);
  assert.deepEqual(
    boardSchema.parse(JSON.parse(JSON.stringify({ ...board, layout: modules })))
      .layout,
    modules,
  );
});

test('moving a module can place a service beside a reserved gap without mutation', () => {
  const modules: BoardModule[] = [
    { id: 'a', kind: 'service', serviceId: 'one', span: 1 },
    { id: 'b', kind: 'spacer', span: 1 },
    { id: 'c', kind: 'widget', widget: 'health', span: 1 },
  ];
  assert.deepEqual(
    moveModule(modules, 2, 0).map((item) => item.id),
    ['c', 'a', 'b'],
  );
  assert.deepEqual(
    modules.map((item) => item.id),
    ['a', 'b', 'c'],
  );
  assert.equal(moveModule(modules, -1, 0), modules);
  assert.equal(moveModule(modules, 0, 3), modules);
});

test('layouts reject duplicate IDs, duplicate cards, invalid widths and unknown widgets', () => {
  const board = structuredClone(defaultConfig.boards[0]);
  const gap: BoardModule = { id: 'gap', kind: 'spacer', span: 1 };
  const card: BoardModule = {
    id: 'card',
    kind: 'service',
    serviceId: board.services[0].id,
    span: 1,
  };
  for (const layout of [
    [gap, gap],
    [card, { ...card, id: 'other' }],
    [{ ...gap, span: 0 }],
    [{ ...gap, span: 5 }],
    [{ id: 'widget', kind: 'widget', widget: 'unknown', span: 1 }],
  ]) {
    assert.equal(boardSchema.safeParse({ ...board, layout }).success, false);
  }
  assert.equal(
    boardSchema.safeParse({
      ...board,
      layout: [
        gap,
        card,
        {
          id: 'note',
          kind: 'widget',
          widget: 'notes',
          span: 1,
          text: 'x'.repeat(10001),
        },
      ],
    }).success,
    false,
  );
});

test('new service module IDs do not collide with existing widget IDs', () => {
  const board = structuredClone(defaultConfig.boards[0]);
  board.layout = [
    { id: `service:${board.services[0].id}`, kind: 'spacer', span: 1 },
  ];
  const modules = boardModules(board);
  assert.equal(new Set(modules.map((item) => item.id)).size, modules.length);
});
