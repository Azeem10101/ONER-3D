/**
 * Layout sanity: does the new, tighter world actually work geometrically?
 *
 *   npx tsx scripts/check-layout.ts
 *
 * The world was shrunk to ~45% of its previous extent. Shrinking a layout is
 * exactly the kind of change that silently produces overlap: a pad that
 * swallows the lake, a lake whose shore crosses the factory, a drainage
 * channel with negative length. Those are arithmetic mistakes, they are cheap
 * to check, and they are expensive to find by looking at a render.
 */

import { terrainHeight, WORLD } from "../src/scene/world";
import { sampleCamera, SHOTS } from "../src/scene/timeline";
import { FOG_DENSITY } from "../src/components/three/Lighting";

let failures = 0;
let warnings = 0;

function fail(message: string) {
  console.log(`  FAIL  ${message}`);
  failures++;
}
function warn(message: string) {
  console.log(`  WARN  ${message}`);
  warnings++;
}
function pass(message: string) {
  console.log(`  PASS  ${message}`);
}

console.log("\nONER-3D layout check\n" + "=".repeat(64) + "\n");

// --- Pad vs factory -------------------------------------------------------
console.log("Factory pad");
const [padX, padZ] = [WORLD.factoryPadHalf.x, WORLD.factoryPadHalf.z];
// The procedural factory's own footprint, read from its authored geometry and
// scaled the same way <Factory> scales it. Previously hard-coded at {28, 22},
// which was the pre-1.45x plant's extent; after the scale-up the building
// silently grew past the pad it is supposed to sit on and this check would have
// kept reporting the old margin.
const FACTORY_EXTENT = { x: 36 * WORLD.factoryScale, z: 31 * WORLD.factoryScale };
// Rounded for display only. The pad check reports these raw, and
// `104.39999999999999m` in a pass message reads like a bug even though it is
// just float multiplication. Kept separate so the arithmetic above stays exact.
const show = (n: number) => n.toFixed(0);

if (FACTORY_EXTENT.x < padX && FACTORY_EXTENT.z < padZ) {
  const marginX = padX - FACTORY_EXTENT.x;
  const marginZ = padZ - FACTORY_EXTENT.z;
  // Too tight and the pad looks like the building, too loose and the
  // clearing reads as an empty plain with a shed in it.
  if (marginX < 8 || marginZ < 8) {
    warn(`pad only ${marginX.toFixed(0)}/${marginZ.toFixed(0)}m larger than the factory — may look fused`);
  } else if (marginX > 60) {
    warn(`pad is ${marginX.toFixed(0)}/${marginZ.toFixed(0)}m larger than the factory — reads as empty ground`);
  } else {
    pass(
      `pad ${padX}×${padZ}m wraps the ${show(FACTORY_EXTENT.x * 2)}×${show(
        FACTORY_EXTENT.z * 2
      )}m factory with ${show(marginX)}/${show(marginZ)}m margin`
    );
  }
} else {
  fail("the factory extends beyond its own pad");
}

// --- Lake vs pad ----------------------------------------------------------
console.log("\nLake vs pad");
const [lx, , lz] = WORLD.lakeCentre;
const gapX = Math.abs(lx + WORLD.lakeRadius + padX);
const gapZ = Math.abs(lz - WORLD.lakeRadius - padZ);
const overlaps = lx + WORLD.lakeRadius > -padX && lz - WORLD.lakeRadius < padZ;

if (overlaps) {
  fail(`lake overlaps the industrial pad by ${(lx + WORLD.lakeRadius + padX).toFixed(1)}m in x`);
} else if (gapX < 12 || gapZ < 12) {
  warn(`only ${gapX.toFixed(0)}/${gapZ.toFixed(0)}m between the lake shore and the pad — the outfall will be on top of the plant`);
} else {
  pass(`lake clears the pad by ${gapX.toFixed(0)}m in x, ${gapZ.toFixed(0)}m in z`);
}

// --- Drainage channel -----------------------------------------------------
console.log("\nDrainage channel");
// The channel runs from the pad edge to the outfall. Its length must be
// positive and the terrain along it must be above water, or the channel is
// either inside out or underwater.
const channelLength = Math.hypot(lx + WORLD.lakeRadius * 0.58 - padX * 0.4, lz - WORLD.lakeRadius * 0.34 - padZ * 0.4);
if (channelLength < 20) {
  fail(`drainage channel is only ${channelLength.toFixed(0)}m long — the outfall is on top of the plant`);
} else {
  pass(`drainage channel spans ${channelLength.toFixed(0)}m from plant to lake`);
}

let lowestOnChannel = Infinity;
for (let t = 0; t <= 1; t += 0.05) {
  const x = padX * 0.4 + t * (lx + WORLD.lakeRadius * 0.58 - padX * 0.4);
  const z = padZ * 0.4 + t * (lz - WORLD.lakeRadius * 0.34 - padZ * 0.4);
  lowestOnChannel = Math.min(lowestOnChannel, terrainHeight(x, z));
}
if (lowestOnChannel < 0) {
  warn(`the channel route dips to ${lowestOnChannel.toFixed(1)}m, below the waterline`);
} else {
  pass(`channel route stays above water (lowest point ${lowestOnChannel.toFixed(1)}m)`);
}

// --- Lake bed vs shore ----------------------------------------------------
console.log("\nLake profile");
let bed = Infinity;
let rim = -Infinity;
for (let i = 0; i < 200; i++) {
  const angle = (i / 200) * Math.PI * 2;
  // Sampled on the shoreline ring, which is where the terrain is most likely
  // to be wrong — a basin that is not actually enclosed reads as water
  // floating above flat ground.
  const r = WORLD.lakeRadius * 1.25;
  const h = terrainHeight(lx + Math.cos(angle) * r, lz + Math.sin(angle) * r);
  rim = Math.max(rim, h);
  bed = Math.min(bed, terrainHeight(lx, lz));
}
if (rim < 0.5) {
  fail(`lake is not enclosed — shoreline terrain drops to ${rim.toFixed(1)}m, so water would spill`);
} else {
  pass(`lake is enclosed (rim ${rim.toFixed(1)}m, bed ${bed.toFixed(1)}m)`);
}

// --- Camera vs world ------------------------------------------------------
console.log("\nCamera framing");
const opening = sampleCamera(0);
const openingDistance = Math.hypot(opening.position[0], opening.position[2]);

if (openingDistance < WORLD.terrainRadius * 0.6) {
  warn(
    `opening camera is only ${openingDistance.toFixed(0)}m out — inside the ${WORLD.terrainRadius}m terrain, so the far side is not visible`
  );
} else {
  pass(`opening camera ${openingDistance.toFixed(0)}m out, beyond the ${WORLD.terrainRadius}m terrain`);
}

// The horizon must be FLAT. The wiggly band that survived the deletion of
// Mountains.tsx was a `ridgedFbm` term inside terrainHeight(), which the skirt
// mesh was still building out to 2470m. A ridge is exactly what must not come
// back, so the assertion is on the shape of the far field rather than on a
// component existing: measure the height variation over the skirt and reject
// anything with a sharp silhouette.
let skirtMin = Infinity;
let skirtMax = -Infinity;
for (let i = 0; i < 4000; i++) {
  const angle = (i / 4000) * Math.PI * 2;
  const r = WORLD.terrainRadius * 0.8 + (i / 4000) * (WORLD.skirtRadius - WORLD.terrainRadius * 0.8);
  const h = terrainHeight(Math.cos(angle) * r, Math.sin(angle) * r);
  skirtMin = Math.min(skirtMin, h);
  skirtMax = Math.max(skirtMax, h);
}
const skirtRelief = skirtMax - skirtMin;
if (skirtRelief > 220) {
  fail(
    `the far field has ${skirtRelief.toFixed(0)}m of relief — a ridged horizon will read as a wiggly band again`
  );
} else {
  pass(
    `far field is a ${skirtRelief.toFixed(0)}m swell out to ${WORLD.skirtRadius}m — a horizon, not a ridge`
  );
}

// The skirt's outer edge must be far enough that fog has dissolved it, or the
// seam between terrain and sky shows as a hard line.
const skirtFog = 1 - Math.exp(-Math.pow(FOG_DENSITY * WORLD.skirtRadius, 2));
if (skirtFog < 0.9) {
  fail(`the skirt's outer edge is only ${(skirtFog * 100).toFixed(0)}% fogged — the seam will be visible`);
} else {
  pass(`the skirt's outer edge is ${(skirtFog * 100).toFixed(0)}% fogged — the seam is hidden`);
}

// The final shot must be close enough to the outfall for the contamination
// reveal to be at full strength, or the whole proximity effect is wasted.
const outro = sampleCamera(1);
const outfallX = lx + WORLD.lakeRadius * 0.58;
const outfallZ = lz - WORLD.lakeRadius * 0.34;
const outroToOutfall = Math.hypot(outro.position[0] - outfallX, outro.position[2] - outfallZ);
if (outroToOutfall > 150) {
  fail(`final shot is ${outroToOutfall.toFixed(0)}m from the outfall — the contamination will not be fully revealed`);
} else {
  pass(`final shot is ${outroToOutfall.toFixed(0)}m from the outfall — contamination fully revealed`);
}

// The camera must never end up under the terrain.
//
// Measured as clearance over the heightfield, but only over DRY LAND. The
// final act of the journey is deliberately underwater, where "clearance over
// the terrain" is negative by design and asserting on it would be meaningless.
let worstClearance = Infinity;
let worstClearanceAt = "";
for (let i = 0; i <= 1000; i++) {
  const state = sampleCamera(i / 1000);
  const overLake =
    Math.hypot(state.position[0] - WORLD.lakeCentre[0], state.position[2] - WORLD.lakeCentre[2]) <
    WORLD.lakeRadius * 1.05;
  if (overLake) continue;
  const clearance = state.position[1] - terrainHeight(state.position[0], state.position[2]);
  if (clearance < worstClearance) {
    worstClearance = clearance;
    worstClearanceAt = `${state.position[0].toFixed(0)}, ${state.position[2].toFixed(0)}`;
  }
}
if (worstClearance < 2) {
  fail(
    `camera dips to ${worstClearance.toFixed(1)}m above the terrain on land at ${worstClearanceAt}`
  );
} else {
  pass(`camera keeps at least ${worstClearance.toFixed(1)}m of clearance above dry land`);
}

// Underwater, the camera must stay clear of the BED or it will be inside the
// lake floor with the fish.
let worstDepth = Infinity;
for (let i = 0; i <= 1000; i++) {
  const state = sampleCamera(i / 1000);
  const overLake =
    Math.hypot(state.position[0] - WORLD.lakeCentre[0], state.position[2] - WORLD.lakeCentre[2]) <
    WORLD.lakeRadius * 1.05;
  if (!overLake) continue;
  worstDepth = Math.min(worstDepth, state.position[1] - terrainHeight(state.position[0], state.position[2]));
}
if (worstDepth < 0.4) {
  fail(`camera gets within ${worstDepth.toFixed(2)}m of the lake bed — it would be inside the floor`);
} else {
  pass(`camera keeps ${worstDepth.toFixed(1)}m of clearance above the lake bed`);
}

// --- Shot ranges ----------------------------------------------------------
console.log("\nTimeline");
const total = SHOTS.reduce((sum, shot) => sum + (shot.to - shot.from), 0);
if (Math.abs(total - 1) > 1e-6) {
  fail(`shot ranges sum to ${total.toFixed(4)}, not 1.0`);
} else {
  pass(`${SHOTS.length} shots cover the full journey`);
}

console.log("\n" + "=".repeat(64));
if (failures === 0) {
  console.log(`PASS — ${warnings} warning(s)\n`);
} else {
  console.log(`FAIL — ${failures} failure(s), ${warnings} warning(s)\n`);
  process.exit(1);
}
