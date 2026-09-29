/**
 * THE TIMELINE
 * ------------
 * This is the single source of truth for the entire experience. The 3D camera
 * and the HTML overlays are both derived from it, which means the gas card for
 * NO2 can never drift out of sync with the moment NO2 appears in the plume.
 *
 * The whole journey is authored in "scroll progress" space (0 -> 1) rather
 * than pixels, so retiming a shot never means touching layout.
 *
 * ## World layout
 *
 * Right-handed, Y up, 1 unit = 1 metre. Authoritative definitions live in
 * world.ts; the re-exports below exist so the timeline reads as one place.
 *
 *        +Y
 *         |   plume + gas cards, up to ~400m
 *         |   ^^^^^
 *  66m ---+-- [chimney top]  (24, 66, -18)
 *         |
 *          \ factory pad, levelled to 22m
 *           \____________
 *
 *   terrain radius    600m, coarse skirt to 2470m, no mountains
 *   lake centre       (-185, 0, 130), radius 95
 *   factory pad       x[-78..78], z[-66..66], plant scaled 1.45x
 *
 * Camera altitudes run about -6m (underwater outro) to 402m (apex). Over LAND
 * anything below ~20m puts the camera inside the canopy, which the validator
 * rejects; the final act is deliberately underwater.
 *
 * ## The beats
 *
 *   0.000  overview         bird's eye, we see the whole picture
 *   0.080  approach         dive in toward the factory
 *   0.200  chimney          arrive at the smoke source
 *   0.320  rise ×5          follow the plume up, one gas card per shot
 *   0.780  apex             top out
 *   0.820  pullout          zoom back to the bird's eye
 *   0.860  water ×4         dive into the lake, one waste card per shot
 *   0.975  outro            camera settles, closing message
 *
 * ## Total scroll length
 *
 * A shot's `to - from` is multiplied by TOTAL_VH (in <Overlays/>) to get its
 * height in vh, so a range of 0.10 becomes 10% of the page. Every card's
 * on-screen duration is therefore authored directly in the ranges above —
 * retiming the experience means editing numbers here and nothing else.
 *
 * Note the water cards get ~2.5% each versus ~10% for the gas cards. That is
 * intentional: the lake is a fast dive, and lingering on three waste cards
 * would stall the ending.
 */

import { WORLD as WORLD_LAYOUT, plumeAxisAt } from "./world";

export type Vec3 = readonly [number, number, number];

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

export type EaseName = "linear" | "inOutSine" | "inOutCubic" | "outCubic" | "outExpo" | "inOutQuint";

const EASINGS: Record<EaseName, (t: number) => number> = {
  linear: (t) => t,
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutQuint: (t) => (t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2),
};

/**
 * A curve with independently specified SPEED at each end.
 *
 * A cubic Hermite in speed space: f(0) = 0, f(1) = 1, and f'(0) and f'(1) are
 * free parameters rather than consequences of the position constraint.
 *
 * ## The problem
 *
 * A shot is a straight line from A to B over a span of scroll, so its average
 * speed is fixed by the author: length over span. Two adjacent shots rarely
 * cruise at the same speed — across this journey they differ by up to 5x — and
 * whatever easing is applied, the camera has to arrive at the seam at one speed
 * and leave it at another. Three schemes were tried here and all three failed:
 *
 *   1. A NAMED EASING CURVE (inOutSine and friends). Every one of them is a
 *      smoothstep, so every one has zero velocity at BOTH ends. Applied
 *      per-shot, that stops the camera dead at all fifteen seams.
 *
 *   2. THE MIRROR OF A SMOOTHSTEP, used as a second curve. A mirror of
 *      inOutSine about (0.5, 0.5) is also a smoothstep, and also at rest at both
 *      ends. This moved the stop-start from the middle of each shot to its edges
 *      without removing a single one.
 *
 *   3. ALTERNATING those two across the shots, so each seam is either a shared
 *      pause or a shared cruise. Pausing at all fifteen seams stutters; cruising
 *      at all fifteen produces a velocity STEP at each, because a shot cruising
 *      at 3100 m per unit of scroll followed by one cruising at 900 hands over
 *      at 3100 and leaves at 900. Form is not continuity.
 *
 * ## The insight
 *
 * Scheme 3 fails for a specific reason. The curve is being asked to hit a
 * particular POSITION, which fixes its average speed, AND to have a particular
 * speed at its ends, which it can only achieve by surging or hesitating
 * somewhere in the middle. Those two requirements are not independent, so no
 * single curve can satisfy both — which is why every attempt above ended up
 * trading one artefact for another.
 *
 * They become independent in speed space. With the two endpoint SLOPES free, the
 * behaviour through the middle falls out of the geometry rather than being an
 * error at the seam. A surge through the middle of a shot reads as a deliberate
 * move; a step at a boundary reads as a fault.
 *
 * ## Why the seams are then continuous by construction
 *
 * Give every shot the same seam speed and continuity stops being something to
 * verify afterwards and becomes something that cannot fail. See CURVES below.
 *
 * The eye is far more sensitive to a change in acceleration than to a change in
 * position, which is why any of this matters at all: the positions along the
 * path were continuous throughout, and a position-delta check cannot see this
 * class of fault. check-motion.ts measures it directly, by comparing the speed a
 * few thousandths either side of every seam against the local cruising speed.
 *
 * @param a0 Speed at t=0, in units of the shot's own average.
 * @param a1 Speed at t=1, in the same units.
 */
function hermite(a0: number, a1: number): (t: number) => number {
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const t2 = t * t;
    const t3 = t2 * t;
    // Cubic Hermite basis: endpoint positions fixed at 0 and 1, endpoint slopes
    // supplied as a0 and a1.
    return (t3 - 2 * t2 + t) * a0 + (-2 * t3 + 3 * t2) + (t3 - t2) * a1;
  };
}

export function ease(name: EaseName, t: number) {
  return EASINGS[name](t);
}

// ---------------------------------------------------------------------------
// Key world positions
// ---------------------------------------------------------------------------

export const WORLD = {
  /** Chimney base and top. Re-exported from world.ts so the timeline and the
 *  factory geometry cannot disagree. */
  get chimneyBase() {
    return WORLD_LAYOUT.chimneyBase;
  },
  get chimneyTop() {
    return WORLD_LAYOUT.chimneyTop;
  },
  /**
   * The stack mouth in WORLD space — the point the plume leaves from, and the
   * point the camera keyframes aim at.
   *
   * Distinct from `chimneyTop`, which is a LOCAL coordinate inside the factory
   * group. That group is lifted onto the pad by `factoryPadHeight`, so the two
   * differ by 22m in Y. Aiming at the local value puts the top of the stack low
   * in frame, and it was also the source of a 36m target whip-pan at the 0.32
   * boundary, where the arrival shot ended on y=44 and the first rise shot
   * began on y=80.
   */
  get chimneyTopWorld() {
    return WORLD_LAYOUT.chimneyTopWorld;
  },

  /** Lake surface. */
  get lakeCentre() {
    return WORLD_LAYOUT.lakeCentre;
  },
  get lakeRadius() {
    return WORLD_LAYOUT.lakeRadius;
  },

  get terrainRadius() {
    return WORLD_LAYOUT.terrainRadius;
  },
  /**
   * The horizon re-export. Formerly `mountainRadius`, which described where a
   * mountain ring sat. There is no mountain ring any more — the ridge lived
   * inside `terrainHeight()` and was removed — so this is the skirt's outer
   * edge. Kept under a layout-neutral name because Timeline's re-export block
   * exists to give components one import for the whole world.
   */
  get skirtRadius() {
    return WORLD_LAYOUT.skirtRadius;
  },
} as const;

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------

export type CardId =
  | "co2"
  | "co"
  | "no2"
  | "so2"
  | "pm25"
  | "nutrients"
  | "metals"
  | "thermal";

export type Shot = {
  id: string;
  /** Scroll-progress range this shot occupies. */
  from: number;
  to: number;
  /** Camera position, interpolated from -> to across the shot. */
  position: readonly [Vec3, Vec3];
  /** The point the camera looks at. Drives both rotation and focus pull. */
  target: readonly [Vec3, Vec3];
  /** Vertical field of view in degrees. Animating this reads as a zoom. */
  fov: readonly [number, number];
  /**
   * The shot's character, for authoring and for the debug HUD.
   *
   * NOT the curve actually used. `sampleCamera` picks from EASE_IN/EASE_OUT
   * based on the shot's position in the journey, because every curve in
   * EASINGS is a smoothstep and therefore has zero velocity at both ends —
   * applied per-shot that stops the camera dead sixteen times over the
   * journey. See the note beside EASE_IN. Retained because it documents what
   * each shot is *for*, which the automatic rule cannot know.
   */
  ease: EaseName;
  /** Content card that fades in and out across this shot's range. */
  card?: CardId;
  /** Short label for the debug HUD and for authoring. */
  label: string;
};

/** A shot plus its position in the journey, which the easing rule needs. */
export type IndexedShot = Shot & { index: number };

/**
 * The camera journey. Ranges are contiguous and cover 0 -> 1 with no gaps,
 * so the camera is never undefined at any scroll position.
 */
export const SHOTS: readonly Shot[] = [
  {
    // MILESTONE 1 OPENING FRAME - retimed for the tighter world.
    //
    // Composition is constrained by geometry rather than taste alone:
    //   altitude 318m, horizontal offset 906m  ->  19.3 degrees of downward
    //   pitch, with a 24 degree half-FOV. The horizon therefore sits about
    //   80% of the way up the frame: the mountains are in shot, and there is
    //   still enough downward view to read the forest canopy.
    //
    // An earlier version was pitched 33 degrees down, which put the horizon
    // entirely out of frame. check-scene.ts asserts the horizon falls inside
    // the vertical FOV so that class of mistake cannot return.
    //
    // The tighter altitude matters: at 620m over a 1400m world the plant and
    // lake were miniatures. At 318m over a 600m world the same site fills the
    // frame the way the reference frames do.
    id: "overview",
    label: "Bird's eye - nature, industry, and the cost of both",
    from: 0.0000,
    to: 0.0824,
    position: [
      [-432, 318, 742],
      [-352, 248, 604],
    ],
    target: [
      [-30, 48, 26],
      [-18, 32, 14],
    ],
    // 48 degrees vertical is roughly a 40mm equivalent - the lens a drone
    // carries, and the widest that still allows a horizon and a large subject
    // to coexist in one frame without edge distortion.
    fov: [48, 46],
    ease: "inOutSine",
  },
  {
    id: "approach",
    label: "Descending toward the plant",
    from: 0.0824,
    to: 0.2287,
    position: [
      [-352, 248, 604],
      [-136, 104, 232],
    ],
    target: [
      [-18, 32, 14],
      [0, 18, 0],
    ],
    fov: [46, 44],
    ease: "inOutCubic",
  },
  {
    // Terminates on the stack the camera then follows. Framing is authored
    // against the real chimney position, not a placeholder.
    id: "chimney",
    label: "Arriving at the smoke source",
    from: 0.2287,
    to: 0.3233,
    position: [
      [-136, 104, 232],
      // BELOW the stack mouth, so the camera arrives looking up the column
      // rather than down at the source.
      //
      // Ending level with or above the mouth put the first rise shot's pitch on
      // a path from -5 degrees through dead level to +13, so the camera started
      // the climb tilted downward at the smoke and had to swing up through
      // horizontal to follow it. check-scene.ts caught the dead-level crossing.
      [4, 50, 62],
    ],
    target: [
      [0, 30, 0],
      // The stack MOUTH, in world space — not WORLD.chimneyTop, which is a LOCAL
      // coordinate at y=44. The factory group is lifted onto the pad by
      // factoryPadHeight, so the mouth the camera actually arrives at is 22m
      // higher. Aiming at 44 put the top of the stack near the middle of the
      // frame rather than the point the plume leaves from, and the mismatch was
      // also the source of a 36m target whip-pan at the 0.32 boundary, where this
      // shot's end target (y=44) met the next shot's start target from
      // plumeAxisAt(80) (y=80).
      WORLD.chimneyTopWorld,
    ],
    fov: [44, 40],
    ease: "inOutSine",
  },
  // The five `rise-*` shots climb the plume.
  //
  // Their targets come from `plumeAxisAt()` rather than hand-typed numbers, and
  // that is a correction rather than a refactor. The plume leans DOWNWIND, away
  // from the stack and toward +x, with an offset that grows as the square of
  // height. The old keyframes marched steadily toward -x instead — from x=24
  // at the stack to x=-4 at the top — so the camera was climbing through clear
  // air while the smoke it was supposed to be inspecting drifted further and
  // further out of frame. Over a 190m column that is tens of metres of error,
  // and it is a very plausible contributor to "the smoke is not moving": the
  // camera was not watching it.
  //
  // `plumeAxisAt` returns the centre of the column, and each camera position
  // sits back along +z from it so the smoke has air around it in frame rather
  // than filling the lens edge to edge.
  {
    id: "rise-co2",
    label: "Following the plume - CO2",
    from: 0.3233,
    to: 0.3563,
    position: [
      [4, 50, 62],
      [26, 104, 58],
    ],
    // Starts on the stack mouth, which is exactly where the previous shot ended
    // looking, so the handover has no target jump at all.
    target: [plumeAxisAt(66), plumeAxisAt(122)],
    fov: [40, 42],
    ease: "inOutSine",
    card: "co2",
  },
  {
    id: "rise-co",
    label: "Following the plume - CO",
    from: 0.3563,
    to: 0.3933,
    position: [
      [26, 104, 58],
      [36, 148, 50],
    ],
    target: [plumeAxisAt(122), plumeAxisAt(166)],
    fov: [42, 43],
    ease: "inOutSine",
    card: "co",
  },
  {
    id: "rise-no2",
    label: "Following the plume - NO2",
    from: 0.3933,
    to: 0.4305,
    position: [
      [36, 148, 50],
      [48, 192, 42],
    ],
    target: [plumeAxisAt(166), plumeAxisAt(210)],
    fov: [43, 43],
    ease: "inOutSine",
    card: "no2",
  },
  {
    id: "rise-so2",
    label: "Following the plume - SO2",
    from: 0.4305,
    to: 0.4639,
    position: [
      [48, 192, 42],
      [62, 228, 44],
    ],
    target: [plumeAxisAt(210), plumeAxisAt(248)],
    fov: [43, 44],
    ease: "inOutSine",
    card: "so2",
  },
  {
    // The last of the five, and the one that used to go wrong.
    //
    // The column tops out at y=256 and `plumeAxisAt` clamps to that, so a
    // target requested higher than 256 silently resolves to the very top. The
    // camera then kept climbing past it — 268m against a 256m target — and the
    // shot ended looking DOWN at the dissipating smoke from above, at a pitch
    // that passed through dead level. The plume visibly dissolving is the point
    // of the shot, so the camera stays below the top and looks up into it.
    id: "rise-pm25",
    label: "Following the plume - PM2.5",
    from: 0.4639,
    to: 0.4841,
    position: [
      [62, 228, 44],
      [72, 234, 56],
    ],
    target: [plumeAxisAt(248), plumeAxisAt(256)],
    fov: [44, 46],
    ease: "inOutSine",
    card: "pm25",
  },
  {
    id: "apex",
    label: "Topping out",
    from: 0.4841,
    to: 0.6024,
    position: [
      [72, 234, 56],
      [-96, 402, 268],
    ],
    // Picks up where the last rise shot left off, then swings back and up to
    // look down the length of the column from above — the turn that reveals the
    // lake beyond it.
    target: [plumeAxisAt(256), [-40, 60, 40]],
    fov: [46, 45],
    ease: "inOutCubic",
  },
  {
    id: "pullout",
    label: "Pulling back to the bird's eye",
    from: 0.6024,
    to: 0.7154,
    position: [
      [-96, 402, 268],
      [-288, 352, 486],
    ],
    target: [
      [-40, 60, 40],
      [-120, 44, 90],
    ],
    fov: [45, 47],
    ease: "inOutSine",
  },
  {
    // Brings the camera over the lake. The water is still clean here and the
    // fish are alive and moving — this shot is the "before" of the story, so
    // it is composed to show clear water with life in it.
    id: "water-approach",
    label: "Swinging out over the lake",
    from: 0.7154,
    to: 0.8371,
    position: [
      [-288, 352, 486],
      [-246, 96, 276],
    ],
    target: [
      [-120, 44, 90],
      [-185, 0, 130],
    ],
    fov: [47, 44],
    ease: "inOutCubic",
  },
  {
    // THE SURFACE CROSSING.
    //
    // The camera passes through the waterline and ends up inside the lake.
    // This is the beat the whole second half builds to, and it is why the lake
    // is only 95m across: at this scale the camera can be inside it, beside the
    // fish, rather than hovering above a pond.
    //
    // The target stays above the water surface so the camera is looking
    // slightly up, which puts the underside of the surface and the sky beyond
    // it in frame — the shot that makes being underwater legible.
    id: "water-enter",
    label: "Entering the water — it is still clean",
    from: 0.8371,
    to: 0.9132,
    position: [
      [-246, 96, 276],
      // -2.2m, not -3.2m. The bowl's bed rises toward the shore, and at this
      // distance the floor is at -3.6m — so -3.2m left only 0.38m of clearance
      // and the near clip plane was essentially scraping the lake floor.
      [-186, -2.2, 176],
    ],
    target: [
      [-185, 0, 130],
      [-198, 4.5, 142],
    ],
    fov: [44, 40],
    ease: "inOutSine",
    // No card: this is a beat for looking, not for reading.
  },
  {
    // The discharge starts. Effluent pours from the outfall, the water starts
    // to discolour, and the fish nearest the outfall begin to react.
    id: "water-discharge",
    label: "The discharge reaches the water",
    from: 0.9132,
    to: 0.9375,
    position: [
      [-186, -2.2, 176],
      [-172, -3.0, 158],
    ],
    target: [
      [-198, 4.5, 142],
      [-178, -1.5, 136],
    ],
    fov: [40, 38],
    ease: "inOutSine",
    card: "nutrients",
  },
  {
    // The plume spreads through the lake. The fish flee toward the clean water
    // on the far side, and this shot is framed to show both the polluted
    // near side and the clean far side at once — that contrast is the point.
    id: "water-spread",
    label: "It spreads — the fish flee toward clean water",
    from: 0.9375,
    to: 0.9636,
    position: [
      [-172, -3.6, 158],
      [-152, -4.2, 142],
    ],
    target: [
      [-178, -1.5, 136],
      [-206, -2.0, 118],
    ],
    fov: [38, 36],
    ease: "inOutSine",
    card: "metals",
  },
  {
    // The fish that could not escape are dying and sinking. Held low and close
    // so the change in the water is the subject, with the dead fish in the
    // lower third of frame.
    id: "water-death",
    label: "There is nowhere clean left to go",
    from: 0.9636,
    to: 0.9878,
    position: [
      [-152, -4.2, 142],
      [-168, -5.0, 158],
    ],
    target: [
      [-206, -2.0, 118],
      [-190, -4.5, 140],
    ],
    fov: [36, 34],
    ease: "inOutSine",
    card: "thermal",
  },
  {
    // Rest, low in the polluted water, looking back up toward the surface.
    // The epilogue lands here.
    //
    // Depth is held at -3.4m rather than going deeper. The bowl's bed varies
    // with distance from the centre, and -5.6m put the camera inside the lake
    // floor at the far side. -3.4m is below the fish, which is the framing
    // that matters, and clear of the bed everywhere in the frame.
    id: "outro",
    label: "Orion Manufacturing Plant",
    from: 0.9878,
    to: 1.0000,
    position: [
      [-168, -3.4, 158],
      [-172, -3.9, 164],
    ],
    target: [
      [-190, -4.0, 140],
      [-192, -2.6, 146],
    ],
    fov: [34, 36],
    ease: "inOutSine",
  },
] as const;

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

export type CameraState = {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  /** Id of the shot currently being played, for HUD/debug. */
  shotId: string;
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function easedParameter(shotIndex: number, t: number): number {
  return CURVES[shotIndex](t);
}

function lerpVec(a: Vec3, b: Vec3, t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/**
 * The curve for each shot, resolved ONCE after the table exists.
 *
 * ## One shared cruise speed
 *
 * `V` is a single speed, in metres per unit of scroll, that the camera matches
 * at EVERY seam in the journey. It is the geometric mean of the shots' own
 * cruise speeds, which is the value that minimises how far any individual shot
 * has to bend to reach it — and the geometric rather than the arithmetic mean
 * because the ratios matter, not the absolute speeds.
 *
 * Each shot then gets a Hermite with both endpoints scaled to V: `a = V /
 * cruise`, so a shot that naturally moves faster than V runs quickly through
 * the middle and eases down to V at each end, and one that moves slower does
 * the reverse. The journey starts and ends at rest — `a = 0` on the first and
 * last shots — because beginning and settling are the two moments where coming
 * to a stop is what the shot is for.
 *
 * ## Why this replaced the alternation scheme
 *
 * The previous approach paired EASE_IN with EASE_OUT shot by shot, so every
 * seam was either a shared pause or a shared cruise. Pausing at all fifteen
 * seams stutters; cruising at all fifteen seams produces a velocity step at
 * each one, because the shots' own speeds differ by up to 5x. Fixing the seam
 * speed directly sidesteps the choice entirely: there is no pairing to get
 * wrong, no rule about which shots are arrivals, and no way for a future retime
 * of one shot to silently break its neighbours.
 *
 * It is also far less code. The alternation, the arrival detection and the
 * continuity ratio were all attempts to infer the seam speed; here it is simply
 * stated.
 *
 * ## Why the clamp
 *
 * `a` above about 2.2 makes a Hermite cubic overshoot backwards. The camera
 * would then travel the wrong way for part of a shot, which is a far worse
 * artefact than the speed step this scheme exists to remove, and one no amount
 * of smoothing elsewhere would hide. So the bend is capped and the residual
 * step is accepted where it occurs — with the shot spans retimed to keep the
 * remaining cases few and small.
 *
 * Declared after SHOTS rather than beside the curve definitions because it
 * reads SHOTS, and module initialisation runs top to bottom: putting it earlier
 * throws a TDZ error at import.
 */
const CURVES: readonly ((t: number) => number)[] = (() => {
  /**
   * The largest factor by which a shot may be bent to reach the shared cruise
   * speed, as a multiple of its own average.
   *
   * 2.2 is where a cubic Hermite with equal endpoint slopes stops being
   * monotonic and begins overshooting past 1 before returning — which would
   * send the camera backwards through part of the shot. That is a far worse
   * artefact than the speed step this scheme exists to remove, and one no
   * amount of smoothing elsewhere would hide. So the bend is capped and the
   * residual step is accepted where it occurs, with the shot spans retimed to
   * keep the remaining cases few and small.
   *
   * Declared inside the IIFE rather than beside the other constants because it
   * is only meaningful here, and because module-level consts initialise in
   * source order — one declared below its use throws a TDZ error at import.
   */
  const MAX_BEND = 2.2;

  const cruise = SHOTS.map((shot) => {
    const length = Math.hypot(
      shot.position[1][0] - shot.position[0][0],
      shot.position[1][1] - shot.position[0][1],
      shot.position[1][2] - shot.position[0][2]
    );
    const span = shot.to - shot.from;
    return span > 0 ? length / span : 1;
  });

  // Geometric mean of the cruise speeds, skipping the two endpoint shots — the
  // opening is nearly stationary and would drag the mean far below the speeds
  // the camera actually travels at for most of the journey.
  const interior = cruise.slice(1, -1);
  const shared = Math.exp(
    interior.reduce((acc, s) => acc + Math.log(Math.max(1, s)), 0) / interior.length
  );

  const clampA = (a: number) => Math.min(MAX_BEND, Math.max(0, a));

  return SHOTS.map((_, index) => {
    const a = clampA(shared / cruise[index]);
    // The journey OPENS at rest — coming to a stop as the page loads is the
    // shot's whole purpose, and a camera already travelling at the first frame
    // reads as a cut that has already happened. It does not CLOSE at rest
    // between shots 0 and 1 though: shot 0 hands on at the shared cruise like
    // every other shot, and shot 1 departs at the same speed. Treating the
    // opening shot as at-rest at both ends made the very first seam a step from
    // nothing to full speed.
    if (index === 0) return hermite(0, a);
    // And the journey CLOSES at rest, for the same reason in reverse, but
    // arrives there from the shared cruise rather than from a stop.
    if (index === SHOTS.length - 1) return hermite(a, 0);
    return hermite(a, a);
  });
})();

/**
 * The shot containing a given progress value, with its index. Clamps at both
 * ends.
 *
 * The index is needed by the easing rule, which depends on a shot's position in
 * the journey rather than on any property of the shot itself. Computed here
 * once at module load rather than tracked incrementally, so it cannot fall out
 * of step with SHOTS.
 */
const INDEXED: readonly IndexedShot[] = SHOTS.map((shot, index) => ({ ...shot, index }));

export function shotAt(progress: number): IndexedShot {
  const p = Math.min(1, Math.max(0, progress));
  for (const shot of INDEXED) {
    if (p >= shot.from && p <= shot.to) return shot;
  }
  return p < INDEXED[0].from ? INDEXED[0] : INDEXED[INDEXED.length - 1];
}

/**
 * Sample the camera at a scroll progress value. This is the only function the
 * render loop needs; it allocates one small object per frame, which is fine
 * at 60fps but is why the object is reused by the caller where possible.
 */
export function sampleCamera(progress: number): CameraState {
  const shot = shotAt(progress);
  const span = shot.to - shot.from;
  // Guard against a zero-length shot dividing by zero.
  const raw = span > 0 ? (progress - shot.from) / span : 0;
  // The curve is chosen by position in the journey, not by the shot's own
  // `ease` field — see the note beside EASE_IN for why.
  const t = easedParameter(shot.index, Math.min(1, Math.max(0, raw)));

  return {
    position: lerpVec(shot.position[0], shot.position[1], t),
    target: lerpVec(shot.target[0], shot.target[1], t),
    fov: lerp(shot.fov[0], shot.fov[1], t),
    shotId: shot.id,
  };
}

/**
 * How "active" a card is at a given progress: 0 when hidden, ramping to 1
 * across the first `edge` of its shot's range, holding, then ramping back to
 * 0 across the last `edge`. This is what gives the pop-up / pop-down feel.
 */
export function cardVisibility(card: CardId, progress: number, edge = 0.22) {
  const shot = SHOTS.find((s) => s.card === card);
  if (!shot) return 0;

  const span = shot.to - shot.from;
  if (span <= 0) return 0;

  const raw = (progress - shot.from) / span;
  if (raw <= 0 || raw >= 1) return 0;

  const easeIn = Math.min(1, raw / edge);
  const easeOut = Math.min(1, (1 - raw) / edge);
  // Smoothstep both ends so the card settles rather than snapping.
  const s = (n: number) => n * n * (3 - 2 * n);
  return s(Math.min(easeIn, easeOut));
}

/** Which cards exist, in timeline order. */
export const CARD_ORDER: readonly CardId[] = ["co2", "co", "no2", "so2", "pm25", "nutrients", "metals", "thermal"];
