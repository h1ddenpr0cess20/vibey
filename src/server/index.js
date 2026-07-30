import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { loadTls } from './tls.js';

const config = loadConfig();
const tls = await loadTls({ https: process.argv.includes('--https') });

const app = createApp(config, { tls });

app.listen(config.port, () => {
  const scheme = tls ? 'https' : 'http';
  console.log(`vibey → ${scheme}://localhost:${config.port}`);
  if (tls) {
    console.log(`     → ${scheme}://<this machine on the wifi>:${config.port}`);
  }
  if (!config.apiKey) {
    console.warn('XAI_API_KEY is not set — the mic will fail until it is.');
  }
  const { webSearch, xSearch, mcpServers } = config.tools;
  const connectors = app.connectors.agents;
  const tools = [
    webSearch && 'web_search',
    xSearch && 'x_search',
    ...mcpServers.map((s) => `mcp:${s.server_label}`),
  ].filter(Boolean);
  console.log(`tools → ${tools.join(', ') || 'none'}`);
  console.log(connectors.length
    ? `connectors → ${connectors.join(', ')}, working in ${app.connectors.settings().cwd}`
    : 'connectors → none yet, switch one on in the connectors panel');
});
