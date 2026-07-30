import { readFileSync, statSync, writeFileSync } from 'node:fs';

import { AGENTS, AGENT_NAMES } from './agents.js';

/**
 * The connector settings, which are edited from the page rather than from the
 * environment — turning an agent on, pointing it at a workspace, choosing how
 * much it is allowed to do. The environment still sets the defaults, and the
 * file below is what the panel writes.
 *
 * One thing is deliberately not in here: the command each agent is run as.
 * That is the difference between configuring a tool and choosing which binary
 * this server executes, and the second one does not belong to anything a
 * browser can reach.
 */
export const SETTINGS_FILE = 'connectors.json';

const LIMITS = { timeout: [10, 86_400], limit: [1, 10] };

export function agentModes(name) {
  return AGENTS[name]?.modes ?? [];
}

/** The whole picture, as the panel needs it: what exists, not just what is on. */
export function describe(state) {
  return {
    cwd: state.cwd,
    timeout: Math.round(state.timeoutMs / 1000),
    limit: state.limit,
    announce: state.announce,
    agents: AGENT_NAMES.map((name) => {
      const agent = state.agents[name] ?? {};
      return {
        name,
        label: AGENTS[name].label,
        enabled: Boolean(agent.enabled),
        model: agent.model ?? '',
        mode: agent.mode ?? '',
        modes: agentModes(name),
        cwd: agent.cwd ?? '',
        command: (agent.command ?? [AGENTS[name].command]).join(' '),
      };
    }),
  };
}

function directory(path, what) {
  if (!path) return '';
  try {
    if (statSync(path).isDirectory()) return path;
  } catch {
    throw new Error(`${what} — there is no directory at ${path}`);
  }
  throw new Error(`${what} — ${path} is not a directory`);
}

function whole(value, [low, high], what) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number < low || number > high) {
    throw new Error(`${what} has to be a number between ${low} and ${high}`);
  }
  return number;
}

/**
 * A change from the panel, folded onto what is already there. Everything is
 * checked here rather than at the edge, because this is also what a file
 * written by hand goes through on the way in.
 */
export function applyPatch(state, patch = {}) {
  const next = {
    ...state,
    agents: Object.fromEntries(Object.entries(state.agents).map(([k, v]) => [k, { ...v }])),
  };

  if ('cwd' in patch) next.cwd = directory(String(patch.cwd ?? ''), 'the workspace') || state.cwd;
  if ('timeout' in patch) next.timeoutMs = whole(patch.timeout, LIMITS.timeout, 'the time limit') * 1000;
  if ('limit' in patch) next.limit = whole(patch.limit, LIMITS.limit, 'how many run at once');
  if ('announce' in patch) next.announce = Boolean(patch.announce);

  for (const [name, change] of Object.entries(patch.agents ?? {})) {
    if (!AGENT_NAMES.includes(name)) throw new Error(`there is no agent called ${name}`);
    const agent = next.agents[name] ?? blank(name);

    if ('enabled' in change) agent.enabled = Boolean(change.enabled);
    if ('model' in change) agent.model = String(change.model ?? '').trim().slice(0, 120);
    if ('cwd' in change) agent.cwd = directory(String(change.cwd ?? '').trim(), `${name}'s workspace`);
    if ('mode' in change) {
      const mode = String(change.mode ?? '').trim();
      if (mode && !agentModes(name).includes(mode)) {
        throw new Error(`${name} has no mode called ${mode}`);
      }
      agent.mode = mode;
    }

    next.agents[name] = agent;
  }

  return next;
}

function blank(name) {
  return {
    enabled: false,
    command: [AGENTS[name].command],
    model: '',
    mode: AGENTS[name].defaultMode ?? agentModes(name)[0] ?? '',
    extra: [],
    cwd: null,
  };
}

/** What goes in the file: the settings, never the command lines. */
export function persistable(state) {
  return {
    cwd: state.cwd,
    timeout: Math.round(state.timeoutMs / 1000),
    limit: state.limit,
    announce: state.announce,
    agents: Object.fromEntries(Object.entries(state.agents).map(([name, agent]) => [name, {
      enabled: Boolean(agent.enabled),
      model: agent.model ?? '',
      mode: agent.mode ?? '',
      cwd: agent.cwd ?? '',
    }])),
  };
}

export function readSettings(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSettings(path, state) {
  try {
    writeFileSync(path, `${JSON.stringify(persistable(state), null, 2)}\n`);
    return true;
  } catch (err) {
    console.warn(`connectors: could not save ${path} — ${err.message}`);
    return false;
  }
}

/** Every agent this build knows how to run, on or off. */
export function initialState(config) {
  const runtime = config.connectors ?? {};
  const agents = {};

  for (const name of AGENT_NAMES) {
    const configured = runtime.agents?.[name];
    agents[name] = configured
      ? { ...blank(name), ...configured, enabled: true }
      : blank(name);
  }

  const state = {
    agents,
    cwd: runtime.cwd ?? process.cwd(),
    timeoutMs: runtime.timeoutMs ?? 900_000,
    limit: runtime.limit ?? 3,
    announce: runtime.announce ?? true,
    file: runtime.file ?? SETTINGS_FILE,
  };

  const saved = readSettings(state.file);
  if (!saved) return state;

  try {
    return { ...applyPatch(state, saved), file: state.file };
  } catch (err) {
    console.warn(`connectors: ignoring ${state.file} — ${err.message}`);
    return state;
  }
}
