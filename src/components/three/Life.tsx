"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Vector3,
  type Mesh,
  type ShaderMaterial,
} from "three";
import { Uniforms } from "@/lib/uniforms";
import { createRandom, range } from "@/scene/random";
import { WORLD, terrainHeight } from "@/scene/world";
import { scrollStore } from "@/lib/scrollStore";

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

export function Birds({ count = 14 }: { count?: number }) {
  const geometry = useMemo(() => {
    const random = createRandom(9182);
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 4);

    for (let i = 0; i < count; i++) {
      // Circling altitude: above the canopy, below the plume base, so birds
      // read against sky and treeline rather than against smoke.
      const radius = range(random, 90, 380);
      const centreX = range(random, -140, 140);
      const centreZ = range(random, -140, 260);
      const altitude = terrainHeight(0, 0) + range(random, 70, 210);

      positions[i * 3] = centreX + Math.cos(random() * Math.PI * 2) * radius;
      positions[i * 3 + 1] = altitude;
      positions[i * 3 + 2] = centreZ + Math.sin(random() * Math.PI * 2) * radius;

      // x: orbit centre, y: orbit centre, z: orbit radius, w: orbit phase
      seeds[i * 4] = centreX;
      seeds[i * 4 + 1] = centreZ;
      seeds[i * 4 + 2] = radius;
      seeds[i * 4 + 3] = random() * Math.PI * 2;
    }

    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geo.setAttribute("aOrbit", new Float32BufferAttribute(seeds, 4));
    return geo;
  }, [count]);

  const uniforms = useMemo(
    () => new Uniforms({ uTime: { value: 0 }, uColor: { value: new Color("#2b2f33") }, uSize: { value: 34 } }),
    []
  );

  useFrame(({ clock, gl }) => {
    uniforms.set("uTime", clock.elapsedTime);
    uniforms.set("uSize", gl.domElement.height * 0.03);
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
          attribute vec4 aOrbit;
          varying float vWing;

          void main() {
            vec2 centre = aOrbit.xy;
            float radius = aOrbit.z;
            float phase = aOrbit.w;

            // Each bird orbits at its own rate and bobs vertically. A little
            // variation in rate stops the flock looking like a rigid carousel.
            float rate = 0.10 + fract(aOrbit.w * 7.31) * 0.09;
            float angle = phase + uTime * rate;

            vec3 p = vec3(
              centre.x + cos(angle) * radius,
              // Sinusoidal bob, so birds rise and fall through the turn.
              position.y + sin(uTime * 0.5 + phase * 3.0) * 9.0,
              centre.y + sin(angle) * radius
            );

            // Wing flap. Fast and small — at this apparent size a full flap
            // cycle reads as a flicker, so it is deliberately restrained.
            vWing = sin(uTime * 9.0 + phase * 11.0) * 0.5 + 0.5;

            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = uSize / max(-mv.z, 1.0) * (0.8 + vWing * 0.4);
          }
        `}
        fragmentShader={/* glsl */ `
          uniform vec3 uColor;
          varying float vWing;
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
            gl_FragColor = vec4(uColor, a * 0.85);
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
 * The narrative curve, and the single place the story is authored:
 *
 *   0.86 - 0.90  water is clean; nothing has been discharged
 *   0.90 - 0.93  effluent begins pouring in at the outfall
 *   0.93 - 0.96  the plume spreads across the lake
 *   0.96 - 0.99  the plume reaches the fish, which start dying
 *   0.99 - 1.00  everything is dead
 *
 * A pure function of progress, so scrolling back up restores the lake.
 */
export function pollutionAt(progress: number): number {
  if (progress < 0.9) return 0;
  if (progress > 0.985) return 1;
  return (progress - 0.9) / 0.085;
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

export function Fish({ count = 34 }: { count?: number }) {
  const mesh = useRef<Mesh>(null);
  const material = useRef<ShaderMaterial>(null);

  const fish = useMemo<Fish[]>(() => {
    const random = createRandom(4471);
    const school: Fish[] = [];
    for (let i = 0; i < count; i++) {
      // Scattered through the lake, biased away from the outfall so the
      // cleanest fish start furthest from the discharge.
      const angle = random() * Math.PI * 2;
      const distance = Math.pow(random(), 0.7) * LAKE.radius * 0.72;
      // Keep inside the bowl, accounting for the shoreline wobble.
      const x = LAKE.centre.x + Math.cos(angle) * distance;
      const z = LAKE.centre.z + Math.sin(angle) * distance;

      // Depth: 1.5m to 6m below the surface. The bowl is deepest at the
      // centre, so clamp against the actual terrain.
      const bed = terrainHeight(x, z);
      const depth = Math.min(range(random, 1.6, 6.0), Math.max(0.8, -bed - 0.8));

      school.push({
        home: new Vector3(x, -depth, z),
        heading: random() * Math.PI * 2,
        speed: range(random, 0.5, 1.1),
        phase: random() * Math.PI * 2,
        size: range(random, 0.75, 1.35),
        resilience: range(random, 0.6, 1.25),
      });
    }
    return school;
  }, [count]);

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

