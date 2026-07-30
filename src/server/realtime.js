import { WebSocketServer, WebSocket } from 'ws';

import { createConnectors } from './connectors/index.js';
import { buildTools, sessionConfig } from './persona.js';

const ALLOWED = new Set([
  'input_audio_buffer.append',
  'input_audio_buffer.commit',
  'input_audio_buffer.clear',
  'conversation.item.create',
  'response.create',
  'response.cancel',
]);

const MAX_FRAME = 1 << 20;

/**
 * The page's own frame, handled here and never forwarded: it carries the
 * memories held in browser storage, which the proxy folds into the session
 * instructions. The persona itself stays server-side and unreachable.
 */
export const MEMORY_EVENT = 'session.memory';

/**
 * The proxy's own frame down to the page: a task changed state. It carries a
 * status, never output — the page shows what is in flight and nothing else.
 */
export const TASK_EVENT = 'task.update';

/**
 * The other frame from the page that never leaves this process: which agent the
 * person picked in the composer. It is a default, not an order — the model can
 * still name one — and it lands mid-call, without a redial.
 */
export const AGENT_EVENT = 'session.agent';

/** Down to the page: which agents are on, after someone changed it in the panel. */
export const SETTINGS_EVENT = 'connectors.update';

/**
 * Which frames from xAI are worth parsing on the way past. Everything else is
 * forwarded as bytes — audio deltas are most of the traffic and the largest,
 * and none of this is worth a JSON.parse of every one of them.
 */
const INSPECT = /"(response\.created|response\.done|response\.output_item\.done|response\.function_call_arguments\.done|input_audio_buffer\.speech_(started|stopped))"/;

/** The function calls in one server event, whichever shape it arrived in. */
function functionCalls(event) {
  if (event.type === 'response.function_call_arguments.done') return [event];
  if (event.type === 'response.output_item.done') {
    return event.item?.type === 'function_call' ? [event.item] : [];
  }
  if (event.type === 'response.done') {
    return (event.response?.output ?? []).filter((item) => item?.type === 'function_call');
  }
  return [];
}

/** What the workspace says when a task settles, marked as not the person. */
function taskNote(task) {
  const what = `task ${task.id}, ${task.agent}, "${task.task}"`;
  switch (task.status) {
    case 'done':
      return `[vibey] ${what} finished after ${task.ran_for}. It reports: ${task.summary}`;
    case 'cancelled':
      return `[vibey] ${what} was stopped after ${task.ran_for}.`;
    case 'timeout':
      return `[vibey] ${what} was still going after ${task.ran_for} and was stopped.`;
    default:
      return `[vibey] ${what} failed after ${task.ran_for}. ${task.error ?? ''}`.trim();
  }
}

function safeCloseCode(code) {
  return code === 1000 || (code >= 3000 && code <= 4999) ? code : 1011;
}

export function sanitize(event) {
  if (!event || typeof event !== 'object' || !ALLOWED.has(event.type)) return null;

  if (event.type === 'response.create') {
    const { instructions, ...response } = event.response ?? {};
    return { ...event, response };
  }

  if (event.type === 'conversation.item.create') {
    const item = event.item;
    if (!item) return null;
    if (item.type === 'function_call_output') {
      const ok = typeof item.call_id === 'string' && typeof item.output === 'string';
      return ok ? event : null;
    }
    if (item.type !== 'message' || item.role !== 'user') return null;
  }

  return event;
}

/**
 * The connectors are made outside a call and shared with the API, because a
 * task has to survive a redial — and the panel has to be able to see one when
 * there is no call up at all.
 */
export function createRealtimeProxy(config, connectors = createConnectors(config)) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (client, req) => {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const voice = config.voices.includes(params.get('voice'))
      ? params.get('voice')
      : config.defaultVoice;
    const model = config.models.includes(params.get('model'))
      ? params.get('model')
      : config.defaultModel;

    const tell = (message) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'error', error: { message } }));
      }
    };

    if (!config.apiKey) {
      tell('XAI_API_KEY is not set — the proxy has nothing to dial with.');
      return client.close(4001, 'no api key');
    }

    const url = `${config.realtimeUrl}?model=${encodeURIComponent(model)}`;
    const upstream = new WebSocket(url, {
      headers: { authorization: `Bearer ${config.apiKey}` },
    });

    let pending = [];
    let memories = [];

    /** Built per send, not per call: the panel can switch an agent on mid-call. */
    const update = () => JSON.stringify({
      type: 'session.update',
      session: sessionConfig({
        voice,
        tools: buildTools({ ...config.tools, connectors: connectors.agents }),
        memories,
        agents: connectors.agents,
        tasks: connectors.tasks(),
      }),
    });

    const sendUp = (event) => {
      if (upstream.readyState !== WebSocket.OPEN) return false;
      upstream.send(JSON.stringify(event));
      return true;
    };

    const tellPage = (event) => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(event));
    };

    /** A tool call is answered once, whichever of the three frames carried it. */
    const answered = new Set();
    const notes = [];
    let responding = false;
    let talking = false;
    let preferred = connectors.agents[0] ?? null;

    /**
     * A note waits for a gap. Cutting into a response — or across the person
     * mid-sentence — to say a task finished is worse than saying it a moment
     * later, and the model asks for one response at a time.
     */
    function flushNotes() {
      if (!notes.length || responding || talking) return;
      const text = notes.splice(0).join('\n');
      const sent = sendUp({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      });
      if (sent) sendUp({ type: 'response.create' });
      else notes.unshift(text);
    }

    function answer(call) {
      const id = call?.call_id;
      const name = call?.name;
      if (!id || !connectors.handles(name) || answered.has(id)) return;
      answered.add(id);

      let args;
      try {
        args = call.arguments ? JSON.parse(call.arguments) : {};
      } catch {
        args = {};
      }

      const output = connectors.run(name, args, { agent: preferred });
      sendUp({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: id, output: JSON.stringify(output) },
      });
      sendUp({ type: 'response.create' });
    }

    /** Everything the proxy needs to know from a frame it is only passing on. */
    function inspect(text) {
      let event;
      try {
        event = JSON.parse(text);
      } catch {
        return;
      }

      switch (event.type) {
        case 'input_audio_buffer.speech_started': talking = true; break;
        case 'input_audio_buffer.speech_stopped': talking = false; break;
        case 'response.created': responding = true; break;
        case 'response.done': responding = false; break;
      }

      for (const call of functionCalls(event)) answer(call);
      if (event.type === 'response.done') flushNotes();
    }

    const unwatch = connectors.watch((task) => {
      tellPage({ type: TASK_EVENT, task });
      if (task.status === 'running' || !connectors.announce) return;
      notes.push(taskNote(task));
      flushNotes();
    });

    /** The agents changed under the call: re-declare the tools it may use. */
    const unlisten = connectors.onSettings(() => {
      if (!connectors.agents.includes(preferred)) preferred = connectors.agents[0] ?? null;
      if (upstream.readyState === WebSocket.OPEN) upstream.send(update());
      tellPage({ type: SETTINGS_EVENT, agents: connectors.agents });
    });

    upstream.on('open', () => {
      upstream.send(update());
      for (const frame of pending) upstream.send(frame);
      pending = [];
      client.send(JSON.stringify({ type: 'proxy.ready', model, voice }));
      for (const task of connectors.tasks()) tellPage({ type: TASK_EVENT, task });
      flushNotes();
    });

    upstream.on('message', (data, isBinary) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
      if (isBinary || !connectors.enabled) return;
      const text = data.toString();
      if (INSPECT.test(text)) inspect(text);
    });

    upstream.on('error', (err) => {
      tell(`the call to xAI failed — ${err.message}`);
    });

    upstream.on('close', (code, reason) => {
      if (client.readyState === WebSocket.OPEN) {
        client.close(safeCloseCode(code), reason?.toString().slice(0, 120) || '');
      }
    });

    client.on('message', (data, isBinary) => {
      if (isBinary || data.length > MAX_FRAME) return;

      let incoming;
      try {
        incoming = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (incoming?.type === AGENT_EVENT) {
        if (connectors.agents.includes(incoming.agent)) preferred = incoming.agent;
        return;
      }

      if (incoming?.type === MEMORY_EVENT) {
        if (!config.tools.memory) return;
        memories = Array.isArray(incoming.memories) ? incoming.memories : [];
        if (upstream.readyState === WebSocket.OPEN) upstream.send(update());
        return;
      }

      const event = sanitize(incoming);
      if (!event) return;

      const frame = JSON.stringify(event);
      if (upstream.readyState === WebSocket.OPEN) upstream.send(frame);
      else if (upstream.readyState === WebSocket.CONNECTING) pending.push(frame);
    });

    client.on('close', () => {
      pending = [];
      unwatch();
      unlisten();
      if (upstream.readyState === WebSocket.OPEN) upstream.close(1000);
      else upstream.terminate();
    });

    client.on('error', () => {
      unwatch();
      unlisten();
      upstream.terminate();
    });
  });

  return {
    handleUpgrade(req, socket, head) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
    close: () => wss.close(),
  };
}
