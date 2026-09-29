/**
 * Why is there an empty band between the lake treeline and the outer forest?
 *
 *   npx tsx scripts/diagnose-jungle.ts
 *
 * The report from testing was "two layers of trees, one around the lake and
 * one far out, with empty land between". Every rejection rule in Jungle.tsx is
 * a candidate, so this walks the actual rejection logic and attributes each
 * lost tree to the rule that killed it.
 *
 * Findings are printed as a radius histogram, because the question is not
 * "is any tree missing" but "which radius band is empty, and why".
 */

import { terrainHeight, padInfluence, WORLD } from "../src/scene/world";
import { createRandom } from "../src/scene/random";

/** Mirrors the rejection rules in src/components/three/Jungle.tsx. */
const RULES = {
  pad: (x: number, z: number) => padInfluence(x, z) > 0.015,
  water: (x: number, z: number) => terrainHeight(x, z) < 1.2,
  slope: (x: number, z: number) => Math.abs(terrainHeight(x + 7, z) - terrainHeight(x - 7, z)) / 14 > 0.62,
  treeline: (x: number, z: number) => terrainHeight(x, z) > 300,
  clump: () => false,
};

type Band = Record<keyof typeof RULES | "accepted", number>;
const bands: Band[] = Array.from({ length: 12 }, () => ({
  pad: 0,
  water: 0,
  slope: 0,
  treeline: 0,
  clump: 0,
  accepted: 0,
}));

const random = createRandom(20260928);
const outer = WORLD.terrainRadius * 0.96;
const SAMPLES = 200_000;

for (let i = 0; i < SAMPLES; i++) {
  const angle = random() * Math.PI * 2;
  const distance = 34 + Math.sqrt(random()) * outer;
  const x = Math.cos(angle) * distance;
  const z = Math.sin(angle) * distance;

  const index = Math.min(bands.length - 1, Math.floor((distance / outer) * bands.length));
  const band = bands[index];

  if (RULES.pad(x, z)) { band.pad++; continue; }
  if (RULES.water(x, z)) { band.water++; continue; }
  if (RULES.slope(x, z)) { band.slope++; continue; }
  if (RULES.treeline(x, z)) { band.treeline++; continue; }

  const density =
    Math.sin(x * 0.0019 + Math.cos(z * 0.0016) * 2.3) * 0.5 +
    Math.cos(z * 0.0013 + Math.sin(x * 0.0021) * 1.8) * 0.5;
  const clump = density * 0.5 + 0.5;
  if (random() > 0.22 + clump * 0.78) { band.clump++; continue; }

  band.accepted++;
}

console.log("\nJungle rejection by radius band\n" + "=".repeat(72));
console.log(
  `${"radius".padEnd(14)}${"accepted".padStart(10)}${"pad".padStart(9)}${"water".padStart(9)}${"slope".padStart(9)}${"treeline".padStart(11)}${"clump".padStart(9)}`
);

const bandWidth = outer / bands.length;
bands.forEach((band, i) => {
  const lo = (i * bandWidth).toFixed(0).padStart(4);
  const hi = ((i + 1) * bandWidth).toFixed(0).padStart(4);
  const pct = ((band.accepted / SAMPLES) * 100).toFixed(2).padStart(5);
  console.log(
    `${lo}-${hi}m`.padEnd(14) +
      `${`${band.accepted} (${pct}%)`.padStart(10)}` +
      `${String(band.pad).padStart(9)}` +
      `${String(band.water).padStart(9)}` +
      `${String(band.slope).padStart(9)}` +
      `${String(band.treeline).padStart(11)}` +
      `${String(band.clump).padStart(9)}`
  );
});

console.log("\nTotals across all bands:");
const total = { pad: 0, water: 0, slope: 0, treeline: 0, clump: 0, accepted: 0 };
for (const band of bands) {
  for (const key of Object.keys(total) as (keyof Band)[]) total[key] += band[key];
}
for (const [key, value] of Object.entries(total)) {
  console.log(`  ${key.padEnd(10)} ${String(value).padStart(8)}  ${((value / SAMPLES) * 100).toFixed(1)}%`);
}

// --- Slope and height profile along a radial line --------------------------
console.log("\nRadial profile from the lake centre outward (mean over 64 bearings)\n" + "=".repeat(72));
console.log("  dist    height   slope   rejected-by-slope   rejected-by-water");
for (let r = 0; r <= outer; r += 25) {
  let heightSum = 0;
  let slopeSum = 0;
  let slopeFail = 0;
  let waterFail = 0;
  const n = 64;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = WORLD.lakeCentre[0] + Math.cos(a) * r;
    const z = WORLD.lakeCentre[2] + Math.sin(a) * r;
    const h = terrainHeight(x, z);
    const s = Math.abs(terrainHeight(x + 7, z) - terrainHeight(x - 7, z)) / 14;
    heightSum += h;
    slopeSum += s;
    if (s > 0.62) slopeFail++;
    if (h < 1.2) waterFail++;
  }
  console.log(
    `  ${String(r).padStart(4)}m ${(heightSum / n).toFixed(1).padStart(8)} ${(slopeSum / n).toFixed(3).padStart(7)}` +
      `  ${String(slopeFail).padStart(18)}  ${String(waterFail).padStart(19)}`
  );
}
console.log();
