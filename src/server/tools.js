/**
 * Which of the server's tools a page is allowed to switch, and what happens
 * when it does.
 *
 * The environment decides what exists. This decides which of those the model is
 * offered on one call, from one browser, and it can only ever take away: a tool
 * the config never enabled has no switch, and nothing the page sends can put it
 * back. That is the whole of the contract — the page subtracts, the server
 * cannot be added to from outside.
 *
 * The connectors are not here. An agent that edits files on this machine is
 * switched on in its own panel, against the server, for everyone — a per-browser
 * switch is the wrong shape for it.
 */

/** The switchable tools, in the order the panel lists them. */
export function toolCatalog(tools = {}) {
  const catalog = [];
  if (tools.webSearch) catalog.push({ name: 'web_search', label: 'web search' });
  if (tools.xSearch) catalog.push({ name: 'x_search', label: 'X search' });
  if (tools.code) catalog.push({ name: 'code_interpreter', label: 'code' });
  for (const server of tools.mcpServers ?? []) {
    catalog.push({ name: `mcp:${server.server_label}`, label: server.server_label });
  }
  return catalog;
}

/**
 * The names in `off` this server actually has a switch for, deduplicated. A
 * page can hold a switch for a tool this server does not offer — an MCP server
 * that has since been taken out of the config — and saying so is not an error,
 * it just has nothing to turn off here.
 */
export function switchedOff(tools, off) {
  const known = new Set(toolCatalog(tools).map((tool) => tool.name));
  return [...new Set((Array.isArray(off) ? off : []).filter((name) => known.has(name)))];
}

/** The config's tools, minus the ones this page has switched off. */
export function pickTools(tools, off = []) {
  const dropped = new Set(switchedOff(tools, off));
  const on = (name) => !dropped.has(name);

  return {
    ...tools,
    webSearch: Boolean(tools.webSearch) && on('web_search'),
    xSearch: Boolean(tools.xSearch) && on('x_search'),
    code: Boolean(tools.code) && on('code_interpreter'),
    mcpServers: (tools.mcpServers ?? []).filter((server) => on(`mcp:${server.server_label}`)),
  };
}
