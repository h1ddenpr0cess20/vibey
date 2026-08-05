import { AGENT_NAMES } from './agents.js';
import { applyPatch, describe, initialState, writeSettings } from './settings.js';
import { createTasks } from './tasks.js';
import { connectorTools, isConnectorTool } from './tools.js';

/** How many tasks come back when the model asks for all of them. */
const RECENT = 10;

/**
 * The connectors: the tools Star can call to hand real work to a real coding
 * agent, and the tasks that come of it.
 *
 * One of these is made per server rather than per call. Which agents are on,
 * where they work and how much they may do is settings rather than startup —
 * the panel changes them while the thing is running, and every live call is
 * told about it so the model's tool list follows.
 */
export function createConnectors(config = {}) {
  let state = initialState(config);

  const watchers = new Set();
  const listeners = new Set();

  const enabled = () => AGENT_NAMES.filter((name) => state.agents[name]?.enabled);

  const tasks = createTasks({
    settings: () => ({
      agents: Object.fromEntries(enabled().map((name) => [name, state.agents[name]])),
      cwd: state.cwd,
      timeoutMs: state.timeoutMs,
      limit: state.limit,
    }),
    onChange: (task) => {
      for (const watcher of watchers) watcher(task);
    },
  });

  /**
   * Only handing work out needs an agent switched on. Looking in on work that
   * is already running, and stopping it, has to keep working after the last one
   * goes off — switching a connector off is what someone does when they want it
   * to stop, and it would otherwise leave a live agent editing files with no way
   * to reach it short of the time limit.
   */
  function run(name, args, { agent: picked } = {}) {
    const names = enabled();

    try {
      switch (name) {
        case 'dispatch_task': {
          if (!names.length) return { ok: false, error: 'no coding agent is switched on' };
          const asked = names.includes(args?.agent) ? args.agent : null;
          const agent = asked ?? (names.includes(picked) ? picked : names[0]);
          const task = tasks.dispatch({ agent, task: args?.task });
          return { ok: true, ...task, note: 'it is running now — say so, and check back rather than waiting' };
        }

        case 'check_task': {
          if (args?.id == null || args.id === '') {
            const all = tasks.list();
            return all.length
              ? { ok: true, tasks: all.slice(-RECENT) }
              : { ok: true, tasks: [], note: 'nothing has been dispatched this session' };
          }
          const task = tasks.get(args.id);
          return task ? { ok: true, ...task } : { ok: false, error: `there is no task ${args.id}` };
        }

        case 'cancel_task':
          return { ok: true, ...tasks.cancel(args?.id) };

        default:
          return { ok: false, error: `${name} is not a connector tool` };
      }
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }

  return {
    get enabled() {
      return enabled().length > 0;
    },

    get agents() {
      return enabled();
    },

    get announce() {
      return state.announce;
    },

    get tools() {
      return connectorTools(enabled());
    },

    /** Everything the panel shows, including the agents that are switched off. */
    settings: () => describe(state),

    /**
     * A change from the panel. It is validated, applied to the running server,
     * written to disk so it survives a restart, and announced — a call already
     * up has to be told, or the model keeps the tool list it dialled with.
     */
    configure(patch) {
      let next;
      try {
        next = applyPatch(state, patch);
      } catch (err) {
        return { ok: false, error: err?.message ?? String(err) };
      }

      state = { ...next, file: state.file };
      const saved = writeSettings(state.file, state);
      for (const listener of listeners) listener();
      return { ok: true, saved, ...describe(state) };
    },

    handles: (name) => isConnectorTool(name),
    run,
    tasks: () => tasks.list(),

    /** Every status change, for as long as the returned function isn't called. */
    watch(fn) {
      watchers.add(fn);
      return () => watchers.delete(fn);
    },

    /** Every settings change, for the same. */
    onSettings(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    close() {
      watchers.clear();
      listeners.clear();
      tasks.stopAll();
    },
  };
}
