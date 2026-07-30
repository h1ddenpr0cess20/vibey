const INLINE = [
  { tag: 'code', re: /`([^`\n]+)`/ },
  { tag: 'strong', re: /\*\*(\S|\S[\s\S]*?\S)\*\*/ },
  { tag: 'strong', re: /__(\S|\S[\s\S]*?\S)__/ },
  { tag: 's', re: /~~(\S|\S[\s\S]*?\S)~~/ },
  { tag: 'em', re: /(?<![\w*])\*(\S|\S[\s\S]*?\S)\*(?!\w)/ },
  { tag: 'em', re: /(?<![\w_])_(\S|\S[\s\S]*?\S)_(?!\w)/ },
];

function firstSpan(text) {
  let found = null;
  for (const { tag, re } of INLINE) {
    const m = re.exec(text);
    if (m && (!found || m.index < found.at)) {
      found = { tag, at: m.index, width: m[0].length, body: m[1] };
    }
  }
  return found;
}

function render(text, into) {
  let rest = text;
  for (let span = firstSpan(rest); span; span = firstSpan(rest)) {
    if (span.at) into.append(rest.slice(0, span.at));
    const el = into.ownerDocument.createElement(span.tag);
    if (span.tag === 'code') el.append(span.body);
    else render(span.body, el);
    into.append(el);
    rest = rest.slice(span.at + span.width);
  }
  if (rest) into.append(rest);
  return into;
}

export function createHud(root = document) {
  const statusEl = root.querySelector('#status');
  const captionEl = root.querySelector('#caption');
  const youEl = root.querySelector('#you');
  const toolEl = root.querySelector('#tool');
  const tasksEl = root.querySelector('#tasks');

  return {
    setState(state) {
      statusEl.dataset.state = state;
      statusEl.textContent = state;
    },

    showUser(text) {
      youEl.textContent = text;
      youEl.classList.add('visible');
    },

    hideUser() {
      youEl.classList.remove('visible');
    },

    setCaption(text) {
      captionEl.classList.remove('error');
      captionEl.classList.add('visible');
      captionEl.replaceChildren();
      render(text, captionEl);
      captionEl.scrollTop = captionEl.scrollHeight;
    },

    clearCaption() {
      captionEl.replaceChildren();
      captionEl.classList.remove('visible', 'error');
    },

    setTool(label) {
      toolEl.textContent = label ?? '';
      toolEl.classList.toggle('visible', Boolean(label));
    },

    /** Only what is still running: a finished task is Star's to report, not a chip's. */
    setTasks(tasks) {
      const live = tasks.filter((task) => task.status === 'running');
      tasksEl.textContent = live.length
        ? `${live.map((task) => `${task.agent} ${task.id}`).join(' · ')} · running`
        : '';
      tasksEl.classList.toggle('visible', live.length > 0);
    },

    showError(message) {
      captionEl.textContent = message;
      captionEl.classList.add('visible', 'error');
    },

    showTools({ web_search: web, x_search: x, code_interpreter: code, memory, connectors = [], mcp }) {
      const names = [web && 'web', x && 'X', code && 'code', memory && 'memory', ...connectors, ...mcp]
        .filter(Boolean);
      const el = root.querySelector('#tools');
      el.textContent = names.length ? `tools: ${names.join(' · ')}` : '';
      el.classList.toggle('visible', names.length > 0);
    },
  };
}
