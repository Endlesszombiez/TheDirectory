import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { readContainerManagers } from '../src/lib/container-managers';
import {
  ContainerManagerNav,
  ContainerManagerView,
} from '../src/components/ContainerManagers';

test('missing and blank manager URLs stay disabled with accessible setup help', () => {
  const managers = readContainerManagers({ DOCKHAND_HOME_URL: '  ' });
  assert.ok(
    managers.every((manager) => manager.url === null && manager.error === null),
  );
  const html = renderToStaticMarkup(
    createElement(ContainerManagerNav, {
      managers,
      selected: null,
      onSelect: () => {},
    }),
  );
  assert.equal((html.match(/disabled=""/g) || []).length, 2);
  assert.match(html, /How to enable Portainer/);
  assert.match(html, /How to enable Dockhand/);
  assert.match(html, /PORTAINER_HOME_URL/);
  assert.match(html, /DOCKHAND_HOME_URL/);
});

test('each manager can be enabled independently and renders its configured frame', () => {
  for (const envKey of ['PORTAINER_HOME_URL', 'DOCKHAND_HOME_URL']) {
    const managers = readContainerManagers({
      [envKey]: ' https://nas.example:9443/manager/?view=home ',
    });
    const enabled = managers.find((manager) => manager.envKey === envKey)!;
    assert.equal(enabled.url, 'https://nas.example:9443/manager/?view=home');
    assert.equal(managers.filter((manager) => manager.url).length, 1);
    const html = renderToStaticMarkup(
      createElement(ContainerManagerView, { manager: enabled }),
    );
    assert.match(html, /<iframe/);
    assert.match(
      html,
      /src="https:\/\/nas.example:9443\/manager\/\?view=home"/,
    );
    assert.match(html, /Open in new tab/);
  }
  assert.equal(
    readContainerManagers({
      PORTAINER_HOME_URL: 'http://localhost:3333',
      DOCKHAND_HOME_URL: 'http://localhost:3000',
    }).filter((manager) => manager.url).length,
    2,
  );
});

test('HTTPS dashboards explain mixed content instead of rendering a blocked HTTP frame', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    value: { location: { protocol: 'https:' } },
    configurable: true,
  });
  try {
    const [manager] = readContainerManagers({
      PORTAINER_HOME_URL: 'http://localhost:3333',
    });
    const html = renderToStaticMarkup(
      createElement(ContainerManagerView, { manager }),
    );
    assert.doesNotMatch(html, /<iframe/);
    assert.match(html, /HTTPS URL/);
    assert.match(html, /role="alert"/);
    assert.match(html, /Open in new tab/);
  } finally {
    if (previousWindow)
      Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('invalid protocols, relative URLs, and embedded credentials never reach frames', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,test',
    'file:///tmp/page',
    '/manager',
    'localhost:3333',
    'http://user:secret@localhost:3333',
    'not a URL',
  ]) {
    const [manager] = readContainerManagers({ PORTAINER_HOME_URL: value });
    assert.equal(manager.url, null, value);
    assert.ok(manager.error, value);
  }
});
