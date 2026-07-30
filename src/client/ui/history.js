const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

function when(at, now = Date.now()) {
  const then = new Date(at);
  const today = new Date(now);
  const sameDay = then.toDateString() === today.toDateString();
  return sameDay ? TIME.format(then) : `${DAY.format(then)}, ${TIME.format(then)}`;
}

const WHO = { user: 'you', assistant: 'star' };

export function createHistoryPanel({ root = document, history, onNew } = {}) {
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
    section.append(head);

    for (const turn of conversation.messages) {
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
