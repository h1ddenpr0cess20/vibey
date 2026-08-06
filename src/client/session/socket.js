const PATH = '/realtime';

const OPEN_TIMEOUT = 15_000;

function socketUrl({ voice, model }) {
  const url = new URL(PATH, location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (voice) url.searchParams.set('voice', voice);
  if (model) url.searchParams.set('model', model);
  return url;
}

export function connect({
  voice,
  model,
  agent,
  memories = [],
  history = [],
  toolsOff = [],
  onEvent,
  onClose,
}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(socketUrl({ voice, model }));
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      reject(new Error('the connection to the proxy timed out'));
    }, OPEN_TIMEOUT);

    ws.addEventListener('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      /** Sent as the call opens, so the first session config already omits them. */
      if (toolsOff.length) ws.send(JSON.stringify({ type: 'session.tools', off: toolsOff }));
      if (memories.length) ws.send(JSON.stringify({ type: 'session.memory', memories }));
      /** Ahead of any audio, so the proxy has it before the call is under way. */
      if (history.length) ws.send(JSON.stringify({ type: 'session.history', turns: history }));
      if (agent) ws.send(JSON.stringify({ type: 'session.agent', agent }));
      resolve({
        get open() {
          return ws.readyState === WebSocket.OPEN;
        },
        send(event) {
          if (ws.readyState !== WebSocket.OPEN) return false;
          ws.send(JSON.stringify(event));
          return true;
        },
        close() {
          onClose = () => {};
          ws.close(1000);
        },
      });
    });

    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string') return;
      try {
        onEvent(JSON.parse(e.data));
      } catch {
      }
    });

    ws.addEventListener('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('could not reach the proxy — is it running? (npm run dev)'));
    });

    ws.addEventListener('close', (e) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        return reject(new Error(e.reason || 'the proxy closed the connection'));
      }
      onClose(e.code === 1000 || e.code === 1005 ? null : e.reason || 'the call dropped');
    });
  });
}
