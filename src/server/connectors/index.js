import { createTasks } from './tasks.js';
import { connectorTools, isConnectorTool } from './tools.js';

/** How many tasks come back when the model asks for all of them. */
const RECENT = 10;

/**
 * The connectors: the tools Star can call to hand real work to a real coding
 * agent, and the tasks that come of it.
 *
 * One of these is made per proxy rather than per call, so a task survives a
 * redial — changing voice mid-session shouldn't lose track of what is running.
 * The work happens here, in the Node process, not in the page: the page never
 * learns what command was run, and the model never sees more than a status.
 */
export function createConnectors(config) {
  const names = config.tools?.connectors ?? [];
  const settings = config.connectors ?? {};
  const watchers = new Set();

  if (!names.length) {
    return {
      enabled: false,
      agents: [],
      tools: [],
      handles: () => false,
      run: () => ({ ok: false, error: 'no coding agent is connected' }),
      tasks: () => [],
      watch: () => () => {},
      close: () => {},
    };
  }

  const tasks = createTasks({
    agents: settings.agents,
    cwd: settings.cwd,
    timeoutMs: settings.timeoutMs,
    limit: settings.limit,
    onChange: (task) => {
      for (const watcher of watchers) watcher(task);
    },
  });

  function run(name, args) {
    try {
      switch (name) {
        case 'dispatch_task': {
          const agent = names.includes(args?.agent) ? args.agent : names[0];
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
    enabled: true,
    agents: [...names],
    tools: connectorTools(names),
    handles: (name) => isConnectorTool(name),
    run,
    tasks: () => tasks.list(),

    /** Every status change, for as long as the returned function isn't called. */
    watch(fn) {
      watchers.add(fn);
      return () => watchers.delete(fn);
    },

    close() {
      watchers.clear();
      tasks.stopAll();
    },
  };
}
