/**
 * Runs the timeline validation checks outside the browser.
 *
 * The same logic the dev overlay calls on mount, so you can catch a bad edit
 * in CI before it reaches a reviewer who has to scroll to find it.
 *
 *   npx tsx scripts/check-timeline.ts
 */

import { validateTimeline } from "../src/scene/validate";
import { SHOTS, sampleCamera } from "../src/scene/timeline";

const { problems } = validateTimeline();

console.log("ONER timeline check\n" + "=".repeat(52));
console.log(`Shots: ${SHOTS.length}`);
console.log(`Total scroll: ${SHOTS.reduce((sum, shot) => sum + (shot.to - shot.from), 0).toFixed(4)} of the journey\n`);

console.log("Progress  Duration  Shot");
console.log("-".repeat(52));
for (const shot of SHOTS) {
  const duration = ((shot.to - shot.from) * 100).toFixed(1).padStart(6);
  console.log(
    `${shot.from.toFixed(3)} - ${shot.to.toFixed(3)}  ${duration}%  ${shot.id}${shot.card ? ` [${shot.card}]` : ""}`
  );
}

console.log("\nCamera sample");
console.log("-".repeat(52));
console.log("Progress   Position                    Target                 FOV");
for (let i = 0; i <= 10; i++) {
  const progress = i / 10;
  const state = sampleCamera(progress);
  const position = state.position.map((n) => n.toFixed(0).padStart(4)).join(", ");
  const target = state.target.map((n) => n.toFixed(0).padStart(4)).join(", ");
  console.log(
    `${progress.toFixed(2).padStart(8)}  [${position}]  [${target}]  ${state.fov.toFixed(0).padStart(3)}`
  );
}

console.log("\n" + "=".repeat(52));
if (problems.length === 0) {
  console.log("PASS — no problems found.");
  process.exit(0);
}

console.log(`FAIL — ${problems.length} problem(s):`);
for (const problem of problems) console.log(`  - ${problem}`);
process.exit(1);
