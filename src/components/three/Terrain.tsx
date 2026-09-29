"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, Color, Vector2, Vector3, type Mesh } from "three";
import { WORLD, terrainHeight, terrainStats } from "@/scene/world";
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
  /** Dry sand on the flats above the treeline. */
  uniform vec3 uSandColor;
  /** Darker, damp sand at the waterline. */
  uniform vec3 uSandWetColor;
  uniform vec3 uFogColor;
  /**
   * [lowestDryHeight, highestHeight] in metres, measured from the same
   * terrainHeight() that builds the mesh.
   *
   * Every colour band on this surface is a fraction of this range rather than
   * an absolute altitude. Absolute thresholds stop working the moment the
   * terrain is reshaped, and they fail silently: the shader still compiles, it
   * just never reaches the upper bands.
   */
  uniform vec2 uHeightRange;
  /**
   * Altitude above which vegetation stops, from the same terrainStats() the
   * jungle scatter uses. The sand band is anchored to this so the two cannot
   * disagree: a sand band keyed to anything else paints the forest.
   */
  uniform float uTreeline;
  uniform float uFogDensity;
  /**
   * Pad extent toward the lake (-X) and away from it (+X). Asymmetric; see
   * WORLD.factoryPadMaxX for why the shoreline only constrains one side.
   */
  uniform float uPadMinX;
  uniform float uPadMaxX;
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
    //
    // THE BANDING BOUNDARIES ARE RELATIVE, and they used to be absolute
    // constants that had silently stopped meaning anything.
    //
    // The terrain was reshaped when the mountain ridge was removed, and its
    // elevation range changed completely — the ground now runs from about 0m to
    // 76m instead of from 0m to 430m. The thresholds stayed at 4/30/110/330 and
    // 55/190, which meant:
    //
    //   - nothing was ever "uHighColor", because 110m is above every hilltop
    //   - the rock term was completely dead, because its height gate started at
    //     55m and most of the world's steepest ground is lower than that
    //
    // So the terrain rendered as a single flat blend of two colours. Both
    // numbers now come from uHeightRange, which <Terrain> measures from the
    // same terrainHeight() the geometry is built from — so they cannot drift
    // out of sync with the land they are colouring.
    float hMin = uHeightRange.x;
    float hMax = uHeightRange.y;
    float hSpan = max(hMax - hMin, 1.0);
    // 0 at the lowest ground, 1 at the highest, in the dry basin.
    float hT = clamp((vHeight - hMin) / hSpan, 0.0, 1.0);

    vec3 color = uLowColor;
    color = mix(color, uMidColor, smoothstep(0.10, 0.48, hT));
    color = mix(color, uHighColor, smoothstep(0.55, 0.95, hT));

    // Rock on the genuinely steep faces. In a real tropical forest the floor is
    // covered in litter and undergrowth, so bare rock belongs on slopes only —
    // and the height gate is now the upper third of the relief, where a scoured
    // hillside would actually appear.
    color = mix(color, uRockColor, smoothstep(0.30, 0.60, slope) * smoothstep(0.45, 0.85, hT));

    // Wet silt in the lake basin. The shoreline is at y = 0 and the bed goes to
    // -9m, and those numbers are stable, so this one stays absolute.
    color = mix(color, uSiltColor, smoothstep(1.5, -5.0, vHeight));

    // The industrial pad. Desaturated on purpose, so the factory structures
    // later read as the subject rather than competing with the floor.
    //
    // ASYMMETRIC in X, matching the carve in world.ts: the pad reaches
    // uPadMinX toward the lake and uPadMaxX away from it. Using abs(x) here
    // would mirror the short side back out to the long one and paint a
    // symmetrical grey rectangle that does not line up with the ground it is
    // supposed to be sitting on.
    float padX = (1.0 - smoothstep(uPadMinX, uPadMinX * 1.35, -vWorldPosition.x))
               * (1.0 - smoothstep(uPadMaxX, uPadMaxX * 1.22, vWorldPosition.x));
    float pad = padX * (1.0 - smoothstep(uPadHalfZ, uPadHalfZ * 1.4, abs(vWorldPosition.z)));
    color = mix(color, uPadColor, pad * 0.9);

    // Large-scale tonal break-up. A perfectly uniform colour across hundreds
    // of metres is one of the strongest tells that terrain is procedural.
    color *= 0.87 + vDetail * 0.26;

    // --- SAND ------------------------------------------------------------
    // A pale coastal plain ABOVE THE TREELINE, so the horizon is land rather
    // than an open wash of haze.
    //
    // Keyed to ELEVATION, not to distance from the origin: the treeline is a
    // function of altitude, so colouring by radius would paint a concentric
    // ring that reads instantly as a texture swatch.
    //
    // The band is anchored to uTreeline, the SAME number the vegetation scatter
    // uses to stop growing trees, so the sand begins exactly where the forest
    // ends.
    //
    // It was previously a hard-coded hT range of 0.40 to 0.84, and that covered
    // 71.6% of the map. The treeline sits at hT 0.73 and the summit at 1.00, so
    // the band swallowed the entire forest and left only the 4.7% that is
    // genuinely treeless uncoloured. The result was a white landscape, which is
    // the opposite of what was asked for. check-scene.ts now asserts the sand
    // band starts at the treeline rather than below it.
    float flat = smoothstep(uTreeline, uTreeline + (hMax - uTreeline) * 0.55, vHeight);
    // Warped so the boundary is irregular. A treeline that follows a contour
    // exactly is a contour line, and contour lines are the giveaway of
    // procedural terrain.
    float sandEdge = flat * (0.72 + 0.28 * valueNoise(vWorldPosition.xz * 0.0032));
    color = mix(color, uSandColor, clamp(sandEdge, 0.0, 1.0));

    // Damp margin at the water's edge, so the shore does not meet the lake with
    // a hard line of saturated colour.
    color = mix(color, uSandWetColor, (1.0 - smoothstep(0.0, 2.8, vHeight)) * 0.5);

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
 * heightfield out to the fog limit.
 *
 * Without this the horizon would show sky through a gap between the detailed
 * heightfield's edge and wherever the eye gives up. It is a single ring mesh
 * of ~4k triangles sampling the same `terrainHeight()` function as the detailed
 * mesh, so the two meet seamlessly at the seam and the far field costs nothing
 * worth measuring.
 *
 * It carries NO mountains. The ridge that used to stand on this skirt was a
 * `ridgedFbm` term inside `terrainHeight()` itself, so it survived the
 * deletion of `Mountains.tsx` and was the source of a wiggly band across the
 * horizon. The term is gone; what remains is a low, smooth plain.
 */
function buildSkirtGeometry(rings: number, segments: number) {
  // Slightly inside the detailed heightfield's edge so the two meshes
  // overlap rather than leaving a hairline crack at the seam.
  const innerRadius = WORLD.terrainRadius * 0.97;
  // Out to the fog limit. The skirt is no longer there to carry a mountain
  // ring — those are gone — but the seam between detailed terrain and open sky
  // still has to be hidden, and a flat plain at 97% fog does that. See
  // WORLD.skirtRadius.
  const outerRadius = WORLD.skirtRadius;

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

  // Sampled from the same height function that builds the geometry below, so
  // the shader's colour bands are always fractions of the terrain that actually
  // exists. Memoised inside terrainStats(), so this is a single scan.
  const stats = terrainStats();

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
      /**
       * Vibrant tropical ground.
       *
       * Lifted last round out of near-black (#1a2415 / #2c3a1f), which fixed
       * "the ground reads as a void" and then overshot into "the ground is
       * washed out". The previous values sat around 20-30% luminance, and with
       * a 3.4-intensity sun and a hemisphere fill on top they landed as a muddy
       * mid-grey-green rather than as foliage.
       *
       * Saturated and mid-bright is the target. A real canopy photograph is
       * neither near-black nor pastel, and the saturation is what carries it
       * more than the level.
       */
      uLowColor: { value: new Color("#2f5c1c") }, // wet jungle soil, in leaf shade
      uMidColor: { value: new Color("#4e9024") }, // canopy, the dominant green
      uHighColor: { value: new Color("#7d9a3c") }, // sunlit scrub, upper slopes
      uRockColor: { value: new Color("#8a8880") }, // bare rock on steep faces
      uSiltColor: { value: new Color("#5a5340") }, // lake bed silt
      uPadColor: { value: new Color("#75705f") }, // compacted industrial ground
      // Warm, desaturated sand. Kept well below white: a pale surface under a
      // low sun blows out to pure white across its whole area, which is what
      // produced the flat white horizon this replaces. These sit around 55-65%
      // luminance so there is still tonal range to shade.
      uSandColor: { value: new Color("#b8a780") },
      uSandWetColor: { value: new Color("#8a7c5c") },
      uFogColor: { value: new Color(FOG_COLOR) },
      uFogDensity: { value: FOG_DENSITY },
      uPadMinX: { value: WORLD.factoryPadHalf.x },
      uPadMaxX: { value: WORLD.factoryPadMaxX },
      uPadHalfZ: { value: WORLD.factoryPadHalf.z },
      // Measured once from the same height function that builds this mesh, so
      // the colour bands stay correct through any future change to the terrain
      // shape. See the comment on the uniform.
      uHeightRange: { value: new Vector2(stats.min, stats.max) },
      uTreeline: { value: stats.treeline },
      uSunDirection: {
        value: new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z).normalize(),
      },
      uSunColor: { value: new Color(1.0, 0.72, 0.44) },
      uSkyColor: { value: new Color(0.56, 0.74, 0.96) },
      uGroundColor: { value: new Color(0.16, 0.22, 0.1) },
      uCameraPosition: { value: new Vector3() },
    }),
    // `stats` is a memoised singleton (see terrainStats), so these are stable
    // for the lifetime of the page. Listed explicitly so the dependency is
    // honest rather than relying on that.
    [stats.min, stats.max, stats.treeline]
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
        Rendered first and without shadows. The skirt is drawn before the
        detailed heightfield so that the seam is always covered by the nearer,
        higher-resolution mesh, whatever the depth precision does. It must not
        cast either — the far plain sits between the sun and the entire
        visible landscape, so a casting skirt would drop the whole site into
        shadow.
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
