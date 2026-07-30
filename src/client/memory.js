import { defaultStorage } from './history.js';

export const KEY = 'vibey.memory.v1';

const LIMIT = 25;
const MAX_LENGTH = 600;

function clean(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH);
}

function valid(item) {
  return Boolean(item && typeof item.text === 'string' && item.text.trim());
}

export function createMemory({
  storage = defaultStorage(),
  key = KEY,
  limit = LIMIT,
  now = Date.now,
} = {}) {
  const listeners = new Set();
  let { enabled, items } = load();

  function load() {
    try {
      const parsed = JSON.parse(storage.getItem(key) ?? 'null');
      if (parsed?.version !== 1) return { enabled: true, items: [] };
      return {
        enabled: parsed.enabled !== false,
        items: (Array.isArray(parsed.items) ? parsed.items : [])
          .filter(valid)
          .map((item) => ({ text: clean(item.text), at: Number(item.at) || now() }))
          .slice(-limit),
      };
    } catch {
      return { enabled: true, items: [] };
    }
  }

  function save() {
    try {
      storage.setItem(key, JSON.stringify({ version: 1, enabled, items }));
    } catch {}
  }

  function changed() {
    save();
    for (const listener of listeners) listener();
  }

  function add(text) {
    const content = clean(text);
    if (!content) return null;
    const already = items.find((item) => item.text.toLowerCase() === content.toLowerCase());
    if (already) return already;

    const item = { text: content, at: now() };
    items.push(item);
    if (items.length > limit) items = items.slice(-limit);
    changed();
    return item;
  }

  function matches(keyword) {
    const needle = clean(keyword).toLowerCase();
    if (!needle) return [];
    return items.filter((item) => item.text.toLowerCase().includes(needle));
  }

  function removeAt(index) {
    if (index < 0 || index >= items.length) return null;
    const [gone] = items.splice(index, 1);
    changed();
    return gone;
  }

  return {
    add,
    matches,
    removeAt,

    get enabled() {
      return enabled;
    },

    set enabled(next) {
      const value = Boolean(next);
      if (value === enabled) return;
      enabled = value;
      changed();
    },

    get items() {
      return items.map((item) => ({ ...item }));
    },

    get limit() {
      return limit;
    },

    /** The lines handed to the session — empty while memory is switched off. */
    lines() {
      return enabled ? items.map((item) => item.text) : [];
    },

    /** Drops every memory whose text contains `keyword`, case-insensitively. */
    forget(keyword) {
      const found = matches(keyword);
      if (!found.length) return [];
      items = items.filter((item) => !found.includes(item));
      changed();
      return found.map((item) => item.text);
    },

    clear() {
      if (!items.length) return;
      items = [];
      changed();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
