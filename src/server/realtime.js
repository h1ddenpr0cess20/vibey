import { WebSocketServer, WebSocket } from 'ws';

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

export function createRealtimeProxy(config) {
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

    const tools = buildTools(config.tools);
    let pending = [];
    let memories = [];

    const update = () => JSON.stringify({
      type: 'session.update',
      session: sessionConfig({ voice, tools, memories }),
    });

    upstream.on('open', () => {
      upstream.send(update());
      for (const frame of pending) upstream.send(frame);
      pending = [];
      client.send(JSON.stringify({ type: 'proxy.ready', model, voice }));
    });

    upstream.on('message', (data, isBinary) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
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
      if (upstream.readyState === WebSocket.OPEN) upstream.close(1000);
      else upstream.terminate();
    });

    client.on('error', () => upstream.terminate());
  });

  return {
    handleUpgrade(req, socket, head) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
    close: () => wss.close(),
  };
}
