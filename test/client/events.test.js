import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { encodePCM } from '../../src/client/session/codec.js';
import { createEventHandler } from '../../src/client/session/events.js';

function harness({ playing = false } = {}) {
  const emitted = [];
  const states = [];
  const errors = [];
  const played = [];
  const messages = [];
  let isPlaying = playing;

  const calls = [];

  const events = createEventHandler({
    setState: (s) => states.push(s),
    emit: (type, payload) => emitted.push({ type, payload }),
    fail: (message) => errors.push(message),
    play: (samples) => played.push(samples),
    flushAudio: () => {
      played.push('<flush>');
      isPlaying = false;
    },
    playing: () => isPlaying,
    messages,
    onFunctionCall: (call) => calls.push(call),
  });

  return {
    events,
    states,
    errors,
    played,
    messages,
    emitted,
    calls,
    of: (type) => emitted.filter((e) => e.type === type).map((e) => e.payload),
    setPlaying: (v) => { isPlaying = v; },
  };
}

const AUDIO = encodePCM(new Int16Array([1, 2, 3, 4]));

describe('transcripts', () => {
  it('appends a .delta but replaces a .updated', () => {
    const h = harness();
    h.events.handle({ type: 'response.output_audio_transcript.delta', delta: 'get ' });
    h.events.handle({ type: 'response.output_audio_transcript.delta', delta: 'off my lawn' });
    assert.deepEqual(h.of('caption'), ['get ', 'get off my lawn']);

    const g = harness();
    g.events.handle({ type: 'response.output_audio_transcript.updated', transcript: 'get' });
    g.events.handle({ type: 'response.output_audio_transcript.updated', transcript: 'get off my lawn' });
    assert.deepEqual(g.of('caption'), ['get', 'get off my lawn']);
  });

  it('reports the person’s cumulative transcript without logging it twice', () => {
    const h = harness();
    h.events.handle({ type: 'conversation.item.input_audio_transcription.updated', transcript: 'what is' });
    h.events.handle({ type: 'conversation.item.input_audio_transcription.updated', transcript: 'what is that' });
    assert.deepEqual(h.of('user'), ['what is', 'what is that']);
    assert.equal(h.messages.length, 0);

    h.events.handle({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'what is that' });
    assert.deepEqual(h.messages, [{ role: 'user', content: 'what is that' }]);
  });

  it('keeps the finished answer in the history', () => {
    const h = harness();
    h.events.handle({ type: 'response.output_audio_transcript.delta', delta: 'obviously.' });
    h.events.handle({ type: 'response.done', response: {} });
    assert.deepEqual(h.messages, [{ role: 'assistant', content: 'obviously.' }]);
  });
});

describe('audio', () => {
  it('plays a delta and goes to speaking', () => {
    const h = harness();
    h.events.handle({ type: 'response.output_audio.delta', delta: AUDIO });
    assert.equal(h.played.length, 1);
    assert.deepEqual(h.states.at(-1), 'speaking');
  });

  it('ignores a delta from a response that has been superseded', () => {
    const h = harness();
    h.events.handle({ type: 'response.created', response: { id: 'resp_2' } });
    h.events.handle({ type: 'response.output_audio.delta', delta: AUDIO, response_id: 'resp_1' });
    assert.deepEqual(h.played, []);

    h.events.handle({ type: 'response.output_audio.delta', delta: AUDIO, response_id: 'resp_2' });
    assert.equal(h.played.length, 1);
  });

  it('drops a delta that is not decodable rather than throwing', () => {
    const h = harness();
    h.events.handle({ type: 'response.output_audio.delta', delta: 'not base64!!' });
    assert.deepEqual(h.played, []);
  });
});

describe('barge-in', () => {
  it('flushes the queue and reports the interruption when Star was talking', () => {
    const h = harness({ playing: true });
    h.events.handle({ type: 'input_audio_buffer.speech_started' });

    assert.deepEqual(h.of('interrupted'), [undefined]);
    assert.ok(h.played.includes('<flush>'));
    assert.equal(h.states.at(-1), 'listening');
  });

  it('does not report an interruption when he was already quiet', () => {
    const h = harness({ playing: false });
    h.events.handle({ type: 'input_audio_buffer.speech_started' });
    assert.deepEqual(h.of('interrupted'), []);
  });

  it('drops stale audio when a new response starts mid-playback', () => {
    const h = harness({ playing: true });
    h.events.handle({ type: 'response.created', response: { id: 'resp_1' } });
    assert.ok(h.played.includes('<flush>'));
  });
});

describe('end of turn', () => {
  it('waits for the queue to drain before it stops speaking', () => {
    const h = harness({ playing: true });
    h.events.handle({ type: 'response.done', response: {} });
    assert.equal(h.states.includes('listening'), false);
  });

  it('ends the turn itself when there was no audio at all', () => {
    const h = harness({ playing: false });
    h.events.handle({ type: 'response.done', response: {} });
    assert.equal(h.states.at(-1), 'listening');
  });

  it('surfaces a failed response', () => {
    const h = harness();
    h.events.handle({
      type: 'response.done',
      response: { status: 'failed', status_details: { error: { message: 'rate limited' } } },
    });
    assert.deepEqual(h.errors, ['rate limited']);
  });

  it('tracks whether a response is in flight', () => {
    const h = harness();
    h.events.handle({ type: 'response.created', response: { id: 'r' } });
    assert.equal(h.events.responding, true);
    h.events.handle({ type: 'response.done', response: {} });
    assert.equal(h.events.responding, false);
  });
});

describe('tools', () => {
  it('labels a server-side tool while it works and clears it after', () => {
    const h = harness();
    h.events.handle({ type: 'response.web_search_call.in_progress' });
    h.events.handle({ type: 'response.x_search_call.in_progress' });
    h.events.handle({ type: 'response.web_search_call.done' });

    assert.deepEqual(h.of('tool'), ['searching the web', 'reading X', null]);
  });

  it('says nothing about events it does not recognise', () => {
    const h = harness();
    h.events.handle({ type: 'rate_limits.updated' });
    assert.deepEqual(h.emitted, []);
  });
});

describe('the proxy handshake', () => {
  it('reports the model and voice actually used', () => {
    const h = harness();
    h.events.handle({ type: 'proxy.ready', model: 'grok-voice-latest', voice: 'rex' });
    assert.deepEqual(h.of('ready'), [{ model: 'grok-voice-latest', voice: 'rex' }]);
  });
});

describe('function calls', () => {
  const CALL = {
    type: 'response.function_call_arguments.done',
    call_id: 'call_1',
    name: 'remember',
    arguments: '{"memory":"drinks his coffee black"}',
  };

  it('hands the parsed arguments over once', () => {
    const h = harness();
    h.events.handle(CALL);

    assert.deepEqual(h.calls, [
      { call_id: 'call_1', name: 'remember', args: { memory: 'drinks his coffee black' } },
    ]);
  });

  it('runs a call once however many events carry it', () => {
    const h = harness();
    const item = { type: 'function_call', call_id: 'call_1', name: 'remember', arguments: '{}' };
    h.events.handle(CALL);
    h.events.handle({ type: 'response.output_item.done', item });
    h.events.handle({ type: 'response.done', response: { output: [item] } });

    assert.equal(h.calls.length, 1);
  });

  it('picks the call up from an output item alone', () => {
    const h = harness();
    h.events.handle({
      type: 'response.output_item.done',
      item: { type: 'function_call', call_id: 'call_2', name: 'forget', arguments: '{"keyword":"dog"}' },
    });

    assert.deepEqual(h.calls, [{ call_id: 'call_2', name: 'forget', args: { keyword: 'dog' } }]);
  });

  it('treats unparseable or missing arguments as none', () => {
    const h = harness();
    h.events.handle({ ...CALL, arguments: '{not json' });
    h.events.handle({ ...CALL, call_id: 'call_3', arguments: undefined });

    assert.deepEqual(h.calls.map((c) => c.args), [{}, {}]);
  });

  it('ignores a call with no id or no name', () => {
    const h = harness();
    h.events.handle({ ...CALL, call_id: undefined });
    h.events.handle({ ...CALL, name: undefined });

    assert.deepEqual(h.calls, []);
  });

  it('lets the same call id through again on a fresh call', () => {
    const h = harness();
    h.events.handle(CALL);
    h.events.reset();
    h.events.handle(CALL);

    assert.equal(h.calls.length, 2);
  });
});
