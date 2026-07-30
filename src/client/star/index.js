import { buildEnvironment } from './environment.js';
import { buildStar, createLobes } from './geometry.js';
import { createGrab } from './grab.js';
import { DEAD, ENERGY_GAIN, MOODS, PALETTE, STALLED } from './moods.js';

function spring(s, k, c, dt, to = 0) {
  s.v += (to - s.p) * k * dt - s.v * c * dt;
  s.p += s.v * dt;
}

const FRAME = { y: 0.06, halfW: 1.5, halfH: 1.5 };
const MARGIN = 1.25;

export function createStar({ stage, THREE }) {
  buildEnvironment({ stage, THREE });

  const {
    group, body, shell,
    shellGeo, shellMat, shellDirs, shellBase,
    core, coreGeo, coreMat, coreDirs, coreBase,
    glowMat, halo, haloMat, haloWide, haloWideMat,
  } = buildStar(THREE);

  const LOBES = createLobes(THREE);

  let state = 'idle';
  let broken = false;
  const target = { ...MOODS.idle };
  const m = { ...MOODS.idle };

  let sustain = 0;
  let impulse = 0;
  let energy = 0;
  let lastEnergy = 0;

  const clock = new THREE.Clock();
  let t = 0;
  let phase = 0;
  let hue = 0;

  // Body springs: squash, rock about z, lean about x.
  const sq = { p: 0, v: 0 };
  const tz = { p: 0, v: 0 };
  const tx = { p: 0, v: 0 };

  let y = 0, yV = 0, airborne = false;
  let x = 0, z = 0;
  let vx = 0, vz = 0;
  let heading = 0.7;
  let evtT = 2.2;

  // A five-point star is a pinwheel: all of its spin is about z.
  let angle = 0;
  let spinRate = 0;
  let tossed = false;

  let dead = 0;

  const v = new THREE.Vector3();
  const tint = new THREE.Color();
  const warm = new THREE.Color('#fff2dc');
  const deadTint = new THREE.Color(DEAD);
  const palette = PALETTE.map((hex) => new THREE.Color(hex));

  const paletteAt = (at, out) => {
    const f = ((at % palette.length) + palette.length) % palette.length;
    const i = Math.floor(f);
    return out.copy(palette[i]).lerp(palette[(i + 1) % palette.length], f - i);
  };

  const land = (force) => {
    sq.v += force;
    tz.v += (Math.random() - 0.5) * force * 0.7;
    tx.v += (Math.random() - 0.5) * force * 0.45;
  };

  let hand = null;

  /** Throw it up and set it spinning — what entering `thinking` looks like. */
  const kick = () => {
    if (hand?.held) { tossed = true; return; }
    spinRate = (Math.random() < 0.5 ? -1 : 1) * (7 + Math.random() * 5);
    yV = 2.2 + Math.random() * 0.6;
    airborne = true;
    tossed = true;
    sq.v -= 2.4;
    heading = Math.random() * Math.PI * 2;
  };

  const frame = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    t += dt;
    const held = Boolean(hand?.held);

    impulse = Math.max(0, impulse - impulse * Math.min(1, dt * 3.4) - dt * 0.05);
    lastEnergy = energy;
    energy += (Math.min(1, sustain + impulse) - energy) * Math.min(1, dt * 6);
    dead += ((broken ? 1 : 0) - dead) * Math.min(1, dt * 2.2);

    const flying = airborne || tossed;
    const mood = broken ? STALLED : (flying ? MOODS.tossed : (MOODS[state] ?? MOODS.idle));
    for (const k in target) {
      target[k] = mood[k];
      m[k] += (mood[k] - m[k]) * Math.min(1, dt * 3.4);
    }

    const gain = ENERGY_GAIN;

    if (!held) {
      if (airborne) {
        yV -= 13 * dt; y += yV * dt;
        if (y <= 0) {
          y = 0;
          if (Math.abs(yV) > 0.9) {
            yV = -yV * 0.42;
            land(4.5 + Math.abs(yV));
            spinRate *= 0.55;
            x += Math.cos(heading) * 0.16; z += Math.sin(heading) * 0.16;
          } else {
            airborne = false; yV = 0;
            land(5.5);
          }
        }
      } else {
        y += (0 - y) * Math.min(1, dt * 8);
      }
    }

    if (!held) {
      x += vx * dt; z += vz * dt;
      const friction = Math.min(1, dt * (airborne ? 0.5 : 3.0));
      vx -= vx * friction; vz -= vz * friction;

      v.set(x, y, z);
      if (hand?.contain(v)) {
        x = v.x; z = v.z;
        if (airborne) y = Math.max(0, v.y);
        vx *= 0.4; vz *= 0.4;
      }
    }

    const travel = Math.hypot(vx, vz);
    if (tossed && !held && !airborne && travel < 0.12) tossed = false;

    // Rolling across the floor drives the pinwheel; in the air it just bleeds
    // off. On top of that sits whatever idle drift the mood asks for.
    if ((held || !airborne) && travel > 0.02) {
      spinRate += (-vx / 0.85 - spinRate) * Math.min(1, dt * 6);
    }
    angle += (spinRate + m.spin * 1.4) * dt;
    spinRate -= spinRate * Math.min(1, dt * (airborne ? 1.1 : 3.2));

    if (!airborne && !flying && !broken && !held) {
      evtT -= dt;
      if (evtT <= 0) {
        const r = Math.random();
        if (r < 0.4) sq.v += 1.8;
        else if (r < 0.7) { tz.v += (Math.random() - 0.5) * 4; tx.v += 1.2; }
        else { yV = 1.1 + Math.random() * 0.5; airborne = true; spinRate += 2.5; sq.v -= 1.6; }
        evtT = 2.8 + Math.random() * 4.5;
      }
    }

    if (state === 'speaking' && !broken) {
      const onset = Math.max(0, energy - lastEnergy);
      if (onset > 0.008) {
        sq.v += onset * 24;
        tz.v += (Math.random() - 0.5) * onset * 26;
      }
    }

    spring(sq, 185, 11, dt);
    const rockAmt = Math.sin(t * (m.rockSpeed + energy * gain.rockSpeed) * 2.0)
      * (m.rock + energy * gain.rock);
    spring(tz, 68, 6.2, dt, rockAmt);
    spring(tx, 68, 6.2, dt, m.lean * 0.2);

    const tremor = (m.jitter + energy * gain.jitter) * 0.014;

    phase += dt * (m.speed + energy * gain.speed);
    hue += dt * m.hue;

    // ---- the goo: every vertex is its base star position, swelled by the sum
    //      of the lobes and scaled by the breath ----
    const wobble = m.wobble + energy * gain.wobble;
    const breathe = 1 + Math.sin(phase * 1.5) * m.breathe;

    const pos = shellGeo.attributes.position;
    const arr = pos.array;
    for (let i = 0; i < arr.length; i += 3) {
      v.set(shellDirs[i], shellDirs[i + 1], shellDirs[i + 2]);
      let d = 0;
      for (const l of LOBES) {
        d += l.amp * Math.sin(l.freq * v.dot(l.dir) * 2.35 + phase * l.speed * 2.2 + l.phase);
      }
      const s = (1 + d * wobble) * breathe;
      arr[i] = shellBase[i] * s;
      arr[i + 1] = shellBase[i + 1] * s;
      arr[i + 2] = shellBase[i + 2] * s;
    }
    pos.needsUpdate = true;
    shellGeo.computeVertexNormals();

    // The core runs the same lobes backwards, so it slides inside the shell
    // instead of moving with it.
    const cpos = coreGeo.attributes.position;
    const ca = cpos.array;
    for (let i = 0; i < ca.length; i += 3) {
      v.set(coreDirs[i], coreDirs[i + 1], coreDirs[i + 2]);
      let d = 0;
      for (let j = 0; j < 3; j++) {
        const l = LOBES[j];
        d += l.amp * 1.5 * Math.sin(l.freq * v.dot(l.dir) * 2.6 - phase * l.speed * 3 + l.phase);
      }
      const s = 1 + d * wobble;
      ca[i] = coreBase[i] * s;
      ca[i + 1] = coreBase[i + 1] * s;
      ca[i + 2] = coreBase[i + 2] * s;
    }
    cpos.needsUpdate = true;
    coreGeo.computeVertexNormals();

    // ---- the light ----
    paletteAt(hue, tint).lerp(deadTint, dead);
    const lit = m.glow + energy * gain.glow;
    const bloom = m.halo + energy * gain.halo;

    shellMat.color.copy(tint);
    shellMat.attenuationColor.copy(tint).lerp(warm, 0.35);
    shellMat.transmission = 0.9 - dead * 0.55;
    shellMat.iridescence = 0.35 * (1 - dead);

    coreMat.emissive.copy(tint);
    coreMat.emissiveIntensity = lit;

    glowMat.uniforms.uColor.value.copy(tint);
    glowMat.uniforms.uStrength.value = bloom * 8.5 * (0.94 + Math.sin(phase * 2.1) * 0.06);

    haloMat.color.copy(tint);
    haloMat.opacity = 0.42 + bloom * 2.6 * (0.96 + Math.sin(phase * 1.7) * 0.04);
    halo.scale.setScalar(4.9 + bloom * 1.6 + Math.sin(phase * 1.3) * 0.12);

    haloWideMat.color.copy(tint);
    haloWideMat.opacity = 0.12 + bloom * 1.1;
    haloWide.scale.setScalar(8 + bloom * 6);

    // ---- where it all sits ----
    core.position.set(
      Math.sin(phase * 0.7) * 0.02,
      Math.sin(phase * 0.9) * 0.018,
      Math.cos(phase * 0.6) * 0.01);
    core.rotation.z = Math.sin(phase * 0.3) * 0.12;

    group.position.set(
      x + (Math.random() - 0.5) * tremor,
      y + Math.abs(rockAmt) * 0.34,
      z + (Math.random() - 0.5) * tremor);
    group.rotation.set(
      tx.p + (Math.random() - 0.5) * tremor,
      Math.sin(phase * 0.2) * 0.12,
      tz.p + (Math.random() - 0.5) * tremor * 1.3);

    body.rotation.z = angle;

    const s = sq.p * 0.075;
    body.scale.set(1 + s * 0.45, 1 - s * 0.8, 1 + s * 0.45);
  };

  stage.setObject(group);

  let dir = new THREE.Vector3(0.24, 0.15, 1).normalize();
  stage._controls.addEventListener('start', () => { dir = null; });

  stage._controls.target.set(0, FRAME.y, 0);

  const reframe = () => {
    const camera = stage._camera;
    const w = stage.clientWidth || 1;
    const h = stage.clientHeight || 1;
    const aspect = w / h;

    const dist = (Math.max(FRAME.halfH, FRAME.halfW / aspect)
      / Math.tan((camera.fov * Math.PI) / 360)) * MARGIN;

    const focus = stage._controls.target;
    const view = dir ? dir.clone() : camera.position.clone().sub(focus).normalize();
    if (view.lengthSq() === 0) view.set(0.24, 0.15, 1).normalize();
    camera.position.copy(focus).addScaledVector(view, dist);
    camera.near = Math.max(dist / 100, 0.01);
    camera.far = dist * 100;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    stage._controls.update();
  };

  reframe();
  new ResizeObserver(reframe).observe(stage);

  const CARRY = 5;

  hand = createGrab({
    stage, THREE, mesh: shell, inset: 0.85,
    at: () => v.set(x, y, z),

    onGrab() {
      tossed = false;
      airborne = false; yV = 0;
      vx = 0; vz = 0;
      evtT = 2.8;
    },

    onDrag(p, dt) {
      const clamp = (n) => Math.max(-CARRY, Math.min(CARRY, n));
      vx += (clamp((p.x - x) / dt) - vx) * 0.35;
      vz += (clamp((p.z - z) / dt) - vz) * 0.35;
      yV = clamp((p.y - y) / dt);
      x = p.x; z = p.z; y = Math.max(0, p.y);
    },

    onDrop() {
      if (broken) { vx = vz = yV = 0; return; }
      tossed = true;
      if (y > 0.02 || yV > 0.4) airborne = true;
      spinRate -= Math.sign(vx || 1) * (Math.hypot(vx, vz) * 1.6 + Math.max(0, yV) * 1.2);
    },
  });

  stage._ground.visible = false;
  stage._key.castShadow = false;
  group.traverse((o) => {
    if (o.isMesh || o.isSprite) o.castShadow = o.receiveShadow = false;
  });

  (function loop() {
    requestAnimationFrame(loop);
    frame();
  })();

  return {
    get state() {
      return state;
    },

    setState(next) {
      if (!Object.hasOwn(MOODS, next) || next === state) return;
      state = next;
      if (next === 'idle' || next === 'thinking') sustain = 0;
      if (next === 'thinking' && !broken) kick();
    },

    setLevel(level) {
      sustain = Math.min(1, Math.max(0, level));
    },

    pulse(weight = 0.3) {
      impulse = Math.min(1, impulse + Math.min(1, Math.max(0, weight)));
    },

    spin() {
      if (broken) return;
      kick();
    },

    jolt(weight = 1) {
      if (broken || airborne || hand?.held) return;
      yV = 1.3 + Math.random() * 0.6 * weight;
      airborne = true;
      spinRate += (Math.random() < 0.5 ? -1 : 1) * 3.5 * weight;
      sq.v -= 2.2 * weight;
      impulse = Math.min(1, impulse + 0.5 * weight);
    },

    stall(on = true) {
      const next = Boolean(on);
      if (next === broken) return;
      broken = next;
      if (broken) {
        sustain = 0;
        airborne = false;
        tossed = false;
        yV = 0;
        vx = vz = 0;
      }
    },
  };
}
