"use client";

import { useMemo } from "react";
import { Sky } from "@react-three/drei";
import { Color, Vector3 } from "three";
import {
  HORIZON_TINT,
  MIE_COEFFICIENT,
  MIE_DIRECTIONAL_G,
  RAYLEIGH,
  SUN_DIRECTION,
  TURBIDITY,
} from "@/scene/sun";

/**
 * The sky dome.
 *
 * drei's <Sky> wraps three's Preetham analytic atmosphere. The parameters
 * matter more than they look:
 *
 *   - `inclination` / `azimuth` position the sun. We derive them from
 *     SUN_DIRECTION so the sky, the directional light, and the fog all agree
 *     on where the sun is. Deriving one from the other is the whole trick
 *     that keeps the lighting coherent.
 *
 *   - `turbidity` is atmospheric haze. At 2.4 this is a clear day; the
 *     reference frames have visible valley haze, which we add separately as
 *     height fog rather than by dirtying the whole sky.
 *
 *   - `rayleigh` controls how blue the sky is and how much of the sun's
 *     colour is scattered out. Higher = deeper blue, more saturated shadows.
 *
 * Cost: one inverted sphere, one fragment shader. Cheap, and it replaces what
 * would otherwise need a downloaded 8K HDR environment map.
 */
export function SkyDome() {
  const { inclination, azimuth } = useMemo(() => {
    // three's Sky expects spherical angles, but our scene works in vectors.
    // Converting once here means the rest of the codebase never has to think
    // in inclination/azimuth.
    const direction = new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z).normalize();
    return {
      inclination: Math.PI / 2 - Math.asin(direction.y),
      azimuth: Math.atan2(direction.z, -direction.x) - Math.PI / 2,
    };
  }, []);

  return (
    <Sky
      // three's Sky already sets material.side = BackSide internally, so the
      // dome only renders its inner faces and we stay inside it.
      distance={450000}
      inclination={inclination}
      azimuth={azimuth}
      turbidity={TURBIDITY}
      rayleigh={RAYLEIGH}
      mieCoefficient={MIE_COEFFICIENT}
      mieDirectionalG={MIE_DIRECTIONAL_G}
    />
  );
}

/**
 * The horizon colour the sky settles to, for fog and distant terrain.
 *
 * Exported as a function because it is sampled after the sky parameters are
 * known, and callers need a real Color rather than a static constant.
 */
export function horizonColor() {
  return new Color(HORIZON_TINT.r, HORIZON_TINT.g, HORIZON_TINT.b);
}
