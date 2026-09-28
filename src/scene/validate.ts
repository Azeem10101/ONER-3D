import { SHOTS, cardVisibility, sampleCamera, WORLD } from "./timeline";
import { CARDS } from "./content";

/**
 * Development-time sanity checks for the timeline.
 *
 * The scroll experience has no test suite, and that is mostly fine: a camera
 * path is a design decision, not a specification. But a few properties are
 * objectively true, and violating them produces a subtly broken page that is
 * painful to debug by eye — a camera that jumps, or a card that never appears.
 *
 * Called from <Overlays> in development only. Set NEXT_PUBLIC_SCENE_DEBUG=1
 * to enable the HUD readout as well.
 */

export function validateTimeline() {
  const problems: string[] = [];

  // 1. Shots must cover 0 -> 1 with no gaps, or sampleCamera() has to fall
  //    back and the camera will snap at the seam.
  if (SHOTS[0].from !== 0) {
    problems.push(`First shot starts at ${SHOTS[0].from}, expected 0`);
  }
  if (SHOTS[SHOTS.length - 1].to !== 1) {
    problems.push(`Last shot ends at ${SHOTS[SHOTS.length - 1].to}, expected 1`);
  }

  for (let i = 1; i < SHOTS.length; i++) {
    const previous = SHOTS[i - 1];
    const shot = SHOTS[i];
    if (Math.abs(previous.to - shot.from) > 1e-9) {
      problems.push(`Gap or overlap between "${previous.id}" (ends ${previous.to}) and "${shot.id}" (starts ${shot.from})`);
    }
    if (shot.to <= shot.from) {
      problems.push(`Shot "${shot.id}" has a non-positive range: ${shot.from} -> ${shot.to}`);
    }
  }

  // 2. Every card referenced by a shot must exist in the content map,
  //    otherwise the panel renders an empty shell.
  for (const shot of SHOTS) {
    if (shot.card && !(shot.card in CARDS)) {
      problems.push(`Shot "${shot.id}" references unknown card "${shot.card}"`);
    }
  }

  // 3. Every card in the content map should be reachable from the timeline.
  //    An orphan card means someone wrote copy that can never be seen.
  for (const id of Object.keys(CARDS)) {
    if (!SHOTS.some((shot) => shot.card === id)) {
      problems.push(`Card "${id}" has content but no shot in the timeline`);
    }
  }

  // 4. sampleCamera() must never return a non-finite value, at any scroll
  //    position. A NaN here silently blanks the entire canvas.
  for (let i = 0; i <= 1000; i++) {
    const state = sampleCamera(i / 1000);
    const values = [...state.position, ...state.target, state.fov];
    if (values.some((n) => !Number.isFinite(n))) {
      problems.push(`sampleCamera(${i / 1000}) returned a non-finite value`);
      break;
    }
  }

  // 5. Every card must reach a high enough visibility to be readable. If the
  //    peak is too low, the card is technically present but never legible.
  for (const shot of SHOTS) {
    if (!shot.card) continue;
    let peak = 0;
    for (let i = 0; i <= 200; i++) {
      const progress = shot.from + ((shot.to - shot.from) * i) / 200;
      peak = Math.max(peak, cardVisibility(shot.card, progress));
    }
    if (peak < 0.9) {
      problems.push(`Card "${shot.card}" peaks at ${peak.toFixed(2)} visibility; it will never be fully opaque`);
    }
  }

  // 6. The camera must stay above ground. Below y=0 it clips through the
  //    terrain and the whole scene disappears.
  for (let i = 0; i <= 1000; i++) {
    const state = sampleCamera(i / 1000);
    if (state.position[1] < 1) {
      problems.push(`Camera dips below ground at progress ${(i / 1000).toFixed(3)} (y=${state.position[1].toFixed(1)})`);
      break;
    }
  }

  return { problems, world: WORLD };
}
