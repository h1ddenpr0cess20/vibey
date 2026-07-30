export function amplitude(analyser) {
  analyser.getFloatTimeDomainData(analyser.buffer);
  let sum = 0;
  for (const v of analyser.buffer) sum += v * v;
  return Math.min(1, Math.sqrt(sum / analyser.buffer.length) * 7);
}

export function createAnalyser(ctx, source) {
  const node = ctx.createAnalyser();
  node.fftSize = 1024;
  node.smoothingTimeConstant = 0.4;
  node.buffer = new Float32Array(node.fftSize);
  source.connect(node);
  return node;
}

export const ATTACK = 0.45;
export const RELEASE = 0.12;

export function follow(level, target) {
  return level + (target - level) * (target > level ? ATTACK : RELEASE);
}
