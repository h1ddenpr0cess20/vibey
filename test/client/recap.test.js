import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { recap } from '../../src/client/session/index.js';

describe('recap', () => {
  it('says nothing about a conversation nobody spoke in', () => {
    assert.equal(recap([]), '');
    assert.equal(recap(), '');
  });

  it('lays the turns out oldest first, and says which side is which', () => {
    const text = recap([
      { role: 'user', content: 'what should I build?' },
      { role: 'assistant', content: 'The small one. Ship it.' },
    ]);

    const lines = text.split('\n').filter(Boolean);
    assert.match(lines[0], /^\[Picking up a conversation from earlier/);
    assert.deepEqual(lines.slice(1), [
      'Them: what should I build?',
      'You: The small one. Ship it.',
    ]);
  });

  it('leaves out what was never said in the conversation', () => {
    const text = recap([
      { role: 'user', content: 'hello' },
      { role: 'agent', content: 'a coding agent reported back' },
      { role: 'user', content: '' },
      null,
    ]);

    assert.doesNotMatch(text, /coding agent/);
    assert.equal(text.split('\n').filter((l) => l.startsWith('Them: ')).length, 1);
  });

  it('keeps the end of a long conversation, which is what the next turn follows', () => {
    const turns = Array.from({ length: 60 }, (_, i) => ({ role: 'user', content: `turn ${i}` }));
    const text = recap(turns);

    assert.match(text, /turn 59/);
    assert.doesNotMatch(text, /turn 0\b/);
  });

  it('stays small enough to send, whatever was said', () => {
    const many = Array.from({ length: 30 }, () => ({ role: 'user', content: 'x'.repeat(2000) }));
    const one = [{ role: 'assistant', content: 'x'.repeat(40_000) }];

    for (const turns of [many, one]) {
      assert.ok(recap(turns).length < 6500, 'the recap has to fit in one frame');
    }
    assert.match(recap(one), /^\[Picking up/);
  });
});
