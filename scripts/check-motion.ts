/**
 * Where does the camera path break?
 *
 *   npx tsx scripts/check-motion.ts
 *
 * Two questions, and they are different problems:
 *
 *   1. DISCONTINUITY. A visible "break" or hitch is almost always a
 *      position jump, which shows up as a spike in the per-frame delta that is
 *      orders of magnitude above its neighbours. Sampled densely enough to
 *      catch a single-frame spike.
 *
 *   2. DISCONTINUITY OF *VELOCITY*. Even with positions perfectly continuous,
 *      the camera can lurch: if one shot arrives moving fast and the next
 *      departs from rest, the speed drops to zero and back within one frame,
 *      which reads as a stutter even though nothing teleported. This is the
 *      more common cause of "it breaks at one point", and it is invisible to a
 *      position-delta check because the positions are fine.
 *
 * So this measures the first derivative of the path as well as the path, and
 * reports the worst jerk in each. Jerk is the derivative of speed with respect
 * to scroll: it is the quantity the eye is actually most sensitive to, because
 * a change in acceleration is a change in how the frame feels, not merely in
 * where it is.
 *
 * A smooth constant-velocity camera has jerk near zero at every point. A
 * camera that eases in and out within every shot has high jerk at every shot
 * boundary, and that is the thing to fix.
 */

import { sampleCamera, SHOTS, type CameraState } from "../src/scene/timeline";
import { terrainHeight, WORLD } from "../src/scene/world";

const SAMPLES = 20_000;
/** Scroll units per sample. */
const STEP = 1 / SAMPLES;

function at(p: number): CameraState {
  return sampleCamera(Math.min(1, Math.max(0, p)));
}

// --- Position continuity -------------------------------------------------
interface Sample {
  p: number;
  pos: [number, number, number];
  target: [number, number, number];
  fov: number;
}

const samples: Sample[] = [];
for (let i = 0; i <= SAMPLES; i++) {
  const p = i * STEP;
  const s = at(p);
  samples.push({
    p,
    pos: s.position,
    target: s.target,
    fov: s.fov,
  });
}

console.log("\nCamera path continuity");
console.log("=".repeat(74));

// The camera should never move further than this in one step. At 60fps over a
// realistic scroll of 8 viewport heights, one frame is ~0.002 of the journey,
// so a smooth move covers a few metres. Anything past 25m in a single step is
// a teleport, not a move.
const MAX_STEP_METRES = 25;
let worstJump = 0;
const jumps: { p: number; metres: number }[] = [];

for (let i = 1; i < samples.length; i++) {
  const a = samples[i - 1];
  const b = samples[i];
  const d = Math.hypot(
    b.pos[0] - a.pos[0],
    b.pos[1] - a.pos[1],
    b.pos[2] - a.pos[2]
  );
  if (d > worstJump) {
    worstJump = d;
  }
  if (d > MAX_STEP_METRES) jumps.push({ p: b.p, metres: d });
}

if (jumps.length === 0) {
  console.log(`  PASS  no position jump  (largest step ${worstJump.toFixed(2)}m, limit ${MAX_STEP_METRES}m)`);
} else {
  console.log(`  FAIL  ${jumps.length} position jump(s) over ${MAX_STEP_METRES}m:`);
  for (const j of jumps.slice(0, 10)) {
    const shot = SHOTS.find((s) => j.p >= s.from && j.p <= s.to);
    console.log(`          at ${j.p.toFixed(4)} (${shot?.id ?? "?"})  ${j.metres.toFixed(1)}m`);
  }
}

// The look-at target must not jump either. A target jump rotates the camera
// without moving it, which is a whip-pan and reads as a hard cut.
let worstTargetJump = 0;
let worstTargetAt = 0;
for (let i = 1; i < samples.length; i++) {
  const a = samples[i - 1];
  const b = samples[i];
  const d = Math.hypot(
    b.target[0] - a.target[0],
    b.target[1] - a.target[1],
    b.target[2] - a.target[2]
  );
  if (d > worstTargetJump) {
    worstTargetJump = d;
    worstTargetAt = b.p;
  }
}
if (worstTargetJump < MAX_STEP_METRES) {
  console.log(`  PASS  no look-at jump  (largest ${worstTargetJump.toFixed(2)}m at ${worstTargetAt.toFixed(4)})`);
} else {
  console.log(
    `  FAIL  look-at target jumps ${worstTargetJump.toFixed(1)}m at ${worstTargetAt.toFixed(4)} — a whip-pan`
  );
}

// FOV must not jump either. A discontinuous focal length is a zoom punch.
let worstFovJump = 0;
let worstFovAt = 0;
for (let i = 1; i < samples.length; i++) {
  const d = Math.abs(samples[i].fov - samples[i - 1].fov);
  if (d > worstFovJump) {
    worstFovJump = d;
    worstFovAt = samples[i].p;
  }
}
if (worstFovJump < 0.5) {
  console.log(`  PASS  no FOV punch  (largest ${worstFovJump.toFixed(3)}deg at ${worstFovAt.toFixed(4)})`);
} else {
  console.log(`  FAIL  FOV jumps ${worstFovJump.toFixed(2)}deg at ${worstFovAt.toFixed(4)}`);
}

// --- Velocity continuity -------------------------------------------------
// Speed in metres per unit of scroll, and the rate at which that speed
// changes — jerk. Jerk is what the eye feels, and it is what "breaking" means
// to a viewer even when they cannot say why.
console.log("\nMotion smoothness");
console.log("=".repeat(74));

const speeds: number[] = [];
for (let i = 0; i < samples.length; i++) {
  const a = samples[Math.max(0, i - 1)];
  const b = samples[Math.min(samples.length - 1, i + 1)];
  speeds.push(
    Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]) /
      (2 * STEP)
  );
}

let meanSpeed = 0;
for (const s of speeds) meanSpeed += s;
meanSpeed /= speeds.length;

console.log(`  mean speed  ${meanSpeed.toFixed(0)} m per unit scroll`);

/**
 * THE ACTUAL CRITERION: velocity mismatch across each boundary.
 *
 * What matters is not how fast the camera is going at a boundary, but how much
 * that speed CHANGES as it crosses one. Two shapes are both acceptable:
 *
 *   - both sides at rest      — a deliberate pause between beats. Velocity
 *                               change is zero, so it is smooth.
 *   - both sides at cruise    — a continuous flow. Also zero change.
 *
 * What is not acceptable is one side at rest and the other at cruise: the
 * camera stops and restarts inside a single frame, which is a visible stutter
 * even though nothing moved abruptly. That is the "breaks at one point" case.
 *
 * An earlier version of this check measured the DIP — the speed AT the boundary
 * relative to the mean either side — and rejected anything under 0.35. That
 * rejected every deliberate pause, of which a cinematic sequence needs several,
 * and it could not tell a planned stop from an accidental one. Measuring the
 * ratio of the two sides instead is the same quantity expressed as continuity
 * rather than as magnitude, and it is the one that maps onto what the eye
 * detects.
 */
console.log("\n  velocity continuity at each shot boundary:");
console.log(`  ${"boundary".padEnd(30)}$"in".padStart(8)}$"out".padStart(8)}$"mismatch".padStart(10)}`);

let worstStep = 0;
let worstStepName = "";

/** A shot's own cruise speed: its length over the span it occupies. */
function cruiseSpeed(shot: (typeof SHOTS)[number]): number {
  const length = Math.hypot(
    shot.position[1][0] - shot.position[0][0],
    shot.position[1][1] - shot.position[0][1],
    shot.position[1][2] - shot.position[0][2]
  );
  const span = shot.to - shot.from;
  return span > 0 ? length / span : 0;
}

/**
 * Instantaneous speed at a progress value, by central difference over a
 * deliberately SHORT baseline.
 *
 * The baseline has to be short — about 0.0004 of the journey, half the length of
 * an easing ramp. An earlier version averaged the speed over a 60-sample window
 * either side of the boundary, which is three times as wide as the ramp itself,
 * so the "in" figure was dominated by the preceding cruise phase and the "out"
 * figure by the following one. It reported a mismatch at seams the easing had
 * deliberately smoothed, which is the same category of mistake as measuring the
 * dip: it describes the shape of the shots rather than the continuity across
 * the seam.
 *
 * What matters is the speed a few thousandths either side of the boundary. If
 * those two numbers agree, the camera flows through; if they do not, it lurches.
 */
const DELTA = 0.0004;
function speedNear(p: number): number {
  const a = sampleCamera(Math.max(0, p - DELTA));
  const b = sampleCamera(Math.min(1, p + DELTA));
  return (
    Math.hypot(
      b.position[0] - a.position[0],
      b.position[1] - a.position[1],
      b.position[2] - a.position[2]
    ) / (2 * DELTA)
  );
}

for (let i = 1; i < SHOTS.length; i++) {
  const seam = SHOTS[i].from;
  const mBefore = speedNear(seam - DELTA * 2);
  const mAfter = speedNear(seam + DELTA * 2);

  // The scale to judge the step against: the larger of the two shots' own
  // cruise speeds.
  //
  // NOT the ratio of the two measured speeds. A ratio divides by the smaller
  // value, and at a seam where both sides are at rest — which is most of them,
  // by design — the smaller value is near zero, so the ratio explodes. It
  // reported a 34x "mismatch" at a seam where the camera went from 101 m/scroll
  // to 3 m/scroll, both of which are a rounding error against a cruising speed
  // of 2100. The ratio of two near-zero numbers carries no information about
  // smoothness.
  //
  // What matters is the step SIZE relative to how fast the camera is going
  // around there. A 100 m/scroll step at a cruising 2100 is invisible; a 2600
  // step at the same cruising speed is a hard jolt.
  const scale = Math.max(cruiseSpeed(SHOTS[i - 1]), cruiseSpeed(SHOTS[i]), 1);
  const step = Math.abs(mBefore - mAfter) / scale;
  const label = `${SHOTS[i - 1].id} -> ${SHOTS[i].id}`;
  console.log(
    `  ${label.padEnd(30)}${mBefore.toFixed(0).padStart(8)}${mAfter.toFixed(0).padStart(8)}${step
      .toFixed(3)
      .padStart(10)}`
  );
  if (step > worstStep) {
    worstStep = step;
    worstStepName = label;
  }
}

// A step above 0.35 means the camera changes speed by more than a third of its
// local cruising speed in a single frame, which reads as a jolt. Below that the
// eye integrates it away.
if (worstStep < 0.35) {
  console.log(
    `  PASS  velocity is continuous at every boundary  (worst step ${worstStep.toFixed(3)} at ${worstStepName})`
  );
} else {
  console.log(
    `  FAIL  camera changes speed by ${(worstStep * 100).toFixed(0)}% of cruising in one frame at "${worstStepName}"`
  );
}

// --- Terrain clearance along the path ------------------------------------
console.log("\nClearance");
console.log("=".repeat(74));
let worstOverLand = Infinity;
let worstAt = 0;
for (const s of samples) {
  const overLake =
    Math.hypot(s.pos[0] - WORLD.lakeCentre[0], s.pos[2] - WORLD.lakeCentre[2]) <
    WORLD.lakeRadius * 1.05;
  if (overLake) continue;
  const clearance = s.pos[1] - terrainHeight(s.pos[0], s.pos[2]);
  if (clearance < worstOverLand) {
    worstOverLand = clearance;
    worstAt = s.p;
  }
}
if (worstOverLand > 2) {
  console.log(`  PASS  ${worstOverLand.toFixed(1)}m above dry land at worst (progress ${worstAt.toFixed(3)})`);
} else {
  console.log(`  FAIL  only ${worstOverLand.toFixed(1)}m above dry land at progress ${worstAt.toFixed(3)}`);
}

let worstUnderwater = Infinity;
for (const s of samples) {
  const overLake =
    Math.hypot(s.pos[0] - WORLD.lakeCentre[0], s.pos[2] - WORLD.lakeCentre[2]) <
    WORLD.lakeRadius * 1.05;
  if (!overLake) continue;
  worstUnderwater = Math.min(
    worstUnderwater,
    s.pos[1] - terrainHeight(s.pos[0], s.pos[2])
  );
}
if (worstUnderwater > 0.4) {
  console.log(`  PASS  ${worstUnderwater.toFixed(1)}m above the lake bed at worst`);
} else {
  console.log(`  FAIL  only ${worstUnderwater.toFixed(2)}m above the lake bed`);
}

console.log();
