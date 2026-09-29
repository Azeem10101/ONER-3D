/**
 * WORLD LAYOUT
 * ============
 * One authoritative description of where everything is, in metres, with Y up.
 *
 * Every other module reads its coordinates from here. This exists because the
 * camera path, the terrain, the vegetation scatter, and the factory all have
 * to agree on where the chimney is — and when they drift apart you get a
 * camera that flies through a building that is 30m from where the keyframe
 * thinks it is.
 *
 * ## Coordinate frame
 *
 *      +Y  up
 *       |
 *       |        factory sits on a low shelf near the origin
 *       |        lake is to the -X / +Z side
 *       |
 *       +------------------ +X
 *      /
 *    +Z
 *
 * ## Scale — and why it is TIGHT
 *
 * The previous layout was 1400m of terrain with mountains at 6km. The
 * reference images are not that wide: their plant, forest and water all sit
 * within a few hundred metres of each other, and the mountains are a band on
 * the horizon rather than a landscape you are flying across. At the old scale
 * the factory and the lake were miniatures in the middle of an empty plain, and
 * the site read as a map rather than as a place you could stand in.
 *
 * Everything below is roughly 45% of the previous extent. The plant, the
 * forest and the water are now all within a few hundred metres of one another,
 * which is what makes the composition read.
 *
 * ## Scale convention
 *
 * 1 unit = 1 metre. A mature tropical emergent is 40-54m (see Jungle.tsx), the
 * factory's main hall is 44m long, and the lake is 190m across. Those three
 * being within an order of magnitude of each other is what makes the site read
 * as real: a forest that is too short makes the factory look like a toy, and
 * a landscape that is too wide makes everything in it look like a toy.
 */

import { fbm, smoothstep, clamp } from "./noise";
import type { Vec3 } from "./timeline";

export const WORLD = {
  // --- Factory site ---------------------------------------------------------
  /** Centre of the industrial complex. */
  factoryCentre: [0, 0, 0] as Vec3,
  /**
   * Half-extents of the levelled industrial pad, in metres.
   *
   * Grown from 62×52 alongside the factory itself, twice now. The pad has to
   * track the building: too small and the plant spills over the edge of its own
   * levelled shelf, too large and the clearing reads as an empty plain with a
   * shed on it. check-layout.ts asserts both directions, and reads the
   * factory's real extent rather than a stale hard-coded number.
   *
   * The X extent is bounded by the lake, which is only 12m away at the closest
   * approach — see check-layout's "lake clears the pad" assertion. Growing the
   * plant further will require moving the lake or the channel approach, not
   * widening the pad.
   */
  factoryPadHalf: { x: 76, z: 68 } as const,
  /**
   * Height of the pad relative to the surrounding jungle floor. Industrial
   * sites are cut flat and often raised, and a visible shelf edge reads as
   * "people built this" in a way a flush clearing does not.
   *
   * The <Factory> component is authored in local coordinates sitting on
   * y = 0 and is offset by this amount when composed in <Environment>, so the
   * chimney values below are LOCAL, not world.
   */
  factoryPadHeight: 22,

  // --- The chimney the camera follows ---------------------------------------
  /**
   * LOCAL, PRE-SCALE coordinates: the chimney base sits on the main hall's
   * roof, and the stack mouth is 30m above it.
   *
   * "Pre-scale" is the important qualifier. <Factory> applies
   * `WORLD.factoryScale` to its whole group, and it divides these values by
   * that same number when building the stack geometry — so the stack lands at
   * exactly these world coordinates no matter how the plant is resized.
   *
   * That is deliberate: the plume, all six `rise-*` camera shots, and
   * `plumeAxisAt()` are keyed to the stack mouth. Anchoring the chimney in
   * world space rather than local space is what lets the factory grow from
   * 72×62m to 104×90m without a single camera keyframe being retimed.
   */
  chimneyBase: [24, 14, -18] as Vec3,
  /** LOCAL coordinates of the stack mouth. */
  chimneyTop: [24, 44, -18] as Vec3,
  /**
   * World-space stack mouth: local y plus the pad height, since the factory
   * is offset onto the pad when composed in <Environment>. Unchanged by
   * `factoryScale` — see above.
   */
  chimneyTopWorld: [24, 66, -18] as Vec3,

  /**
   * Height of the plume above the chimney mouth.
   *
   * The downward lean coefficient below (0.16) must stay in step with the
   * vertex shader in Plume.tsx, or the camera stops tracking the smoke and
   * starts tracking empty air beside it. That coupling is why the axis is
   * exposed as a function rather than left as a number in a keyframe.
   */
  plumeHeight: 190,
  /** How far the plume leans downwind, as a fraction of height per life². */
  plumeLeanX: 0.16,
  plumeLeanZ: 0.06,

  // --- Lake -----------------------------------------------------------------
  /**
   * Close to the plant on purpose. The water is a subject, not a feature on
   * the horizon: the viewer has to be able to see clear water and polluted
   * water in the same frame while the camera descends onto it, which is
   * impossible if the lake is 300m from the factory and 380m across.
   */
  lakeCentre: [-185, 0, 130] as Vec3,
  lakeRadius: 95,
  /** Terrain is depressed here so the shoreline is organic, not a disc. */
  lakeBasinDepth: 9,

  // --- Terrain --------------------------------------------------------------
  /** Radius of the fully detailed terrain. A coarse skirt fills beyond it. */
  terrainRadius: 600,

  /**
   * How far out the coarse skirt reaches.
   *
   * There are no mountains. This number exists only so the skirt's outer edge
   * is far enough that atmospheric fog has fully dissolved it: at
   * FOG_DENSITY = 0.00085 the fog reaches 97% at this distance, so the seam
   * between "terrain" and "sky" is a flat wash of haze rather than a visible
   * edge. Pulling it in makes the edge show.
   */
  skirtRadius: 2470,
  /**
   * Maximum height of the far plain, in metres above the base terrain.
   *
   * A gentle swell, not a ridge. See the far-field term in `terrainHeight()`.
   */
  farFieldHeight: 130,

  // --- Vegetation -----------------------------------------------------------
  /** No trees inside the pad, plus a margin for the treeline. */
  jungleInnerRadius: 0,

  // --- Factory size ---------------------------------------------------------
  /**
   * Uniform scale applied to the procedural plant.
   *
   * The factory is authored once in local coordinates and scaled here rather
   * than by rewriting every dimension in Factory.tsx, so the silhouette and the
   * numbers that must agree with it (the chimney, the pad, the camera path) can
   * never drift apart. Resizing the plant is then a one-line change that the
   * layout checks can verify.
   *
   * 1.85 puts the main hall at 81m long and the stack 56m above the roof, on a
   * footprint of about 133×115m — 3.3x the area of the 72×62m plant it
   * replaced. That is the scale at which a plant stops reading as a shed on a
   * plain: against a 600m terrain radius and a 190m lake, it is now the largest
   * single object in the frame, which is what the piece is about.
   *
   * The pad tracks it (see factoryPadHalf), and the chimney is anchored in world
   * space rather than local, so growing the plant by a further 28% did not
   * require retiming a single camera keyframe or moving the plume.
   */
  factoryScale: 1.85,
} as const;

/**
 * World-space XZ of the plume's centreline at a given altitude.
 *
 * The plume is not vertical. The vertex shader applies a downwind lean that
 * grows with the square of height, so by the top of the column the smoke is
 * tens of metres from directly above the stack. The `rise-*` camera shots are
 * supposed to climb alongside that column, and they used to do it with
 * hand-typed keyframes that drifted the wrong way — the plume leans toward +x
 * while the keyframes marched toward -x, so the camera was climbing through
 * clear air a growing distance from the smoke it was supposed to be
 * inspecting.
 *
 * Deriving the shots from this function instead means the camera is always
 * genuinely beside the plume. It also means changing the lean coefficients or
 * the scale moves the camera and the smoke together.
 *
 * @param altitude World-space Y to sample the column at.
 * @returns `[x, y, z]` in world space. Y is clamped to the column's extent, so
 *   a caller can pass an altitude outside the plume and still get a sane point
 *   on the axis.
 */
export function plumeAxisAt(altitude: number): Vec3 {
  const base = WORLD.chimneyTopWorld[1];
  const top = base + WORLD.plumeHeight;
  const y = clamp(altitude, base, top);
  // life in the vertex shader is 0 at the stack mouth and 1 at the top of the
  // column; the lean is life², matching Plume.tsx exactly.
  const life = (y - base) / WORLD.plumeHeight;
  const lean = life * life * WORLD.plumeHeight;
  return [
    WORLD.chimneyTopWorld[0] + lean * WORLD.plumeLeanX,
    y,
    WORLD.chimneyTopWorld[2] + lean * WORLD.plumeLeanZ,
  ];
}

/**
 * Summary statistics of the terrain, measured rather than assumed.
 *
 * The forest's treeline used to be a hand-typed constant (`ground > 320`),
 * written when the landscape's base offset and noise amplitudes were different
 * values. It was never revisited, so after those numbers changed the threshold
 * ended up above the highest ground in the world and the treeline silently
 * stopped existing — trees grew to the top of the highest hill with bare rock
 * nowhere in sight.
 *
 * Anything that needs a number *relative to the terrain* should take it from
 * here. Memoised because it samples the heightfield, which is far too expensive
 * to do per scattered tree, and because every caller wants the same value.
 *
 * The treeline is the upper quartile of dry-land height plus a margin: real
 * forest gives way to scrub and rock well before the summit, and taking a
 * quantile rather than the maximum means one freak hilltop cannot drag the
 * whole forest line up with it.
 */
let _terrainStats: TerrainStats | null = null;

export type TerrainStats = {
  /** Lowest dry ground outside the lake, in metres. */
  min: number;
  /** Highest ground within the detailed terrain, in metres. */
  max: number;
  /** Height above which the forest gives way to scrub. */
  treeline: number;
  /** Peak-to-peak relief across the detailed terrain. */
  relief: number;
};

export function terrainStats(): TerrainStats {
  if (_terrainStats) return _terrainStats;

  const SAMPLES = 6000;
  // The lake is excluded: its bed is meant to be below zero, and including it
  // would drag `min` down by 40m and say nothing about the forest.
  const dry: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    // A golden-angle walk rather than a uniform polar grid, so consecutive
    // samples are never adjacent and the estimate is not biased by a repeating
    // arc pattern.
    const angle = i * 2.399963;
    const radius = Math.sqrt(i / SAMPLES) * WORLD.terrainRadius;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (Math.hypot(x - WORLD.lakeCentre[0], z - WORLD.lakeCentre[2]) < WORLD.lakeRadius * 1.5) continue;
    dry.push(terrainHeight(x, z));
  }
  dry.sort((a, b) => a - b);

  const min = dry[0];
  const max = dry[dry.length - 1];
  const q3 = dry[Math.floor(dry.length * 0.75)];

  _terrainStats = {
    min,
    max,
    // The upper quartile plus a third of the way to the summit. A forest
    // typically stops below the highest ground, and this keeps the band of
    // treeless hilltop visible from every approach without cutting into the
    // forest that fills the basin.
    treeline: q3 + (max - q3) * 0.34,
    relief: max - min,
  };
  return _terrainStats;
}

/**
 * Terrain height at a world position, in metres.
 *
 * Deliberately a pure function so the terrain mesh, the vegetation scatter,
 * and the camera collision all agree. If you change the shape here, everything
 * downstream moves with it for free.
 */
export function terrainHeight(x: number, z: number): number {
  // Rolling jungle floor. This is the ground the forest sits on, so it should
  // read as a basin that undulates — not as dramatic landscape, and not as a
  // table. Three numbers here are load-bearing and each was found by
  // measurement rather than by eye; check-scene.ts now asserts all of them.
  //
  // ## 1. The +28 base offset
  //
  // `fbm()` returns a value centred on ZERO, spanning about -0.43..+0.43. With
  // no offset at all the terrain therefore straddled the waterline, and the
  // jungle scatter — which rejects anything below 1.2m to keep trees out of the
  // lake — threw away 65.6% of the entire map. The visible result was a forest
  // reduced to scattered clumps on the highest ground with bare terrain between,
  // which read as "two layers of trees with empty land between them".
  //
  // 28m of base is sized against the worst case of the two noise terms below
  // (roughly 0.43 * 67 = 29m), so the lowest ground anywhere in the world is
  // still above the waterline. Do not reduce it without re-measuring.
  //
  // ## 2. The frequencies
  //
  // These were originally 0.0019, chosen when the world was 1400m in radius.
  // At that scale 2pi/0.0019 = 3300m was a genuine broad swell. The world is now
  // 600m in radius — 1200m across — so that wavelength never completed even one
  // cycle and the "landscape" was flat everywhere the camera could see it. That
  // was hidden by a 430m mountain ridge; once the ridge was removed the
  // landscape was revealed as a table, with only 30m of dry relief.
  //
  // Both frequencies are now sized against the world that exists:
  //
  //   0.0075  ->  ~840m wavelength. Two or three hills across the whole map.
  //             This is the large shape, and what gives the horizon some form.
  //   0.0210  ->  ~300m wavelength. Individual hills and valleys, which is what
  //             actually catch light and cast shadow at this viewing scale.
  //
  // ## 3. The amplitudes
  //
  // Set from the MEASURED span of `fbm` (~0.86), not from an assumed 0..1.
  // Together these give roughly 40m of broad relief and 18m of fine relief, so
  // the ground runs from about 0m in the lowest hollows to ~76m on the highest
  // hilltops. That is a basin, not a plain — and it is nowhere near a mountain
  // range, which is the point.
  let height =
    28 + fbm(x * 0.0075, z * 0.0075, 4) * 46 + fbm(x * 0.021, z * 0.021, 3) * 21;

  // Far field: a broad, low swell beyond the detailed terrain.
  //
  // THIS USED TO BE A MOUNTAIN RIDGE, and deleting `Mountains.tsx` did not
  // remove it. `ridgedFbm(...)*430` lived in the shared height function, so the
  // coarse skirt mesh was still building a 430m ridged horizon out to 2470m —
  // that was the "wiggly band" across the upper frame, and it survived the
  // component deletion because the geometry was never in that component.
  //
  // `ridgedFbm` is specifically the wrong primitive here: it folds the noise
  // into sharp creases by design, which is what makes a ridge read as a ridge.
  // Plain `fbm` at a wavelength of roughly 15km varies by only a few metres
  // across the whole visible distance, so the far field reads as a low, soft
  // plain that dissolves into fog — a horizon, not a skyline.
  const distance = Math.hypot(x, z);
  const farField = smoothstep(WORLD.terrainRadius * 0.8, WORLD.skirtRadius * 0.72, distance);
  if (farField > 0.001) {
    const broad = fbm(x * 0.00042, z * 0.00042, 3) * 0.5 + 0.5;
    height += farField * (broad - 0.35) * WORLD.farFieldHeight;
  }

  // --- Lake basin ---------------------------------------------------------
  // A real bowl with a real shoreline, carved as a shape rather than as a
  // subtraction.
  //
  // The previous approach subtracted a fixed depth from the finished height
  // and then bolted a `max()` lip onto the outside. That produced a TRENCH,
  // not a lake: the basin floor was flat at -9m and the lip rose to +3.5m
  // with nothing in between, so terrain sat between -1.2m and +3.4m for
  // 200m around the lake — below the 1.2m waterline, which is why no tree
  // could ever grow there. That was the empty band around the water: 23% of
  // all scatter attempts were being rejected as "underwater".
  //
  // Instead the ground is now shaped as a continuous profile from bed, up
  // through the waterline, to dry land — so the shoreline is a real bank with
  // soil above water, and the forest meets the water the way it should.
  const lakeDx = x - WORLD.lakeCentre[0];
  const lakeDz = z - WORLD.lakeCentre[2];
  const lakeDistance = Math.hypot(lakeDx, lakeDz);
  // Wobble scaled to the lake rather than left at the old absolute value —
  // 13m of shoreline noise on a 95m-radius lake would drown the shape entirely.
  const shorelineWobble = fbm(x * 0.0068, z * 0.0068, 3) * 13;
  const effectiveRadius = WORLD.lakeRadius + shorelineWobble;

  // How far into the lake profile we are, 0 at the shoreline and 1 at the
  // deepest point.
  const shoreT = smoothstep(effectiveRadius * 1.34, effectiveRadius * 0.18, lakeDistance);
  if (shoreT > 0.001) {
    // Smooth bowl, deepest at the centre. pow() rather than a linear ramp so
    // the bed flattens out instead of coming to a point.
    const bowl = Math.pow(shoreT, 0.62);
    const bed = -WORLD.lakeBasinDepth * bowl;

    // Blend toward the bowl, but never below it — the surrounding terrain
    // should not be able to intrude into the water.
    const bank = height;
    const target = bed < bank ? bed : bank;
    height = height * (1 - shoreT) + target * shoreT;

    // Above the waterline, lift into a dry bank so the shore reads as land
    // rather than as a wet margin. Only outside the waterline.
    const above = 1 - smoothstep(0.06, 0.3, shoreT);
    if (above > 0.001) {
      const bankHeight = 1.9;
      height = height + (Math.max(height, bankHeight) - height) * above;
    }
  }

  // --- Factory pad --------------------------------------------------------
  // Flatten the industrial site, with a smooth blend at the boundary so it
  // does not look like a hard-edged rectangle stamped into the ground. The
  // blend is ~40% of the pad so the shelf has a visible edge without eating
  // the surrounding forest.
  const padBlend = 16;
  const padX = 1 - smoothstep(WORLD.factoryPadHalf.x, WORLD.factoryPadHalf.x + padBlend, Math.abs(x));
  const padZ = 1 - smoothstep(WORLD.factoryPadHalf.z, WORLD.factoryPadHalf.z + padBlend, Math.abs(z));
  const pad = padX * padZ;
  if (pad > 0.001) {
    height = height * (1 - pad) + WORLD.factoryPadHeight * pad;
  }

  // Approach corridor. A raised causeway from the plant to the near shore, so
  // the drainage channel runs level and meets the water instead of dipping
  // under a bank on the way.
  //
  // The earlier `max()` lip this replaced had two bugs: it also applied at the
  // lake centre (raising the bed above the waterline and leaving the lake dry)
  // and it created the trench that is now gone. The bowl profile above handles
  // the shoreline; this only has to deal with the ground between the pad and
  // the water.
  if (lakeDistance < effectiveRadius * 2.6) {
    // The corridor runs from the pad's edge (positive X, since the plant is at
    // the origin and the lake is to the -X) to the outfall.
    //
    // The origin was originally derived by subtracting the pad offset from the
    // outfall, which put the axis start at -155m — on the far side of the lake
    // from the plant, so the wedge never covered the channel at all and the
    // dip persisted. Derived from the same pad edge <Environment> uses instead.
    const outfallX = WORLD.lakeCentre[0] + WORLD.lakeRadius * 0.58;
    const outfallZ = WORLD.lakeCentre[2] - WORLD.lakeRadius * 0.34;
    const approachX = WORLD.factoryPadHalf.x * 0.4;
    const approachZ = WORLD.factoryPadHalf.z * 0.4;
    const dirX = outfallX - approachX;
    const dirZ = outfallZ - approachZ;
    const dirLength = Math.hypot(dirX, dirZ) || 1;
    // Projection onto the corridor axis, 0 at the plant, 1 at the outfall.
    const along =
      ((x - approachX) * dirX + (z - approachZ) * dirZ) / (dirLength * dirLength);
    // Perpendicular distance from that axis.
    const perp =
      Math.abs((x - approachX) * -dirZ + (z - approachZ) * dirX) / dirLength;

    // Gated to dry land only. Un-gated, the corridor ran on past the shore and
    // lifted the lake bed above the waterline, so the lake was dry. `shoreT` is
    // the lake profile factor: 0 out on dry land, rising to 1 at the bottom.
    const dryLand = 1 - shoreT;
    const corridor =
      (1 - smoothstep(0, 1.25, along)) * (1 - smoothstep(6, 22, perp)) * dryLand;
    if (corridor > 0.001) {
      const causeway = 2.6;
      height = Math.max(height, height * (1 - corridor) + causeway * corridor);
    }
  }

  // Keep everything from dipping below the water table far away, which would
  // show as odd flat puddles. The floor is below the lake bed so the basin
  // can never be clipped upward.
  return clamp(height, -WORLD.lakeBasinDepth - 1.5, 18 + WORLD.farFieldHeight + 40);
}

/** How strongly industrialised the ground is at a point, 0..1. Used to keep
 *  trees and scrub off the pad. */
export function padInfluence(x: number, z: number): number {
  const padX = 1 - smoothstep(WORLD.factoryPadHalf.x * 0.9, WORLD.factoryPadHalf.x * 1.25, Math.abs(x));
  const padZ = 1 - smoothstep(WORLD.factoryPadHalf.z * 0.9, WORLD.factoryPadHalf.z * 1.35, Math.abs(z));
  return padX * padZ;
}

/** True if a point is under the lake surface. */
export function isSubmerged(x: number, z: number): boolean {
  return terrainHeight(x, z) < 0;
}
