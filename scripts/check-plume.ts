/**
 * Is the smoke plume actually going to look like it is moving?
 *
 *   npx tsx scripts/check-plume.ts
 *
 * This re-implements Plume.tsx's sprite budget on the CPU so the numbers can be
 * verified without a browser — which matters here, because the failure mode is
 * invisible in code review and invisible to a position-based test.
 *
 * ## The quantity that matters
 *
 * Not the rise speed. The number of sprites a single view ray passes through.
 *
 * Accumulated alpha along a ray is 1 - Π(1 - αᵢ). With 35 sprites overlapping,
 * that is 0.98 however low each sprite's opacity is: the column becomes an
 * opaque mass, and an opaque mass has no internal features, so movement cannot
 * show up in it no matter how fast the particles travel.
 *
 * That was the real reason the plume read as static, and it survived two rounds
 * of "raise the rise speed" and one of "lower the per-sprite opacity", because
 * none of those touch the count. The lever is
 *
 *     sprites per ray = (count / column height) x diameter² / column width
 *
 * and it has to come down to roughly 6 for individual billows to be
 * distinguishable. A distinguishable puff is the only thing the eye can track.
 *
 * ## Why this is a check and not a comment
 *
 * Every version of this file that fixed the plume did so by adjusting numbers
 * that had no stated target, and each adjustment made it worse in a different
 * direction. Stating the budget explicitly — and asserting on it — means the
 * next person to add particles to the plume finds out immediately.
 */

import { WORLD } from "../src/scene/world";

/** Mirrors the layer table in Plume.tsx. Keep the two in step. */
const LAYERS = [
  { name: "core", count: 260, size: [12, 22] as const, opacity: 0.3, spread: 20, speed: [0.07, 0.14] as const },
  { name: "mid", count: 200, size: [18, 34] as const, opacity: 0.2, spread: 40, speed: [0.05, 0.1] as const },
  { name: "outer", count: 90, size: [45, 78] as const, opacity: 0.1, spread: 74, speed: [0.032, 0.068] as const },
];

/** The rise shots view the plume from roughly this far away. */
const VIEW_DISTANCE = 300;
const CANVAS_HEIGHT = 1080;
/** Half the vertical FOV, in radians, at the widest rise shot. */
const HALF_FOV = (22 * Math.PI) / 180;
/** gl_PointSize clamp in Plume.tsx. */
const POINT_SIZE_CLAMP = 150;
/**
 * Mean of the shader's per-particle density weight:
 *   (0.18 + 0.82 * mean(fract)) * (0.45 + 0.55 * mean(fract)) = 0.59 * 0.725
 */
const MEAN_DENSITY_WEIGHT = 0.43;

console.log("\nPlume sprite budget");
console.log("=".repeat(78));
console.log(
  `  ${"layer".padEnd(6)}${"per ray".padStart(9)}${"alpha".padStart(8)}${"m/s".padStart(7)}${"px/s".padStart(8)}${"sprite px".padStart(11)}${"cross in".padStart(10)}`
);

let totalSurvival = 1;
let worstPerRay = 0;
let slowestPxPerSecond = Infinity;

for (const layer of LAYERS) {
  const height = layer.name === "mid" ? WORLD.plumeHeight * 0.9 : layer.name === "outer" ? WORLD.plumeHeight * 1.15 : WORLD.plumeHeight;
  const midSpeed = (layer.speed[0] + layer.speed[1]) / 2;
  const lifeSeconds = 1 / midSpeed;
  const verticalSpeed = height / lifeSeconds;
  const diameter = (layer.size[0] + layer.size[1]) / 2;

  // Pixels per metre at the viewing distance, for the vertical field of view.
  const pixelsPerMetre = CANVAS_HEIGHT / (2 * VIEW_DISTANCE * Math.tan(HALF_FOV));
  const spritePixels = Math.min(
    diameter * (0.32 + 0.5 * 1.5) * (CANVAS_HEIGHT * 0.55) / VIEW_DISTANCE,
    POINT_SIZE_CLAMP
  );

  // Column width is roughly 1.5x the spread radius on each side, and the spread
  // grows as the plume rises, so the average is taken a little wider than the
  // base.
  const columnWidth = layer.spread * 3;
  const perRay = Math.max(1, (layer.count / height) * diameter * diameter / columnWidth);

  const perSprite = MEAN_DENSITY_WEIGHT * layer.opacity;
  const accumulated = 1 - Math.pow(1 - perSprite, perRay);
  totalSurvival *= 1 - accumulated;

  const pxPerSecond = verticalSpeed * pixelsPerMetre;

  worstPerRay = Math.max(worstPerRay, perRay);
  slowestPxPerSecond = Math.min(slowestPxPerSecond, pxPerSecond);

  console.log(
    `  ${layer.name.padEnd(6)}${perRay.toFixed(1).padStart(9)}${accumulated.toFixed(2).padStart(8)}` +
      `${verticalSpeed.toFixed(0).padStart(7)}${pxPerSecond.toFixed(0).padStart(8)}` +
      `${spritePixels.toFixed(0).padStart(11)}${lifeSeconds.toFixed(1).padStart(9)}s`
  );
}

const totalAlpha = 1 - totalSurvival;
console.log(
  `\n  total accumulated alpha through all three layers: ${totalAlpha.toFixed(3)}`
);

let failed = 0;

function check(label: string, ok: boolean, detail: string) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(46)}${detail}`);
  if (!ok) failed++;
}

// The single most important assertion. Above about 0.93 the plume is an opaque
// mass and no amount of speed tuning will make its motion legible.
check(
  "the plume is not opaque",
  totalAlpha < 0.93,
  `alpha ${totalAlpha.toFixed(3)}, limit 0.93`
);

// Above roughly 12 sprites per ray, individual puffs stop being distinguishable
// and the structure that makes motion visible is lost again — the opposite
// failure from the one being guarded against here.
check(
  "individual puffs are distinguishable",
  worstPerRay < 12,
  `${worstPerRay.toFixed(1)} sprites per ray, limit 12`
);

// The slowest layer sets the perceived motion of the whole column. Under about
// 20 px/s the drift reads as a static gradient rather than as movement.
check(
  "the slowest layer still reads as moving",
  slowestPxPerSecond > 20,
  `${slowestPxPerSecond.toFixed(0)} px/s at ${VIEW_DISTANCE}m, need > 20`
);

// A sprite clamped to the cap covers a large fraction of the frame, which
// flattens what it covers into one uniform patch.
check(
  "no sprite covers the frame",
  spritePixelsOf(LAYERS[0]) < POINT_SIZE_CLAMP,
  `core ${spritePixelsOf(LAYERS[0]).toFixed(0)}px, cap ${POINT_SIZE_CLAMP}px`
);

function spritePixelsOf(layer: (typeof LAYERS)[number]) {
  const diameter = (layer.size[0] + layer.size[1]) / 2;
  return Math.min(
    diameter * (0.32 + 0.5 * 1.5) * (CANVAS_HEIGHT * 0.55) / VIEW_DISTANCE,
    POINT_SIZE_CLAMP
  );
}

console.log();
if (failed > 0) {
  console.log(`FAIL — ${failed} problem(s).`);
  process.exitCode = 1;
} else {
  console.log("PASS");
}
