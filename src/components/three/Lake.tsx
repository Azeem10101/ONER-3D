"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshReflectorMaterial } from "@react-three/drei";
import { Color, type Mesh } from "three";
import { WORLD } from "@/scene/timeline";

/**
 * PLACEHOLDER LAKE — replace with the Spline-exported GLB surface.
 *
 * The lake is a hero moment: the camera spends the last 10% of the journey
 * diving straight into it, so it is the one surface worth paying for a real
 * reflection. The factory reflecting in the polluted water is the whole
 * point of the closing shot.
 *
 * Perf note: MeshReflectorMaterial renders the scene a second time. At
 * resolution 512 with blur this is acceptable on desktop. If you are targeting
 * mobile, drop to 256 or swap for a plain MeshStandardMaterial with a
 * roughness of ~0.1.
 */
export function Lake() {
  const surface = useRef<Mesh>(null);
  const baseColor = new Color("#0d1f24");

  useFrame(({ clock }) => {
    // A very slight vertical drift. Real ripple is done in the normal map;
    // this just keeps the reflection from looking like a still mirror.
    if (surface.current) {
      surface.current.position.y = Math.sin(clock.elapsedTime * 0.35) * 0.06;
    }
  });

  return (
    <group>
      <mesh
        ref={surface}
        position={[WORLD.lakeCentre[0], 0, WORLD.lakeCentre[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[WORLD.lakeRadius, 96]} />
        <MeshReflectorMaterial
          resolution={512}
          mixBlur={1.1}
          mixStrength={2.4}
          blur={[380, 120]}
          depthScale={1.1}
          minDepthThreshold={0.3}
          maxDepthThreshold={1.3}
          color={baseColor}
          metalness={0.5}
          roughness={0.85}
        />
      </mesh>

      {/* Algal bloom. Rendered as a flat additive disc slightly above the
          water so the eutrophication reads at a glance. The nutrient card
          arrives at progress 0.95, right as we reach this. */}
      <mesh
        position={[WORLD.lakeCentre[0] - 6, 0.12, WORLD.lakeCentre[2] + 4]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[16, 48]} />
        <meshBasicMaterial color="#3f6212" transparent opacity={0.34} depthWrite={false} />
      </mesh>
    </group>
  );
}
