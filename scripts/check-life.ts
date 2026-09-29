/**
 * Is the school actually in the lake, and big enough to see?
 *
 *   npx tsx scripts/check-life.ts
 *
 * The underwater act is the last 15% of the journey and the camera ends up
 * among the school, so "the fish are not visible" has a small number of possible
 * causes, all of them checkable here without a browser:
 *
 *   1. The fish are BURIED. Their depth is placed relative to the lake bed, and
 *      the bed is a carved bowl with a noisy shoreline, so a fish placed for one
 *      part of the lake can end up inside the floor at another.
 *   2. The fish are on DRY LAND. The shoreline carries up to 13m of noise, so a
 *      point inside the nominal circle can be above water.
 *   3. The fish are TOO SMALL to read as animals at the distances the camera
 *      actually reaches.
 *   4. The camera passes THROUGH one, filling the frame with scaled geometry.
 *   5. The school has collapsed into a single plane, so it reads as a row rather
 *      than as a volume.
 *
 * All five produce the same symptom and have completely different fixes, which
 * is why guessing is not useful here.
 *
 * ## It calls the real function
 *
 * This imports `placeFish` from Life.tsx rather than reimplementing the
 * placement. An earlier version modelled the algorithm with its own sampler, and
 * the two implementations drifted far enough apart that the check reported a
 * 30m clearance from the camera while the real code produced a different
 * arrangement entirely — which is precisely the class of bug the check exists
 * to catch, reproduced inside the check itself.
 */

import { placeFish } from "../src/components/three/Life";
import { terrainHeight } from "../src/scene/world";
import { sampleCamera } from "../src/scene/timeline";

const COUNT = 64;
/** The fish geometry spans about -0.5..0.5 before the 1.6x shader scale. */
const BODY_LENGTH = 1.6;
const BODY_HALF = BODY_LENGTH / 2;

const school = placeFish(COUNT);
const cameraPath = (() => {
  const path: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i <= 300; i++) {
    const s = sampleCamera(i / 300);
    if (s.position[1] < 0) path.push({ x: s.position[0], y: s.position[1], z: s.position[2] });
  }
  return path;
})();

console.log("\nFish placement");
console.log("=".repeat(78));

let buried = 0;
let onLand = 0;
let minHeadroom = Infinity;
let minDepth = Infinity;
let maxDepth = -Infinity;
let nearest = Infinity;
let worstBuried = "";
let worstLand = "";

for (const f of school) {
  const { x, y, z } = f.home;
  const bed = terrainHeight(x, z);
  const headroom = y - bed;
  minHeadroom = Math.min(minHeadroom, headroom);
  minDepth = Math.min(minDepth, -y);
  maxDepth = Math.max(maxDepth, -y);

  if (headroom < BODY_HALF) {
    buried++;
    if (buried === 1) worstBuried = `x=${x.toFixed(0)} z=${z.toFixed(0)} bed=${bed.toFixed(1)} y=${y.toFixed(1)}`;
  }
  if (bed > -0.2) {
    onLand++;
    if (onLand === 1) worstLand = `x=${x.toFixed(0)} z=${z.toFixed(0)} bed=${bed.toFixed(1)}`;
  }
  for (const p of cameraPath) {
    nearest = Math.min(nearest, Math.hypot(p.x - x, p.y - y, p.z - z));
  }
}

let failed = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(42)}${detail}`);
  if (!ok) failed++;
}

check(
  "no fish is buried in the lake bed",
  buried === 0,
  buried === 0
    ? `at least ${minHeadroom.toFixed(1)}m clearance on all ${school.length}`
    : `${buried} buried, worst: ${worstBuried}`
);

check(
  "every fish is under water",
  onLand === 0,
  onLand === 0
    ? `all ${school.length} below the 0m waterline`
    : `${onLand} above it, worst: ${worstLand}`
);

check(
  "the camera does not pass inside a fish",
  nearest > 1.2,
  `nearest approach ${nearest.toFixed(1)}m, need > 1.2m`
);

check(
  "the school occupies a volume, not a plane",
  maxDepth - minDepth > 2.5,
  `${minDepth.toFixed(1)}m to ${maxDepth.toFixed(1)}m below the surface`
);

// --- Apparent size --------------------------------------------------------
console.log("\nApparent size at the range the camera actually reaches");
console.log("=".repeat(78));

const H = 1080;
const HALF_FOV = (40 * Math.PI) / 360;
const pxAt = (metres: number) => (BODY_LENGTH * H) / (2 * metres * Math.tan(HALF_FOV));

// How many fish are within a readable range of the path at all.
let inFrame = 0;
for (const f of school) {
  for (const p of cameraPath) {
    const d = Math.hypot(p.x - f.home.x, p.y - f.home.y, p.z - f.home.z);
    if (d < 40) {
      inFrame++;
      break;
    }
  }
}

console.log(`  ${cameraPath.length} camera samples below the waterline`);
console.log(`  nearest fish: ${nearest.toFixed(1)}m  ->  ${pxAt(nearest).toFixed(0)} px tall`);
console.log(`  fish within 40m of the path at some point: ${inFrame} of ${school.length}`);

check(
  "a fish at close range reads as an animal",
  pxAt(nearest) > 12,
  `${pxAt(nearest).toFixed(0)}px at ${nearest.toFixed(0)}m, need > 12px`
);

check(
  "the camera has fish in frame, not an empty lake",
  inFrame >= 20,
  `${inFrame} of ${school.length} come within 40m, need >= 20`
);

console.log();
if (failed > 0) {
  console.log(`FAIL — ${failed} problem(s).`);
  process.exitCode = 1;
} else {
  console.log("PASS");
}
