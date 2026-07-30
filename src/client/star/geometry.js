/**
 * The star, as geometry. A five-point star profile swept onto a sphere and
 * flattened front to back, a smaller copy of it glowing inside, and two
 * additive layers of light around the silhouette.
 *
 * Nothing here animates. It hands back the undeformed positions and the unit
 * directions they came from, and `index.js` owns the frame.
 */

const POINTS = 5;
const RIN = 0.48;   // inner radius of the star polygon, tips at 1
const LUTN = 1024;  // samples around the profile
const BLUR = 30;    // triangular blur — rounds the tips and notches into goo
const FLAT = 0.46;  // half-thickness front to back

/** Radius of a sharp five-point star at angle `t`, by line-segment intersection. */
const rawStar = (t) => {
  const seg = Math.PI / POINTS;
  const a = ((t % (2 * seg)) + 2 * seg) % (2 * seg);
  const r1 = a <= seg ? 1 : RIN, r2 = a <= seg ? RIN : 1;
  const t1 = a <= seg ? 0 : seg, t2 = a <= seg ? seg : 2 * seg;
  return (r1 * r2 * Math.sin(t2 - t1)) / (r1 * Math.sin(a - t1) + r2 * Math.sin(t2 - a));
};

/** The blurred profile, sampled once and normalised so the tips reach 1. */
const LUT = (() => {
  const lut = new Float32Array(LUTN);
  const raw = new Float32Array(LUTN);
  for (let i = 0; i < LUTN; i++) raw[i] = rawStar((i / LUTN) * Math.PI * 2);

  let max = 0;
  for (let i = 0; i < LUTN; i++) {
    let s = 0, wsum = 0;
    for (let j = -BLUR; j <= BLUR; j++) {
      const w = 1 - Math.abs(j) / (BLUR + 1);
      s += raw[(i + j + LUTN) % LUTN] * w; wsum += w;
    }
    lut[i] = s / wsum;
    if (lut[i] > max) max = lut[i];
  }
  for (let i = 0; i < LUTN; i++) lut[i] /= max;
  return lut;
})();

const starR = (t) => {
  const f = (t / (Math.PI * 2)) * LUTN;
  const i = Math.floor(f), k = f - i;
  const a = LUT[((i % LUTN) + LUTN) % LUTN], b = LUT[(((i + 1) % LUTN) + LUTN) % LUTN];
  return a + (b - a) * k;
};

/**
 * Map a unit sphere direction onto the puffy star body. The profile is applied
 * in the xy plane and faded out toward the poles, so the front and back stay
 * domed rather than creasing into the points.
 */
export const toStar = (nx, ny, nz, out) => {
  const w = Math.sqrt(nx * nx + ny * ny);
  const s = starR(Math.atan2(nx, ny));        // atan2(x, y) puts a point straight up
  const radial = 1 + (s - 1) * Math.pow(w, 0.72);
  const tip = (s - RIN) / (1 - RIN);
  const zs = FLAT * (1 - 0.62 * Math.pow(w, 2.4) * tip);
  return out.set(nx * radial, ny * radial, nz * zs);
};

/**
 * Five directional sine lobes, spread over the sphere on the golden angle.
 * Summed, they read as smooth organic swell — and because each is a function
 * of the direction alone, the seam and the poles come out continuous.
 */
export function createLobes(THREE) {
  const lobes = [];
  for (let i = 0; i < 5; i++) {
    const a = i * 2.399963, y = 1 - 2 * (i + 0.5) / 5;
    const r = Math.sqrt(1 - y * y);
    lobes.push({
      dir: new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r).normalize(),
      freq: 1.0 + i * 0.42,
      speed: 0.45 + i * 0.19,
      amp: 0.115 / (1 + i * 0.6),
      phase: i * 1.7,
    });
  }
  return lobes;
}

export function buildStar(THREE) {
  const group = new THREE.Group();
  group.name = 'star_character';

  // The body squashes and spins; the halos hang off `group` so a squash never
  // stretches a sprite that is meant to read as light in the air.
  const body = new THREE.Group();
  body.name = 'body';
  group.add(body);

  const v = new THREE.Vector3();

  const shellMat = new THREE.MeshPhysicalMaterial({
    name: 'slime_shell',
    color: new THREE.Color('#ffb03a'),
    transparent: true,
    opacity: 0.78,
    transmission: 0.9,
    thickness: 0.35,
    ior: 1.3,
    roughness: 0.08,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    iridescence: 0.35,
    iridescenceIOR: 1.35,
    attenuationDistance: 2.4,
    attenuationColor: new THREE.Color('#ffd8a1'),
    sheen: 0.5,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color('#ffffff'),
  });

  const shellGeo = new THREE.SphereGeometry(1, 144, 88);
  const shellDirs = shellGeo.attributes.position.array.slice();
  const shellBase = new Float32Array(shellDirs.length);
  for (let i = 0; i < shellDirs.length; i += 3) {
    toStar(shellDirs[i], shellDirs[i + 1], shellDirs[i + 2], v);
    shellBase[i] = v.x; shellBase[i + 1] = v.y; shellBase[i + 2] = v.z;
  }
  shellGeo.attributes.position.array.set(shellBase);
  shellGeo.attributes.position.needsUpdate = true;
  shellGeo.computeVertexNormals();

  // The shell is rewritten every frame and the bounds are never recomputed, so
  // they are set once with enough room for the widest wobble. Left to itself
  // three.js would cache the undeformed hull and start missing the tips on a
  // raycast the moment the goo swelled past it.
  shellGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.45);
  shellGeo.boundingBox = new THREE.Box3(
    new THREE.Vector3(-1.45, -1.45, -1.45), new THREE.Vector3(1.45, 1.45, 1.45));

  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.name = 'shell';
  body.add(shell);

  const coreMat = new THREE.MeshStandardMaterial({
    name: 'slime_core',
    color: new THREE.Color('#3a1405'),
    emissive: new THREE.Color('#ffa62b'),
    emissiveIntensity: 3.5,
    roughness: 0.35,
    metalness: 0,
    transparent: true,
    opacity: 0.95,
  });

  const coreGeo = new THREE.SphereGeometry(1, 72, 46);
  const coreDirs = coreGeo.attributes.position.array.slice();
  const coreBase = new Float32Array(coreDirs.length);
  for (let i = 0; i < coreDirs.length; i += 3) {
    toStar(coreDirs[i], coreDirs[i + 1], coreDirs[i + 2], v).multiplyScalar(0.54);
    coreBase[i] = v.x; coreBase[i + 1] = v.y; coreBase[i + 2] = v.z;
  }
  coreGeo.attributes.position.array.set(coreBase);
  coreGeo.attributes.position.needsUpdate = true;
  coreGeo.computeVertexNormals();

  const core = new THREE.Mesh(coreGeo, coreMat);
  core.name = 'core';
  body.add(core);

  // The rim bloom shares the shell's geometry rather than owning a second
  // body, so it deforms with it for free and can never drift out of register.
  const glowMat = new THREE.ShaderMaterial({
    name: 'slime_glow',
    uniforms: { uColor: { value: new THREE.Color('#ffa62b') }, uStrength: { value: 0.5 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vP;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position * 1.06, 1.0);
        vP = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uStrength;
      varying vec3 vN; varying vec3 vP;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(-vP)));
        float rim = pow(f, 1.55) * (1.0 - pow(f, 12.0));
        float body = pow(f, 0.4) * 0.16;
        float a = (rim + body) * uStrength;
        gl_FragColor = vec4(uColor * a * 1.15, a);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    depthWrite: false,
  });

  const glow = new THREE.Mesh(shellGeo, glowMat);
  glow.name = 'glow';
  body.add(glow);

  const radial = (stops) => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    for (const [at, alpha] of stops) grd.addColorStop(at, `rgba(255,255,255,${alpha})`);
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };

  // Close bloom, depth-tested, so the body sits inside its own light.
  const haloMat = new THREE.SpriteMaterial({
    map: radial([[0, 1], [0.14, 0.55], [0.34, 0.17], [0.66, 0.035], [1, 0]]),
    color: new THREE.Color('#ffa62b'),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.85,
  });
  const halo = new THREE.Sprite(haloMat);
  halo.name = 'halo';
  halo.scale.setScalar(4.4);
  group.add(halo);

  // Wide atmospheric wash, depth-untested so it reads as light in the air.
  const haloWideMat = new THREE.SpriteMaterial({
    map: radial([[0, 0.42], [0.3, 0.16], [0.6, 0.05], [1, 0]]),
    color: new THREE.Color('#ff7a2f'),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    opacity: 0.3,
  });
  const haloWide = new THREE.Sprite(haloWideMat);
  haloWide.name = 'halo_wide';
  haloWide.scale.setScalar(9);
  haloWide.renderOrder = -1;
  group.add(haloWide);

  return {
    group, body,
    shell, shellGeo, shellMat, shellDirs, shellBase,
    core, coreGeo, coreMat, coreDirs, coreBase,
    glow, glowMat, halo, haloMat, haloWide, haloWideMat,
  };
}
