"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  PerspectiveCamera,
  Vector3,
  type Mesh,
  type ShaderMaterial,
} from "three";
import { Uniforms } from "@/lib/uniforms";
import { createRandom, range } from "@/scene/random";
import { WORLD, terrainHeight } from "@/scene/world";
import { scrollStore } from "@/lib/scrollStore";
import { sampleCamera } from "@/scene/timeline";
import { FOG_COLOR } from "./Lighting";

/**
 * LIVING THINGS
 * =============
 * Birds, fish, and the pollution plume that kills the fish.
 *
 * The final act of the journey is the only part of the experience that tells
 * its story through *behaviour over time* rather than through camera
 * position: the lake starts clean, effluent is poured in, it spreads, the fish
 * flee toward clean water, and then they die. That needs a small simulation,
 * and it needs to be legible.
 *
 * ## Everything is a pure function of scroll progress
 *
 * The contamination, the fish positions, and the deaths are all driven by
 * `progress` (0..1) rather than by elapsed time. That is a deliberate
 * constraint: a user who scrolls back up must see the lake heal and the fish
 * come back to life. Time-driven state would leave dead fish floating on
 * clear water. Idle motion (fin wag, drift, wing flap) IS time-driven,
 * because that should keep moving even when the scroll is still.
 */

// ---------------------------------------------------------------------------
// BIRDS
// ---------------------------------------------------------------------------

/**
 * A flock of birds circling over the forest.
 *
 * Modelled as instanced two-triangle wings rather than geometry, animated on
 * the GPU. Birds are almost always a few hundred pixels of dark shape against
 * a bright sky, so a wing silhouette and a plausible circling path carry
 * essentially all of the read.
 *
 * Circling rather than linear flight because a linear flock reads as a
 * repeating line, whereas real birds circle thermals and a scattered
 * set of independent orbits reads as alive.
 */
/**
 * Uploads the per-instance fish data onto a geometry.
 *
 * Module-level rather than a closure defined inside the component, so the
 * React Compiler sees the geometry as a function argument being initialised
 * instead of a memoised value being mutated behind the compiler's back.
 */
function writeFishInstances(geo: InstancedBufferGeometry, fish: Fish[], count: number) {
  const offset = geo.getAttribute("aOffset") as InstancedBufferAttribute;
  const params = geo.getAttribute("aParams") as InstancedBufferAttribute;
  fish.forEach((f, i) => {
    offset.setXYZ(i, f.home.x, f.home.y, f.home.z);
    // x: swim speed, y: tail-wag phase
    params.setXY(i, f.speed, f.phase);
  });
  offset.needsUpdate = true;
  params.needsUpdate = true;
  geo.instanceCount = count;
}

/**
 * The three flocks, as [centreX, centreZ, orbitRate, baseAltitude] in world XZ.
 *
 * ## Why these positions
 *
 * Placed along the camera's actual path rather than scattered over the map. The
 * camera runs from the opening bird's-eye at 900m out, in over the plant, up
 * the plume from y=50 to y=234, then back out over the lake. A flock that is
 * somewhere in that volume is seen at 100-400m, where a bird is a legible
 * shape; one out beyond it is seen at 900m, where it is a third of a pixel.
 *
 * The altitudes straddle the camera's own band through the middle of the
 * journey (50-234m), so the birds cross in front of the treeline and the plume
 * rather than sitting in a layer the camera never visits.
 *
 * ## Why a flock shares a rate
 *
 * Birds in a flock circle in the same direction at similar speeds. Without this
 * each bird orbits independently and the group reads as unrelated individuals
 * who happen to be co-located. Rates differ per flock so that when two are in
 * frame together they are visibly not in formation.
 */
const FLOCKS: readonly (readonly [number, number, number, number])[] = [
  // Over the jungle between the plant and the lake, which is the ground the
  // camera crosses while climbing the plume.
  [-60, 130, 0.085, 150],
  // Out over the lake, so they are in frame during the pullout and the descent.
  [-230, 200, 0.107, 195],
  // Behind and above the plant, visible in the opening bird's-eye once the
  // depth fade has thinned them to silhouettes.
  [110, -80, 0.129, 170],
];

export function Birds({ count = 24 }: { count?: number }) {
  const geometry = useMemo(() => {
    const random = createRandom(9182);
    const positions = new Float32Array(count * 3);
    const orbits = new Float32Array(count * 4);
    const rates = new Float32Array(count);
    const phases = new Float32Array(count);
    const scales = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      // Tight orbits, 40-110m, so a flock stays coherent.
      const [centreX, centreZ, rate, base] = FLOCKS[i % FLOCKS.length];
      const radius = range(random, 40, 110);
      // Spread through a vertical band around the flock's base altitude, so the
      // group has depth rather than reading as a flat ring.
      const altitude = base + range(random, -45, 45);

      positions[i * 3] = centreX + Math.cos(random() * Math.PI * 2) * radius;
      positions[i * 3 + 1] = altitude;
      positions[i * 3 + 2] = centreZ + Math.sin(random() * Math.PI * 2) * radius;

      // aOrbit: x/z = orbit centre, y = altitude, w = orbit radius
      orbits[i * 4] = centreX;
      orbits[i * 4 + 1] = altitude;
      orbits[i * 4 + 2] = centreZ;
      orbits[i * 4 + 3] = radius;
      // Per-flock rate, nudged a little per bird so the formation breathes
      // rather than being perfectly rigid.
      rates[i] = rate * range(random, 0.92, 1.08);
      phases[i] = random() * Math.PI * 2;
      // Raptors: 1.3m to 3.0m across. A uniform small bird would be a couple of
      // pixels at the distances the camera actually sees them from.
      scales[i] = range(random, 1.3, 3.0);
    }

    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geo.setAttribute("aOrbit", new Float32BufferAttribute(orbits, 4));
    geo.setAttribute("aFlight", new Float32BufferAttribute(rates, 1));
    geo.setAttribute("aPhase", new Float32BufferAttribute(phases, 1));
    geo.setAttribute("aSpan", new Float32BufferAttribute(scales, 1));
    return geo;
  }, [count]);

  const uniforms = useMemo(
    () =>
      new Uniforms({
        uTime: { value: 0 },
        uColor: { value: new Color("#2b2f33") },
        // The haze the birds fade toward. Matches the scene fog so a distant
        // bird dissolves into the same air as everything else.
        uHaze: { value: new Color(FOG_COLOR) },
        uSize: { value: 34 },
      }),
    []
  );

  useFrame(({ clock, gl, camera }) => {
    uniforms.set("uTime", clock.elapsedTime);
    // PIXELS PER METRE AT ONE METRE. This is a physical quantity, not a taste
    // setting: the sprite IS the bird's silhouette, so its width in pixels has
    // to be the bird's wingspan projected onto the screen.
    //
    // It was previously `height * 0.055`, which at 1080p is 59 — and 59 divided
    // by a typical viewing distance of 300m is 0.2 pixels. The birds were
    // sub-pixel and could not have been visible at any distance. The factor here
    // corresponds to a bird about 2.05m across, and aSpan scales it per bird.
    //
    // Read off the live camera rather than assuming a field of view, because the
    // camera's FOV is animated across the journey and a fixed constant would be
    // wrong for most of it. The perspective branch is the one that applies here;
    // the orthographic one exists only to satisfy the union type and would be
    // meaningless in this project.
    const perspective = camera as PerspectiveCamera;
    if (perspective.isPerspectiveCamera) {
      uniforms.set(
        "uSize",
        gl.domElement.height / (2 * Math.tan((perspective.fov * Math.PI) / 360))
      );
    }
  });

  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={5}>
      <shaderMaterial
        transparent
        depthWrite={false}
        uniforms={uniforms.values}
        vertexShader={/* glsl */ `
          uniform float uTime;
          uniform float uSize;
          // x/z = orbit centre, y = altitude, w = orbit radius
          attribute vec4 aOrbit;
          // Per-flock orbit rate, per-bird phase, and wingspan in metres.
          attribute float aFlight;
          attribute float aPhase;
          attribute float aSpan;

          varying float vWing;
          varying float vDepth;

          void main() {
            float angle = aPhase + uTime * aFlight;

            vec3 p = vec3(
              aOrbit.x + cos(angle) * aOrbit.w,
              // Vertical bob, so birds rise and fall through the turn rather
              // than holding a perfectly flat orbit.
              aOrbit.y + sin(uTime * 0.5 + aPhase * 3.0) * 9.0,
              aOrbit.z + sin(angle) * aOrbit.w
            );

            // Wing flap. Fast and small — at this apparent size a full flap
            // cycle reads as a flicker, so it is deliberately restrained.
            vWing = sin(uTime * 9.0 + aPhase * 11.0) * 0.5 + 0.5;

            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;

            // The sprite is the bird, so its width in pixels is the wingspan
            // divided by distance. uSize is pixels-per-metre at one metre, so
            // uSize * span / distance falls out directly.
            float dist = max(-mv.z, 1.0);
            gl_PointSize = max(1.5, uSize * aSpan / dist) * (0.85 + vWing * 0.3);

            // Distant birds fade toward the haze rather than staying hard black
            // specks. Past about 700m a bird is two or three pixels across, and
            // drawing it as a solid dark dot reads as sensor noise on the lens
            // rather than as an animal.
            vDepth = 1.0 - smoothstep(320.0, 780.0, dist);
          }
        `}
        fragmentShader={/* glsl */ `
          uniform vec3 uColor;
          uniform vec3 uHaze;
          varying float vWing;
          varying float vDepth;

          void main() {
            vec2 uv = gl_PointCoord - 0.5;

            // Two swept wings meeting at a body. Cheaper than a mesh and, at
            // a few dozen pixels, indistinguishable.
            float body = 1.0 - smoothstep(0.0, 0.09, abs(uv.x));
            // Wings sweep back and up, and the dihedral changes with the flap
            // so the silhouette is never identical frame to frame.
            float wingY = abs(uv.y) - (0.06 + abs(uv.x) * 0.55);
            float wing = 1.0 - smoothstep(0.0, 0.1 + vWing * 0.07, wingY);
            wing *= 1.0 - smoothstep(0.36, 0.5, abs(uv.x));

            float a = clamp(body + wing, 0.0, 1.0);
            if (a < 0.02) discard;
            // Fading out entirely past 1.1km. A bird at that range is two or
            // three pixels across; drawing it as a hard dark dot reads as sensor
            // noise rather than as an animal.
            a *= vDepth;
            // Toward the haze colour as it recedes, so a distant bird is a pale
            // smudge in the air rather than a black speck.
            vec3 color = mix(uHaze, uColor, vDepth);
            gl_FragColor = vec4(color, a * 0.85);
            #include <colorspace_fragment>
          }
        `}
      />
    </points>
  );
}

// ---------------------------------------------------------------------------
// FISH
// ---------------------------------------------------------------------------

/** Lake geometry the fish and pollution share. Mirrors Lake.tsx. */
const LAKE = {
  centre: new Vector3(WORLD.lakeCentre[0], 0, WORLD.lakeCentre[2]),
  radius: WORLD.lakeRadius,
  /** How deep the water is at the centre. Fish stay well inside this. */
  depth: WORLD.lakeBasinDepth,
};

/** The outfall, in world XZ. Matches Lake.tsx. */
const OUTFALL: [number, number] = [
  WORLD.lakeCentre[0] + WORLD.lakeRadius * 0.58,
  WORLD.lakeCentre[2] - WORLD.lakeRadius * 0.34,
];

/**
 * How polluted the lake is at a given scroll progress.
 *
 * The narrative curve, and the single place the story is authored. Four systems
 * read it — the water surface, the discharge plume, the sediment and the fish —
 * so they cannot disagree about what the water looks like.
 *
 * Keyed to the SHOT boundaries, which is why it was re-authored when the
 * timeline was retimed. The old version was pinned to 0.90-0.985, which had
 * been chosen against the previous shot ranges; after the retime, 0.90 fell in
 * the middle of the descent rather than at the start of it, and the pollution
 * would have begun before the camera had finished arriving at the lake.
 *
 * Against the current shots:
 *
 *   0.7154 - 0.76   water-approach, high over the lake. CLEAN. This is the
 *                    "before", and it is the whole reason the sequence works —
 *                    the viewer sees a clear lake first.
 *   0.76  - 0.8371  the discharge starts at the outfall and the plume begins
 *                    to spread. Still seen from above, so the spread is legible
 *                    on the surface rather than only from underwater.
 *   0.8371 - 0.9132 the camera crosses the waterline with the plume advancing.
 *   0.9132 - 0.9878 underwater: the plume reaches the fish, which flee and then
 *                    die.
 *   0.9878 +        the outro, fully polluted and dead.
 *
 * A pure function of progress, so scrolling back up restores the lake and
 * revives the fish. Time-accumulated state cannot do that: it leaves dead fish
 * floating on clear water.
 */
export function pollutionAt(progress: number): number {
  const START = 0.76;
  const FULL = 0.92;
  if (progress <= START) return 0;
  if (progress >= FULL) return 1;
  // Smoothstep rather than linear, so the discharge starts and completes
  // gently. A linear ramp begins at full rate, which shows as the plume
  // appearing rather than as effluent being poured.
  const t = (progress - START) / (FULL - START);
  return t * t * (3 - 2 * t);
}

type Fish = {
  /** Home position in the lake, before any pollution response. */
  home: Vector3;
  /** Direction the fish swims, for the body orientation. */
  heading: number;
  speed: number;
  phase: number;
  size: number;
  /** Per-fish tolerance — some die before others. */
  resilience: number;
};

/** The camera's positions below the waterline, sampled once at module load. */
const UNDERWATER_PATH: readonly Vector3[] = (() => {
  const path: Vector3[] = [];
  for (let i = 0; i <= 300; i++) {
    const state = sampleCamera(i / 300);
    if (state.position[1] < 0) path.push(new Vector3(...state.position));
  }
  return path;
})();

/** Half the fish's body length, after the 1.6x scale in the vertex shader. */
const BODY_HALF = 0.8;

/**
 * How close the camera is allowed to pass to a fish, in metres.
 *
 * 2.5m is the clearance that actually matters: the body is 1.6m long, so
 * anything closer than about 1m puts the camera inside a fish. An earlier value
 * of 4m was safe but pushed the whole school to 30m or further, which left the
 * camera alone in an empty lake — the fish were placed correctly and still
 * absent from the one shot they exist for.
 */
const CAMERA_CLEARANCE = 2.5;

/**
 * Place the school.
 *
 * Rejection sampling with three constraints, and a bounded number of attempts.
 *
 * ## Why constraints rather than a clamp
 *
 * The previous version placed every fish on one uniform sample and clamped
 * afterwards. That produced three separate faults which all look identical on
 * screen — "the fish are not there":
 *
 *   1. 20 of 34 were BURIED. The depth clamp was `max(0.8, -bed - 0.8)`, which
 *      is a FLOOR rather than a headroom requirement: over a bed at -6.6m it
 *      placed a fish at -5.8m, leaving 0.8m of clearance for a body whose
 *      half-length is 0.8m. Exactly touching.
 *   2. 10 of 34 were on DRY LAND. Positions ran to 0.72 of the nominal radius,
 *      but the shoreline carries up to 13m of noise wobble and the bowl narrows
 *      toward the edge, so a point inside the nominal circle can sit on the
 *      bank.
 *   3. The nearest fish to the camera was 1.2m — inside the animal.
 *
 * Testing the bed BEFORE choosing a depth, and retrying, fixes all three at the
 * source. Clamping after the fact cannot: by the time you know a fish is buried
 * there is no free parameter left to move.
 *
 * The attempt cap matters. An unbounded loop would hang the page if the
 * constraints ever became unsatisfiable, and a missing fish is visibly better
 * than a frozen tab.
 *
 * Exported so `scripts/check-life.ts` asserts against THIS function rather than
 * a second reimplementation of it. An earlier version of that check modelled the
 * placement with its own sampler, and the two drifted far enough apart that it
 * reported a 30m clearance while the real code produced a different arrangement
 * entirely — which is the same class of bug as the one it was written to catch.
 */
export function placeFish(count: number): Fish[] {
  const random = createRandom(4471);
  const school: Fish[] = [];

  const tooCloseToCamera = (x: number, y: number, z: number) => {
    const limit = CAMERA_CLEARANCE * CAMERA_CLEARANCE;
    for (const point of UNDERWATER_PATH) {
      const dx = point.x - x;
      const dy = point.y - y;
      const dz = point.z - z;
      if (dx * dx + dy * dy + dz * dz < limit) return true;
    }
    return false;
  };

  for (let i = 0; i < count; i++) {
    let x = 0;
    let y = 0;
    let z = 0;
    let placed = false;

    for (let attempt = 0; attempt < 80 && !placed; attempt++) {
      const angle = random() * Math.PI * 2;
      const distance = Math.pow(random(), 0.7) * LAKE.radius * 0.6;
      const candidateX = LAKE.centre.x + Math.cos(angle) * distance;
      const candidateZ = LAKE.centre.z + Math.sin(angle) * distance;

      // Must be genuinely under water with room to swim. The -1.5m test matches
      // the shoreline the terrain carves, so a fish can never land on the bank.
      const bed = terrainHeight(candidateX, candidateZ);
      if (bed > -1.5) continue;

      // A HEADROOM test, not a floor: the body needs BODY_HALF clear of the bed
      // at its own depth.
      const maxDepth = -bed - BODY_HALF - 0.3;
      if (maxDepth < 1.2) continue;
      const candidateY = -Math.min(range(random, 1.6, 6.0), maxDepth);

      if (tooCloseToCamera(candidateX, candidateY, candidateZ)) continue;

      x = candidateX;
      y = candidateY;
      z = candidateZ;
      placed = true;
    }

    // Fall back to the middle of the bowl if the constraints could not be met,
    // rather than leaving a fish at the world origin.
    if (!placed) {
      x = LAKE.centre.x;
      z = LAKE.centre.z;
      y = -Math.max(2, WORLD.lakeBasinDepth * 0.5);
    }

    school.push({
      home: new Vector3(x, y, z),
      heading: random() * Math.PI * 2,
      speed: range(random, 0.5, 1.1),
      phase: random() * Math.PI * 2,
      size: range(random, 0.75, 1.35),
      resilience: range(random, 0.6, 1.25),
    });
  }
  return school;
}

export function Fish({ count = 64 }: { count?: number }) {
  const mesh = useRef<Mesh>(null);
  const material = useRef<ShaderMaterial>(null);

  // The school, placed once. See placeFish() for the rules and for why they are
  // rules rather than a clamp.
  const fish = useMemo(() => placeFish(count), [count]);

  // --- Fish geometry ------------------------------------------------------
  // A single low-poly fish: an elongated body plus a tail fin. Built once and
  // instanced; the tail wag is done in the vertex shader from a per-instance
  // phase, so there is no CPU work per fish per frame.
  const body = useMemo(() => {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    // Body: a stretched octahedron-ish hull, pointing +X.
    const rings = [
      { x: -0.5, w: 0.02, h: 0.02 },
      { x: -0.25, w: 0.13, h: 0.16 },
      { x: 0.05, w: 0.16, h: 0.2 },
      { x: 0.32, w: 0.1, h: 0.14 },
      { x: 0.5, w: 0.02, h: 0.03 },
    ];
    for (let r = 0; r < rings.length - 1; r++) {
      const a = rings[r];
      const b = rings[r + 1];
      // Four sides, flat-shaded by duplicating vertices.
      for (let s = 0; s < 4; s++) {
        const a0 = (s / 4) * Math.PI * 2;
        const a1 = ((s + 1) / 4) * Math.PI * 2;
        const p = (ring: { x: number; w: number; h: number }, ang: number): [number, number, number] => [
          ring.x,
          Math.sin(ang) * ring.h,
          Math.cos(ang) * ring.w,
        ];
        const v0 = p(a, a0);
        const v1 = p(a, a1);
        const v2 = p(b, a1);
        const v3 = p(b, a0);
        for (const v of [v0, v1, v2, v0, v2, v3]) {
          positions.push(v[0], v[1], v[2]);
          normals.push(0, v[1], v[2]);
          uvs.push(v[0] + 0.5, (v[1] + 0.5) * 0.5);
        }
      }
    }

    const geo = new InstancedBufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal", new Float32BufferAttribute(normals, 3));
    geo.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    return geo;
  }, []);

  // Tail fin, as a separate instanced geometry so the wag can rotate it.
  const tail = useMemo(() => {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    // A forked caudal fin in the YZ plane at the rear of the body.
    const v: [number, number, number][] = [
      [0, 0, 0],
      [-0.34, 0.2, 0],
      [-0.26, 0, 0],
      [0, 0, 0],
      [-0.26, 0, 0],
      [-0.34, -0.2, 0],
    ];
    for (const vert of v) {
      positions.push(vert[0], vert[1], vert[2]);
      normals.push(1, 0, 0);
      uvs.push(0.5, vert[1] + 0.5);
    }
    const geo = new InstancedBufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal", new Float32BufferAttribute(normals, 3));
    geo.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    return geo;
  }, []);

  // Per-instance attributes, uploaded once.
  // Both geometries share the same per-instance attribute layout, so the
  // attributes are built here and written once on mount. The write happens in
  // a layout effect because the attribute objects are created inside useMemo
  // and the React Compiler treats mutating a memo result as a violation —
  // the effect is the correct place for imperative setup either way.
  const bodyGeo = useMemo(() => {
    const geo = body;
    geo.setAttribute("aOffset", new InstancedBufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute("aParams", new InstancedBufferAttribute(new Float32Array(count * 2), 2));
    return geo;
  }, [body, count]);

  const tailGeo = useMemo(() => {
    const geo = tail;
    geo.setAttribute("aOffset", new InstancedBufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute("aParams", new InstancedBufferAttribute(new Float32Array(count * 2), 2));
    return geo;
  }, [tail, count]);

  // Written through a helper that takes the geometry as a parameter, rather
  // than closing over the memo results. The React Compiler cannot follow a
  // closure that mutates a `useMemo` value, so passing the object in makes
  // the mutation explicit at the call site.
  useLayoutEffect(() => {
    writeFishInstances(bodyGeo, fish, count);
    writeFishInstances(tailGeo, fish, count);
  }, [bodyGeo, tailGeo, fish, count]);

  const uniforms = useMemo(
    () =>
      new Uniforms({
        uTime: { value: 0 },
        uPollution: { value: 0 },
        uBodyColor: { value: new Color("#2f8f9e") },
        uBellyColor: { value: new Color("#d8e6df") },
        uDeadColor: { value: new Color("#6a6255") },
        uOutfall: { value: new Vector3(OUTFALL[0], 0, OUTFALL[1]) },
        uLakeCentre: { value: LAKE.centre.clone() },
        uRadius: { value: LAKE.radius },
      }),
    []
  );

  useFrame(({ clock }) => {
    uniforms.set("uTime", clock.elapsedTime);
    // Pollution comes from scroll progress, not time, so scrolling back up
    // restores the lake and revives the fish.
    uniforms.set("uPollution", pollutionAt(scrollStore.smoothed));
  });

  return (
    <group>
      <mesh ref={mesh} geometry={bodyGeo} frustumCulled={false}>
        <shaderMaterial
          ref={material}
          transparent
          uniforms={uniforms.values}
          vertexShader={FISH_VERTEX}
          fragmentShader={FISH_FRAGMENT}
        />
      </mesh>
      <mesh geometry={tailGeo} frustumCulled={false}>
        <shaderMaterial
          transparent
          uniforms={uniforms.values}
          vertexShader={FISH_VERTEX}
          fragmentShader={FISH_FRAGMENT}
        />
      </mesh>
    </group>
  );
}

/**
 * Fish vertex shader.
 *
 * Per-instance behaviour, all from the `uPollution` uniform:
 *
 *   - alive:    slow patrol around the home position
 *   - fleeing:  swim hard AWAY from the outfall, toward clean water, as the
 *               plume reaches them
 *   - dying:    lose colour, sink, and stop moving
 *   - dead:     belly-up at the bed, motionless
 *
 * Position is computed in the shader from the instance's home position, so the
 * CPU never touches a fish after mount.
 */
const FISH_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uPollution;
  uniform vec3  uOutfall;
  uniform vec3  uLakeCentre;
  uniform float uRadius;

  attribute vec3 aOffset;   // home position
  attribute vec2 aParams;   // x: swim speed, y: tail phase

  varying float vPollution;
  varying float vBelly;
  varying float vDead;

  void main() {
    vBelly = uv.y;

    // --- Swimming ---------------------------------------------------------
    // Idle: a slow lissajous patrol around home, so the school never looks
    // static even when the scroll is not moving.
    float speed = aParams.x;
    float phase = aParams.y;
    float t = uTime * speed;

    vec3 pos = aOffset;
    pos.x += sin(t + phase) * 3.2;
    pos.y += sin(t * 0.7 + phase * 2.3) * 0.55;
    pos.z += cos(t * 0.8 + phase * 1.7) * 3.2;

    // Heading, from the local velocity of the patrol.
    vec3 vel = vec3(
      cos(t + phase) * 3.2 * speed,
      0.0,
      -sin(t * 0.8 + phase * 1.7) * 3.2 * speed
    );

    // --- Response to pollution -------------------------------------------
    // How contaminated is the water AT THIS FISH, not globally? The plume
    // spreads outward from the outfall, so the fish nearest the discharge are
    // affected first. This is what makes the sequence read as a spreading
    // event rather than a lake-wide switch.
    float distToOutfall = distance(aOffset.xz, uOutfall.xz);
    float plumeReach = uPollution * uRadius * 1.5;
    float exposure = 1.0 - smoothstep(plumeReach * 0.55, plumeReach, distToOutfall);
    exposure = clamp(exposure * uPollution, 0.0, 1.0);

    vPollution = exposure;

    // Fleeing: run from the outfall. A per-fish resilience means they do not
    // all react at once, which looks far more like a real response than a
    // synchronised panic.
    float reaction = exposure * step(0.35, fract(phase * 3.71));
    vec3 away = normalize(aOffset.xz - uOutfall.xz + vec2(0.001));
    pos.xz += away * reaction * 14.0;

    // --- Dying and dead ---------------------------------------------------
    // Death lags exposure, so a fish stays briefly active after the water
    // around it goes bad. It then sinks, rolls belly-up, and stops.
    float death = smoothstep(0.45, 0.95, exposure);
    vDead = death;

    // Sink to the lake bed, which is deepest at the centre.
    float bedY = -6.5;
    pos.y = mix(pos.y, bedY, death);

    // Belly-up: roll the fish 180 degrees as it dies.
    float roll = death * 3.14159;

    // Motion dies with it. A dead fish is still, and a twitching one reads as
    // a bug.
    float liveliness = (1.0 - death);
    float wag = sin(uTime * (2.5 + speed * 2.0) + phase * 6.0);
    float bodyWave = wag * liveliness * 0.14 * smoothstep(0.35, -0.5, position.x);

    // --- Transform --------------------------------------------------------
    // Orient along the swim direction, with the roll applied last.
    float heading = atan(vel.x, vel.z) + reaction * 3.0;
    float c = cos(heading);
    float s = sin(heading);
    vec3 rotated = vec3(position.x * c - position.z * s, position.y, position.x * s + position.z * c);

    // Tail wag: displace laterally, increasing toward the tail.
    float tailWeight = smoothstep(0.0, -0.4, position.x);
    rotated.y += bodyWave * (0.4 + tailWeight);

    // Roll for the dead.
    float cr = cos(roll);
    float sr = sin(roll);
    rotated = vec3(rotated.x, rotated.y * cr - rotated.z * sr, rotated.y * sr + rotated.z * cr);

    // Scale.
    rotated *= 1.6;

    vec3 world = pos + rotated;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const FISH_FRAGMENT = /* glsl */ `
  uniform vec3 uBodyColor;
  uniform vec3 uBellyColor;
  uniform vec3 uDeadColor;

  varying float vPollution;
  varying float vBelly;
  varying float vDead;

  void main() {
    // Countershading: dark back, pale belly. Cheap, and it is the single
    // detail that stops a fish reading as a grey lozenge.
    vec3 color = mix(uBellyColor, uBodyColor, smoothstep(0.2, 0.8, 1.0 - vBelly));

    // Dying fish lose colour, then go a dead grey-brown.
    color = mix(color, uDeadColor, vDead);
    color = mix(color, color * vec3(0.85, 0.8, 0.6), vPollution * 0.5);

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

