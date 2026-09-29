"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, Color, Vector3, type Mesh } from "three";
import { WORLD, terrainHeight } from "@/scene/world";
import { SUN_DIRECTION } from "@/scene/sun";
import { FOG_COLOR, FOG_DENSITY } from "./Lighting";
import type { QualitySettings } from "@/scene/quality";

/**
 * TERRAIN
 * =======
 * A CPU-displaced heightfield with a custom shading pass.
 *
 * ## One source of truth for height
 *
 * The vertices are displaced on the CPU using `terrainHeight()` from
 * world.ts — the exact same function the vegetation scatter uses to decide
 * where to plant each tree. An earlier draft of this file displaced in the
 * vertex shader too, which meant two implementations of the same noise: one
 * in GLSL, one in TypeScript. They would have drifted the moment either was
 * edited, and the symptom would have been trees floating above the ground or
 * buried in it, at random, in a way that is miserable to debug.
 *
 * So: CPU does all geometry, and the fragment shader only colours what the
 * CPU built. The cost is one build of ~65k vertices on mount, which is a few
 * milliseconds and happens once.
 *
 * ## Shading
 *
 * Normals are derived per-fragment from screen-space derivatives of the world
 * position. This costs nothing extra over an interpolated vertex normal and
 * is far smoother across a 1400m heightfield, where vertex-interpolated
 * normals visibly facet on the larger triangles near the edge.
 */

const fragmentShader = /* glsl */ `
  uniform vec3 uLowColor;
  uniform vec3 uMidColor;
  uniform vec3 uHighColor;
  uniform vec3 uRockColor;
  uniform vec3 uSiltColor;
  uniform vec3 uPadColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uPadHalfX;
  uniform float uPadHalfZ;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;
  uniform vec3 uCameraPosition;

  varying vec3 vWorldPosition;
  varying float vHeight;
  varying float vDetail;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  void main() {
    // Per-fragment normal from world-position derivatives. Cheaper than
    // reading a varying normal and much smoother on the wide triangles near
    // the edge of the heightfield.
    vec3 normal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
    if (normal.y < 0.0) normal = -normal;

    float slope = 1.0 - clamp(normal.y, 0.0, 1.0);

    // --- Colour layers --------------------------------------------------
    // Humid tropical ground: dark organic soil low down, olive-green scrub
    // through the mid elevations, exposed rock only on genuinely steep faces.
    vec3 color = uLowColor;
    color = mix(color, uMidColor, smoothstep(4.0, 30.0, vHeight));
    color = mix(color, uHighColor, smoothstep(110.0, 330.0, vHeight));

    // Rock only on the mountain flanks. The jungle floor has no visible bare
    // rock, because in a real tropical forest the floor is covered in
    // litter and undergrowth.
    color = mix(color, uRockColor, smoothstep(0.30, 0.60, slope) * smoothstep(55.0, 190.0, vHeight));

    // Wet silt in the lake basin.
    color = mix(color, uSiltColor, smoothstep(1.5, -5.0, vHeight));

    // The industrial pad. Desaturated on purpose, so the factory structures
    // later read as the subject rather than competing with the floor.
    float pad = (1.0 - smoothstep(uPadHalfX, uPadHalfX * 1.35, abs(vWorldPosition.x)))
              * (1.0 - smoothstep(uPadHalfZ, uPadHalfZ * 1.4, abs(vWorldPosition.z)));
    color = mix(color, uPadColor, pad * 0.9);

    // Large-scale tonal break-up. A perfectly uniform colour across hundreds
    // of metres is one of the strongest tells that terrain is procedural.
    color *= 0.87 + vDetail * 0.26;

    // --- Lighting -------------------------------------------------------
    // Wrapped diffuse. A hard N·L terminates at the terminator, which on
    // terrain reads as a hard line. Wrapping it by ~0.25 softens the
    // transition the way skylight scattered from the surrounding forest
    // actually does.
    float ndl = dot(normal, uSunDirection);
    float diffuse = clamp((ndl + 0.25) / 1.25, 0.0, 1.0);

    // Hemisphere fill from the same colours the light rig uses, so terrain
    // and vegetation shade consistently.
    float sky = 0.5 + 0.5 * normal.y;
    vec3 ambient = mix(uGroundColor, uSkyColor, sky);

    vec3 lit = color * (uSunColor * diffuse * 0.85 + ambient);

    // --- Fog ------------------------------------------------------------
    // Exponential-squared, matched to the scene fog so terrain and
    // vegetation recede at exactly the same rate. Mismatched fog density
    // between layers is what makes a composite scene look like separate
    // scenes stacked together.
    float distance = length(vWorldPosition - uCameraPosition);
    float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * distance * distance);
    color = mix(lit, uFogColor, clamp(fogFactor, 0.0, 1.0));

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

const vertexShader = /* glsl */ `
  varying vec3 vWorldPosition;
  varying float vHeight;
  varying float vDetail;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vHeight = worldPosition.y;
    vDetail = valueNoise(worldPosition.xz * 0.015) * 0.6
            + valueNoise(worldPosition.xz * 0.05) * 0.4;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

/** Build the near heightfield: a flat grid spanning the detailed region. */
function buildGeometry(segments: number) {
  const size = WORLD.terrainRadius * 2;
  const positions = new Float32Array((segments + 1) * (segments + 1) * 3);
  const indices = new Uint32Array(segments * segments * 6);

  const step = size / segments;
  const origin = -WORLD.terrainRadius;

  let vertex = 0;
  for (let z = 0; z <= segments; z++) {
    for (let x = 0; x <= segments; x++) {
      const worldX = origin + x * step;
      const worldZ = origin + z * step;
      positions[vertex * 3] = worldX;
      positions[vertex * 3 + 1] = terrainHeight(worldX, worldZ);
      positions[vertex * 3 + 2] = worldZ;
      vertex++;
    }
  }

  let index = 0;
  for (let z = 0; z < segments; z++) {
    for (let x = 0; x < segments; x++) {
      const a = z * (segments + 1) + x;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      // Wound so the face normal points up. The fragment shader flips the
      // normal if it derives one pointing down, but getting the winding right
      // means backface culling does not discard half the terrain.
      indices[index++] = a;
      indices[index++] = c;
      indices[index++] = b;
      indices[index++] = b;
      indices[index++] = c;
      indices[index++] = d;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * The outer skirt: low-resolution ground from the edge of the detailed
 * heightfield out to the mountain ring.
 *
 * Without this there is a visible void. The near terrain is a flat grid
 * bounded at radius 1400m, and the mountain ring does not begin until 3200m,
 * so the horizon would show sky through a 1800m gap. The mountains would
 * appear to float above an empty band.
 *
 * This fills that band with the same `terrainHeight()` function at a much
 * coarser resolution. It is a single ring mesh with ~2k triangles, so the gap
 * is closed for a negligible cost, and because both meshes sample the same
 * height function they meet seamlessly at the seam.
 */
function buildSkirtGeometry(rings: number, segments: number) {
  // Slightly inside the detailed heightfield's edge so the two meshes
  // overlap rather than leaving a hairline crack at the seam.
  const innerRadius = WORLD.terrainRadius * 0.97;
  // Out past the near mountain ring, so the ridge line is never floating
  // above an exposed edge.
  const outerRadius = WORLD.mountainRadius * 1.3;

  const vertexCount = (rings + 1) * (segments + 1);
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(rings * segments * 6);

  let vertex = 0;
  for (let ring = 0; ring <= rings; ring++) {
    // sqrt spacing puts more rings near the camera-side distance where the
    // silhouette against the mountains matters most, and fewer far out where
    // fog has already taken over.
    const t = ring / rings;
    const radius = innerRadius + (outerRadius - innerRadius) * Math.pow(t, 0.7);

    for (let segment = 0; segment <= segments; segment++) {
      const angle = (segment / segments) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      positions[vertex * 3] = x;
      positions[vertex * 3 + 1] = terrainHeight(x, z);
      positions[vertex * 3 + 2] = z;
      vertex++;
    }
  }

  let index = 0;
  for (let ring = 0; ring < rings; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const a = ring * (segments + 1) + segment;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      indices[index++] = a;
      indices[index++] = c;
      indices[index++] = b;
      indices[index++] = b;
      indices[index++] = c;
      indices[index++] = d;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

export function Terrain({ quality }: { quality: QualitySettings }) {
  const mesh = useRef<Mesh>(null);

  const geometry = useMemo(
    () => buildGeometry(quality.terrainSegments),
    [quality.terrainSegments]
  );

  // Coarse, and deliberately not tied to the quality tier. A handful of rings
  // and segments is enough to close the gap; more would only add triangles
  // nobody can resolve through this much fog.
  const skirt = useMemo(() => buildSkirtGeometry(16, 128), []);

  const uniforms = useMemo(
    () => ({
      // Vibrant tropical palette. The previous values were so dark and so
      // desaturated that the ground read as bare black-green nothing, and the
      // forest looked like it was sitting on a void.
      uLowColor: { value: new Color("#2c4a1e") }, // wet jungle soil
      uMidColor: { value: new Color("#4a7a2a") }, // scrub and canopy shadow
      uHighColor: { value: new Color("#6d7a4e") }, // upper exposed slopes
      uRockColor: { value: new Color("#7a7872") }, // bare rock
      uSiltColor: { value: new Color("#4a4432") }, // lake bed silt
      uPadColor: { value: new Color("#6e6a60") }, // compacted industrial ground
      uFogColor: { value: new Color(FOG_COLOR) },
      uFogDensity: { value: FOG_DENSITY },
      uPadHalfX: { value: WORLD.factoryPadHalf.x },
      uPadHalfZ: { value: WORLD.factoryPadHalf.z },
      uSunDirection: {
        value: new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z).normalize(),
      },
      uSunColor: { value: new Color(1.0, 0.72, 0.44) },
      uSkyColor: { value: new Color(0.52, 0.68, 0.88) },
      uGroundColor: { value: new Color(0.1, 0.13, 0.07) },
      uCameraPosition: { value: new Vector3() },
    }),
    []
  );

  // The fog term needs the camera's world position, which the uniform cannot
  // read on its own. Updated here rather than from the Lighting component so
  // the terrain stays self-contained.
  useFrame(({ camera }) => {
    uniforms.uCameraPosition.value.copy(camera.position);
  });

  return (
    <>
      <mesh ref={mesh} geometry={geometry} receiveShadow frustumCulled={false}>
        <shaderMaterial
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
        />
      </mesh>

      {/*
        Rendered first and without shadows. The skirt sits behind the
        mountains in draw order but is geometrically nearer than them, so it
        must not cast — otherwise a 620m ridge would throw a shadow across
        the entire visible landscape from a light that is behind the camera.
      */}
      <mesh geometry={skirt} frustumCulled={false} renderOrder={-1}>
        <shaderMaterial
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
        />
      </mesh>
    </>
  );
}

/** Re-exported so the vegetation scatter and the terrain agree on a surface. */
export { terrainHeight };
