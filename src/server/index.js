import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { loadTls } from './tls.js';

const config = loadConfig();
const tls = await loadTls({ https: process.argv.includes('--https') });

const app = createApp(config, { tls });

/**
 * This machine only, unless someone said otherwise. There are no accounts here
 * and the connectors edit real files, so reaching the wifi is a decision rather
 * than a default. TLS is that decision made: a phone is the reason to have it.
 *
 * Undefined rather than a wildcard address for the wide case — that is what
 * lets Node take both families where it can and fall back where it cannot.
 */
const local = !config.host && !tls;
const host = local ? '127.0.0.1' : config.host || undefined;

app.listen(config.port, host, () => {
  const scheme = tls ? 'https' : 'http';
  console.log(`vibey → ${scheme}://localhost:${config.port}`);
  if (host !== '127.0.0.1' && host !== '::1') {
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
