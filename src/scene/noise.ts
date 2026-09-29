/**
 * NOISE
 * =====
 * Value/simplex noise for terrain displacement and vegetation scatter.
 *
 * Why hand-rolled rather than pulling in simplex-noise: this needs to be
 * deterministic (same terrain every reload, so art direction is reproducible
 * and the camera timings stay valid) and seedable (so the factory clearing can
 * be carved without touching the surrounding hills). Both are easier to get
 * from ~80 lines than from wrestling with a library's global state.
 *
 * 2D only. The terrain is a heightfield, so we never need a third axis, and
 * dropping it keeps the inner loop cheap enough to run at 256².
 */

/** Deterministic PRNG. Same seed always produces the same terrain. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRAD_SIZE = 256;
const GRAD_MASK = GRAD_SIZE - 1;

const PERM = new Uint8Array(GRAD_SIZE * 2);
const GRAD_X = new Float32Array(GRAD_SIZE);
const GRAD_Y = new Float32Array(GRAD_SIZE);

(function buildPermutation() {
  const random = mulberry32(1337);
  const source = new Uint8Array(GRAD_SIZE);
  for (let i = 0; i < GRAD_SIZE; i++) source[i] = i;
  // Fisher-Yates with the seeded PRNG.
  for (let i = GRAD_SIZE - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = source[i];
    source[i] = source[j];
    source[j] = swap;
  }
  for (let i = 0; i < GRAD_SIZE * 2; i++) PERM[i] = source[i & GRAD_MASK];

  for (let i = 0; i < GRAD_SIZE; i++) {
    const angle = (i / GRAD_SIZE) * Math.PI * 2;
    GRAD_X[i] = Math.cos(angle);
    GRAD_Y[i] = Math.sin(angle);
  }
})();

/** Fade curve 6t⁵-15t⁴+10t³. C2 continuous, which is what stops the terrain
 *  from showing a grid of creases at the octave boundaries. */
function fade(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function dotGradient(hash: number, x: number, y: number) {
  const h = hash & GRAD_MASK;
  return GRAD_X[h] * x + GRAD_Y[h] * y;
}

/**
 * Perlin-style gradient noise in [-1, 1].
 *
 * This is the workhorse. Everything else in this file is a way of combining
 * octaves of it.
 */
export function noise2D(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;

  const X = xi & GRAD_MASK;
  const Y = yi & GRAD_MASK;

  const u = fade(xf);
  const v = fade(yf);

  const aa = PERM[X + PERM[Y]];
  const ab = PERM[X + PERM[Y + 1]];
  const ba = PERM[X + 1 + PERM[Y]];
  const bb = PERM[X + 1 + PERM[Y + 1]];

  const x1 = dotGradient(aa, xf, yf) + u * (dotGradient(ba, xf - 1, yf) - dotGradient(aa, xf, yf));
  const x2 = dotGradient(ab, xf, yf - 1) + u * (dotGradient(bb, xf - 1, yf - 1) - dotGradient(ab, xf, yf - 1));

  return x1 + v * (x2 - x1);
}

/** Fractional Brownian motion: layered octaves of `noise2D`. */
export function fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let normalisation = 0;

  for (let i = 0; i < octaves; i++) {
    sum += noise2D(x * frequency, y * frequency) * amplitude;
    normalisation += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return sum / normalisation;
}

/**
 * Ridged noise. `1 - |noise|` inverted and squared.
 *
 * This is what makes mountain ridges look like mountains. Plain fbm gives you
 * rolling blobs; the absolute-value fold creates sharp creases and connected
 * crest lines, which is the single biggest difference between "procedural
 * hills" and "a mountain range".
 */
export function ridgedFbm(x: number, y: number, octaves = 5, lacunarity = 2.1, gain = 0.5): number {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let normalisation = 0;
  let previous = 1;

  for (let i = 0; i < octaves; i++) {
    // The previous octave's output is folded back in, which sharpens the
    // creases further and stops the ridges from looking like parallel grooves.
    let n = 1 - Math.abs(noise2D(x * frequency, y * frequency) * previous);
    n *= n;
    previous = n;

    sum += n * amplitude;
    normalisation += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return sum / normalisation;
}

export function clamp(value: number, min: number, max: number) {
  return value < min ? min : value > max ? max : value;
}

export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
