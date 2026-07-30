/**
 * A mood is one set of targets. The controller eases every field toward the
 * mood the conversation is in, so a change of state reads as a change of
 * temperament rather than a cut.
 *
 * jitter/lean/rock/rockSpeed move the whole body; wobble/speed/breathe deform
 * the surface; hue/glow/halo are the light coming out of it; spin is the idle
 * pinwheel.
 */
export const MOODS = {
  idle: {
    jitter: 0.05, lean: 0.00, rock: 0.05, rockSpeed: 0.9,
    wobble: 0.36, speed: 0.80, breathe: 0.016,
    hue: 0.030, spin: 0.035, glow: 3.6, halo: 0.14,
  },
  listening: {
    jitter: 0.03, lean: -0.12, rock: 0.10, rockSpeed: 1.5,
    wobble: 0.20, speed: 1.20, breathe: 0.036,
    hue: 0.014, spin: 0.020, glow: 5.0, halo: 0.20,
  },
  thinking: {
    jitter: 0.10, lean: 0.07, rock: 0.02, rockSpeed: 1.0,
    wobble: 0.55, speed: 1.95, breathe: 0.012,
    hue: 0.190, spin: 0.260, glow: 9.5, halo: 0.42,
  },
  speaking: {
    jitter: 0.14, lean: 0.04, rock: 0.04, rockSpeed: 1.4,
    wobble: 0.48, speed: 2.45, breathe: 0.050,
    hue: 0.075, spin: 0.070, glow: 6.2, halo: 0.28,
  },

  /** Off the ground — thrown, dropped, or spun up on its own. */
  tossed: {
    jitter: 0.14, lean: 0.10, rock: 0.02, rockSpeed: 1.0,
    wobble: 0.72, speed: 2.60, breathe: 0.030,
    hue: 0.240, spin: 0.500, glow: 8.0, halo: 0.38,
  },
};

/** Nothing is reaching the model: the light goes out and the goo goes still. */
export const STALLED = {
  jitter: 0.01, lean: 0.00, rock: 0.005, rockSpeed: 0.5,
  wobble: 0.06, speed: 0.22, breathe: 0.006,
  hue: 0.000, spin: 0.004, glow: 0.35, halo: 0.02,
};

/** What live audio adds on top of the mood, at full amplitude. */
export const ENERGY_GAIN = {
  jitter: 0.45, rock: 0.045, rockSpeed: 0.8,
  wobble: 0.30, speed: 1.1, glow: 4.5, halo: 0.16,
};

/** The palette the star drifts through; `hue` is how fast it walks it. */
export const PALETTE = ['#ffd166', '#ffa62b', '#ff7a2f', '#f2452e', '#ff9c4a'];

/** Where the colour goes when the call is broken. */
export const DEAD = '#3d3a44';
