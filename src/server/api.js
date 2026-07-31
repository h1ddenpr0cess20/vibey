import { sameOrigin } from './origin.js';

/** A body has to be small: this is settings, not an upload. */
const MAX_BODY = 64 * 1024;

function sendJSON(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJSON(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      /** Hanging up matters: a rejected promise does not stop the sender, and
       *  the rest of the body would go on being buffered into nothing. */
      if (raw.length > MAX_BODY) {
        req.destroy();
        reject(new Error('that is too much to be settings'));
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('that was not JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function createApiMiddleware(config, connectors) {
  /** Wiring this without the registry is how the panel ends up empty. */
  if (!connectors) throw new Error('createApiMiddleware needs the connectors registry');

  return async function api(req, res, next) {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/')) return next();

    /**
     * Anything that changes something has to have been asked for from this
     * page. A cross-site POST needs no preflight if it keeps the content type
     * simple, and this API takes a body without looking at that header — so
     * without this, a page in another tab can switch every agent on at its
     * loosest mode and point the workspace at the root of the disk.
     */
    if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) {
      return sendJSON(res, 403, { ok: false, error: 'that did not come from this page' });
    }

    if (path === '/api/config' && req.method === 'GET') {
      return sendJSON(res, 200, {
        models: config.models,
        model: config.defaultModel,
        voices: config.voices,
        voice: config.defaultVoice,
        tools: {
          web_search: config.tools.webSearch,
          x_search: config.tools.xSearch,
          code_interpreter: config.tools.code,
          memory: config.tools.memory,
          connectors: connectors.agents,
          mcp: config.tools.mcpServers.map((s) => s.server_label),
        },
        ready: Boolean(config.apiKey),
      });
    }

    /**
     * The connector setup, read and written from the panel. Which agents are
     * on, where they work, and how much they are allowed to do — applied to
     * the running server and saved, without an edit to a file or a restart.
     */
    if (path === '/api/connectors' && req.method === 'GET') {
      return sendJSON(res, 200, connectors.settings());
    }

    if (path === '/api/connectors' && (req.method === 'PUT' || req.method === 'POST')) {
      let patch;
      try {
        patch = await readJSON(req);
      } catch (err) {
        return sendJSON(res, 400, { ok: false, error: err.message });
      }
      const result = connectors.configure(patch);
      return sendJSON(res, result.ok ? 200 : 400, result);
    }

    /**
     * The tasks are read from here rather than only from the socket, so the
     * panel still has them after a reload and between calls. Dispatching is
     * not here on purpose: work goes out through the conversation, where it
     * gets read back to you first. Stopping one is the exception.
     */
    if (path === '/api/tasks' && req.method === 'GET') {
      return sendJSON(res, 200, { agents: connectors.agents, tasks: connectors.tasks() });
    }

    const stopping = /^\/api\/tasks\/([^/]+)\/stop$/.exec(path);
    if (stopping && req.method === 'POST') {
      let id;
      try {
        id = decodeURIComponent(stopping[1]);
      } catch {
        return sendJSON(res, 400, { ok: false, error: 'that is not a task number' });
      }
      const result = connectors.run('cancel_task', { id });
      return sendJSON(res, result.ok ? 200 : 409, result);
    }

    sendJSON(res, 404, { error: `no route for ${req.method} ${path}` });
  };
}
