import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig, loadEnv } from 'vite';

import { createApiMiddleware } from './src/server/api.js';
import { loadConfig } from './src/server/config.js';
import { createConnectors } from './src/server/connectors/index.js';
import { REALTIME_PATH } from './src/server/app.js';
import { createRealtimeProxy } from './src/server/realtime.js';
import { CERT_DIR } from './src/server/tls.js';

function icyApi(env) {
  const config = loadConfig({ ...process.env, ...env });
  return {
    name: 'vibey-api',
    configureServer(server) {
      /** One registry for both, exactly as createApp does it — dev is not a
       *  second wiring of the same thing. */
      const connectors = createConnectors(config);

      server.middlewares.use(createApiMiddleware(config, connectors));

      const realtime = createRealtimeProxy(config, connectors);
      server.httpServer?.on('close', () => connectors.close());
      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (req.url.split('?')[0] !== REALTIME_PATH) return;
        realtime.handleUpgrade(req, socket, head);
      });

      if (!config.apiKey) {
        server.config.logger.warn('XAI_API_KEY is not set — the mic will fail until it is.');
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  const lan = mode === 'lan';

  return {
    plugins: [icyApi(env), ...(lan ? [basicSsl({ certDir: CERT_DIR })] : [])],
    server: {
      port: Number(env.PORT) || 5173,
      host: true,
    },
    resolve: {
      alias: { 'three/addons/': 'three/examples/jsm/' },
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      chunkSizeWarningLimit: 800,
    },
  };
});
