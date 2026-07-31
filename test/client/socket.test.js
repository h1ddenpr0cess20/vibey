import assert from 'node:assert/strict';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { WebSocket, WebSocketServer } from 'ws';

import { connect } from '../../src/client/session/socket.js';

/**
 * The page's end of the socket, against a server standing in for the proxy —
 * enough to see what a call says on the way up before anyone has spoken.
 */
describe('connect', () => {
  let wss;
  let received;
  let saved;

  beforeEach(async () => {
    received = [];
    wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(wss, 'listening');
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        try {
          received.push(JSON.parse(data.toString()));
        } catch {
        }
      });
    });

    const { port } = wss.address();
    saved = { WebSocket: globalThis.WebSocket, location: globalThis.location };
    globalThis.WebSocket = WebSocket;
    globalThis.location = { href: `http://127.0.0.1:${port}/` };
  });

  afterEach(async () => {
    globalThis.WebSocket = saved.WebSocket;
    globalThis.location = saved.location;
    if (globalThis.WebSocket === undefined) delete globalThis.WebSocket;
    if (globalThis.location === undefined) delete globalThis.location;
    await new Promise((resolve) => wss.close(resolve));
  });

  const dial = (options = {}) => connect({ onEvent: () => {}, onClose: () => {}, ...options });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  it('hands an earlier conversation over as the call opens', async () => {
    const turns = [
      { role: 'user', content: 'what should I build?' },
      { role: 'assistant', content: 'The small one. Ship it.' },
    ];

    const call = await dial({ history: turns });
    await settle();

    assert.deepEqual(received, [{ type: 'session.history', turns }]);
    call.close();
  });

  it('says nothing about a conversation that was not picked up', async () => {
    const call = await dial();
    await settle();

    assert.deepEqual(received, []);
    call.close();
  });

  it('sends the memories first, so both are up before any audio', async () => {
    const call = await dial({
      memories: ['they ship on fridays'],
      history: [{ role: 'user', content: 'hello' }],
    });
    await settle();

    assert.deepEqual(received.map((f) => f.type), ['session.memory', 'session.history']);
    call.close();
  });
});
