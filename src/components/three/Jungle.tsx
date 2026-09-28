"use client";

import { useMemo } from "react";
import { Instance, Instances } from "@react-three/drei";
import { createRandom, range } from "@/scene/random";
import { WORLD } from "@/scene/timeline";

/**
 * PLACEHOLDER JUNGLE — replace with the Spline-exported GLB.
 *
 * Instanced cones in a ring around the facility. The point of this is to give
 * the camera something to parallax against: without a dense mid-ground you
 * cannot tell that the camera is moving, and the whole illusion collapses.
 *
 * The ring is deliberately hollow where the factory and lake sit, so the
 * camera path never clips through a tree.
 */

const TREE_COUNT = 1400;

type Tree = { position: [number, number, number]; scale: [number, number, number]; shade: number };

function isClearOfStructures(x: number, z: number) {
  // Factory footprint, padded.
  if (x > -34 && x < 34 && z > -28 && z < 30) return false;
  // Lake, padded.
  const dx = x - WORLD.lakeCentre[0];
  const dz = z - WORLD.lakeCentre[2];
  if (Math.hypot(dx, dz) < WORLD.lakeRadius + 12) return false;
  return true;
}

export function Jungle() {
  const trees = useMemo<Tree[]>(() => {
    const random = createRandom(20260928);
    const result: Tree[] = [];

    let guard = 0;
    while (result.length < TREE_COUNT && guard < TREE_COUNT * 12) {
      guard++;
      // sqrt keeps the distribution even across the ring's area instead of
      // clumping everything toward the middle.
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * (WORLD.jungleOuter - WORLD.jungleInner) + WORLD.jungleInner;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;

      if (!isClearOfStructures(x, z)) continue;

      const height = range(random, 14, 34);
      result.push({
        position: [x, height / 2, z],
        scale: [range(random, 5, 9), height, range(random, 5, 9)],
        // Vary lightness so the canopy does not read as one flat mass.
        shade: range(random, 0, 1),
      });
    }
    return result;
  }, []);

  return (
    <group>
      {/* Canopies. Two tones keeps the mass from flattening under fog. */}
      <Instances limit={trees.length} range={trees.length} frustumCulled>
        <coneGeometry args={[0.5, 1, 6]} />
        <meshStandardMaterial roughness={0.95} metalness={0} flatShading />
        {trees.map((tree, i) => (
          <Instance
            key={i}
            position={tree.position}
            scale={tree.scale}
            color={tree.shade > 0.5 ? "#1f3d24" : "#274a2b"}
          />
        ))}
      </Instances>
    </group>
  );
}
