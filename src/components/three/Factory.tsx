"use client";

import { WORLD } from "@/scene/timeline";

/**
 * PLACEHOLDER FACTORY — replace with the Spline-exported GLB.
 *
 * Built from primitives to establish the silhouette and, more importantly, to
 * get the *scale* right. The camera timings in timeline.ts are all in metres,
 * so a chimney that is 30m here means 30m there. Get the proportions right in
 * the placeholder and the Spline model drops in without re-timing anything.
 *
 * The read we want: heavy industry from the industrial era. Brick and steel,
 * low halls, a dominating stack, a cooling tower, and storage tanks.
 */
export function Factory() {
  const chimneyHeight = WORLD.chimneyTop[1] - WORLD.chimneyBase[1];
  const chimneyMidY = (WORLD.chimneyTop[1] + WORLD.chimneyBase[1]) / 2;

  return (
    <group>
      {/* Ground slab, so the plant does not float above the terrain. */}
      <mesh position={[0, 0.2, 0]} receiveShadow>
        <boxGeometry args={[72, 0.4, 62]} />
        <meshStandardMaterial color="#2a2724" roughness={1} />
      </mesh>

      {/* Main hall. */}
      <mesh position={[0, 7, 0]} castShadow receiveShadow>
        <boxGeometry args={[44, 14, 34]} />
        <meshStandardMaterial color="#4a3f38" roughness={0.9} />
      </mesh>

      {/* Sawtooth roof — the ridged silhouette of an old mill roof. */}
      {[-1, 0, 1].map((i) => (
        <mesh key={i} position={[i * 11, 16, 0]} castShadow>
          <boxGeometry args={[2.2, 4, 34]} />
          <meshStandardMaterial color="#3b332d" roughness={0.9} />
        </mesh>
      ))}

      {/* Lower processing wing. */}
      <mesh position={[-28, 4, 14]} castShadow receiveShadow>
        <boxGeometry args={[20, 8, 16]} />
        <meshStandardMaterial color="#423831" roughness={0.9} />
      </mesh>

      {/* THE chimney. The camera arrives here at scroll progress 0.22. */}
      <mesh position={[WORLD.chimneyBase[0], chimneyMidY, WORLD.chimneyBase[2]]} castShadow>
        <cylinderGeometry args={[2.4, 3.6, chimneyHeight, 20]} />
        <meshStandardMaterial color="#5b3a30" roughness={0.95} />
      </mesh>

      {/* Faint heat glow at the stack mouth. */}
      <mesh position={WORLD.chimneyTop}>
        <cylinderGeometry args={[2.35, 2.35, 1.2, 20]} />
        <meshBasicMaterial color="#c2410c" />
      </mesh>

      {/* Secondary stack, for a less symmetrical skyline. */}
      <mesh position={[-16, 24, -10]} castShadow>
        <cylinderGeometry args={[1.5, 2.1, 30, 16]} />
        <meshStandardMaterial color="#4f342c" roughness={0.95} />
      </mesh>

      {/* Cooling tower. */}
      <mesh position={[28, 13, -22]} castShadow>
        <cylinderGeometry args={[7, 10, 26, 24]} />
        <meshStandardMaterial color="#6b6560" roughness={0.9} />
      </mesh>

      {/* Storage tanks. */}
      {[
        [-32, 3, -14],
        [-40, 3.5, -4],
        [22, 3, 22],
      ].map((position, i) => (
        <mesh key={i} position={position as [number, number, number]} castShadow>
          <cylinderGeometry args={[5, 5, 6 + i, 20]} />
          <meshStandardMaterial color="#565049" roughness={0.7} metalness={0.3} />
        </mesh>
      ))}

      {/* Outfall pipe running toward the lake — the water narrative needs a
          visible source, otherwise the lake looks like it pollutes itself. */}
      <mesh position={[-16, 0.6, 16]} rotation={[0, Math.PI / 7, 0]}>
        <boxGeometry args={[26, 1.2, 2]} />
        <meshStandardMaterial color="#3c3630" roughness={0.9} />
      </mesh>
      <mesh position={[-27, 0.6, 21]}>
        <cylinderGeometry args={[1.4, 1.4, 1.2, 16]} />
        <meshStandardMaterial color="#2f2a26" roughness={0.9} />
      </mesh>
    </group>
  );
}
