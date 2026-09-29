"use client";

import { Jungle } from "./Jungle";
import { Factory } from "./Factory";
import { Lake, Outfall, OUTFALL_POSITION, UnderwaterVolume, Discharge } from "./Lake";
import { Plume } from "./Plume";
import { Terrain } from "./Terrain";
import { GroundHaze } from "./Atmosphere";
import { Birds, Fish } from "./Life";
import { WORLD, terrainHeight } from "@/scene/world";
import type { QualitySettings } from "@/scene/quality";

/**
 * SCENE COMPOSITION
 * =================
 * Everything visible in the 3D layer, in draw order.
 *
 * The mountains are deliberately absent. With the world shrunk to a 600m
 * terrain radius they were subtending 22 degrees at the opening shot — a
 * quarter of the frame, right where the factory and lake need to be — and they
 * were reading as a wall the camera was standing next to rather than as a
 * horizon. Removing them puts the whole budget on the site itself, which is
 * what the piece is about.
 *
 * ## Why the factory is offset onto the pad
 *
 * `Factory` is authored in local coordinates sitting on y = 0, but the
 * terrain function levels the industrial site to WORLD.factoryPadHeight and
 * cuts the lake basin below zero. Without the offset the buildings sink into
 * the pad and the chimney floats above it. The offset is applied once, here,
 * rather than by rewriting every coordinate inside the component.
 */
export function Environment({ quality }: { quality: QualitySettings }) {
  // Distance from the factory edge to the outfall, for the connecting channel.
  const channelLength = Math.hypot(
    OUTFALL_POSITION[0] - WORLD.factoryPadHalf.x * 0.4,
    OUTFALL_POSITION[2] - WORLD.factoryPadHalf.z * 0.4
  );
  const channelAngle = Math.atan2(
    OUTFALL_POSITION[2] - WORLD.factoryPadHalf.z * 0.4,
    OUTFALL_POSITION[0] - WORLD.factoryPadHalf.x * 0.4
  );

  return (
    <>
      {/* Opaque geometry first. Terrain writes depth, so it resolves before
          anything transparent regardless of order. */}
      <Terrain quality={quality} />

      <group position={[0, WORLD.factoryPadHeight, 0]}>
        <Factory />
      </group>

      {/* Drainage channel from the plant to the lake. Without it the
          contamination appears in the water with no visible source, which
          breaks the causal chain the whole second half of the story depends
          on.

          A single long box would float over the rolling ground between the
          pad and the shore, so this is a run of short segments, each seated on
          the terrain beneath it. That is what makes it read as a cut channel
          following the contour rather than a ramp hanging in mid-air. */}
      {Array.from({ length: 16 }, (_, i) => {
        const t = (i + 0.5) / 16;
        const x =
          WORLD.factoryPadHalf.x * 0.4 + t * (OUTFALL_POSITION[0] - WORLD.factoryPadHalf.x * 0.4);
        const z =
          WORLD.factoryPadHalf.z * 0.4 + t * (OUTFALL_POSITION[2] - WORLD.factoryPadHalf.z * 0.4);
        const ground = terrainHeight(x, z);
        const segment = channelLength / 16 + 1.2;

        return (
          <group key={i} position={[x, 0, z]} rotation={[0, -channelAngle, 0]}>
            <mesh position={[0, ground - 0.6, 0]} receiveShadow>
              <boxGeometry args={[segment, 1.4, 4.4]} />
              <meshStandardMaterial color="#3b3830" roughness={0.96} />
            </mesh>
            {/* Side walls, so it reads as a channel rather than a slab. */}
            {[-1, 1].map((side) => (
              <mesh key={side} position={[0, ground + 0.4, side * 2.4]} castShadow receiveShadow>
                <boxGeometry args={[segment, 2.1, 0.6]} />
                <meshStandardMaterial color="#4a453d" roughness={0.92} />
              </mesh>
            ))}
          </group>
        );
      })}

      <Outfall />
      <Discharge />

      <Jungle quality={quality} />
      <Lake quality={quality} />
      <Plume quality={quality} />

      {/* Birds circle over the forest throughout — they are the only thing in
          the scene that keeps moving when the scroll stops. */}
      <Birds />

      {/* The final act: inside the lake, with the school and the pollution
          plume. Depth-tested against the water surface so they are occluded
          correctly from above and visible from below. */}
      <Fish />
      <UnderwaterVolume quality={quality} />

      {/* Transparent, camera-following, drawn last. */}
      <GroundHaze quality={quality} />
    </>
  );
}
