const DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

export function createMemoryPanel({ root = document, memory, onChange } = {}) {
  const panelEl = root.querySelector('#memory');
  const listEl = root.querySelector('#memory-list');
  const toggleEl = root.querySelector('#memory-toggle');
  const switchEl = root.querySelector('#memory-switch');
  const clearEl = root.querySelector('#memory-clear');
  const closeEl = root.querySelector('#memory-close');
  const formEl = root.querySelector('#memory-add');
  const inputEl = root.querySelector('#memory-input');
  const doc = panelEl.ownerDocument;

  let armed = null;

  function disarm() {
    clearTimeout(armed);
    armed = null;
    clearEl.textContent = 'clear';
    clearEl.classList.remove('armed');
  }

  function itemEl(item, index) {
    const row = doc.createElement('li');
    row.className = 'memory-item';

    const text = doc.createElement('span');
    text.className = 'memory-text';
    text.append(item.text);

    const at = doc.createElement('span');
    at.className = 'chip meta';
    at.append(DAY.format(new Date(item.at)));

    const drop = doc.createElement('button');
    drop.className = 'chip';
    drop.type = 'button';
    drop.append('forget');
    drop.setAttribute('aria-label', `Forget: ${item.text}`);
    drop.addEventListener('click', () => {
      memory.removeAt(index);
      render();
    });

    row.append(text, at, drop);
    return row;
  }

  function render() {
    const items = memory.items;
    switchEl.setAttribute('aria-pressed', String(memory.enabled));
    switchEl.textContent = memory.enabled ? 'on' : 'off';
    panelEl.classList.toggle('off', !memory.enabled);
    inputEl.disabled = !memory.enabled;
    clearEl.disabled = !items.length;
    listEl.replaceChildren();

    if (!items.length) {
      const empty = doc.createElement('p');
      empty.className = 'empty';
      empty.append('Nothing remembered yet. Tell it to remember something, or type it here.');
      listEl.append(empty);
      return;
    }

    listEl.append(...items.map(itemEl));
  }

  memory.subscribe(() => {
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

  switchEl.addEventListener('click', () => {
    memory.enabled = !memory.enabled;
    render();
    onChange?.();
  });

  clearEl.addEventListener('click', () => {
    if (!armed) {
      clearEl.textContent = 'sure?';
      clearEl.classList.add('armed');
      armed = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    memory.clear();
    render();
    onChange?.();
  });

  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!memory.add(inputEl.value)) return;
    inputEl.value = '';
    render();
    onChange?.();
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
