import { SHOTS, cardVisibility, sampleCamera } from "../src/scene/timeline";
import { terrainHeight, WORLD } from "../src/scene/world";
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
  maxAltitude > WORLD.terrainRadius * 0.4 && maxAltitude < WORLD.mountainRadius,
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
  const radius = (i / 4000) * WORLD.mountainRadius * 1.2;
  const h = terrainHeight(Math.cos(angle) * radius, Math.sin(angle) * radius);
  if (!Number.isFinite(h)) nan++;
  minHeight = Math.min(minHeight, h);
  maxHeight = Math.max(maxHeight, h);
}

check("no NaN in the heightfield", nan === 0, `${nan} sample(s)`);
check(
  "terrain has real vertical relief",
  maxHeight - minHeight > 150,
  `${minHeight.toFixed(0)}m to ${maxHeight.toFixed(0)}m`
);
check(
  "mountains reach a visible height",
  maxHeight > 250,
  `max ${maxHeight.toFixed(0)}m`
);

// Factory pad must actually be flat, or the factory will float or sink.
//
// Sampled INSIDE the pad bounds, and the bounds come from WORLD rather than
// being hard-coded. A previous version sampled a fixed -150..150 grid, which
// silently started measuring open terrain the moment the pad was resized — and
// then reported a "pad is not level" failure that was really a stale test.
let padDeviation = 0;
const padStepX = (WORLD.factoryPadHalf.x * 2) / 8;
const padStepZ = (WORLD.factoryPadHalf.z * 2) / 8;
for (let i = 0; i <= 8; i++) {
  for (let j = 0; j <= 8; j++) {
    const x = -WORLD.factoryPadHalf.x + i * padStepX;
    const z = -WORLD.factoryPadHalf.z + j * padStepZ;
    padDeviation = Math.max(padDeviation, Math.abs(terrainHeight(x, z) - WORLD.factoryPadHeight));
  }
}
check(
  "factory pad is level",
  padDeviation < 0.6,
  `max deviation ${padDeviation.toFixed(2)}m`
);

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

// The detailed heightfield is bounded, so something must fill the gap between
// it and the mountain ring or the horizon shows a void.
check(
  "no gap between detailed terrain and the mountain ring",
  WORLD.mountainRadius * 0.88 > WORLD.terrainRadius,
  `terrain ends at ${WORLD.terrainRadius}m, mountains at ${(WORLD.mountainRadius * 0.88).toFixed(0)}m`
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
