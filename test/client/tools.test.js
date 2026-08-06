import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createToolSwitches, KEY } from '../../src/client/tools.js';

function fakeStorage(seed = null) {
  const map = new Map();
  if (seed !== null) map.set(KEY, seed);
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const CATALOG = [
  { name: 'web_search', label: 'web search' },
  { name: 'x_search', label: 'X search' },
  { name: 'mcp:orders', label: 'orders' },
];

function harness(seed = null) {
  const storage = fakeStorage(seed);
  const switches = createToolSwitches({ storage });
  switches.setCatalog(CATALOG);
  return { storage, switches };
}

const stored = (storage) => JSON.parse(storage.map.get(KEY));

describe('the catalog', () => {
  it('is what the server offered, all of it on until something is switched', () => {
    const { switches } = harness();

    assert.deepEqual(switches.items, CATALOG.map((tool) => ({ ...tool, enabled: true })));
    assert.deepEqual(switches.off, []);
  });

  it('falls back to the name for a tool the server did not label', () => {
    const { switches } = harness();
    switches.setCatalog([{ name: 'mcp:rota' }, { label: 'no name at all' }, null]);

    assert.deepEqual(switches.items, [{ name: 'mcp:rota', label: 'mcp:rota', enabled: true }]);
  });

  it('lists the labels of what is left on, for the chip', () => {
    const { switches } = harness();
    switches.set('x_search', false);

    assert.deepEqual(switches.labels, ['web search', 'orders']);
  });
});

describe('switching', () => {
  it('records only what is off, and says so once', () => {
    const { storage, switches } = harness();
    let told = 0;
    switches.subscribe(() => (told += 1));

    switches.toggle('x_search');
    assert.equal(switches.enabled('x_search'), false);
    assert.deepEqual(switches.off, ['x_search']);
    assert.deepEqual(stored(storage), { version: 1, off: ['x_search'] });

    switches.set('x_search', false);
    assert.equal(told, 1, 'switching it off again is not a change');

    switches.toggle('x_search');
    assert.deepEqual(switches.off, []);
    assert.equal(told, 2);
  });

  it('survives the reload, which is the point of storing it', () => {
    const { storage, switches } = harness();
    switches.set('mcp:orders', false);

    const again = createToolSwitches({ storage });
    again.setCatalog(CATALOG);
    assert.equal(again.enabled('mcp:orders'), false);
    assert.equal(again.enabled('web_search'), true);
  });

  it('keeps a switch for a tool this server has stopped offering', () => {
    const { switches } = harness(JSON.stringify({ version: 1, off: ['mcp:gone'] }));

    assert.deepEqual(switches.items.map((t) => t.enabled), [true, true, true]);
    assert.deepEqual(switches.off, ['mcp:gone'], 'still ours to send, and the proxy drops it');
  });
});

describe('what was stored last time', () => {
  it('is ignored when it is not this version, or not a list', () => {
    assert.deepEqual(harness('{"version":0,"off":["web_search"]}').switches.off, []);
    assert.deepEqual(harness('{"version":1,"off":"web_search"}').switches.off, []);
    assert.deepEqual(harness('not json at all').switches.off, []);
    assert.deepEqual(harness().switches.off, []);
  });

  it('keeps only the names that are strings', () => {
    const { switches } = harness(JSON.stringify({ version: 1, off: ['x_search', 7, null] }));
    assert.deepEqual(switches.off, ['x_search']);
  });
});
