"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Color, DirectionalLight, Vector3 } from "three";
import {
  HEMISPHERE_GROUND_COLOR,
  HEMISPHERE_INTENSITY,
  HEMISPHERE_SKY_COLOR,
  SUN_COLOR,
  SUN_DIRECTION,
  SUN_DISTANCE,
  SUN_INTENSITY,
} from "@/scene/sun";
import type { QualitySettings } from "@/scene/quality";

/**
 * LIGHTING RIG
 * ============
 * Sun, sky fill, and atmospheric fog — the three systems that do most of the
 * work of making a scene look photographed rather than rendered.
 *
 * ## The core idea
 *
 * Everything is derived from one vector, SUN_DIRECTION. The sun light, the
 * sky dome's sun position, and the fog colour are all computed from it. When
 * these three disagree — a warm light but a cool fog, or a shadow pointing
 * away from the visible sun — the image stops reading as a photograph, and
 * the problem is usually invisible to whoever is looking at it.
 */

const sunDirection = new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z).normalize();

/**
 * Fog density, in the exponential-squared sense: fog = 1 - e^(-(d·k)²).
 *
 * Calibrated against the scene's real depth range rather than guessed. The
 * world is now 600m of terrain with mountains at 1900m, so the density is
 * roughly double the old value — keeping the previous constant would have left
 * the entire new, tighter world almost unfogged and the mountains reading as a
 * hard cutout.
 *
 * At k = 0.00085:
 *   200m — 0.03, effectively clear. The factory site 200m away is crisp.
 *   600m — 0.23.  The far treeline has lost a quarter of its contrast.
 *   1200m — 0.73. The near range is mostly atmosphere.
 *   1900m — 0.93. The far range is a value shift against the sky.
 *
 * That progression is the aerial perspective in the reference frames. The
 * terrain and mountain shaders import this same constant, so all layers recede
 * at an identical rate — mismatched densities between layers is what makes a
 * composite scene look like separate scenes stacked together.
 */
export const FOG_DENSITY = 0.00085;

/** Fog colour, shared by the scene's <fogExp2> and the custom shaders. */
export const FOG_COLOR = "#9ea7ad";

/**
 * Keeps the shadow camera tight around the play area and snapped to the sun.
 *
 * This matters more than shadow resolution. A 4096px shadow map spread over
 * 2000m of terrain gives 0.5m per texel, which is far too coarse to resolve a
 * tree trunk. The same map over a 180m box gives 0.04m per texel, which
 * resolves individual branches. Tightness is free quality.
 */
function updateShadowCamera(
  light: DirectionalLight,
  size: number,
  focus: Vector3,
  enabled: boolean
) {
  light.visible = enabled;
  if (!enabled) return;

  light.target.position.copy(focus);
  light.target.updateMatrixWorld();

  // Park the light far enough back that the shadow camera's near plane sits
  // in front of the tallest geometry. The mountain ring is 620m tall and
  // outside the shadow volume, so the chimney at 88m sets the requirement.
  light.position.copy(focus).addScaledVector(sunDirection, SUN_DISTANCE);
  light.updateMatrixWorld();

  const camera = light.shadow.camera;
  if (camera.left !== -size) {
    camera.left = -size;
    camera.right = size;
    camera.top = size;
    camera.bottom = -size;
    camera.near = 1;
    camera.far = SUN_DISTANCE * 2.2;
    camera.updateProjectionMatrix();
  }
}

export function Lighting({ quality }: { quality: QualitySettings }) {
  const sun = useRef<DirectionalLight>(null);
  const focus = useRef(new Vector3(0, 0, 0));
  const { camera } = useThree();

  const shadowsEnabled = quality.shadowMapSize > 0;

  const sunColor = useMemo(
    () => new Color(SUN_COLOR.r, SUN_COLOR.g, SUN_COLOR.b),
    []
  );

  useFrame(() => {
    const light = sun.current;
    if (!light) return;

    // Track a point ahead of the camera rather than the camera itself, so the
    // shadow volume covers where the viewer is about to look. Snapping this
    // to a coarse grid prevents the shadow texels from crawling as the camera
    // moves, which is a very visible artefact on slow hardware where the
    // shadow map resolution is already marginal.
    const target = focus.current;
    const snap = quality.shadowCameraSize * 0.1;
    target.set(
      Math.round(camera.position.x / snap) * snap,
      0,
      Math.round(camera.position.z / snap) * snap
    );

    light.shadow.mapSize.setScalar(quality.shadowMapSize);
    updateShadowCamera(light, quality.shadowCameraSize, target, shadowsEnabled);
  });

  return (
    <>
      {/*
        Sun. A single directional light, warm and low, casting the long
        shadows that the whole golden-hour look depends on.
      */}
      <directionalLight
        ref={sun}
        color={sunColor}
        intensity={SUN_INTENSITY}
        castShadow={shadowsEnabled}
        // The shadow bias values are specific to the shadow camera size
        // configured above. Too low and the terrain self-shadows into acne;
        // too high and shadows detach from the objects casting them.
        shadow-bias={-0.0006}
        shadow-normalBias={0.6}
      />

      {/*
        Sky fill. This is what keeps shadowed sides from going black, and it
        is the second most important decision after the sun colour. A plain
        ambient light flattens everything; a hemisphere light preserves a
        vertical gradient, so undersides and canopies still read as separate
        planes even in shadow.
      */}
      <hemisphereLight
        args={[
          new Color(HEMISPHERE_SKY_COLOR.r, HEMISPHERE_SKY_COLOR.g, HEMISPHERE_SKY_COLOR.b),
          new Color(HEMISPHERE_GROUND_COLOR.r, HEMISPHERE_GROUND_COLOR.g, HEMISPHERE_GROUND_COLOR.b),
          HEMISPHERE_INTENSITY,
        ]}
      />
    </>
  );
}
