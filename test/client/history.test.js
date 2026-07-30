import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHistory } from '../../src/client/history.js';

function fakeStorage({ cap = Infinity } = {}) {
  const map = new Map();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem(k, v) {
      if (String(v).length > cap) throw new Error('QuotaExceededError');
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
  };
}

function ticker(start = 1_700_000_000_000) {
  let t = start;
  return () => (t += 1000);
}

function harness(options = {}) {
  const storage = options.storage ?? fakeStorage();
  return { storage, history: createHistory({ storage, now: ticker(), ...options }) };
}

const KEY = 'vibey.history.v1';

describe('recording', () => {
  it('keeps both sides of the conversation in the order they were said', () => {
    const { history } = harness();
    history.begin({ model: 'grok-voice-latest', voice: 'leo' });
    history.append({ role: 'user', content: 'add a health check to the worker' });
    history.append({ role: 'assistant', content: 'Health check on the worker, hitting slash healthz. Sending it now.' });

    const [conversation] = history.conversations;
    assert.deepEqual(conversation.messages.map((m) => [m.role, m.content]), [
      ['user', 'add a health check to the worker'],
      ['assistant', 'Health check on the worker, hitting slash healthz. Sending it now.'],
    ]);
    assert.equal(conversation.model, 'grok-voice-latest');
    assert.equal(conversation.voice, 'leo');
  });

  it('writes a conversation nobody spoke in nowhere', () => {
    const { storage, history } = harness();
    history.begin({ voice: 'leo' });
    history.end();
    assert.equal(storage.getItem(KEY), null);
    assert.deepEqual(history.conversations, []);
  });

  it('drops a turn with nothing in it, and trims the rest', () => {
    const { history } = harness();
    history.begin();
    assert.equal(history.append({ role: 'user', content: '   ' }), null);
    assert.equal(history.append({ role: 'user', content: null }), null);
    history.append({ role: 'assistant', content: '  fine.  ' });
    assert.deepEqual(history.conversations[0].messages.map((m) => m.content), ['fine.']);
  });

  it('starts a conversation on its own for a turn that arrives without one', () => {
    const { history } = harness();
    history.append({ role: 'user', content: 'hello?' });
    assert.equal(history.conversations.length, 1);
    assert.ok(history.live);
  });

  it('separates one call from the next', () => {
    const { history } = harness();
    history.begin({ voice: 'leo' });
    history.append({ role: 'user', content: 'first' });
    history.end();
    history.begin({ voice: 'rex' });
    history.append({ role: 'user', content: 'second' });

    assert.deepEqual(history.conversations.map((c) => c.voice), ['rex', 'leo']);
  });

  it('ends idempotently, because every teardown path calls it', () => {
    const { history } = harness();
    history.begin();
    history.append({ role: 'user', content: 'hello' });
    assert.ok(history.end());
    assert.equal(history.end(), null);
    assert.equal(history.live, null);
    assert.equal(history.conversations.length, 1);
  });
});

describe('what a coding agent sent back', () => {
  it('goes in the log as its own kind of turn, beside the talking', () => {
    const { history } = harness();
    history.append({ role: 'user', content: 'add a retry' });
    history.append({
      role: 'agent',
      agent: 'codex',
      taskId: '3',
      status: 'done',
      task: 'add a retry around the fetch',
      content: 'two files changed, tests pass',
    });

    const [conversation] = history.conversations;
    const [said, agent] = conversation.messages;
    assert.equal(said.role, 'user');
    assert.equal(agent.role, 'agent');
    assert.equal(agent.agent, 'codex');
    assert.equal(agent.taskId, '3');
    assert.equal(agent.status, 'done');
    assert.equal(agent.task, 'add a retry around the fetch');
    assert.equal(agent.content, 'two files changed, tests pass');
  });

  it('survives being read back by a later page', () => {
    const store = new Map();
    const storage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    createHistory({ storage }).append({ role: 'agent', agent: 'claude', taskId: '1', content: 'done' });

    const [conversation] = createHistory({ storage }).conversations;
    assert.equal(conversation.messages[0].role, 'agent');
    assert.equal(conversation.messages[0].agent, 'claude');
  });

  it('is still a turn like any other when the role is nonsense', () => {
    const { history } = harness();
    history.append({ role: 'robot', content: 'beep' });
    assert.equal(history.conversations[0].messages[0].role, 'user');
  });
});

describe('persistence', () => {
  it('reads back what an earlier page wrote', () => {
    const storage = fakeStorage();
    const first = createHistory({ storage, now: ticker() });
    first.begin({ voice: 'leo' });
    first.append({ role: 'user', content: 'remember this' });

    const second = createHistory({ storage, now: ticker() });
    assert.equal(second.conversations[0].messages[0].content, 'remember this');
  });

  it('ignores a value it did not write', () => {
    const storage = fakeStorage();
    storage.setItem(KEY, '{"version":99,"conversations":[{"nope":true}]}');
    assert.deepEqual(createHistory({ storage }).conversations, []);

    storage.setItem(KEY, 'not json at all');
    assert.deepEqual(createHistory({ storage }).conversations, []);
  });

  it('carries on in memory when storage refuses every write', () => {
    const storage = fakeStorage({ cap: 0 });
    const history = createHistory({ storage, now: ticker() });
    history.append({ role: 'user', content: 'still here' });
    assert.equal(history.conversations[0].messages[0].content, 'still here');
  });

  it('sheds the oldest conversations to stay under the limit', () => {
    const { history } = harness({ limit: 2 });
    for (const content of ['one', 'two', 'three']) {
      history.begin();
      history.append({ role: 'user', content });
      history.end();
    }
    assert.deepEqual(
      history.conversations.map((c) => c.messages[0].content),
      ['three', 'two'],
    );
  });

  it('sheds to stay under the byte budget too', () => {
    const { history } = harness({ budget: 400 });
    for (let i = 0; i < 12; i++) {
      history.begin();
      history.append({ role: 'assistant', content: `answer number ${i} `.repeat(4) });
      history.end();
    }
    const kept = history.conversations;
    assert.ok(kept.length > 0 && kept.length < 12, `kept ${kept.length}`);
    assert.match(kept[0].messages[0].content, /answer number 11/);
  });

  it('clears everything, including the call in progress', () => {
    const { storage, history } = harness();
    history.begin();
    history.append({ role: 'user', content: 'forget it' });
    history.clear();
    assert.deepEqual(history.conversations, []);
    assert.equal(storage.getItem(KEY), null);

    history.append({ role: 'user', content: 'after' });
    assert.deepEqual(history.conversations[0].messages.map((m) => m.content), ['after']);
  });

  it('removes one conversation by id', () => {
    const { history } = harness();
    history.begin();
    history.append({ role: 'user', content: 'keep' });
    history.end();
    history.begin();
    history.append({ role: 'user', content: 'drop' });
    const [live] = history.conversations;

    assert.equal(history.remove(live.id), true);
    assert.equal(history.remove('nothing-by-that-name'), false);
    assert.deepEqual(history.conversations.map((c) => c.messages[0].content), ['keep']);
    assert.equal(history.live, null);
  });
});

describe('subscribers', () => {
  it('tells the panel when there is something new to draw', () => {
    const { history } = harness();
    let calls = 0;
    const off = history.subscribe(() => calls++);

    history.begin();
    assert.equal(calls, 0, 'an empty conversation is not news');
    history.append({ role: 'user', content: 'hello' });
    history.end();
    history.clear();
    assert.equal(calls, 3);

    off();
    history.append({ role: 'user', content: 'unheard' });
    assert.equal(calls, 3);
  });

  it('hands out conversations the caller cannot edit from under us', () => {
    const { history } = harness();
    history.append({ role: 'user', content: 'mine' });
    history.conversations[0].messages.push({ role: 'user', content: 'theirs' });
    assert.equal(history.conversations[0].messages.length, 1);
  });
});
