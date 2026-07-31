import { readFileSync } from 'node:fs';

import { AGENT_NAMES, AGENTS, splitArgs } from './connectors/agents.js';

export const KNOWN_VOICES = Object.freeze([
  'leo', 'rex', 'sal', 'atlas', 'zagan', 'orion', 'perseus',
  'helix', 'zenith', 'rigel', 'castor', 'ursa', 'naksh', 'kepler',
  'ara', 'eve', 'carina', 'luna', 'iris', 'celeste', 'lumen',
  'lux', 'cosmo', 'sirius', 'altair', 'helios',
]);

/** The one Star opens on. Named rather than positional, so the picker can keep
 *  xAI's own ordering without that deciding who answers. */
export const DEFAULT_VOICE = 'sirius';

export const KNOWN_MODELS = Object.freeze(['grok-voice-latest', 'grok-voice-think-fast-1.0']);

function flag(value, fallback) {
  if (value == null || value === '') return fallback;
  return !/^(0|false|no|off)$/i.test(value);
}

function loadMcpServers(env) {
  const raw = env.XAI_MCP_SERVERS || readMcpFile(env.XAI_MCP_FILE || 'mcp.json');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.filter((s) => {
      const ok = s && typeof s.server_url === 'string' && typeof s.server_label === 'string';
      if (!ok) console.warn('mcp: dropping an entry without server_url + server_label');
      return ok;
    });
  } catch (err) {
    console.warn(`mcp: could not parse the server list — ${err.message}`);
    return [];
  }
}

function readMcpFile(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** Where each agent's own settings come from, and what it is called there. */
const CONNECTOR_ENV = Object.freeze({
  claude: { prefix: 'CLAUDE', mode: 'CLAUDE_PERMISSION_MODE', defaultMode: 'acceptEdits' },
  codex: { prefix: 'CODEX', mode: 'CODEX_SANDBOX', defaultMode: 'workspace-write' },
  opencode: { prefix: 'OPENCODE', mode: 'OPENCODE_PERMISSION_MODE', defaultMode: 'default' },
  grok: { prefix: 'GROK', mode: 'GROK_PERMISSION_MODE', defaultMode: 'acceptEdits' },
});

/** How long an agent may work before it is stopped, and how many may at once. */
const DEFAULT_TIMEOUT = 900;
const DEFAULT_LIMIT = 3;

/**
 * The coding agents this server may hand work to. Off unless `CONNECTORS` names
 * one: a connector runs a CLI that edits files, so it is opt-in on the machine
 * that would be edited, never a default.
 */
function loadConnectors(env) {
  const chosen = (env.CONNECTORS ?? '')
    .split(/[,\s]+/)
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

  const names = [];
  const agents = {};

  for (const name of chosen) {
    if (!AGENT_NAMES.includes(name)) {
      console.warn(`connectors: no agent called ${name} — known: ${AGENT_NAMES.join(', ')}`);
      continue;
    }
    if (names.includes(name)) continue;

    const { prefix, mode, defaultMode } = CONNECTOR_ENV[name];
    const command = splitArgs(env[`${prefix}_COMMAND`]);
    names.push(name);
    agents[name] = {
      command: command.length ? command : [AGENTS[name].command],
      model: env[`${prefix}_MODEL`] || '',
      mode: env[mode] ?? defaultMode,
      extra: splitArgs(env[`${prefix}_ARGS`]),
      cwd: env[`${prefix}_CWD`] || null,
    };
  }

  return {
    names,
    runtime: {
      agents,
      cwd: env.CONNECTOR_CWD || process.cwd(),
      file: env.CONNECTOR_FILE || 'connectors.json',
      timeoutMs: (Number(env.CONNECTOR_TIMEOUT) || DEFAULT_TIMEOUT) * 1000,
      limit: Number(env.CONNECTOR_LIMIT) || DEFAULT_LIMIT,
      announce: flag(env.CONNECTOR_ANNOUNCE, true),
    },
  };
}

export function loadConfig(env = process.env) {
  const defaultVoice = env.XAI_VOICE || DEFAULT_VOICE;
  const defaultModel = env.XAI_MODEL || KNOWN_MODELS[0];
  const connectors = loadConnectors(env);

  return {
    port: Number(env.PORT) || 5173,
    /** Empty means "decide from how it was started" — see src/server/index.js. */
    host: env.HOST || '',
    apiKey: env.XAI_API_KEY,
    realtimeUrl: env.XAI_REALTIME_URL || 'wss://api.x.ai/v1/realtime',
    defaultModel,
    defaultVoice,
    voices: KNOWN_VOICES.includes(defaultVoice)
      ? [...KNOWN_VOICES]
      : [defaultVoice, ...KNOWN_VOICES],
    models: KNOWN_MODELS.includes(defaultModel)
      ? [...KNOWN_MODELS]
      : [defaultModel, ...KNOWN_MODELS],
    tools: {
      webSearch: flag(env.XAI_WEB_SEARCH, true),
      xSearch: flag(env.XAI_X_SEARCH, true),
      code: flag(env.XAI_CODE_INTERPRETER, true),
      memory: flag(env.MEMORY, true),
      connectors: connectors.names,
      mcpServers: loadMcpServers(env),
    },
    connectors: connectors.runtime,
  };
}
