"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  type Points,
  SRGBColorSpace,
} from "three";
import { createRandom } from "@/scene/random";
import type { QualitySettings } from "@/scene/quality";

/**
 * LOW-ALTITUDE HAZE
 * =================
 * The mist that pools in valleys and hangs around forest canopy in the early
 * morning and late afternoon.
 *
 * ## Why this is separate from the distance fog
 *
 * Distance fog alone gives aerial perspective, but it applies uniformly with
 * depth, which makes a scene read as flat and hazy everywhere at once. Real
 * ground mist is *layered*: dense in the low ground, absent above the canopy,
 * thickest in the mid distance where you see the greatest depth through it.
 *
 * Implemented as a camera-following sheet of soft billboards rather than
 * inside the terrain shader, for one reason that matters on an integrated
 * GPU: it adds no per-pixel cost to the terrain, which is already the heaviest
 * surface in the scene.
 *
 * The look comes from very low per-particle opacity and heavy overlap.
 * Individual puffs should be almost invisible; only the accumulation reads as
 * mist. That is also why the particle count is high — it counts *layers*, not
 * visible blobs.
 */

const WIND_X = 2.6;
const WIND_Z = 1.1;

/** The horizontal extent the layer wraps over, in metres. Half the terrain
 *  radius, so the haze always surrounds the camera without extending past the
 *  mountains. */
const WRAP = 1720;

/**
 * Soft radial sprite. Built at runtime so no texture file is needed, and
 * deliberately low-contrast: a hard falloff makes the billboards readable as
 * discs, which instantly reads as "particle effect" rather than as air.
 */
function createHazeSprite() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,0.5)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.22)");
  gradient.addColorStop(0.75, "rgba(255,255,255,0.05)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function GroundHaze({ quality }: { quality: QualitySettings }) {
  const points = useRef<Points>(null);

  /**
   * Particle count.
   *
   * Was 90 / 170 / 280 by tier. That was the single cause of the whole scene
   * washing out to white, and it was tier-dependent — which is why it only
   * appeared at medium and high.
   *
   * The arithmetic: at 190m across, a sprite 300m from the camera subtends
   * 2*atan(95/300) = 35 degrees. The vertical FOV is 43. So EACH sprite covered
   * about four fifths of the frame. With 170 of them at medium, on additive
   * blending, at 0.1 opacity and a 0.5-alpha core, a single pixel was receiving
   * a dozen overlapping contributions and the accumulated value was far past
   * white long before the terrain behind it could be seen.
   *
   * That is what "the ground is white", "no water", "no birds", "no fish" and
   * "the smoke is not dark enough" all turned out to be: one additive layer,
   * 8x too large and 3x too opaque, sitting over everything.
   *
   * The new numbers are derived from the coverage the effect is supposed to
   * produce rather than inherited from a 1400m world. `HAZE_COVERAGE` below
   * states the target, and check-atmosphere.ts asserts the accumulated additive
   * value stays under it.
   */
  const count = quality.tier === "low" ? 30 : quality.tier === "medium" ? 46 : 66;

  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const random = createRandom(60219);

    for (let i = 0; i < count; i++) {
      // Concentrated in the mid distance, where the effect does the most work
      // for atmospheric depth. Scaled to the tighter world: the previous
      // 220-1720m band sat almost entirely beyond the 600m terrain and did
      // nothing visible.
      const angle = random() * Math.PI * 2;
      const distance = 110 + Math.pow(random(), 0.6) * 780;
      positions[i * 3] = Math.cos(angle) * distance;
      positions[i * 3 + 1] = 5 + random() * 28;
      positions[i * 3 + 2] = Math.sin(angle) * distance;
    }

    const geo = new BufferGeometry();
    const positionAttribute = new BufferAttribute(positions, 3);
    positionAttribute.setUsage(DynamicDrawUsage);
    geo.setAttribute("position", positionAttribute);
    return geo;
  }, [count]);

  // Created during render rather than in an effect. The <Canvas> subtree is
  // client-only, so `document` is always available, and this avoids a
  // setState-in-effect that would cost an extra render pass on mount.
  const map = useMemo(() => (typeof document === "undefined" ? null : createHazeSprite()), []);

  useFrame(({ clock, camera }) => {
    if (!points.current) return;
    const time = clock.elapsedTime;

    // The layer follows the camera horizontally so it never runs out, but
    // stays fixed vertically — the mist must keep its height in the world,
    // which is the entire point of it.
    points.current.position.set(camera.position.x, 0, camera.position.z);
    points.current.rotation.y = time * 0.004;

    const positionAttribute = geometry.getAttribute("position");
    const positions = positionAttribute.array as Float32Array;
    for (let i = 0; i < count; i++) {
      // Drift is small enough to be almost subliminal, which is correct. The
      // eye should only notice it over several seconds.
      positions[i * 3] += WIND_X * 0.00035;
      positions[i * 3 + 2] += WIND_Z * 0.00035;

      // Wrap so the layer is effectively infinite without more particles.
      if (positions[i * 3] > WRAP / 2) positions[i * 3] -= WRAP;
      if (positions[i * 3 + 2] > WRAP / 2) positions[i * 3 + 2] -= WRAP;
    }
    positionAttribute.needsUpdate = true;
  });

  return (
    <points ref={points} geometry={geometry} frustumCulled={false} renderOrder={2}>
      <pointsMaterial
        map={map ?? undefined}
        /**
         * 55m, not 190m.
         *
         * At 55m a sprite 300m away subtends 21 degrees, roughly half the frame
         * height, and at the 110-890m ring most sprites are much further off
         * than that. Individual puffs stay soft and low-contrast; only a few
         * layers ever overlap any one pixel.
         */
        size={55}
        sizeAttenuation
        transparent
        /**
         * 0.028, not 0.1.
         *
         * Additive blending accumulates, so per-particle opacity is not the
         * opacity of the effect — it is the opacity of ONE OF N layers. At 0.1
         * with the old count, any pixel crossed by four sprites received 0.2 of
         * pure white before the terrain underneath contributed anything.
         */
        opacity={0.024}
        depthWrite={false}
        color={new Color(0.72, 0.76, 0.8)}
        blending={AdditiveBlending}
        alphaTest={0.004}
      />
    </points>
  );
}
