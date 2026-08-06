/**
 * The panel behind the `tools` button: what the model may reach for on this
 * call, with a switch each.
 *
 * The list is whatever the server offers — switching one off here takes it out
 * of the call being held right now, without a redial, and it stays off in this
 * browser until it is switched back on. Nothing here can add a tool: a server
 * that runs without web search has no web search switch to find.
 */
export function createToolsPanel({ root = document, switches, onChange } = {}) {
  const panelEl = root.querySelector('#toolbox');
  const listEl = root.querySelector('#toolbox-list');
  const toggleEl = root.querySelector('#toolbox-toggle');
  const closeEl = root.querySelector('#toolbox-close');
  const doc = panelEl.ownerDocument;

  function itemEl(tool) {
    const row = doc.createElement('li');
    row.className = 'tool-item';
    row.dataset.on = String(tool.enabled);

    const name = doc.createElement('span');
    name.className = 'tool-name';
    name.append(tool.label);

    const el = doc.createElement('button');
    el.className = 'chip switch';
    el.type = 'button';
    el.setAttribute('aria-pressed', String(tool.enabled));
    el.setAttribute('aria-label', `Switch ${tool.label} ${tool.enabled ? 'off' : 'on'}`);
    el.append(tool.enabled ? 'on' : 'off');
    el.addEventListener('click', () => {
      switches.toggle(tool.name);
      render();
      onChange?.();
    });

    row.append(name, el);
    return row;
  }

  function render() {
    const items = switches.items;
    listEl.replaceChildren();

    if (!items.length) {
      const empty = doc.createElement('p');
      empty.className = 'empty';
      empty.append('Nothing to switch — this server offers it no tools.');
      listEl.append(empty);
      return;
    }

    listEl.append(...items.map(itemEl));
  }

  function open() {
    render();
    panelEl.hidden = false;
    toggleEl.setAttribute('aria-expanded', 'true');
    closeEl.focus();
  }

  function close() {
    panelEl.hidden = true;
    toggleEl.setAttribute('aria-expanded', 'false');
  }

  toggleEl.addEventListener('click', () => (panelEl.hidden ? open() : close()));
  closeEl.addEventListener('click', close);

  return {
    open,
    close,
    render,
    get isOpen() {
      return !panelEl.hidden;
    },
  };
}
