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
  ease: EaseName;
  /** Content card that fades in and out across this shot's range. */
  card?: CardId;
  /** Short label for the debug HUD and for authoring. */
  label: string;
};

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
    from: 0.0,
    to: 0.08,
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
    from: 0.08,
    to: 0.2,
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
    from: 0.2,
    to: 0.32,
    position: [
      [-136, 104, 232],
      [4, 62, 66],
    ],
    target: [
      [0, 18, 0],
      [24, 44, -18],
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
    from: 0.32,
    to: 0.42,
    position: [
      [4, 62, 66],
      [26, 104, 58],
    ],
    target: [plumeAxisAt(80), plumeAxisAt(122)],
    fov: [40, 42],
    ease: "inOutSine",
    card: "co2",
  },
  {
    id: "rise-co",
    label: "Following the plume - CO",
    from: 0.42,
    to: 0.51,
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
    from: 0.51,
    to: 0.6,
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
    from: 0.6,
    to: 0.69,
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
    from: 0.69,
    to: 0.78,
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
    from: 0.78,
    to: 0.82,
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
    from: 0.82,
    to: 0.86,
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
    from: 0.86,
    to: 0.9,
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
    from: 0.9,
    to: 0.925,
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
    from: 0.925,
    to: 0.95,
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
    from: 0.95,
    to: 0.975,
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
    from: 0.975,
    to: 0.992,
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
    from: 0.992,
    to: 1.0,
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

function lerpVec(a: Vec3, b: Vec3, t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** The shot containing a given progress value. Clamps at both ends. */
export function shotAt(progress: number): Shot {
  const p = Math.min(1, Math.max(0, progress));
  for (const shot of SHOTS) {
    if (p >= shot.from && p <= shot.to) return shot;
  }
  return p < SHOTS[0].from ? SHOTS[0] : SHOTS[SHOTS.length - 1];
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
  const t = ease(shot.ease, Math.min(1, Math.max(0, raw)));

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
