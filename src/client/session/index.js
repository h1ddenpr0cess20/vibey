import { createAudio, createCapture, createPlayer } from './audio.js';
import { encodePCM } from './codec.js';
import { createEmitter } from './emitter.js';
import { createEventHandler } from './events.js';
import { amplitude, createAnalyser, follow } from './metering.js';
import { connect } from './socket.js';
import { createTools, toolLabel } from './tools.js';

const MIC_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
};

/** How much of an earlier conversation rides along when one is picked up. */
const PRIOR_TURNS = 40;
const PRIOR_CHARS = 6000;

/**
 * The turns of an earlier conversation, trimmed to what is worth carrying and
 * cut down to the two roles a conversation has. They travel as turns rather
 * than as a summary of turns, because that is what the realtime API takes: one
 * `conversation.item.create` each, a user message holding `input_text` and an
 * assistant message holding `output_text`. Describing the history inside a
 * single message instead leaves the model with no history at all — only
 * somebody telling it about one.
 *
 * The oldest go first when there are too many: what was said last is what the
 * next sentence is most likely to follow from.
 */
export function prior(turns = []) {
  const kept = turns
    .filter((turn) => turn?.content && (turn.role === 'user' || turn.role === 'assistant'))
    .slice(-PRIOR_TURNS)
    .map((turn) => ({ role: turn.role, content: String(turn.content).slice(0, PRIOR_CHARS) }));

  let total = kept.reduce((sum, turn) => sum + turn.content.length, 0);
  while (total > PRIOR_CHARS && kept.length > 1) {
    total -= kept.shift().content.length;
  }

  return kept;
}

function micUnavailable() {
  if (navigator.mediaDevices?.getUserMedia) return null;
  return globalThis.isSecureContext === false
    ? 'the microphone needs a secure page, and this one is plain http:// — serve it over https (npm run dev:lan) or open it on localhost'
    : 'this browser won’t hand over a microphone — try opening the page in Safari or Chrome';
}

export function createVoiceSession({ model, voice, agent, memory, switches } = {}) {
  const { on, emit } = createEmitter();
  const messages = [];
  const tools = memory ? createTools({ memory }) : {};

  let currentModel = model;
  let currentVoice = voice;
  let currentAgent = agent;

  let call = null;
  let audio = null;
  let capture = null;
  let player = null;
  let micStream = null;
  let micAnalyser = null;

  let state = 'idle';
  let context = [];
  let muted = false;
  let connecting = false;
  let generation = 0;
  let picked = 0;
  let dialledPick = 0;

  let frame = 0;
  let level = 0;

  function setState(next) {
    if (state === next) return;
    state = next;
    emit('state', next);
  }

  function fail(message) {
    emit('error', { message });
  }

  /**
   * Answers a function call the model made. The result has to go back as a
   * `function_call_output` item followed by a fresh `response.create` — without
   * the second frame the model waits forever on its own tool.
   *
   * A name we don't run is not ours to answer: the connectors are handled by
   * the proxy, and all this does for one of those is put a label up.
   */
  function runTool({ call_id: callId, name, args }) {
    const label = toolLabel(name);
    if (label) emit('tool', label);

    const tool = tools[name];
    if (!tool) return;

    let output;
    try {
      output = tool(args);
    } catch (err) {
      output = { ok: false, error: err?.message ?? String(err) };
    }

    call?.send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(output) },
    });
    call?.send({ type: 'response.create' });
    emit('memory', output);
  }

  const events = createEventHandler({
    setState,
    emit,
    fail,
    messages,
    play: (samples) => player?.enqueue(samples),
    flushAudio: () => player?.flush(),
    playing: () => player?.playing ?? false,
    onFunctionCall: runTool,
  });

  function tick() {
    frame = requestAnimationFrame(tick);

    if (state === 'speaking' && !player.playing) setState('listening');

    const analyser = state === 'speaking' ? audio.outAnalyser : state === 'listening' ? micAnalyser : null;
    level = follow(level, analyser ? amplitude(analyser) : 0);
    emit('level', level);
  }

  async function start() {
    if (call || connecting) return;
    connecting = true;
    const mine = ++generation;
    const abandoned = () => mine !== generation;

    try {
      const unavailable = micUnavailable();
      if (unavailable) throw new Error(unavailable);
      micStream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      if (abandoned()) return stop();

      audio = await createAudio();
      if (abandoned()) return stop();

      micAnalyser = createAnalyser(audio.ctx, audio.ctx.createMediaStreamSource(micStream));
      player = createPlayer(audio.ctx, audio.output);

      dialledPick = picked;
      call = await connect({
        voice: currentVoice,
        model: currentModel,
        agent: currentAgent,
        memories: memory?.lines() ?? [],
        toolsOff: switches?.off ?? [],
        history: prior(context),
        onEvent: events.handle,
        onClose: (reason) => {
          if (!call) return;
          if (reason) fail(reason);
          stop();
        },
      });
      if (abandoned()) return stop();

      capture = await createCapture(audio.ctx, micStream, (samples) => {
        if (muted) return;
        call?.send({ type: 'input_audio_buffer.append', audio: encodePCM(samples) });
      });
      if (abandoned()) return stop();

      frame = requestAnimationFrame(tick);
      setState('listening');
    } catch (err) {
      fail(err?.message ?? String(err));
      stop();
    } finally {
      connecting = false;
    }
  }

  function stop() {
    generation++;
    const closing = call;
    call = null;

    cancelAnimationFrame(frame);
    frame = 0;
    level = 0;
    emit('level', 0);

    player?.flush();
    capture?.close();
    closing?.close();
    micStream?.getTracks().forEach((track) => track.stop());
    audio?.ctx.close();

    call = capture = player = micStream = audio = micAnalyser = null;
    muted = false;
    events.reset();
    setState('idle');
  }

  function send(text) {
    const content = text.trim();
    if (!content || !call?.open) return;
    messages.push({ role: 'user', content });
    emit('message', { role: 'user', content });
    call.send({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: content }] },
    });
    call.send({ type: 'response.create' });
    setState('thinking');
  }

  return {
    on,
    start,
    stop,
    send,
    get messages() {
      return messages;
    },
    /**
     * The turns of a conversation being picked up again. They are handed over
     * on the next dial rather than now — there may be no call yet, and this is
     * what a redial re-sends, so a voice change mid-conversation keeps it.
     */
    get context() {
      return context;
    },
    set context(turns) {
      context = Array.isArray(turns) ? turns : [];
    },
    /** Hands the current memories to a call already in progress. */
    syncMemory() {
      if (!memory || !call?.open) return false;
      return call.send({ type: 'session.memory', memories: memory.lines() });
    },
    /**
     * The same for the tool switches: the proxy re-declares the tools on the
     * call that is up, so one goes out of reach mid-sentence rather than at the
     * next dial.
     */
    syncTools() {
      if (!switches || !call?.open) return false;
      return call.send({ type: 'session.tools', off: switches.off });
    },
    get connected() {
      return call?.open ?? false;
    },
    get busy() {
      return events.responding;
    },
    get state() {
      return state;
    },
    get muted() {
      return muted;
    },
    set muted(next) {
      muted = Boolean(next);
      micStream?.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    },
    get model() {
      return currentModel;
    },
    set model(next) {
      currentModel = next;
      picked++;
    },
    get voice() {
      return currentVoice;
    },
    set voice(next) {
      currentVoice = next;
      picked++;
    },
    /** Which agent gets the work. Unlike voice and model, it lands mid-call. */
    get agent() {
      return currentAgent;
    },
    set agent(next) {
      currentAgent = next;
      if (next && call?.open) call.send({ type: 'session.agent', agent: next });
    },
    get stale() {
      return !!call && picked !== dialledPick;
    },
    cancel() {
      if (!call?.open) return;
      if (events.responding) call.send({ type: 'response.cancel' });
      events.interrupt();
    },
  };
}
