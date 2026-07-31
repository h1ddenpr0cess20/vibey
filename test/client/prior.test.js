import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { prior } from '../../src/client/session/index.js';

describe('prior', () => {
  it('has nothing to carry from a conversation nobody spoke in', () => {
    assert.deepEqual(prior([]), []);
    assert.deepEqual(prior(), []);
  });

  it('carries the turns themselves, in the order they were said', () => {
    assert.deepEqual(prior([
      { role: 'user', content: 'what should I build?', at: 1 },
      { role: 'assistant', content: 'The small one. Ship it.', at: 2 },
    ]), [
      { role: 'user', content: 'what should I build?' },
      { role: 'assistant', content: 'The small one. Ship it.' },
    ]);
  });

  it('leaves out what was never said in the conversation', () => {
    const turns = prior([
      { role: 'user', content: 'hello' },
      { role: 'agent', content: 'a coding agent reported back' },
      { role: 'user', content: '' },
      null,
    ]);

    assert.deepEqual(turns, [{ role: 'user', content: 'hello' }]);
  });

  it('keeps the end of a long conversation, which is what the next turn follows', () => {
    const turns = prior(Array.from({ length: 60 }, (_, i) => ({ role: 'user', content: `turn ${i}` })));

    assert.equal(turns.length, 40);
    assert.equal(turns.at(-1).content, 'turn 59');
    assert.equal(turns[0].content, 'turn 20');
  });

  it('stays small enough to send, whatever was said', () => {
    const many = prior(Array.from({ length: 30 }, () => ({ role: 'user', content: 'x'.repeat(2000) })));
    const one = prior([{ role: 'assistant', content: 'x'.repeat(40_000) }]);

    const size = (turns) => turns.reduce((sum, turn) => sum + turn.content.length, 0);
    assert.ok(size(many) <= 6000, 'a long conversation is shed down to the budget');
    assert.ok(size(one) <= 6000, 'a single enormous turn is cut to it');
  });
});
