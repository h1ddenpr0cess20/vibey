import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { fileURLToPath } from 'node:url';

import { createApiMiddleware } from './api.js';
import { loadConfig } from './config.js';
import { createRealtimeProxy } from './realtime.js';
import { createStaticMiddleware } from './static.js';

const DIST = fileURLToPath(new URL('../../dist', import.meta.url));

export const REALTIME_PATH = '/realtime';

export function chain(...middleware) {
  return (req, res) => {
    let i = 0;
    const next = () => {
      const fn = middleware[i++];
      if (!fn) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('not found');
      }
      Promise.resolve(fn(req, res, next)).catch((err) => {
        console.error(err);
        if (res.headersSent) return res.end();
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal error' }));
      });
    };
    next();
  };
}

export function createApp(config = loadConfig(), { root = DIST, tls = null } = {}) {
  const handle = chain(createApiMiddleware(config), createStaticMiddleware(root));
  const server = tls ? createSecureServer(tls, handle) : createServer(handle);
  const realtime = createRealtimeProxy(config);

  server.on('upgrade', (req, socket, head) => {
    if (req.url.split('?')[0] !== REALTIME_PATH) return socket.destroy();
    realtime.handleUpgrade(req, socket, head);
  });

  return server;
}
