/**
 * The coding agents a task can be handed to, as command lines.
 *
 * Both are run headless, once per task, in the workspace directory — no TTY, no
 * prompt to answer, nothing to attend to while they work. What comes back on
 * stdout is a machine format that each CLI has already changed once, so the
 * parsers take the shape they know and fall back to the tail of the output
 * rather than failing a task over a renamed field.
 */

/** How much of an agent's answer rides back to the model. It gets read aloud. */
export const SUMMARY_LENGTH = 1200;

export const AGENTS = Object.freeze({
  claude: {
    label: 'Claude Code',
    command: 'claude',
    /** Its permission modes, safest first. The panel offers exactly these. */
    modes: ['plan', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions'],
    /** What it is switched on as: enough to do the work, no wider. */
    defaultMode: 'acceptEdits',
    /** `-p` is print mode: one task, no session, a JSON document on stdout. */
    args({ task, model, mode, extra }) {
      return [
        '-p', task,
        '--output-format', 'json',
        ...(mode ? ['--permission-mode', mode] : []),
        ...(model ? ['--model', model] : []),
        ...extra,
      ];
    },
    parse(stdout, stderr) {
      const last = findLast(jsonObjects(stdout), (o) => typeof o.result === 'string');
      if (last) {
        return last.is_error
          ? { error: trim(last.result) || 'the run reported an error' }
          : { summary: trim(last.result) };
      }
      return { summary: trim(fallback(stdout, stderr)) };
    },
  },

  codex: {
    label: 'Codex',
    command: 'codex',
    /** Its sandbox policies, safest first. */
    modes: ['read-only', 'workspace-write', 'danger-full-access'],
    defaultMode: 'workspace-write',
    /** `exec` is the non-interactive path; without a sandbox it may only read. */
    args({ task, model, mode, extra }) {
      return [
        'exec',
        '--json',
        ...(mode ? ['--sandbox', mode] : []),
        ...(model ? ['--model', model] : []),
        ...extra,
        task,
      ];
    },
    parse(stdout, stderr) {
      const text = lastAgentMessage(jsonObjects(stdout));
      return { summary: trim(text || fallback(stdout, stderr)) };
    },
  },
});

export const AGENT_NAMES = Object.freeze(Object.keys(AGENTS));

export function agentLabel(name) {
  return AGENTS[name]?.label ?? name;
}

/**
 * A command line from the environment, split the way a shell would split the
 * simple half of one — so `CODEX_COMMAND` can wrap the CLI in `npx`, `docker
 * exec`, or anything else that ends up taking the flags we append.
 */
export function splitArgs(line) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let m = re.exec(line ?? ''); m; m = re.exec(line ?? '')) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

function trim(text) {
  const flat = (text ?? '').trim();
  return flat.length > SUMMARY_LENGTH ? `…${flat.slice(-SUMMARY_LENGTH)}` : flat;
}

function findLast(list, ok) {
  for (let i = list.length - 1; i >= 0; i--) if (ok(list[i])) return list[i];
  return null;
}

/**
 * Every JSON object in the output, in order. The CLIs disagree about whether
 * that is one document or one event per line, and a stray log line in the
 * middle of either is not a reason to lose the rest.
 */
function jsonObjects(text) {
  const whole = (text ?? '').trim();
  if (!whole) return [];

  try {
    const parsed = JSON.parse(whole);
    return Array.isArray(parsed) ? parsed.filter(isObject) : [parsed].filter(isObject);
  } catch {
    // Not one document, so read it as a line per event.
  }

  const found = [];
  for (const line of whole.split('\n')) {
    const start = line.trim();
    if (!start.startsWith('{') && !start.startsWith('[')) continue;
    try {
      const parsed = JSON.parse(start);
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        if (isObject(item)) found.push(item);
      }
    } catch {
      // A partial line, or prose that happens to open with a brace.
    }
  }
  return found;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object';
}

const MESSAGE_TYPE = /agent_message|assistant|task_complete|result/;
const MESSAGE_KEYS = ['text', 'message', 'last_agent_message'];

/** The last thing the agent said, out of a stream of events about itself. */
function lastAgentMessage(objects) {
  let found = '';
  for (const object of objects) {
    const item = isObject(object.item) ? object.item : isObject(object.msg) ? object.msg : object;
    const type = String(item.item_type ?? item.type ?? object.type ?? '');
    if (!MESSAGE_TYPE.test(type)) continue;
    for (const key of MESSAGE_KEYS) {
      if (typeof item[key] === 'string' && item[key].trim()) found = item[key];
    }
  }
  return found;
}

/** No format we recognise: keep the end of what it actually printed. */
function fallback(stdout, stderr) {
  const prose = (stdout ?? '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('{'))
    .join('\n')
    .trim();
  return prose || (stdout ?? '').trim() || (stderr ?? '').trim();
}
