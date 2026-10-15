import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  RenderDeployment,
  UplinksWidget,
} from '../src/components/CloudWidgets';

test('uplink widgets distinguish waiting, current, and stale summaries and escape submitted text', () => {
  const html = renderToStaticMarkup(
    createElement(UplinksWidget, {
      loading: false,
      uplinks: [
        {
          id: 'waiting',
          name: 'Waiting app',
          staleAfter: 60,
          receivedAt: null,
          values: null,
          stale: true,
        },
        {
          id: 'current',
          name: 'Active app',
          staleAfter: 60,
          receivedAt: new Date().toISOString(),
          values: {
            message: '<script>alert(1)</script>',
            ready: false,
            missing: null,
          },
          stale: false,
        },
        {
          id: 'old',
          name: 'Old app',
          staleAfter: 60,
          receivedAt: new Date(Date.now() - 120_000).toISOString(),
          values: { queue: 8 },
          stale: true,
        },
      ],
    }),
  );
  for (const text of ['Waiting', 'Current', 'Stale', 'Received', 'false', '—'])
    assert.ok(html.includes(text));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(html.includes('<script>'), false);
  const unavailable = renderToStaticMarkup(
    createElement(UplinksWidget, {
      loading: false,
      uplinks: [],
      error: 'Storage unavailable',
    }),
  );
  assert.ok(unavailable.includes('role="alert"'));
  assert.equal(unavailable.includes('No uplinks connected'), false);
});

test('Render cards show last known deployment and failure context independently of HTTP health', () => {
  const html = renderToStaticMarkup(
    createElement(RenderDeployment, {
      id: 'srv-worker',
      dashboardUrl: 'https://dashboard.render.com/worker/srv-worker',
      connected: true,
      status: {
        checkedAt: new Date().toISOString(),
        error: 'Render unavailable',
        deployment: {
          id: 'dep-one',
          status: 'build_failed',
          createdAt: new Date().toISOString(),
          commit: { id: 'abcdef12345', message: '<unsafe>' },
        },
      },
    }),
  );
  for (const text of [
    'build failed',
    'abcdef1',
    'Showing last known deployment.',
    'https://dashboard.render.com/worker/srv-worker',
    '&lt;unsafe&gt;',
  ])
    assert.ok(html.includes(text));
  const disconnected = renderToStaticMarkup(
    createElement(RenderDeployment, { id: 'srv-worker', connected: false }),
  );
  assert.ok(disconnected.includes('Connection unavailable'));
  assert.equal(disconnected.includes('Online'), false);
});
