const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

function when(at, now = Date.now()) {
  const then = new Date(at);
  const today = new Date(now);
  const sameDay = then.toDateString() === today.toDateString();
  return sameDay ? TIME.format(then) : `${DAY.format(then)}, ${TIME.format(then)}`;
}

const WHO = { user: 'you', assistant: 'star' };

/** What a coding agent's turn is labelled with, and what it did, above it. */
function agentHead(doc, turn) {
  const head = doc.createElement('span');
  head.className = 'who chip';
  head.append([turn.agent, turn.taskId].filter(Boolean).join(' '));

  const state = doc.createElement('span');
  state.className = 'chip agent-status';
  state.append(turn.status === 'done' ? 'done' : turn.status);

  return [head, state];
}

export function createHistoryPanel({ root = document, history, onNew, onResume, onClear } = {}) {
  const panelEl = root.querySelector('#history');
  const logEl = root.querySelector('#history-log');
  const toggleEl = root.querySelector('#history-toggle');
  const newEl = root.querySelector('#history-new');
  const clearEl = root.querySelector('#history-clear');
  const closeEl = root.querySelector('#history-close');
  const doc = panelEl.ownerDocument;

  let armed = null;

  function disarm() {
    clearTimeout(armed);
    armed = null;
    clearEl.textContent = 'clear';
    clearEl.classList.remove('armed');
  }

  /**
   * Picks an old conversation back up: it becomes the one being talked in, and
   * what was said in it goes over to the model as context. The one already
   * being talked in says so instead — there is nothing to pick up.
   */
  function resumeEl(conversation) {
    const live = conversation.id === history.live;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'chip resume';
    button.disabled = live;
    button.append(live ? 'live' : 'continue');
    if (!live) {
      button.setAttribute('aria-label', `Continue the conversation from ${when(conversation.startedAt)}`);
      button.addEventListener('click', () => {
        close();
        onResume?.(conversation.id);
      });
    }
    return button;
  }

  function conversationEl(conversation) {
    const section = doc.createElement('section');
    section.className = 'entry';

    const head = doc.createElement('header');
    head.className = 'chip';
    head.append(when(conversation.startedAt));
    const meta = [conversation.voice, conversation.model].filter(Boolean).join(' · ');
    if (meta) {
      const dim = doc.createElement('span');
      dim.className = 'meta';
      dim.append(meta);
      head.append(dim);
    }
    head.append(resumeEl(conversation));
    section.append(head);

    for (const turn of conversation.messages) {
      if (turn.role === 'agent') {
        section.append(agentEl(turn));
        continue;
      }

      const line = doc.createElement('p');
      line.className = 'turn';
      line.dataset.role = turn.role;

      const who = doc.createElement('span');
      who.className = 'who chip';
      who.append(WHO[turn.role] ?? turn.role);

      line.append(who, turn.content);
      section.append(line);
    }

    return section;
  }

  /** An agent's turn is a block rather than a line: what it was asked, then
   *  what it sent back, which is longer than anything anyone says out loud. */
  function agentEl(turn) {
    const block = doc.createElement('div');
    block.className = 'turn agent';
    block.dataset.role = 'agent';
    block.dataset.status = turn.status;

    const head = doc.createElement('p');
    head.className = 'agent-head';
    head.append(...agentHead(doc, turn));
    block.append(head);

    if (turn.task) {
      const asked = doc.createElement('p');
      asked.className = 'agent-task';
      asked.append(turn.task);
      block.append(asked);
    }

    const said = doc.createElement('p');
    said.className = 'agent-said';
    said.append(turn.content);
    block.append(said);

    return block;
  }

  function render() {
    const conversations = history.conversations;
    newEl.disabled = !history.live;
    logEl.replaceChildren();

    if (!conversations.length) {
      const empty = doc.createElement('p');
      empty.className = 'empty';
      empty.append('Nothing here yet. Talk to it and the session lands here.');
      logEl.append(empty);
      clearEl.disabled = true;
      return;
    }

    clearEl.disabled = false;
    logEl.append(...conversations.map(conversationEl));
    logEl.scrollTop = 0;
  }

  history.subscribe(() => {
    if (!panelEl.hidden) render();
  });

  function open() {
    render();
    panelEl.hidden = false;
    toggleEl.setAttribute('aria-expanded', 'true');
    closeEl.focus();
  }

  function close() {
    disarm();
    panelEl.hidden = true;
    toggleEl.setAttribute('aria-expanded', 'false');
  }

  toggleEl.addEventListener('click', () => (panelEl.hidden ? open() : close()));
  closeEl.addEventListener('click', close);

  newEl.addEventListener('click', () => {
    close();
    onNew?.();
  });

  clearEl.addEventListener('click', () => {
    if (!armed) {
      clearEl.textContent = 'sure?';
      clearEl.classList.add('armed');
      armed = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    history.clear();
    onClear?.();
    render();
  });

  return {
    open,
    close,
    render,
    get isOpen() {
      return !panelEl.hidden;
    },
  };
}
