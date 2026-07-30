import { readFileSync } from 'node:fs';

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

export function loadConfig(env = process.env) {
  const defaultVoice = env.XAI_VOICE || DEFAULT_VOICE;
  const defaultModel = env.XAI_MODEL || KNOWN_MODELS[0];

  return {
    port: Number(env.PORT) || 5173,
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
      mcpServers: loadMcpServers(env),
    },
  };
}
