import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMemory } from '../../src/client/memory.js';
import { createTools } from '../../src/client/session/tools.js';

function fakeStorage(seed = null) {
  const map = new Map();
  if (seed !== null) map.set('vibey.memory.v1', seed);
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function ticker(start = 1_700_000_000_000) {
  let t = start;
  return () => (t += 1000);
}

function harness(options = {}) {
  const storage = options.storage ?? fakeStorage();
  return { storage, memory: createMemory({ storage, now: ticker(), ...options }) };
}

const stored = (storage) => JSON.parse(storage.map.get('vibey.memory.v1'));

describe('storing', () => {
  it('keeps what it is given, in the order it arrived', () => {
    const { memory } = harness();
    memory.add('drinks his coffee black');
    memory.add('has a dog called Pebble');

    assert.deepEqual(memory.items.map((m) => m.text), [
      'drinks his coffee black',
      'has a dog called Pebble',
    ]);
  });

  it('flattens whitespace and caps a rambling memory at 600 characters', () => {
    const { memory } = harness();
    memory.add('  lives   in\n  Reno  ');
    memory.add('x'.repeat(900));

    assert.equal(memory.items[0].text, 'lives in Reno');
    assert.equal(memory.items[1].text.length, 600);
  });

  it('refuses empty text and ignores a repeat of what it already knows', () => {
    const { memory } = harness();
    assert.equal(memory.add('   '), null);
    assert.equal(memory.add(undefined), null);

    memory.add('hates small talk');
    memory.add('Hates Small Talk');
    assert.equal(memory.items.length, 1);
  });

  it('drops the oldest memory once it is over the limit', () => {
    const { memory } = harness({ limit: 3 });
    for (const text of ['one', 'two', 'three', 'four']) memory.add(text);

    assert.deepEqual(memory.items.map((m) => m.text), ['two', 'three', 'four']);
  });

  it('survives the round trip through storage', () => {
    const { storage, memory } = harness();
    memory.add('allergic to cats');
    memory.enabled = false;

    const { memory: reopened } = harness({ storage });
    assert.deepEqual(reopened.items.map((m) => m.text), ['allergic to cats']);
    assert.equal(reopened.enabled, false);
  });

  it('starts empty and switched on when storage holds junk', () => {
    const { memory } = harness({ storage: fakeStorage('{"version":9,"items":"nope"}') });
    assert.deepEqual(memory.items, []);
    assert.equal(memory.enabled, true);
  });

  it('writes a version stamp so a later format can tell the difference', () => {
    const { storage, memory } = harness();
    memory.add('takes the stairs');
    assert.equal(stored(storage).version, 1);
  });
});

describe('forgetting', () => {
  it('drops every memory matching the keyword, case-insensitively', () => {
    const { memory } = harness();
    memory.add('has a dog called Pebble');
    memory.add('walks the DOG at six');
    memory.add('drinks his coffee black');

    assert.deepEqual(memory.forget('dog'), [
      'has a dog called Pebble',
      'walks the DOG at six',
    ]);
    assert.deepEqual(memory.items.map((m) => m.text), ['drinks his coffee black']);
  });

  it('leaves the list alone when nothing matches', () => {
    const { memory } = harness();
    memory.add('drinks his coffee black');

    assert.deepEqual(memory.forget('tea'), []);
    assert.deepEqual(memory.forget(''), []);
    assert.equal(memory.items.length, 1);
  });

  it('removes by index and clears the lot', () => {
    const { memory } = harness();
    memory.add('one');
    memory.add('two');

    assert.equal(memory.removeAt(5), null);
    assert.equal(memory.removeAt(0).text, 'one');
    memory.clear();
    assert.deepEqual(memory.items, []);
  });
});

describe('the lines handed to the session', () => {
  it('are the stored texts while memory is on, and nothing while it is off', () => {
    const { memory } = harness();
    memory.add('drinks his coffee black');
    assert.deepEqual(memory.lines(), ['drinks his coffee black']);

    memory.enabled = false;
    assert.deepEqual(memory.lines(), []);
    assert.deepEqual(memory.items.map((m) => m.text), ['drinks his coffee black']);
  });
});

describe('subscribers', () => {
  it('hear every change and stop hearing after unsubscribing', () => {
    const { memory } = harness();
    let beats = 0;
    const off = memory.subscribe(() => beats++);

    memory.add('one');
    memory.enabled = false;
    memory.enabled = false;
    memory.clear();
    off();
    memory.add('two');

    assert.equal(beats, 3);
  });
});

describe('the tools the model calls', () => {
  it('stores and forgets through the same memory', () => {
    const { memory } = harness();
    const tools = createTools({ memory });

    assert.deepEqual(tools.remember({ memory: 'drinks his coffee black' }), {
      ok: true,
      remembered: 'drinks his coffee black',
      total: 1,
    });

    const forgotten = tools.forget({ keyword: 'coffee' });
    assert.equal(forgotten.ok, true);
    assert.deepEqual(forgotten.forgotten, ['drinks his coffee black']);
    assert.equal(memory.items.length, 0);
  });

  it('says no rather than throwing on junk arguments', () => {
    const { memory } = harness();
    const tools = createTools({ memory });

    assert.equal(tools.remember({}).ok, false);
    assert.equal(tools.forget({ keyword: '  ' }).ok, false);
    assert.equal(tools.forget({ keyword: 'nothing stored' }).ok, false);
  });

  it('refuses both calls while memory is switched off', () => {
    const { memory } = harness();
    memory.enabled = false;
    const tools = createTools({ memory });

    assert.equal(tools.remember({ memory: 'anything' }).ok, false);
    assert.equal(tools.forget({ keyword: 'anything' }).ok, false);
    assert.deepEqual(memory.items, []);
  });
});
