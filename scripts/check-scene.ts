import { SHOTS, cardVisibility, sampleCamera } from "../src/scene/timeline";
import { terrainHeight, terrainStats, plumeAxisAt, WORLD } from "../src/scene/world";
import { TIERS, detectGpu } from "../src/scene/quality";

/**
 * Runs the timeline and world assertions outside the browser.
 *
 * The same logic the dev build calls on mount, so a bad edit is caught in CI
 * before it reaches a reviewer who has to scroll to find it.
 *
 *   npx tsx scripts/check-scene.ts
 */

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

console.log("\nONER scene check");
console.log("=".repeat(64));

// --- Timeline contiguity --------------------------------------------------
console.log("\nTimeline");
check("first shot starts at 0", SHOTS[0].from === 0, `got ${SHOTS[0].from}`);
check(
  "last shot ends at 1",
  SHOTS[SHOTS.length - 1].to === 1,
  `got ${SHOTS[SHOTS.length - 1].to}`
);

let gaps = 0;
for (let i = 1; i < SHOTS.length; i++) {
  if (Math.abs(SHOTS[i - 1].to - SHOTS[i].from) > 1e-9) gaps++;
}
check("no gaps or overlaps between shots", gaps === 0, `${gaps} seam(s) broken`);

let inverted = 0;
for (const shot of SHOTS) {
  if (shot.to <= shot.from) inverted++;
}
check("all shot ranges are positive", inverted === 0, `${inverted} inverted`);

// --- Camera sanity -------------------------------------------------------
console.log("\nCamera");
let belowGroundOnLand = 0;
let inCanopyOverLand = 0;
let belowWaterSurface = 0;
let minAltitude = Infinity;
let maxAltitude = -Infinity;

for (let i = 0; i <= 2000; i++) {
  const state = sampleCamera(i / 2000);
  const altitude = state.position[1];
  minAltitude = Math.min(minAltitude, altitude);
  maxAltitude = Math.max(maxAltitude, altitude);

  const overLake =
    Math.hypot(state.position[0] - WORLD.lakeCentre[0], state.position[2] - WORLD.lakeCentre[2]) <
    WORLD.lakeRadius * 1.05;

  // Being underwater is intentional for the final act — the camera enters the
  // lake and ends up inside it. What must never happen is going below ground
  // while over LAND, which would put the camera inside the terrain.
  if (!overLake) {
    if (altitude < 1) belowGroundOnLand++;
    if (altitude < 20) inCanopyOverLand++;
  } else if (altitude < -1) {
    belowWaterSurface++;
  }
}

check(
  "camera never goes below ground on land",
  belowGroundOnLand === 0,
  `${belowGroundOnLand} sample(s) below y=0 over land`
);
check(
  "camera only flies low over water",
  inCanopyOverLand === 0,
  `${inCanopyOverLand} sample(s) below 20m over land`
);

// The final act is underwater, so this is now an assertion rather than a
// prohibition: the camera MUST actually enter the lake, or the whole
// fish/pollution sequence is invisible.
check(
  "camera enters the lake (final act)",
  belowWaterSurface > 0,
  `${belowWaterSurface} sample(s) below the waterline`
);
check(
  "camera stays above the lake bed",
  minAltitude > -WORLD.lakeBasinDepth + 0.5,
  `min altitude ${minAltitude.toFixed(1)}m, bed at -${WORLD.lakeBasinDepth}m`
);
check(
  "altitude span is cinematic",
  // The upper bound is the sky, not a mountain ring. There is no ridge to stay
  // below any more, so the meaningful constraint is simply that the camera
  // climbs well above the treeline and comes back down into the lake.
  maxAltitude > WORLD.terrainRadius * 0.4 && maxAltitude < WORLD.skirtRadius,
  `${minAltitude.toFixed(0)}m to ${maxAltitude.toFixed(0)}m`
);

// --- Cards ---------------------------------------------------------------
console.log("\nContent");
const cards = new Set(SHOTS.map((s) => s.card).filter(Boolean));
check("8 content cards placed on the timeline", cards.size === 8, `got ${cards.size}`);

let unreadable = 0;
for (const shot of SHOTS) {
  if (!shot.card) continue;
  let peak = 0;
  for (let i = 0; i <= 400; i++) {
    peak = Math.max(peak, cardVisibility(shot.card, shot.from + ((shot.to - shot.from) * i) / 400));
  }
  if (peak < 0.9) unreadable++;
}
check("every card reaches full opacity", unreadable === 0, `${unreadable} too dim`);

// --- Terrain -------------------------------------------------------------
console.log("\nTerrain");
let minHeight = Infinity;
let maxHeight = -Infinity;
let nan = 0;
for (let i = 0; i < 4000; i++) {
  const angle = (i / 4000) * Math.PI * 2 * 37;
  const radius = (i / 4000) * WORLD.skirtRadius;
  const h = terrainHeight(Math.cos(angle) * radius, Math.sin(angle) * radius);
  if (!Number.isFinite(h)) nan++;
  minHeight = Math.min(minHeight, h);
  maxHeight = Math.max(maxHeight, h);
}
check("no NaN in the heightfield", nan === 0, `${nan} sample(s)`);

// Relief is measured over the DETAILED terrain only. The skirt is deliberately
// near-flat — its job is to hide the seam at the fog limit, not to provide
// topography — so including it in this figure averaged away the landscape's
// actual range and made the check fail once the ridge was removed.
//
// The threshold is deliberately low. There are no mountains any more, so the
// only vertical interest left is the lake bowl (down to -9m) and the rolling
// jungle floor (up to ~58m), and this asserts that both are present.
let detailedMin = Infinity;
let detailedMax = -Infinity;
for (let i = 0; i < 4000; i++) {
  const angle = (i / 4000) * Math.PI * 2 * 37;
  const radius = (i / 4000) * WORLD.terrainRadius;
  const h = terrainHeight(Math.cos(angle) * radius, Math.sin(angle) * radius);
  detailedMin = Math.min(detailedMin, h);
  detailedMax = Math.max(detailedMax, h);
}
// minHeight/maxHeight are retained for the NaN sweep across the full skirt.
check(
  "terrain has real vertical relief",
  detailedMax - detailedMin > 40,
  `min ${detailedMin.toFixed(0)}m to max ${detailedMax.toFixed(0)}m over the detailed ${WORLD.terrainRadius}m`
);

// The treeline must actually exist. It used to be a hand-typed 320m against a
// landscape topping out at 76m, so it rejected nothing and the treeline
// silently vanished — forest to the summit of the highest hill. Now it is
// derived from the terrain's own statistics, and this asserts the derived value
// is (a) below the summit and (b) low enough to leave real forest below it.
const stats = terrainStats();
check(
  "the treeline is below the highest ground",
  stats.treeline < stats.max,
  `treeline ${stats.treeline.toFixed(1)}m, summit ${stats.max.toFixed(1)}m`
);
check(
  "most of the landscape is still forested",
  stats.treeline > stats.min + (stats.max - stats.min) * 0.45,
  `treeline sits ${(((stats.treeline - stats.min) / (stats.max - stats.min)) * 100).toFixed(0)}% of the way up the relief`
);

/**
 * The sand band must start at the TREELINE, not below it.
 *
 * It was hard-coded to a normalised height of 0.40-0.84 while the treeline
 * actually sits at 0.73 of the relief. So the band swallowed the whole forest:
 * 71.6% of the map was painted sand where only 4.7% is genuinely treeless, and
 * the landscape went white. The shader now reads stats.treeline directly, and
 * this asserts the arithmetic that makes the mistake impossible to repeat.
 */
{
  const span = stats.max - stats.min;
  const bandStart = (stats.treeline - stats.min) / span;
  // The shader's band is smoothstep(treeline, treeline + 0.55 * (max - treeline)).
  const bandWidth = (stats.max - stats.treeline) * 0.55;
  const midpointSand = Math.max(
    0,
    Math.min(1, (stats.min + span * 0.5 - stats.treeline) / bandWidth)
  );
  check(
    "the sand band starts at the treeline, not below it",
    bandStart > 0.55 && midpointSand < 0.02,
    `band starts at hT ${bandStart.toFixed(2)}; the midpoint of the relief gets ${(
      midpointSand * 100
    ).toFixed(1)}% sand`
  );

  // The fraction of dry land above the treeline is the budget the sand is
  // actually allowed to spend, and the thing that was 15x overspent.
  let above = 0;
  let total = 0;
  for (let i = 0; i < 6000; i++) {
    const angle = i * 2.399963;
    const radius = Math.sqrt((i + 0.5) / 6000) * WORLD.terrainRadius;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (Math.hypot(x - WORLD.lakeCentre[0], z - WORLD.lakeCentre[2]) < WORLD.lakeRadius * 1.5) continue;
    total++;
    if (terrainHeight(x, z) > stats.treeline) above++;
  }
  const fraction = above / Math.max(1, total);
  check(
    "most of the map is still green forest",
    fraction < 0.35,
    `${(fraction * 100).toFixed(1)}% of dry land is above the treeline and therefore sand`
  );
}
// The floor OUTSIDE the lake must sit above the waterline, or the jungle
// scatter rejects it and the forest thins out into bare ground. This is the
// bug that produced "two layers of trees with empty land between them", so it
// is worth a standing assertion rather than a one-time measurement.
//
// The lake itself is excluded: its bed is supposed to be below zero, and the
// whole detailed-terrain disc contains it.
let floorMin = Infinity;
let flooded = 0;
let floorSamples = 0;
for (let i = 0; i < 6000; i++) {
  const angle = i * 2.399963;
  const radius = Math.sqrt(i / 6000) * WORLD.terrainRadius;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  // Generous margin around the nominal radius, because the shoreline is
  // wobbled by up to 13m of noise.
  if (Math.hypot(x - WORLD.lakeCentre[0], z - WORLD.lakeCentre[2]) < WORLD.lakeRadius * 1.5) continue;
  const h = terrainHeight(x, z);
  floorSamples++;
  floorMin = Math.min(floorMin, h);
  if (h < 1.2) flooded++;
}
check(
  "the jungle floor sits above the waterline",
  flooded === 0,
  flooded === 0
    ? `lowest dry point ${floorMin.toFixed(1)}m, none of ${floorSamples} samples rejected as underwater`
    : `${flooded} of ${floorSamples} samples below 1.2m, lowest ${floorMin.toFixed(1)}m — the forest will thin out here`
);

// Factory pad must actually be flat, or the factory will float or sink.
//
// Sampled INSIDE the pad bounds, and the bounds come from WORLD rather than
// being hard-coded. A previous version sampled a fixed -150..150 grid, which
// silently started measuring open terrain the moment the pad was resized — and
// then reported a "pad is not level" failure that was really a stale test.
let padDeviation = 0;
for (let i = 0; i <= 8; i++) {
  for (let j = 0; j <= 8; j++) {
    // Sample the ASYMMETRIC pad: the -X half is bounded by the lake shore, the
    // +X half runs much further (see WORLD.factoryPadMaxX). A symmetric sample
    // grid would put half its points on ground that is no longer part of the
    // site, where the terrain is free to undulate — and then report a "pad is
    // not level" failure that is really a stale test.
    const t = i / 8;
    const x =
      t < 0.5
        ? -WORLD.factoryPadHalf.x + t * 2 * WORLD.factoryPadHalf.x
        : (t - 0.5) * 2 * WORLD.factoryPadMaxX;
    const z = -WORLD.factoryPadHalf.z + (j / 8) * 2 * WORLD.factoryPadHalf.z;
    padDeviation = Math.max(padDeviation, Math.abs(terrainHeight(x, z) - WORLD.factoryPadHeight));
  }
}
check(
  "factory pad is level",
  padDeviation < 0.6,
  `max deviation ${padDeviation.toFixed(2)}m`
);

// --- Plume tracking -------------------------------------------------------
// The five `rise-*` shots exist to climb alongside the smoke. They were found
// to be doing the opposite: the plume leans downwind toward +x while the
// hand-typed keyframes marched toward -x, so the camera was climbing through
// clear air with the smoke leaving frame. This asserts the shots stay near the
// column's centreline, which is the property that actually matters and which
// cannot be expressed by reading the keyframes.
console.log("\nPlume tracking");
{
  const riseShots = SHOTS.filter((s) => s.id.startsWith("rise-"));
  let worstOffset = 0;
  let worstShot = "";
  for (const shot of riseShots) {
    for (const key of shot.target) {
      const [x, y, z] = key;
      const axis = plumeAxisAt(y);
      // Horizontal distance from the column's centreline at the same altitude.
      const offset = Math.hypot(x - axis[0], z - axis[2]);
      if (offset > worstOffset) {
        worstOffset = offset;
        worstShot = shot.id;
      }
    }
  }
  // The column is up to ~110m wide at the top, so 30m off-axis is still inside
  // the smoke. Beyond that the camera is looking at air.
  check(
    "every rise shot aims at the plume",
    worstOffset < 30,
    `worst offset ${worstOffset.toFixed(1)}m in ${worstShot || "n/a"}`
  );

  // And the camera must be looking roughly along the column rather than
  // across it, so the shot reads as climbing a plume.
  let worstPitch = Infinity;
  for (const shot of riseShots) {
    for (let i = 0; i <= 100; i++) {
      const state = sampleCamera(shot.from + ((shot.to - shot.from) * i) / 100);
      const dx = state.target[0] - state.position[0];
      const dy = state.target[1] - state.position[1];
      const dz = state.target[2] - state.position[2];
      const horizontal = Math.hypot(dx, dz);
      if (horizontal < 1) continue;
      const pitch = Math.abs(Math.atan2(dy, horizontal)) * (180 / Math.PI);
      worstPitch = Math.min(worstPitch, pitch);
    }
  }
  // A pitch near zero means the camera is level with its target, i.e. looking
  // horizontally at a point on the column rather than up or along it.
  check(
    "the camera does not sight horizontally across the plume",
    worstPitch > 8,
    `flattest pitch ${worstPitch.toFixed(1)}°`
  );
}

// The lake basin must actually be below the waterline.
check(
  "lake bed is below sea level",
  terrainHeight(WORLD.lakeCentre[0], WORLD.lakeCentre[2]) < -2,
  `${terrainHeight(WORLD.lakeCentre[0], WORLD.lakeCentre[2]).toFixed(1)}m`
);

// The opening camera must see the mountains. A high camera looking down
// steeply cannot see the horizon at all, so the check is about the pitch
// angle rather than raw distance: the view direction must be shallow enough
// that the ridge line falls inside the frame.
const opening = sampleCamera(0);
const toTarget = [
  opening.target[0] - opening.position[0],
  opening.target[1] - opening.position[1],
  opening.target[2] - opening.position[2],
];
const horizontal = Math.hypot(toTarget[0], toTarget[2]);
// Negative pitch = looking down. The horizon sits at 0 degrees, so a camera
// pitched below about -8 degrees with a 42 degree vertical FOV puts the
// mountains out of frame entirely.
const pitchDegrees = (Math.atan2(toTarget[1], horizontal) * 180) / Math.PI;
const halfFov = opening.fov / 2;
// Scale-relative, not an absolute altitude. "A bird's eye" means the camera
// is high relative to the WORLD it is looking at; hard-coding 400m breaks the
// moment the world is resized, and the world has been resized twice already.
const birdEyeFloor = WORLD.terrainRadius * 0.35;
check(
  "opening shot is a true bird's eye",
  opening.position[1] > birdEyeFloor,
  `altitude ${opening.position[1].toFixed(0)}m vs floor ${birdEyeFloor.toFixed(0)}m (terrain radius ${WORLD.terrainRadius}m)`
);
check(
  "opening shot keeps the horizon in frame",
  pitchDegrees + halfFov > 0,
  `pitch ${pitchDegrees.toFixed(1)}° with ${halfFov.toFixed(0)}° half-FOV`
);
check(
  "opening camera looks toward the factory pad",
  Math.hypot(opening.target[0], opening.target[2]) < 200,
  `target ${opening.target[0].toFixed(0)}, ${opening.target[2].toFixed(0)}`
);

// The detailed heightfield is bounded, so the coarse skirt has to reach well
// past its edge or the horizon shows a void between terrain and sky.
check(
  "the skirt overlaps the detailed terrain and reaches the fog limit",
  WORLD.skirtRadius * 0.88 > WORLD.terrainRadius,
  `terrain ends at ${WORLD.terrainRadius}m, skirt at ${WORLD.skirtRadius}m`
);

// --- Quality tiers -------------------------------------------------------
console.log("\nQuality tiers");
for (const tier of ["low", "medium", "high"] as const) {
  const settings = TIERS[tier];
  const total = settings.vegetationNearCount + settings.vegetationFarCount;
  console.log(
    `  ${tier.toUpperCase().padEnd(7)} ${String(total).padStart(6)} trees · ` +
      `${String(settings.shadowMapSize).padStart(4)}px shadow · ` +
      `dpr ≤${settings.maxPixelRatio} · ${settings.terrainSegments}² terrain`
  );
  check(`${tier} has a positive vegetation budget`, total > 0);
  check(`${tier} caps pixel ratio`, settings.maxPixelRatio <= 2);
}

// Tiers must be strictly ordered, or "low" could cost more than "high".
check(
  "low costs less than medium",
  TIERS.low.vegetationNearCount + TIERS.low.vegetationFarCount <
    TIERS.medium.vegetationNearCount + TIERS.medium.vegetationFarCount
);
check(
  "medium costs less than high",
  TIERS.medium.vegetationNearCount + TIERS.medium.vegetationFarCount <
    TIERS.high.vegetationNearCount + TIERS.high.vegetationFarCount
);

console.log("\nGPU detection (requires a DOM; skipped in Node)");
if (typeof document === "undefined") {
  console.log("  SKIP  no document — run in the browser via the diagnostics panel");
} else {
  const gpu = detectGpu();
  console.log(`  ${gpu.renderer ?? "not reported"} → ${gpu.detected}`);
}

console.log("\n" + "=".repeat(64));
if (failures === 0) {
  console.log("PASS — no problems found.\n");
  process.exit(0);
}
console.log(`FAIL — ${failures} problem(s).\n`);
process.exit(1);
