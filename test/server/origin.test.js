import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, describe, it } from 'node:test';

import { WebSocket } from 'ws';

import { sameOrigin } from '../../src/server/origin.js';
import { startApp } from '../helpers/app.js';
import { startXaiStub } from '../helpers/xai-stub.js';

const ELSEWHERE = 'https://evil.example';

describe('sameOrigin', () => {
  it('lets through what named no origin at all — that is not a browser', () => {
    assert.equal(sameOrigin({ headers: { host: 'localhost:5173' } }), true);
    assert.equal(sameOrigin({ headers: {} }), true);
  });

  it('lets through a page served by this same server', () => {
    assert.equal(sameOrigin({
      headers: { origin: 'http://localhost:5173', host: 'localhost:5173' },
    }), true);
    assert.equal(sameOrigin({
      headers: { origin: 'https://192.168.1.5:5173', host: '192.168.1.5:5173' },
    }), true);
  });

  it('turns down a page served by anything else', () => {
    assert.equal(sameOrigin({
      headers: { origin: ELSEWHERE, host: 'localhost:5173' },
    }), false);
    assert.equal(sameOrigin({
      headers: { origin: 'http://localhost:5174', host: 'localhost:5173' },
    }), false);
    /** A sandboxed frame, and anything else that is not a URL. */
    assert.equal(sameOrigin({ headers: { origin: 'null', host: 'localhost:5173' } }), false);
    assert.equal(sameOrigin({ headers: { origin: 'http://localhost:5173' } }), false);
  });
});

describe('a request from another page', () => {
  let xai;
  let app;

  before(async () => {
    xai = await startXaiStub();
    app = await startApp({ XAI_REALTIME_URL: xai.address, CONNECTORS: 'claude' });
  });

  after(async () => {
    await app.close();
    await xai.close();
  });

  const post = (path, { origin, body, type = 'text/plain;charset=UTF-8' } = {}) => fetch(
    `${app.origin}${path}`,
    {
      method: 'POST',
      headers: { 'content-type': type, ...(origin ? { origin } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );

  /**
   * A cross-site POST with a simple content type skips the preflight, so the
   * browser sends it whatever this server would have answered. The refusal has
   * to be the server's.
   */
  it('cannot rewrite the connector setup', async () => {
    const before = await (await app.get('/api/connectors')).json();

    const res = await post('/api/connectors', {
      origin: ELSEWHERE,
      body: { cwd: '/', agents: { codex: { enabled: true, mode: 'danger-full-access' } } },
    });
    assert.equal(res.status, 403);

    const after = await (await app.get('/api/connectors')).json();
    assert.deepEqual(after, before, 'nothing moved');
  });

  it('cannot stop work it did not dispatch', async () => {
    const res = await post('/api/tasks/1/stop', { origin: ELSEWHERE });
    assert.equal(res.status, 403);
  });

  /**
   * WebSockets are outside the same-origin policy, so this handshake is the one
   * an attacker actually gets to make. Through it they would be talking on our
   * key, and — with a connector on — spawning a CLI on the person's files.
   */
  it('cannot open the call socket', async () => {
    const ws = new WebSocket(`${app.origin.replace('http:', 'ws:')}/realtime`, {
      headers: { origin: ELSEWHERE },
    });
    const [err] = await once(ws, 'error');
    assert.match(err.message, /403/);
    assert.equal(xai.headers(), null, 'the proxy never dialled on their behalf');
  });

  it('leaves the page this server actually serves alone', async () => {
    const res = await fetch(`${app.origin}/api/connectors`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: app.origin },
      body: JSON.stringify({ agents: { claude: { mode: 'plan' } } }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);

    const ws = new WebSocket(`${app.origin.replace('http:', 'ws:')}/realtime`, {
      headers: { origin: app.origin },
    });
    await once(ws, 'open');
    ws.terminate();
  });

  it('reads are left open — a browser cannot see the answer anyway', async () => {
    const res = await fetch(`${app.origin}/api/config`, { headers: { origin: ELSEWHERE } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });
});

describe('a body bigger than the settings it claims to be', () => {
  let app;

  before(async () => {
    app = await startApp();
  });

  after(() => app.close());

  it('is turned down rather than buffered to the end', async () => {
    const res = await fetch(`${app.origin}/api/connectors`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(128 * 1024),
    }).catch((err) => err);

    /** Either the 400 lands or the hangup does — both mean it stopped reading. */
    if (res instanceof Error) return;
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /too much/);
  });

  it('turns a task number that is not one into a 400, not a 500', async () => {
    const res = await fetch(`${app.origin}/api/tasks/%/stop`, { method: 'POST' });
    assert.equal(res.status, 400);
  });
});
