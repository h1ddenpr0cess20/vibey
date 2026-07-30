import { AUDIO_RATE } from './constants.js';

const WORKLET_URL = `${import.meta.env?.BASE_URL ?? '/'}pcm-worklet.js`;

const LEAD = 0.08;

export function createPlayer(ctx, destination) {
  let cursor = 0;
  let sources = new Set();

  return {
    enqueue(samples) {
      if (!samples?.length) return;

      const buffer = ctx.createBuffer(1, samples.length, AUDIO_RATE);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) {
        channel[i] = samples[i] / (samples[i] < 0 ? 32768 : 32767);
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(destination);

      const at = Math.max(cursor, ctx.currentTime + LEAD);
      source.start(at);
      cursor = at + buffer.duration;

      sources.add(source);
      source.onended = () => sources.delete(source);
    },

    flush() {
      for (const source of sources) {
        source.onended = null;
        try {
          source.stop();
        } catch {
        }
      }
      sources = new Set();
      cursor = 0;
    },

    get playing() {
      return cursor > ctx.currentTime;
    },
  };
}

export async function createCapture(ctx, stream, onFrame) {
  await ctx.audioWorklet.addModule(WORKLET_URL);

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'pcm-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  });

  node.port.onmessage = (e) => onFrame(new Int16Array(e.data));
  source.connect(node);

  return {
    node,
    close() {
      node.port.onmessage = null;
      node.port.postMessage('stop');
      source.disconnect();
      node.disconnect();
    },
  };
}

export async function createAudio() {
  const ctx = new AudioContext({ sampleRate: AUDIO_RATE, latencyHint: 'interactive' });
  if (ctx.state === 'suspended') await ctx.resume();

  const gain = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.4;
  analyser.buffer = new Float32Array(analyser.fftSize);

  gain.connect(analyser);
  analyser.connect(ctx.destination);

  return { ctx, output: gain, outAnalyser: analyser };
}
