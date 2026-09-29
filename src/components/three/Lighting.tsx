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
 * Distance fog density, in the exponential-squared sense: fog = 1 - e^(-(d·k)²).
 *
 * ## ZERO. There is no distance fog, by explicit request.
 *
 * This was 0.00085 against a light grey (#9ea7ad), and it was the single
 * biggest reason the landscape read as white rather than green. From the
 * opening bird's-eye — 859m out and 318m up — the visible ground runs from 600m
 * to 1400m away, which is 23% to 65% fog. The skirt beyond it was 99% fog, so
 * the whole horizon was a flat wash of light grey, and even the forest in the
 * middle distance was a third diluted toward it. Nothing painted underneath
 * could compete with a veil laid over the top.
 *
 * The constant is kept rather than deleted because the underwater pass still
 * needs one: a submerged camera with no murk reads as a blue room rather than
 * as being in water. <FogController> ramps from this to the underwater density
 * purely on camera altitude, so above the surface there is no distance fog at
 * all.
 *
 * ## What this costs
 *
 * The far terrain will not recede, and a plain running to the fog limit will be
 * as legible as the ground underfoot. That is a genuine loss and it is the trade
 * being made. The compensation is shape: the far field stays low and gently
 * undulating rather than flat, so distance reads through form instead of haze.
 */
export const FOG_DENSITY = 0;

/**
 * The colour used as the scene background and as the water's aerial tint.
 *
 * Much darker and cooler than the previous #9ea7ad. With no distance fog this
 * is rarely seen over the terrain, but it still shows at the very edge of frame
 * and behind the water, and the old value was close enough to white to read as
 * a blown highlight.
 */
export const FOG_COLOR = "#6f7d86";

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
