/**
 * Deterministic pseudo-randomness.
 *
 * The jungle, the ground scatter, and the smoke plume all need "random"
 * placement. Using Math.random() would reshuffle the scene on every React
 * StrictMode double-render and on every Fast Refresh, so the art direction
 * would silently drift while you tuned the timeline. A seeded generator keeps
 * the world identical every single time it loads.
 */

/** mulberry32 — small, fast, good enough distribution for scattering. */
export function createRandom(seed: number) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(random: () => number, min: number, max: number) {
  return min + random() * (max - min);
}
