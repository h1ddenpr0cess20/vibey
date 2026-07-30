const LABELS = {
  remember: 'remembering that',
  forget: 'forgetting that',
  dispatch_task: 'handing it over',
  check_task: 'checking on it',
  cancel_task: 'calling it off',
};

/**
 * The HUD caption for a tool call, or null for a name nobody labels. Not every
 * label belongs to a tool the page runs — the connectors are answered by the
 * proxy, and the call still passes through here on its way to the model.
 */
export function toolLabel(name) {
  return LABELS[name] ?? null;
}

/**
 * The client-side function tools, keyed by the name the model calls. Each one
 * takes the parsed arguments and returns the object sent back as the call's
 * output.
 */
export function createTools({ memory }) {
  return {
    remember(args) {
      if (!memory.enabled) return { ok: false, error: 'memory is switched off' };
      const stored = memory.add(args?.memory);
      if (!stored) return { ok: false, error: 'nothing worth storing in that' };
      return { ok: true, remembered: stored.text, total: memory.items.length };
    },

    forget(args) {
      if (!memory.enabled) return { ok: false, error: 'memory is switched off' };
      const keyword = typeof args?.keyword === 'string' ? args.keyword : '';
      if (!keyword.trim()) return { ok: false, error: 'no keyword to match on' };
      const forgotten = memory.forget(keyword);
      if (!forgotten.length) return { ok: false, keyword, error: 'nothing stored matches that' };
      return { ok: true, keyword, forgotten, total: memory.items.length };
    },
  };
}
