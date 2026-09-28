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
 * ## World layout (Three.js right-handed, Y up, 1 unit ~= 1 metre)
 *
 *        +Y
 *         |            smoke plume + gas cards
 *         |            ^^^^^
 *   30m --+--  [chimney top]
 *         |
 *          \  factory
 *           \___________
 *
 *   jungle ring: radius 60 -> 260 (all directions)
 *   LAKE centre: (-52, 0, 30), radius 30
 *   factory footprint: roughly x[-22..22], z[-16..18]
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
  /** Chimney base and top, on the factory roof. */
  chimneyBase: [8, 14, -6] as Vec3,
  chimneyTop: [8, 44, -6] as Vec3,

  /** Lake surface. */
  lakeCentre: [-52, 0, 30] as Vec3,
  lakeRadius: 30,

  /** Jungle ring bounds. */
  jungleInner: 60,
  jungleOuter: 260,
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
    id: "overview",
    label: "Bird's eye — the whole picture",
    from: 0.0,
    to: 0.08,
    position: [
      [96, 74, 128],
      [82, 66, 112],
    ],
    target: [
      [-4, 6, 2],
      [-4, 8, 2],
    ],
    fov: [46, 45],
    ease: "inOutSine",
  },
  {
    id: "approach",
    label: "Descending toward the plant",
    from: 0.08,
    to: 0.2,
    position: [
      [82, 66, 112],
      [30, 34, 62],
    ],
    target: [
      [-4, 8, 2],
      [4, 16, 0],
    ],
    fov: [45, 48],
    ease: "inOutCubic",
  },
  {
    id: "chimney",
    label: "Arriving at the smoke source",
    from: 0.2,
    to: 0.32,
    position: [
      [30, 34, 62],
      [14, 46, 16],
    ],
    target: [
      [4, 16, 0],
      [8, 44, -6],
    ],
    fov: [48, 40],
    ease: "inOutSine",
  },
  {
    id: "rise-co2",
    label: "Following the plume — CO2",
    from: 0.32,
    to: 0.42,
    position: [
      [14, 46, 16],
      [10, 66, 14],
    ],
    target: [
      [8, 44, -6],
      [7, 64, -6],
    ],
    fov: [40, 42],
    ease: "inOutSine",
    card: "co2",
  },
  {
    id: "rise-co",
    label: "Following the plume — CO",
    from: 0.42,
    to: 0.51,
    position: [
      [10, 66, 14],
      [6, 86, 12],
    ],
    target: [
      [7, 64, -6],
      [5, 84, -5],
    ],
    fov: [42, 43],
    ease: "inOutSine",
    card: "co",
  },
  {
    id: "rise-no2",
    label: "Following the plume — NO2",
    from: 0.51,
    to: 0.6,
    position: [
      [6, 86, 12],
      [2, 106, 10],
    ],
    target: [
      [5, 84, -5],
      [1, 104, -4],
    ],
    fov: [43, 43],
    ease: "inOutSine",
    card: "no2",
  },
  {
    id: "rise-so2",
    label: "Following the plume — SO2",
    from: 0.6,
    to: 0.69,
    position: [
      [2, 106, 10],
      [-4, 124, 8],
    ],
    target: [
      [1, 104, -4],
      [-3, 122, -3],
    ],
    fov: [43, 44],
    ease: "inOutSine",
    card: "so2",
  },
  {
    id: "rise-pm25",
    label: "Following the plume — PM2.5",
    from: 0.69,
    to: 0.78,
    position: [
      [-4, 124, 8],
      [-8, 138, 6],
    ],
    target: [
      [-3, 122, -3],
      [-6, 136, -2],
    ],
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
      [-8, 138, 6],
      [-30, 168, 70],
    ],
    target: [
      [-6, 136, -2],
      [-20, 40, 20],
    ],
    fov: [46, 45],
    ease: "inOutCubic",
  },
  {
    id: "pullout",
    label: "Pulling back to the bird's eye",
    from: 0.82,
    to: 0.86,
    position: [
      [-30, 168, 70],
      [-64, 120, 118],
    ],
    target: [
      [-20, 40, 20],
      [-26, 4, 24],
    ],
    fov: [45, 44],
    ease: "inOutSine",
  },
  {
    id: "water-approach",
    label: "Swinging out over the lake",
    from: 0.86,
    to: 0.9,
    position: [
      [-64, 120, 118],
      [-52, 34, 74],
    ],
    target: [
      [-26, 4, 24],
      [-52, 0, 30],
    ],
    fov: [44, 40],
    ease: "inOutCubic",
  },
  {
    id: "water-nutrients",
    label: "The lake — nutrient loading",
    from: 0.9,
    to: 0.925,
    position: [
      [-52, 34, 74],
      [-46, 12, 52],
    ],
    target: [
      [-52, 0, 30],
      [-52, 0, 30],
    ],
    fov: [40, 34],
    ease: "inOutSine",
    card: "nutrients",
  },
  {
    id: "water-metals",
    label: "The lake — heavy metals",
    from: 0.925,
    to: 0.95,
    position: [
      [-46, 12, 52],
      [-42, 7, 42],
    ],
    target: [
      [-52, 0, 30],
      [-52, 0, 30],
    ],
    fov: [34, 30],
    ease: "inOutSine",
    card: "metals",
  },
  {
    id: "water-thermal",
    label: "The lake — thermal discharge",
    from: 0.95,
    to: 0.975,
    position: [
      [-42, 7, 42],
      [-38, 5, 36],
    ],
    target: [
      [-52, 0, 30],
      [-52, 0, 30],
    ],
    fov: [30, 28],
    ease: "inOutSine",
    card: "thermal",
  },
  {
    // No card. This beat exists purely to give the closing message somewhere
    // to land, and to bring the camera to rest on the lake.
    id: "outro",
    label: "Orion Manufacturing Plant",
    from: 0.975,
    to: 1.0,
    position: [
      [-38, 5, 36],
      [-30, 9, 30],
    ],
    target: [
      [-52, 0, 30],
      [-50, 1, 30],
    ],
    fov: [28, 30],
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
