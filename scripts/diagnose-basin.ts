/**
 * Why does terrain sit below the waterline for 200m around the lake?
 *
 *   npx tsx scripts/diagnose-basin.ts
 *
 * The radial profile shows heights of -1.2m at 150-250m from the lake centre,
 * well below the 1.2m waterline the jungle scatter rejects at. That is the
 * empty band. The lake is only 95m in radius, so something other than the
 * basin itself is depressing a 250m ring.
 *
 * This attributes the final height at each point to the individual terms, so
 * the culprit is a number rather than a guess.
 */

import { terrainHeight, padInfluence, WORLD } from "../src/scene/world";
import { fbm, ridgedFbm, smoothstep } from "../src/scene/noise";

console.log("\nHeight attribution around the lake\n" + "=".repeat(78));

const R0 = 150;
const R1 = 260;

// --- Term-by-term, replicating terrainHeight's structure ------------------
type Sample = {
  r: number;
  angle: number;
  final: number;
  baseNoise: number;
  mountainTerm: number;
  bowlTarget: number;
  shoreT: number;
  bank: number;
  corridor: number;
  pad: number;
};

const samples: Sample[] = [];
for (let i = 0; i < 6000; i++) {
  const angle = (i / 6000) * Math.PI * 2;
  const r = R0 + (i / 6000) * (R1 - R0);
  const x = WORLD.lakeCentre[0] + Math.cos(angle) * r;
  const z = WORLD.lakeCentre[2] + Math.sin(angle) * r;

  const baseNoise = fbm(x * 0.0019, z * 0.0019, 4) * 13;
  const distance = Math.hypot(x, z);
  const mountainWeight = smoothstep(WORLD.terrainRadius * 0.75, WORLD.mountainRadius * 0.55, distance);
  const mountainTerm =
    mountainWeight > 0.001 ? ridgedFbm(x * 0.0011, z * 0.0011, 5) * WORLD.mountainHeight * mountainWeight : 0;

  const lakeDx = x - WORLD.lakeCentre[0];
  const lakeDz = z - WORLD.lakeCentre[2];
  const lakeDistance = Math.hypot(lakeDx, lakeDz);
  const shorelineWobble = fbm(x * 0.0068, z * 0.0068, 3) * 13;
  const effectiveRadius = WORLD.lakeRadius + shorelineWobble;
  const shoreT = smoothstep(effectiveRadius * 1.34, effectiveRadius * 0.18, lakeDistance);
  const bowl = Math.pow(shoreT, 0.62);
  const bowlTarget = -WORLD.lakeBasinDepth * bowl;

  const afterNoise = baseNoise + mountainTerm;
  // The blend takes min(afterNoise, bowlTarget) weighted by shoreT.
  const target = bowlTarget < afterNoise ? bowlTarget : afterNoise;
  // Kept for reference in the attribution table; the final height is read
  // back from terrainHeight() so this script cannot drift out of sync with
  // the real implementation.
  void (afterNoise * (1 - shoreT) + target * shoreT);
  const above = 1 - smoothstep(0.06, 0.3, shoreT);

  const pad = padInfluence(x, z);

  samples.push({
    r,
    angle,
    final: terrainHeight(x, z),
    baseNoise,
    mountainTerm,
    bowlTarget,
    shoreT,
    bank: above,
    corridor: 0,
    pad,
  });
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

console.log(
  `\nmean over the ${R0}-${R1}m ring (${samples.length} samples):\n` +
    `  raw fbm base        ${mean(samples.map((s) => s.baseNoise)).toFixed(2)}m\n` +
    `  mountain term       ${mean(samples.map((s) => s.mountainTerm)).toFixed(2)}m\n` +
    `  bowl shoreT         ${mean(samples.map((s) => s.shoreT)).toFixed(3)}  (0 = dry land)\n` +
    `  bowl target         ${mean(samples.map((s) => s.bowlTarget)).toFixed(2)}m\n` +
    `  bank factor         ${mean(samples.map((s) => s.bank)).toFixed(3)}\n` +
    `  FINAL               ${mean(samples.map((s) => s.final)).toFixed(2)}m`
);

// --- Is it the noise, or the bowl? ---------------------------------------
const inRing = samples.filter((s) => s.shoreT < 0.001);
const belowWaterline = inRing.filter((s) => s.final < 1.2);
console.log(
  `\nOf ${inRing.length} fully-dry samples in the ring, ${belowWaterline.length} are below the 1.2m waterline ` +
    `(${((belowWaterline.length / inRing.length) * 100).toFixed(1)}%).`
);

if (belowWaterline.length) {
  console.log(`\n  Their raw fbm base:      ${mean(belowWaterline.map((s) => s.baseNoise)).toFixed(2)}m`);
  console.log(`  Their final height:      ${mean(belowWaterline.map((s) => s.final)).toFixed(2)}m`);
  console.log(`  Their mountain term:     ${mean(belowWaterline.map((s) => s.mountainTerm)).toFixed(2)}m`);
  console.log(
    `  Their mean radius:       ${mean(belowWaterline.map((s) => s.r)).toFixed(0)}m from lake centre`
  );

  // If the raw noise is already negative here, the base terrain itself is
  // the problem, not the lake code.
  if (mean(belowWaterline.map((s) => s.baseNoise)) < 1.2) {
    console.log(
      "\n  VERDICT: the base fbm terrain is itself below the waterline here. The lake is\n" +
        "  not the cause — the waterline constant is. Either the noise is biased low\n" +
        "  around this region, or a 1.2m rejection threshold is too high for terrain\n" +
        "  that legitimately averages near 0m."
    );
  } else {
    console.log("\n  VERDICT: the base terrain is fine; something in the lake code is pulling it down.");
  }
}

// --- Where does the base terrain actually sit? ---------------------------
console.log("\nBase terrain height distribution across the whole map (no lake, no pad):");
const all: number[] = [];
for (let i = 0; i < 20000; i++) {
  const a = (i / 20000) * Math.PI * 2;
  const r = Math.sqrt(i / 20000) * WORLD.terrainRadius;
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  all.push(fbm(x * 0.0019, z * 0.0019, 4) * 13);
}
all.sort((a, b) => a - b);
console.log(`  min ${all[0].toFixed(1)}  p10 ${all[2000].toFixed(1)}  p50 ${all[10000].toFixed(1)}  p90 ${all[18000].toFixed(1)}  max ${all[19999].toFixed(1)}`);
console.log(
  `  fraction below 1.2m waterline: ${((all.filter((h) => h < 1.2).length / all.length) * 100).toFixed(1)}%`
);
console.log();
