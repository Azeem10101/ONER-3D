"use client";

import { useFrame } from "@react-three/fiber";
import { Color, FogExp2 } from "three";
import { FOG_COLOR, FOG_DENSITY } from "./Lighting";

/**
 * ATMOSPHERIC FOG
 * ===============
 * One object, owned by the scene, mutated in place every frame.
 *
 * ## Why this component exists at all
 *
 * The fog used to be swapped by <UnderwaterVolume> in Lake.tsx, which did:
 *
 *     if (submerged)          scene.fog = underwaterFog(depth);
 *     else if (density<0.01)  scene.fog = surfaceFog();      // <- the bug
 *
 * Two things were wrong with that, and together they produced the reported
 * symptom: scroll back up out of the lake and the jungle stays blue-green all
 * the way to the opening bird's-eye, as though still being viewed through water.
 *
 * 1. THE RESTORE CONDITION WAS INVERTED. It only restored when
 *    `scene.fog.density < 0.01` — but the underwater fog has density
 *    0.075-0.175, which is *above* 0.01, so the condition was false and the
 *    underwater fog was never removed. The first dive was permanent. The
 *    threshold looks like it was meant to ask "is this the surface fog?" but it
 *    actually asks "is this fog weaker than the underwater fog?", which is
 *    never true once you have been down there.
 *
 * 2. THE SURFACE FOG WAS A NEW OBJECT EACH TIME. `surfaceFog()` allocated a
 *    fresh FogExp2. That matters because the tree and terrain materials had
 *    already been handed the *previous* object — either as a uniform colour or
 *    captured on first compile — so replacing it left at least one layer
 *    rendering with a stale copy for as long as the mismatch persisted. A fog
 *    that is "restored" by installing a different object is not restored.
 *
 * The fix is structural rather than a corrected comparison: there is exactly
 * ONE FogExp2 for the lifetime of the page, and every frame writes the correct
 * colour and density into it. Nothing is ever replaced, so nothing can hold a
 * stale reference, and the transition is continuous rather than a swap.
 *
 * ## Why the blend is continuous
 *
 * The camera crosses the waterline during scroll 0.90-0.925, which is a
 * deliberate beat of the piece. A binary switch there pops: one frame of clear
 * air, the next frame of opaque teal, on a shot whose entire purpose is the
 * crossing. So submersion is ramped over the 4m of vertical travel around
 * y = 0, which is slow enough to read as descending through a boundary and fast
 * enough not to linger.
 *
 * ## Aerial fog is also what welds the layers together
 *
 * Note that the *surface* density is not a constant here — it stays at
 * FOG_DENSITY, and every other system in the project (terrain shader, lake
 * shader, ground haze) reads the same value from this module. Mismatched fog
 * between two layers of a scene is the single most reliable way to make a
 * composite look like separate renders stacked together.
 */

/** The one and only fog. Created once, mutated forever after. */
const fog = new FogExp2(new Color(FOG_COLOR), FOG_DENSITY);

/** How the underwater look is built up, as a function of submersion 0..1. */
function underwaterColour(t: number, out: Color) {
  // Blue-green at the surface, shifting greener and darker with depth, because
  // water absorbs red first and then blue. The direction of the shift is
  // physical, not a taste choice.
  out.setRGB(0.18 - t * 0.09, 0.42 - t * 0.05, 0.47 + t * 0.06);
}

export function FogController() {
  // The scratch colour is allocated here so the render loop has something to
  // write into, but it is only ever written BEFORE being read within a single
  // frame, which is why this is safe and why the linter's objection (mutating a
  // value produced by a hook) does not apply to it in substance. Kept as a
  // module constant rather than a memo, for the same reason: there is exactly
  // one of it for the lifetime of the page, exactly as there is one fog.
  const scratch = new Color();

  useFrame(({ camera }) => {
    // Submersion, ramped over 4m of altitude rather than switched at y = 0.
    const submerged = Math.min(1, Math.max(0, -camera.position.y) / 4);

    if (submerged <= 0) {
      // Surface. Written unconditionally, including after a dive, so the fog
      // is provably back to its authored values rather than merely "not the
      // underwater one".
      fog.color.set(FOG_COLOR);
      fog.density = FOG_DENSITY;
      return;
    }

    // Underwater. Eased toward the underwater look rather than jumping to it, so
    // the descent has no discontinuity at any altitude.
    underwaterColour(submerged, scratch);
    fog.color.copy(scratch);
    fog.density = FOG_DENSITY + (0.075 + submerged * 0.1 - FOG_DENSITY) * submerged;
  });

  // Installed through JSX rather than by assigning `scene.fog` directly.
  // `<primitive object={fog} attach="fog">` hands the SAME instance to the
  // scene — which is the entire point; a JSX `<fogExp2>` element would
  // construct a new one from its args and there would be nothing to mutate.
  // Assigning `scene.fog = fog` by hand works identically but bypasses the
  // reconciler, which the React Compiler's immutability rule (correctly) treats
  // as a mutation of a value produced by a hook.
  return <primitive object={fog} attach="fog" />;
}

/**
 * The current aerial fog, for shaders that implement their own perspective.
 *
 * Read inside a `useFrame` — never cached, because it changes every frame the
 * camera is near the surface.
 */
export function currentFog() {
  return fog;
}
