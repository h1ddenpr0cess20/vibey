import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pickTools, switchedOff, toolCatalog } from '../../src/server/tools.js';

const server = (label) => ({ server_label: label, server_url: `https://${label}.example.com/mcp` });

const full = {
  webSearch: true,
  xSearch: true,
  code: true,
  memory: true,
  connectors: ['claude'],
  mcpServers: [server('orders'), server('rota')],
};

describe('toolCatalog', () => {
  it('names a switch for each tool the config turned on', () => {
    assert.deepEqual(toolCatalog(full), [
      { name: 'web_search', label: 'web search' },
      { name: 'x_search', label: 'X search' },
      { name: 'code_interpreter', label: 'code' },
      { name: 'mcp:orders', label: 'orders' },
      { name: 'mcp:rota', label: 'rota' },
    ]);
  });

  it('offers no switch for a tool the config left off', () => {
    const names = toolCatalog({ ...full, webSearch: false, code: false, mcpServers: [] })
      .map((t) => t.name);
    assert.deepEqual(names, ['x_search']);
  });

  it('leaves memory and the connectors out — both are switched elsewhere', () => {
    const names = toolCatalog(full).map((t) => t.name);
    assert.equal(names.includes('memory'), false);
    assert.equal(names.includes('claude'), false);
  });
});

describe('switchedOff', () => {
  it('keeps only names this server has a switch for, once each', () => {
    assert.deepEqual(
      switchedOff(full, ['x_search', 'x_search', 'mcp:gone', 'sudo', 'mcp:rota']),
      ['x_search', 'mcp:rota'],
    );
  });

  it('takes nothing at all from a page that sends nonsense', () => {
    assert.deepEqual(switchedOff(full, undefined), []);
    assert.deepEqual(switchedOff(full, 'web_search'), []);
    assert.deepEqual(switchedOff(full, [null, 7, {}]), []);
  });
});

describe('pickTools', () => {
  it('drops what the page switched off and leaves the rest alone', () => {
    const picked = pickTools(full, ['web_search', 'code_interpreter', 'mcp:orders']);

    assert.equal(picked.webSearch, false);
    assert.equal(picked.code, false);
    assert.equal(picked.xSearch, true);
    assert.equal(picked.memory, true);
    assert.deepEqual(picked.connectors, ['claude'], 'the connectors are not the page to switch');
    assert.deepEqual(picked.mcpServers.map((s) => s.server_label), ['rota']);
  });

  it('cannot switch a tool on that the config never enabled', () => {
    const picked = pickTools({ ...full, webSearch: false }, []);
    assert.equal(picked.webSearch, false);
  });

  it('is the config itself when nothing is switched off', () => {
    assert.deepEqual(pickTools(full), full);
    assert.deepEqual(pickTools(full, []), full);
  });
});
