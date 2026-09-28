"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  Points,
  type PointsMaterial,
  SRGBColorSpace,
} from "three";
import { createRandom } from "@/scene/random";
import { WORLD } from "@/scene/timeline";

/**
 * The smoke plume rising from the chimney.
 *
 * This is the thread the camera follows from progress 0.22 to 0.76, so it
 * has to feel like a continuous column even though it is built from discrete
 * particles. Three things sell that:
 *
 *   1. Particles recycle at staggered phases, so the column never pulses.
 *   2. Radius grows with height and the whole thing leans downwind, which
 *      gives the eye the "rising and spreading" cue.
 *   3. Particles fade toward the fog colour as they age, so they dissolve
 *      into the sky instead of popping out of existence.
 *
 * PLACEHOLDER: swap the sprite for a real smoke plume simulation once the
 * Spline scene is in. This is intentionally cheap.
 */

const COUNT = 420;
const PLUME_HEIGHT = 150;
const SPREAD = 34;
const WIND = new Color();

/** Soft radial puff, generated at runtime so we ship no texture asset. */
function createSoftSprite() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,0.95)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.45)");
  gradient.addColorStop(0.7, "rgba(255,255,255,0.12)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

type Particle = {
  /** Staggered start so the column is continuous, not pulsed. */
  offset: number;
  speed: number;
  wobble: number;
  wobbleRate: number;
  drift: number;
  size: number;
};

export function Plume() {
  const points = useRef<Points>(null);
  const material = useRef<PointsMaterial>(null);

  // Created during render rather than in an effect. The <Canvas> subtree is
  // client-only (loaded via next/dynamic with ssr: false), so `document` is
  // always available here, and deriving the texture this way avoids a
  // setState-in-effect that would cost an extra render pass on mount.
  const map = useMemo(() => (typeof document === "undefined" ? null : createSoftSprite()), []);

  const geometry = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const geo = new BufferGeometry();
    const positionAttribute = new BufferAttribute(positions, 3);
    const colorAttribute = new BufferAttribute(colors, 3);
    positionAttribute.setUsage(DynamicDrawUsage);
    colorAttribute.setUsage(DynamicDrawUsage);
    geo.setAttribute("position", positionAttribute);
    geo.setAttribute("color", colorAttribute);
    return geo;
  }, []);

  const particles = useMemo<Particle[]>(() => {
    const random = createRandom(77321);
    return Array.from({ length: COUNT }, () => ({
      offset: random(),
      speed: 0.02 + random() * 0.018,
      wobble: random() * Math.PI * 2,
      wobbleRate: 0.6 + random() * 1.4,
      drift: 0.4 + random() * 1.6,
      size: 6 + random() * 14,
    }));
  }, []);

  /** Fresh particles are dark smoke; dying ones wash out to the sky. */
  const smoke = useMemo(() => new Color("#6b6560"), []);
  const sky = useMemo(() => new Color("#8a9ba5"), []);

  useFrame(({ clock }) => {
    if (!points.current) return;
    const time = clock.elapsedTime;
    const positionAttribute = geometry.getAttribute("position");
    const colorAttribute = geometry.getAttribute("color");
    const positions = positionAttribute.array as Float32Array;
    const colors = colorAttribute.array as Float32Array;
    const [cx, cy, cz] = WORLD.chimneyTop;

    for (let i = 0; i < COUNT; i++) {
      const p = particles[i];
      const life = (time * p.speed + p.offset) % 1;

      // A particle's radius grows with age, so the column opens out as it
      // rises the way a real plume does.
      const radius = life * SPREAD * p.drift;
      const angle = p.wobble + time * p.wobbleRate * 0.35;

      positions[i * 3] = cx + Math.cos(angle) * radius;
      positions[i * 3 + 1] = cy + life * PLUME_HEIGHT;
      positions[i * 3 + 2] = cz + Math.sin(angle) * radius;

      // Fade in fast, out slowly — a puff becomes visible immediately and
      // then thins out over a long tail.
      const fade = life < 0.08 ? life / 0.08 : 1 - (life - 0.08) / 0.92;
      WIND.copy(smoke).lerp(sky, Math.pow(life, 0.65));
      colors[i * 3] = WIND.r * fade + 0.02;
      colors[i * 3 + 1] = WIND.g * fade + 0.02;
      colors[i * 3 + 2] = WIND.b * fade + 0.02;
    }

    positionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
  });

  return (
    <points ref={points} geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        ref={material}
        size={10}
        map={map ?? undefined}
        vertexColors
        transparent
        opacity={0.5}
        depthWrite={false}
        sizeAttenuation
        alphaTest={0.01}
      />
    </points>
  );
}
