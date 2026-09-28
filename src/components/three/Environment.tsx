"use client";

import { useMemo } from "react";
import { Factory } from "./Factory";
import { Jungle } from "./Jungle";
import { Lake } from "./Lake";
import { Plume } from "./Plume";
import { createRandom } from "@/scene/random";

/** Hazy industrial daylight. Matches the fog colour so nothing pops. */
const SKY = "#8a9ba5";

/**
 * Everything visible in the 3D scene.
 *
 * When the Spline models are ready, each of these four components is replaced
 * by a <SplineModel> that loads the exported .glb from /public/models. The
 * scene graph structure, the fog, and the lights stay exactly as they are, so
 * the camera timeline does not need re-timing.
 */
export function Environment() {
  const ground = useMemo(() => {
    // Two flat tones broken up into patches, so the terrain does not read as
    // one enormous plane when the camera is 130m up.
    const random = createRandom(4242);
    return Array.from({ length: 60 }, () => ({
      x: (random() - 0.5) * 620,
      z: (random() - 0.5) * 620,
      scale: 26 + random() * 60,
      shade: random() > 0.5 ? "#1a2a1b" : "#16251a",
    }));
  }, []);

  return (
    <>
      <color attach="background" args={[SKY]} />
      {/* Linear fog. Linear rather than exponential because the timeline makes
          hard camera moves that exponential fog turns into visible banding. */}
      <fog attach="fog" args={[SKY, 160, 620]} />

      <hemisphereLight args={["#b8c9d6", "#1c2418", 1.15]} />
      <directionalLight
        position={[90, 130, 60]}
        intensity={2.1}
        color="#fff3e0"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={400}
        shadow-camera-left={-120}
        shadow-camera-right={120}
        shadow-camera-top={120}
        shadow-camera-bottom={-120}
      />

      {/* Terrain base. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.3, 0]} receiveShadow>
        <circleGeometry args={[340, 64]} />
        <meshStandardMaterial color="#142013" roughness={1} />
      </mesh>

      {/* Ground patch variation. */}
      {ground.map((patch, i) => (
        <mesh
          key={i}
          rotation={[-Math.PI / 2, 0, patch.x * 0.01]}
          position={[patch.x, -0.25 + (i % 5) * 0.01, patch.z]}
        >
          <circleGeometry args={[patch.scale, 20]} />
          <meshStandardMaterial color={patch.shade} roughness={1} />
        </mesh>
      ))}

      <Jungle />
      <Factory />
      <Lake />
      <Plume />
    </>
  );
}
