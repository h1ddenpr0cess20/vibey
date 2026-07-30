import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { AGENTS, agentLabel } from './agents.js';

/** How much of each stream is kept while a task runs. The parsers read the end. */
const OUTPUT_CAP = 256 * 1024;

/** How long a killed agent gets to go quietly before it is killed properly. */
const KILL_GRACE = 5_000;

/** How much of the task text goes back to the model, and to the page. */
const TASK_LENGTH = 240;

/**
 * The tasks handed out this run, and the child processes behind them.
 *
 * A dispatch returns the moment the process is spawned — the whole point is
 * that the call carries on while the agent works — so everything after that is
 * a status change, reported through `onChange`.
 */
export function createTasks({ settings, onChange = () => {} } = {}) {
  const tasks = new Map();
  const children = new Map();
  let next = 1;

  function settle(task, status, { summary, error } = {}) {
    if (task.status !== 'running') return;
    task.status = status;
    task.endedAt = Date.now();
    if (summary) task.summary = summary;
    if (error) task.error = error;
    const child = children.get(task.id);
    clearTimeout(child?.timer);
    children.delete(task.id);
    onChange(view(task));
  }

  function dispatch({ agent: name, task: text }) {
    /** Read fresh: the panel can have changed any of this since the last task. */
    const { agents, cwd, timeoutMs, limit } = settings();
    const chosen = agents?.[name];
    if (!chosen) {
      throw new Error(`${name} is not switched on — on now: ${Object.keys(agents ?? {}).join(', ') || 'nothing'}`);
    }

    const work = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!work) throw new Error('there is no task in that');

    const live = [...tasks.values()].filter((t) => t.status === 'running');
    if (live.length >= limit) {
      throw new Error(`${limit} tasks are already running — wait for one, or cancel it`);
    }

    const agent = AGENTS[name];
    /** Resolved once, here: it is what the agent gets, what the task records,
     *  and what the panel shows — nobody has to ask the agent where it is. */
    const where = resolve(chosen.cwd || cwd || process.cwd());
    const [command, ...lead] = chosen.command;
    const args = [...lead, ...agent.args({ extra: [], ...chosen, task: work, cwd: where })];

    const task = {
      id: String(next++),
      agent: name,
      label: agentLabel(name),
      task: work,
      cwd: where,
      status: 'running',
      startedAt: Date.now(),
      endedAt: null,
      summary: '',
      error: '',
    };
    tasks.set(task.id, task);

    let stdout = '';
    let stderr = '';
    const keep = (buffer, chunk) => (buffer + chunk).slice(-OUTPUT_CAP);

    let child;
    try {
      child = spawn(command, args, {
        cwd: where,
        env: childEnv(where),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      settle(task, 'failed', { error: err.message });
      return view(task);
    }

    children.set(task.id, { child, timer: null });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout = keep(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = keep(stderr, chunk); });

    child.on('error', (err) => {
      const missing = err.code === 'ENOENT';
      settle(task, 'failed', {
        error: missing
          ? `${command} is not on the PATH — install the CLI, or point the connector at it`
          : err.message,
      });
    });

    child.on('close', (code) => {
      if (task.status !== 'running') return;

      const stopping = children.get(task.id)?.stopping;
      if (stopping) {
        settle(task, stopping, {
          error: stopping === 'timeout'
            ? 'it ran past the time limit and was stopped'
            : 'stopped before it finished',
        });
        return;
      }

      const { summary, error } = agent.parse(stdout, stderr);
      if (error || code !== 0) {
        settle(task, 'failed', {
          summary,
          error: error || `it exited ${code}${stderr.trim() ? ` — ${stderr.trim().slice(-400)}` : ''}`,
        });
        return;
      }
      settle(task, 'done', { summary: summary || 'it finished without saying anything' });
    });

    const held = children.get(task.id);
    if (held) held.timer = setTimeout(() => stop(task, 'timeout'), timeoutMs);

    onChange(view(task));
    return view(task);
  }

  /** Ask the child to stop, then insist. The status lands when it actually goes. */
  function stop(task, status) {
    const held = children.get(task.id);
    if (!held || held.stopping) return;
    held.stopping = status;
    clearTimeout(held.timer);
    held.child.kill('SIGTERM');
    held.timer = setTimeout(() => held.child.kill('SIGKILL'), KILL_GRACE);
    held.timer.unref?.();
  }

  return {
    dispatch,

    get: (id) => (tasks.has(String(id)) ? view(tasks.get(String(id))) : null),

    list: () => [...tasks.values()].map(view),

    cancel(id) {
      const task = tasks.get(String(id));
      if (!task) throw new Error(`there is no task ${id}`);
      if (task.status !== 'running') throw new Error(`task ${id} already ${task.status}`);
      stop(task, 'cancelled');
      return view(task);
    },

    /** Teardown: nothing outlives the server that started it. */
    stopAll() {
      for (const [id, held] of children) {
        clearTimeout(held.timer);
        held.child.kill('SIGKILL');
        children.delete(id);
      }
    },
  };
}

/**
 * The agents inherit the environment, minus the one credential that is ours.
 *
 * `PWD` is rewritten rather than inherited: spawning with a `cwd` moves the
 * process but leaves that variable pointing at wherever the server was started,
 * and anything downstream that trusts it rather than asking the kernel then
 * reports the wrong directory.
 */
function childEnv(cwd) {
  const env = { ...process.env, PWD: cwd };
  delete env.XAI_API_KEY;
  return env;
}

function humanDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

/** What a task looks like to the model and to the page — never the raw output. */
export function view(task) {
  const ran = (task.endedAt ?? Date.now()) - task.startedAt;
  return {
    id: task.id,
    agent: task.agent,
    label: task.label,
    status: task.status,
    task: task.task.length > TASK_LENGTH ? `${task.task.slice(0, TASK_LENGTH)}…` : task.task,
    ran_for: humanDuration(ran),
    cwd: task.cwd,
    /** For the panel, which counts a running task up itself rather than waiting. */
    startedAt: task.startedAt,
    endedAt: task.endedAt,
    ...(task.summary ? { summary: task.summary } : {}),
    ...(task.error ? { error: task.error } : {}),
  };
}
