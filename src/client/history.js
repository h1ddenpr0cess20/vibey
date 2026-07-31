export const KEY = 'vibey.history.v1';

const LIMIT = 40;
const BUDGET = 300_000;
const PROBE = `${KEY}.probe`;

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

export function defaultStorage() {
  try {
    const store = globalThis.localStorage;
    store.setItem(PROBE, '1');
    store.removeItem(PROBE);
    return store;
  } catch {
    return memoryStorage();
  }
}

/** Who a turn came from. The third one is not in the conversation: it is what
 *  a coding agent sent back, kept beside the talking that dispatched it. */
const ROLES = new Set(['user', 'assistant', 'agent']);

function newId(startedAt) {
  return `c${startedAt.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function valid(conversation) {
  return Boolean(
    conversation
    && typeof conversation.id === 'string'
    && Number.isFinite(conversation.startedAt)
    && Array.isArray(conversation.messages)
    && conversation.messages.every((m) => m && typeof m.content === 'string'),
  );
}

export function createHistory({
  storage = defaultStorage(),
  key = KEY,
  limit = LIMIT,
  budget = BUDGET,
  now = Date.now,
} = {}) {
  let conversations = load();
  let open = null;
  const listeners = new Set();

  function load() {
    try {
      const parsed = JSON.parse(storage.getItem(key) ?? 'null');
      if (parsed?.version !== 1 || !Array.isArray(parsed.conversations)) return [];
      return parsed.conversations.filter(valid);
    } catch {
      return [];
    }
  }

  function save() {
    for (;;) {
      if (conversations.length > limit) {
        conversations.pop();
        continue;
      }
      const body = JSON.stringify({ version: 1, conversations });
      if (body.length > budget && conversations.length > 1) {
        conversations.pop();
        continue;
      }
      try {
        storage.setItem(key, body);
      } catch {
        if (conversations.length > 1) {
          conversations.pop();
          continue;
        }
      }
      return;
    }
  }

  function changed() {
    for (const listener of listeners) listener();
  }

  function begin({ model, voice } = {}) {
    end();
    open = { id: newId(now()), startedAt: now(), endedAt: null, model, voice, messages: [] };
    return open;
  }

  function append(message) {
    const content = typeof message?.content === 'string' ? message.content.trim() : '';
    if (!content) return null;

    const role = ROLES.has(message.role) ? message.role : 'user';
    const turn = { role, content, at: now() };
    if (role === 'agent') {
      turn.agent = String(message.agent ?? 'agent');
      turn.taskId = String(message.taskId ?? '');
      turn.status = String(message.status ?? 'done');
      if (message.task) turn.task = String(message.task);
    }
    open ??= begin();
    if (!conversations.includes(open)) conversations.unshift(open);
    open.messages.push(turn);
    open.endedAt = turn.at;

    save();
    changed();
    return turn;
  }

  function end() {
    if (!open) return null;
    const closed = open;
    open = null;
    if (closed.messages.length) changed();
    return closed;
  }

  /**
   * Opens a stored conversation back up, so what is said next lands in it
   * instead of in a new entry. It moves to the top of the list on the way,
   * where the one being talked in belongs.
   */
  function resume(id) {
    const at = conversations.findIndex((c) => c.id === id);
    if (at < 0) return null;

    end();
    open = conversations[at];
    conversations.splice(at, 1);
    conversations.unshift(open);
    save();
    changed();
    return { ...open, messages: [...open.messages] };
  }

  return {
    begin,
    append,
    end,
    resume,

    get conversations() {
      return conversations.map((c) => ({ ...c, messages: [...c.messages] }));
    },

    get live() {
      return open?.id ?? null;
    },

    remove(id) {
      const at = conversations.findIndex((c) => c.id === id);
      if (at < 0) return false;
      if (conversations[at] === open) open = null;
      conversations.splice(at, 1);
      save();
      changed();
      return true;
    },

    clear() {
      conversations = [];
      open = null;
      try {
        storage.removeItem(key);
      } catch {}
      changed();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
