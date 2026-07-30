import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { WebSocket } from 'ws';

import { createApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';
import { loadTls } from '../../src/server/tls.js';
import { startXaiStub } from '../helpers/xai-stub.js';

describe('tls', () => {
  it('stays on http by default — localhost is already a secure context', async () => {
    assert.equal(await loadTls({ env: {} }), null);
  });

  it('serves a real certificate when it is given one, without asking for --https', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vibey-tls-'));
    await writeFile(join(dir, 'key.pem'), 'a key');
    await writeFile(join(dir, 'cert.pem'), 'a certificate');

    const tls = await loadTls({
      env: { SSL_KEY: join(dir, 'key.pem'), SSL_CERT: join(dir, 'cert.pem') },
    });

    assert.deepEqual(tls, { key: 'a key', cert: 'a certificate' });
  });

  it('generates a self-signed certificate for --https', async () => {
    const tls = await loadTls({ https: true, env: {} });

    assert.equal(tls.key, tls.cert);
    const cert = new X509Certificate(tls.cert);
    assert.ok(new Date(cert.validTo) > new Date(), 'a certificate that is already expired is no use');
    assert.match(cert.subjectAltName ?? '', /IP Address:127\.0\.0\.1/);
  });

  describe('a server serving it', () => {
    let stub;
    let server;
    let port;

    before(async () => {
      stub = await startXaiStub();
      const config = loadConfig({ XAI_API_KEY: 'xai-test-key', XAI_REALTIME_URL: stub.address });
      server = createApp(config, {
        root: '/nonexistent',
        tls: await loadTls({ https: true, env: {} }),
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      ({ port } = server.address());
    });

    after(async () => {
      server.close();
      await Promise.all([once(server, 'close'), stub.close()]);
    });

    it('carries the realtime socket over wss', async () => {
      const ws = new WebSocket(`wss://127.0.0.1:${port}/realtime`, { rejectUnauthorized: false });
      await once(ws, 'open');

      ws.send(JSON.stringify({ type: 'response.cancel' }));
      const received = await stub.waitFor(1);

      assert.ok(received.some((f) => f.type === 'response.cancel'), 'nothing reached xAI');
      ws.terminate();
    });
  });
});
