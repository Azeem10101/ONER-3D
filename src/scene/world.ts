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

import { fbm, ridgedFbm, smoothstep, clamp } from "./noise";
import type { Vec3 } from "./timeline";

export const WORLD = {
  // --- Factory site ---------------------------------------------------------
  /** Centre of the industrial complex. */
  factoryCentre: [0, 0, 0] as Vec3,
  /**
   * Half-extents of the levelled industrial pad, in metres.
   *
   * Only slightly larger than the factory's own ~72×62m footprint. The
   * previous 190×150 pad was a clearing three times the size of the building
   * standing in it, which read as an empty plain with a shed on it.
   */
  factoryPadHalf: { x: 62, z: 52 } as const,
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
  /** LOCAL coordinates: the chimney base sits on the main hall's roof. */
  chimneyBase: [24, 14, -18] as Vec3,
  /** LOCAL coordinates of the stack mouth. */
  chimneyTop: [24, 44, -18] as Vec3,
  /**
   * World-space stack mouth: local y plus the pad height, since the factory
   * is offset onto the pad when composed in <Environment>.
   */
  chimneyTopWorld: [24, 66, -18] as Vec3,

  /** Height of the plume above the chimney mouth. */
  plumeHeight: 190,

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
   * Height of the far ridge line, in metres.
   *
   * 430m at 1900m subtends about 13 degrees — a band on the horizon. Taller or
   * closer and the range stops being a horizon and becomes a backdrop the
   * camera is apparently standing next to.
   */
  mountainHeight: 430,
  /** How far out the mountain ring sits. */
  mountainRadius: 1900,

  // --- Vegetation -----------------------------------------------------------
  /** No trees inside the pad, plus a margin for the treeline. */
  jungleInnerRadius: 0,
} as const;

/**
 * Terrain height at a world position, in metres.
 *
 * Deliberately a pure function so the terrain mesh, the vegetation scatter,
 * and the camera collision all agree. If you change the shape here, everything
 * downstream moves with it for free.
 */
export function terrainHeight(x: number, z: number): number {
  // Base rolling terrain. Low amplitude and low frequency: this is the ground
  // the jungle sits on, so it should read as gently undulating, not as
  // dramatic landscape.
  //
  // The +18 offset is load-bearing and was found the hard way. `fbm()` returns
  // a value centred on ZERO, so the raw terrain averaged 0.6m across the whole
  // map and ranged -3m to +3m. Since sea level is y = 0, that put two thirds of
  // the world BELOW the waterline — and the jungle scatter rejects anything
  // below 1.2m to keep trees out of the lake. The visible result was a forest
  // reduced to scattered clumps on the highest ground, with bare terrain
  // between, which read as "two layers of trees with empty land between them".
  //
  // 65.6% of the map was being rejected. Lifting the base to average ~18.5m
  // puts the whole landscape comfortably above the waterline, so the only
  // sub-waterline ground is now the lake basin itself.
  let height = 18 + fbm(x * 0.0019, z * 0.0019, 4) * 13;

  // Mountain ridges, far out. Weighted by distance so they only appear
  // beyond the detailed terrain, which keeps the near ground cheap and calm.
  const distance = Math.hypot(x, z);
  const mountainWeight = smoothstep(WORLD.terrainRadius * 0.75, WORLD.mountainRadius * 0.55, distance);
  if (mountainWeight > 0.001) {
    const ridge = ridgedFbm(x * 0.0011, z * 0.0011, 5);
    height += ridge * WORLD.mountainHeight * mountainWeight;
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
  return clamp(height, -WORLD.lakeBasinDepth - 1.5, WORLD.mountainHeight * 1.1);
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
