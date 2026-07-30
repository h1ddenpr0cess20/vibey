import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodePCM, encodePCM } from '../../src/client/session/codec.js';

describe('PCM codec', () => {
  it('round-trips samples including the rails', () => {
    const samples = new Int16Array([0, 1, -1, 32767, -32768, 1234, -4321]);
    assert.deepEqual(decodePCM(encodePCM(samples)), samples);
  });

  it('encodes only the view it was given, not the whole buffer', () => {
    const backing = new Int16Array([11, 22, 33, 44, 55, 66]);
    const view = backing.subarray(2, 4);
    assert.deepEqual(decodePCM(encodePCM(view)), new Int16Array([33, 44]));
  });

  it('round-trips a chunk larger than the apply() batch size', () => {
    const samples = new Int16Array(70_000);
    for (let i = 0; i < samples.length; i++) samples[i] = (i * 37) % 32768;
    assert.deepEqual(decodePCM(encodePCM(samples)), samples);
  });

  it('refuses anything that is not whole samples', () => {
    assert.equal(decodePCM(encodePCM(new Uint8Array([1, 2, 3]))), null);
    assert.equal(decodePCM('not base64!!'), null);
    assert.equal(decodePCM(''), null);
    assert.equal(decodePCM(undefined), null);
  });
});
