import { fetchTasks, stopTask } from './api.js';

/**
 * What the server is running on our behalf, mirrored in the page.
 *
 * Nothing here is authoritative: the tasks belong to the Node process, which
 * spawned them and is the only thing that can stop one. This holds the last
 * status of each, whether it arrived over the socket during a call or was
 * fetched between two of them, and tells the panel when that changed.
 */
export function createTaskBoard({ load = fetchTasks, stop = stopTask } = {}) {
  const board = new Map();
  const listeners = new Set();
  let agents = [];

  const announce = () => {
    for (const listener of listeners) listener();
  };

  /** Newest first, by the number the person hears — which is the order given out. */
  const byNewest = (a, b) => Number(b.id) - Number(a.id);

  return {
    get items() {
      return [...board.values()].sort(byNewest);
    },

    get running() {
      return [...board.values()].filter((task) => task.status === 'running').length;
    },

    /** Which agents this server can dispatch to — none means the feature is off. */
    get agents() {
      return [...agents];
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** One task, as the proxy just reported it. */
    apply(task) {
      if (!task?.id) return false;
      board.set(task.id, task);
      announce();
      return true;
    },

    /** The whole board, for a page that has just opened or has no call up. */
    async refresh() {
      const body = await load();
      agents = body.agents ?? [];
      board.clear();
      for (const task of body.tasks ?? []) board.set(task.id, task);
      announce();
      return agents;
    },

    /**
     * Stops one. The agent keeps whatever it has already written, and the
     * status that comes back is the one the server settled on, not a guess.
     */
    async stop(id) {
      try {
        const body = await stop(id);
        if (body.id) board.set(body.id, body);
        announce();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err?.message ?? String(err) };
      }
    },
  };
}
