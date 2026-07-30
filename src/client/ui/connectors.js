import { fetchConnectors, saveConnectors } from '../api.js';

/** How long a stopped task waits before the server is asked again. */
const AFTER_STOP = 600;

const STATUS = {
  running: 'running',
  done: 'done',
  failed: 'failed',
  cancelled: 'stopped',
  timeout: 'timed out',
};

/** The modes that let an agent do more than edit inside its own workspace. */
const LOUD = /bypass|danger|dontAsk|auto/;

function elapsed(task, now = Date.now()) {
  const seconds = Math.max(0, Math.round(((task.endedAt ?? now) - task.startedAt) / 1000));
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/**
 * The panel behind the `connectors` button: the setup for the coding agents,
 * and what they are working on.
 *
 * Everything a person changes about a connector is here rather than in a file
 * — which agent is on, where it works, how much it is allowed to do — and it
 * takes effect on the running server, mid-call, without a restart.
 *
 * Dispatching is deliberately not here. Work goes out through the
 * conversation, where it gets read back to you first. The only thing this does
 * to a task is stop it.
 */
export function createConnectorsPanel({ root = document, board, onAgents } = {}) {
  const panelEl = root.querySelector('#connectors');
  const setupEl = root.querySelector('#connectors-setup');
  const listEl = root.querySelector('#connectors-list');
  const toggleEl = root.querySelector('#connectors-toggle');
  const saveEl = root.querySelector('#connectors-save');
  const closeEl = root.querySelector('#connectors-close');
  const noteEl = root.querySelector('#connectors-note');
  const doc = panelEl.ownerDocument;

  /** The last thing the server said the setup was, and the edits on top of it. */
  let settings = null;
  let edited = false;
  let clocks = [];
  let ticking = 0;
  const stopping = new Set();

  const fields = new Map();

  function say(message, bad = false) {
    noteEl.textContent = message ?? '';
    noteEl.classList.toggle('error', Boolean(bad));
    noteEl.classList.toggle('visible', Boolean(message));
  }

  function touched() {
    edited = true;
    saveEl.disabled = false;
    say('');
  }

  function field(label, el) {
    const wrap = doc.createElement('label');
    wrap.className = 'field';
    const name = doc.createElement('span');
    name.className = 'chip';
    name.append(label);
    wrap.append(name, el);
    return wrap;
  }

  function input(key, value, { type = 'text', placeholder = '' } = {}) {
    const el = doc.createElement('input');
    el.type = type;
    el.value = value ?? '';
    el.placeholder = placeholder;
    el.addEventListener('input', touched);
    fields.set(key, el);
    return el;
  }

  function select(key, options, value) {
    const el = doc.createElement('select');
    el.className = 'chip';
    el.replaceChildren(...options.map((option) => new Option(option, option)));
    el.value = value;
    el.addEventListener('change', touched);
    fields.set(key, el);
    return el;
  }

  function agentEl(agent) {
    const row = doc.createElement('section');
    row.className = 'agent';
    row.dataset.on = String(agent.enabled);

    const head = doc.createElement('header');

    const on = doc.createElement('button');
    on.type = 'button';
    on.className = 'chip switch';
    on.setAttribute('aria-pressed', String(agent.enabled));
    on.append(agent.enabled ? 'on' : 'off');
    on.addEventListener('click', () => {
      const now = on.getAttribute('aria-pressed') !== 'true';
      on.setAttribute('aria-pressed', String(now));
      on.textContent = now ? 'on' : 'off';
      row.dataset.on = String(now);
      touched();
    });
    fields.set(`${agent.name}.enabled`, on);

    const name = doc.createElement('span');
    name.className = 'chip agent-name';
    name.append(agent.label);

    const command = doc.createElement('span');
    command.className = 'chip meta';
    command.append(agent.command);

    head.append(on, name, command);

    const mode = select(`${agent.name}.mode`, agent.modes, agent.mode);
    const warn = doc.createElement('span');
    warn.className = 'agent-warn';
    const setWarn = () => {
      warn.textContent = LOUD.test(mode.value) ? 'this one can act outside the workspace' : '';
    };
    mode.addEventListener('change', setWarn);
    setWarn();

    const grid = doc.createElement('div');
    grid.className = 'agent-fields';
    grid.append(
      field('mode', mode),
      field('model', input(`${agent.name}.model`, agent.model, { placeholder: 'default' })),
      field('workspace', input(`${agent.name}.cwd`, agent.cwd, { placeholder: 'the one above' })),
    );

    row.append(head, grid, warn);
    return row;
  }

  function renderSetup() {
    fields.clear();
    setupEl.replaceChildren();
    if (!settings) return;

    const where = doc.createElement('div');
    where.className = 'agent-fields wide';
    where.append(
      field('workspace', input('cwd', settings.cwd, { placeholder: '/path/to/the/repo' })),
      field('at once', input('limit', settings.limit, { type: 'number' })),
      field('time limit', input('timeout', settings.timeout, { type: 'number' })),
    );

    setupEl.append(where, ...settings.agents.map(agentEl));
  }

  function taskEl(task) {
    const row = doc.createElement('section');
    row.className = 'task';
    row.dataset.status = task.status;

    const head = doc.createElement('header');

    const who = doc.createElement('span');
    who.className = 'chip task-who';
    who.append(`${task.agent} ${task.id}`);

    const state = doc.createElement('span');
    state.className = 'chip task-state';
    state.append(stopping.has(task.id) && task.status === 'running'
      ? 'stopping'
      : STATUS[task.status] ?? task.status);

    const clock = doc.createElement('span');
    clock.className = 'chip meta';
    clock.append(elapsed(task));
    if (task.status === 'running') clocks.push({ el: clock, task });

    head.append(who, state, clock);

    if (task.status === 'running') {
      const stop = doc.createElement('button');
      stop.className = 'chip';
      stop.type = 'button';
      stop.append('stop');
      stop.disabled = stopping.has(task.id);
      stop.setAttribute('aria-label', `Stop task ${task.id}`);
      stop.addEventListener('click', () => halt(task.id));
      head.append(stop);
    }

    const what = doc.createElement('p');
    what.className = 'task-what';
    what.append(task.task);

    row.append(head, what);

    const said = task.error || task.summary;
    if (said) {
      const outcome = doc.createElement('p');
      outcome.className = task.error ? 'task-said error' : 'task-said';
      outcome.append(said);
      row.append(outcome);
    }

    return row;
  }

  function renderTasks() {
    const items = board.items;
    clocks = [];
    listEl.replaceChildren();

    if (!items.length) {
      const empty = doc.createElement('p');
      empty.className = 'empty';
      empty.append(board.agents.length
        ? 'Nothing dispatched yet. Say what you want built — it goes out from the conversation.'
        : 'Switch an agent on above, then say what you want built.');
      listEl.append(empty);
      return;
    }

    listEl.append(...items.map(taskEl));
  }

  function render() {
    renderSetup();
    renderTasks();
    saveEl.disabled = !edited;
  }

  async function halt(id) {
    stopping.add(id);
    renderTasks();
    const { ok, error } = await board.stop(id);
    if (!ok) say(error, true);
    setTimeout(() => {
      stopping.delete(id);
      board.refresh().catch(() => renderTasks());
    }, AFTER_STOP);
  }

  function collect() {
    const patch = { agents: {} };
    patch.cwd = fields.get('cwd').value.trim();
    patch.limit = Number(fields.get('limit').value);
    patch.timeout = Number(fields.get('timeout').value);

    for (const agent of settings.agents) {
      patch.agents[agent.name] = {
        enabled: fields.get(`${agent.name}.enabled`).getAttribute('aria-pressed') === 'true',
        mode: fields.get(`${agent.name}.mode`).value,
        model: fields.get(`${agent.name}.model`).value.trim(),
        cwd: fields.get(`${agent.name}.cwd`).value.trim(),
      };
    }
    return patch;
  }

  async function save() {
    saveEl.disabled = true;
    try {
      settings = await saveConnectors(collect());
      edited = false;
      render();
      const on = settings.agents.filter((a) => a.enabled).map((a) => a.name);
      say(on.length ? `saved — ${on.join(' and ')} ready` : 'saved — no agent is on');
      onAgents?.(on);
      board.refresh().catch(() => {});
    } catch (err) {
      saveEl.disabled = false;
      say(err?.message ?? String(err), true);
    }
  }

  async function load() {
    try {
      settings = await fetchConnectors();
      edited = false;
      render();
    } catch (err) {
      say(err?.message ?? String(err), true);
    }
  }

  function tick() {
    for (const { el, task } of clocks) el.textContent = elapsed(task);
  }

  /** The count on the button is the whole point of it being a button. */
  function syncToggle() {
    const running = board.running;
    toggleEl.textContent = running ? `connectors ${running}` : 'connectors';
    toggleEl.classList.toggle('live', running > 0);

    clearInterval(ticking);
    ticking = running && !panelEl.hidden ? setInterval(tick, 1000) : 0;
  }

  board.subscribe(() => {
    if (!panelEl.hidden) renderTasks();
    syncToggle();
  });

  function open() {
    render();
    panelEl.hidden = false;
    toggleEl.setAttribute('aria-expanded', 'true');
    closeEl.focus();
    syncToggle();
    load();
    board.refresh().catch(() => {});
  }

  function close() {
    panelEl.hidden = true;
    toggleEl.setAttribute('aria-expanded', 'false');
    clearInterval(ticking);
    ticking = 0;
    say('');
  }

  toggleEl.addEventListener('click', () => (panelEl.hidden ? open() : close()));
  closeEl.addEventListener('click', close);
  saveEl.addEventListener('click', save);

  return {
    open,
    close,
    render,
    load,
    sync: syncToggle,
    get isOpen() {
      return !panelEl.hidden;
    },
  };
}
