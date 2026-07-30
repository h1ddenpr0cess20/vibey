import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { startApp } from '../helpers/app.js';

describe('GET /api/config', () => {
  let app;

  before(async () => {
    app = await startApp({
      XAI_MCP_SERVERS: JSON.stringify([{
        server_label: 'orders',
        server_url: 'https://mcp.example.com/mcp',
        authorization: 'Bearer hunter2',
      }]),
    });
  });

  after(() => app.close());

  it('names the pickers and their defaults', async () => {
    const body = await (await app.get('/api/config')).json();

    assert.ok(body.voices.includes(body.voice));
    assert.ok(body.models.includes(body.model));
    assert.equal(body.ready, true);
  });

  it('reports which tools are live by label only', async () => {
    const body = await (await app.get('/api/config')).json();

    assert.equal(body.tools.web_search, true);
    assert.equal(body.tools.x_search, true);
    assert.deepEqual(body.tools.mcp, ['orders']);
    const raw = JSON.stringify(body);
    assert.equal(raw.includes('hunter2'), false);
    assert.equal(raw.includes('mcp.example.com'), false);
  });

  it('reports a missing key rather than failing at the mic', async () => {
    const bare = await startApp({ XAI_API_KEY: '' });
    try {
      const body = await (await bare.get('/api/config')).json();
      assert.equal(body.ready, false);
    } finally {
      await bare.close();
    }
  });

  it('404s an unknown route', async () => {
    const res = await app.get('/api/nope');
    assert.equal(res.status, 404);
  });
});
