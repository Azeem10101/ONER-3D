/**
 * Is the ground haze washing the scene out?
 *
 *   npx tsx scripts/check-atmosphere.ts
 *
 * ## The failure this guards against
 *
 * <GroundHaze> renders soft billboards with ADDITIVE blending. Additive is the
 * right choice for mist — it accumulates rather than occluding, so overlapping
 * puffs get brighter instead of forming visible discs. It is also completely
 * unforgiving, because what a pixel receives is the SUM over every sprite that
 * covers it:
 *
 *     contribution = opacity * (number of covering sprites) * sprite peak alpha
 *
 * Every one of those parameters looks reasonable on its own. The effect is
 * entirely a product, and nothing in the component shows you the product.
 *
 * So this computes it. The bug it was written for: 280 sprites of 190m across,
 * additive, at 0.1 opacity. A sprite 300m away subtended 2*atan(95/300) = 35
 * degrees against a 22-degree half-FOV, so it covered four fifths of the frame,
 * and any pixel was crossed by a dozen of them. The accumulated value was
 * several times past white, and terrain, water, birds, fish and smoke all
 * disappeared into it.
 *
 * Because the count was tier-gated (90 / 170 / 280) it only appeared at medium
 * and high, which made one bad number look like three separate bugs on two
 * quality settings.
 *
 * ## How coverage is computed
 *
 * A sprite of diameter `s` at range `d` subtends roughly (s/d)^2 steradians.
 * The frame subtends 4*sin(halfFovV)*sin(halfFovH). Summing the first over all
 * sprites and dividing by the second gives the expected number of sprites
 * overlaying any given pixel — above 1 as soon as they overlap. Multiply by
 * opacity and peak alpha for the accumulated value.
 *
 * The first version of this check divided sprite count by the annulus AREA,
 * which is a per-square-metre quantity with no relationship to a pixel, and so
 * cheerfully reported 0.000 for a configuration several times past white. A
 * model that cannot fail is worse than no model at all.
 */

type Layer = { name: string; count: number; size: number; opacity: number };

/** Mirrors the <pointsMaterial> in Atmosphere.tsx. Keep in step. */
const TIERS: Record<string, Layer> = {
  low: { name: "low", count: 30, size: 55, opacity: 0.024 },
  medium: { name: "medium", count: 46, size: 55, opacity: 0.024 },
  high: { name: "high", count: 66, size: 55, opacity: 0.024 },
};

/** Peak alpha of the sprite gradient in createHazeSprite(). */
const SPRITE_PEAK_ALPHA = 0.5;

/** Vertical half-FOV of the widest shot, degrees, and the frame aspect. */
const HALF_FOV_V = 22;
const ASPECT = 1.6;
const HALF_FOV_H = (Math.atan(Math.tan((HALF_FOV_V * Math.PI) / 180) * ASPECT) * 180) / Math.PI;
const VIEW_DISTANCE = 300;

/** The annulus the sprites are scattered over, matching Atmosphere.tsx. */
const ANNULUS_INNER = 110;
const ANNULUS_SPAN = 780;
/** The exponent in `110 + pow(random, 0.6) * 780`. */
const SPREAD_EXPONENT = 0.6;

/**
 * The ceiling on accumulated additive value.
 *
 * Aerial haze in a real photograph is a few percent of the frame. Past about
 * 0.09 it stops being atmosphere and becomes a veil, and everything behind it
 * loses contrast. Set well under that, because the effect only has to be
 * perceptible.
 */
const MAX_ACCUMULATED = 0.09;

/** Expected number of sprites covering any given pixel. */
function coverage(layer: Layer): number {
  const screenSolidAngle =
    4 * Math.sin((HALF_FOV_V * Math.PI) / 180) * Math.sin((HALF_FOV_H * Math.PI) / 180);
  const STEPS = 400;
  let total = 0;
  for (let i = 0; i < STEPS; i++) {
    // Inverting the distance CDF so the sample is uniform in distance rather
    // than drawing from a random stream, which keeps the figure deterministic.
    const u = (i + 0.5) / STEPS;
    const d = ANNULUS_INNER + Math.pow(u, 1 / SPREAD_EXPONENT) * ANNULUS_SPAN;
    total += Math.pow(layer.size / d, 2);
  }
  total *= layer.count / STEPS;
  return total / screenSolidAngle;
}

console.log("\nAdditive haze coverage");
console.log("=".repeat(78));
console.log(
  `  ${HALF_FOV_V * 2}° vertical / ${HALF_FOV_H.toFixed(0)}° horizontal FOV, ` +
    `sprites over a ${ANNULUS_INNER}-${ANNULUS_INNER + ANNULUS_SPAN}m annulus\n`
);
console.log(
  `  ${"tier".padEnd(8)}$"count".padStart(7)}$"size m".padStart(9)}$"opacity".padStart(10)}` +
    `${"deg/sprite".padStart(13)}$"coverage".padStart(11)}$"accumulated".padStart(13)}`
);

let failed = 0;
for (const tier of ["low", "medium", "high"] as const) {
  const layer = TIERS[tier];
  const cover = coverage(layer);
  const degrees = (2 * Math.atan(layer.size / 2 / VIEW_DISTANCE) * 180) / Math.PI;
  const accumulated = cover * layer.opacity * SPRITE_PEAK_ALPHA;

  console.log(
    `  ${tier.padEnd(8)}${String(layer.count).padStart(7)}${layer.size.toFixed(0).padStart(9)}` +
      `${layer.opacity.toFixed(3).padStart(10)}${degrees.toFixed(0).padStart(13)}` +
      `${cover.toFixed(2).padStart(11)}${accumulated.toFixed(3).padStart(13)}`
  );

  if (accumulated > MAX_ACCUMULATED) {
    console.log(
      `         FAIL  ${tier} accumulates ${(accumulated * 100).toFixed(0)}% white, ceiling ` +
        `${(MAX_ACCUMULATED * 100).toFixed(0)}% — the scene is being veiled`
    );
    failed++;
  }
  // Asserted separately because a single frame-filling sprite can be wrong even
  // when the accumulated total looks acceptable.
  if (degrees > HALF_FOV_V) {
    console.log(
      `         FAIL  ${tier} sprite subtends ${degrees.toFixed(0)}° against a ` +
        `${HALF_FOV_V}° half-FOV — one puff fills the frame`
    );
    failed++;
  }
}

// The tier gap is itself the tell. A ratio this high means the effect's cost is
// a function of the quality setting, which is exactly how one bad number came
// to look like three different bugs on two settings.
const ratio =
  (TIERS.high.count * TIERS.high.opacity) / (TIERS.low.count * TIERS.low.opacity);
console.log(`\n  low:high cost ratio ${ratio.toFixed(2)}x`);
if (ratio > 2.5) {
  console.log(
    "         FAIL  over 2.5x — a veil will appear on some machines and not others"
  );
  failed++;
} else {
  console.log("         PASS  the effect looks the same at every quality setting");
}

console.log();
if (failed > 0) {
  console.log(`FAIL — ${failed} problem(s).`);
  process.exitCode = 1;
} else {
  console.log("PASS");
}
