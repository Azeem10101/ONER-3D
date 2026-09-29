"use client";

import { WORLD } from "@/scene/world";

/**
 * THE PLANT
 * =========
 * Heavy industry from the industrial era: brick and steel, low halls, a
 * dominating stack, a cooling tower, storage tanks.
 *
 * ## Scale
 *
 * Everything here is authored in LOCAL coordinates sitting on y = 0, and the
 * whole group is scaled by `WORLD.factoryScale` and lifted onto the pad by
 * `WORLD.factoryPadHeight` when <Environment> composes it. Two consequences
 * worth knowing:
 *
 *   1. The chimney cannot be authored here. WORLD.chimneyBase/chimneyTop are
 *      the single source of truth for where the stack mouth is, because the
 *      plume, the camera path and the layout checks all need that number. So
 *      the stack geometry is derived from it rather than typed in, and it is
 *      divided back out of the scale to stay in local space.
 *
 *   2. This is still primitives. Boxes and cylinders, which is the honest
 *      state of the asset work — the photoreal GLB pipeline was reverted. The
 *      silhouette, the proportions and the material separation are what carry
 *      the read at this distance; a 64m hall seen from 900m is legible as mass
 *      and shape, not as detail. What it cannot yet do is close-ups, and the
 *      camera never goes there.
 *
 * ## Why it got bigger
 *
 * At 72×62m on a 600m-radius world the plant read as a shed on a plain — the
 * lake and the forest were more visually substantial than the thing the whole
 * piece is about. 1.45x makes the main hall 64m long, the stack 44m above the
 * roof, and the footprint about 104×90m, which is the scale at which an
 * industrial site actually looks like one.
 */
export function Factory() {
  // Derived from WORLD rather than declared here, so the stack cannot drift
  // away from the plume that comes out of it. Divided by the group scale to get
  // back into the local space these primitives are authored in.
  const scale = WORLD.factoryScale;
  const chimneyHeight = (WORLD.chimneyTop[1] - WORLD.chimneyBase[1]) / scale;
  const chimneyBaseY = WORLD.chimneyBase[1] / scale;
  const chimneyX = WORLD.chimneyBase[0] / scale;
  const chimneyZ = WORLD.chimneyBase[2] / scale;
  const chimneyTopY = WORLD.chimneyTop[1] / scale;

  return (
    <group scale={scale}>
      {/* Ground slab, so the plant does not float above the terrain. */}
      <mesh position={[0, 0.2, 0]} receiveShadow>
        <boxGeometry args={[72, 0.4, 62]} />
        <meshStandardMaterial color="#2a2724" roughness={1} />
      </mesh>

      {/* Main hall. The dominant mass, and deliberately the widest thing on
          the site so the silhouette reads as a big rectangular shed. */}
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

      {/* Second long shed, set back on the far side. Added with the scale-up:
          the previous site had one hall and a wing, which from above read as a
          single rectangle rather than as a complex with parts. */}
      <mesh position={[6, 5, -30]} castShadow receiveShadow>
        <boxGeometry args={[38, 10, 18]} />
        <meshStandardMaterial color="#453b34" roughness={0.9} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={`shed-vault-${i}`} position={[-6 + i * 12, 11.5, -30]} castShadow>
          <cylinderGeometry args={[4.2, 4.2, 17, 14, 1, false, 0, Math.PI]} />
          <meshStandardMaterial color="#3f362f" roughness={0.85} />
        </mesh>
      ))}

      {/* THE STACK. The camera arrives here at scroll progress 0.22, and every
          rise-* shot climbs the plume that leaves it. Position is derived from
          WORLD so all three stay attached. */}
      <mesh position={[chimneyX, chimneyBaseY + chimneyHeight / 2, chimneyZ]} castShadow>
        <cylinderGeometry args={[2.4, 3.6, chimneyHeight, 20]} />
        <meshStandardMaterial color="#5b3a30" roughness={0.95} />
      </mesh>

      {/* Banded collar partway up. A real stack is not a smooth taper — the
          courses and the banding are most of what makes it read as brick
          masonry rather than as a cone. */}
      <mesh position={[chimneyX, chimneyBaseY + chimneyHeight * 0.45, chimneyZ]} castShadow>
        <cylinderGeometry args={[2.85, 3.05, 2.2, 20]} />
        <meshStandardMaterial color="#6b4a3c" roughness={0.95} />
      </mesh>

      {/* Faint heat glow at the stack mouth. */}
      <mesh position={[chimneyX, chimneyTopY, chimneyZ]}>
        <cylinderGeometry args={[2.35, 2.35, 1.2, 20]} />
        <meshBasicMaterial color="#c2410c" />
      </mesh>

      {/* Secondary stack, for a less symmetrical skyline. */}
      <mesh position={[-16, 24, -10]} castShadow>
        <cylinderGeometry args={[1.5, 2.1, 30, 16]} />
        <meshStandardMaterial color="#4f342c" roughness={0.95} />
      </mesh>

      {/* Cooling tower. The hyperbolic waist is the silhouette that says
          "power station" more than any other single shape, so it is modelled
          with a profile rather than as a plain cylinder. */}
      <mesh position={[28, 13, -22]} castShadow>
        <cylinderGeometry args={[6.2, 9.4, 26, 24, 1, true]} />
        <meshStandardMaterial color="#6b6560" roughness={0.9} side={2} />
      </mesh>

      {/* Storage tanks. */}
      {[
        [-32, 3, -14],
        [-40, 3.5, -4],
        [22, 3, 22],
        [-24, 3, 26],
      ].map((position, i) => (
        <mesh key={i} position={position as [number, number, number]} castShadow>
          <cylinderGeometry args={[5, 5, 6 + i, 20]} />
          <meshStandardMaterial color="#565049" roughness={0.7} metalness={0.3} />
        </mesh>
      ))}

      {/* Pipe gantry. Horizontal runs of pipework are what actually make an
          industrial site read as connected machinery rather than as separate
          sheds, and they break up the vertical mass of the hall roofs. */}
      {[
        { position: [24, 7, 18] as [number, number, number], length: 30, rot: 0 },
        { position: [-10, 9, 20] as [number, number, number], length: 24, rot: Math.PI / 2 },
        { position: [18, 12, -12] as [number, number, number], length: 20, rot: 0 },
      ].map((run, i) => (
        <mesh key={`pipe-${i}`} position={run.position} rotation={[0, run.rot, 0]}>
          <boxGeometry args={[run.length, 1.1, 1.1]} />
          <meshStandardMaterial color="#4d453d" roughness={0.8} metalness={0.25} />
        </mesh>
      ))}
      {/* Pipe supports. */}
      {[
        [10, 3, 18],
        [24, 3, 18],
        [38, 3, 18],
        [-10, 4, 10],
        [-10, 4, 24],
      ].map((position, i) => (
        <mesh key={`support-${i}`} position={position as [number, number, number]} castShadow>
          <boxGeometry args={[0.9, 6, 0.9]} />
          <meshStandardMaterial color="#453e37" roughness={0.9} />
        </mesh>
      ))}

      {/* Outfall pipe running toward the lake — the water narrative needs a
          visible source, otherwise the lake looks like it pollutes itself.
          Lengthened and its angle set to point at the lake, so the run reads as
          deliberate rather than as a box lying on the ground. */}
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
