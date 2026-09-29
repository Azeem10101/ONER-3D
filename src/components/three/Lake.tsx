"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, Color, FogExp2, Vector3, BackSide, type Mesh, type Points } from "three";
import { WORLD } from "@/scene/world";
import { SUN_DIRECTION } from "@/scene/sun";
import { FOG_COLOR, FOG_DENSITY } from "./Lighting";
import { createRandom } from "@/scene/random";
import { Uniforms } from "@/lib/uniforms";
import { pollutionAt } from "./Life";
import { scrollStore } from "@/lib/scrollStore";
import type { QualitySettings } from "@/scene/quality";

/**
 * THE LAKE — and the contamination in it
 * ======================================
 * The second half of the story. The camera dives into this water at scroll
 * 0.86-1.00, so it is a hero surface and it has to be a real one.
 *
 * ## What was wrong before
 *
 * A `MeshReflectorMaterial` disc in one flat colour, plus a separate flat
 * green circle for "algal bloom". Two problems: a planar reflection renders
 * the whole scene a second time, which is unaffordable on integrated graphics;
 * and the bloom was a hard-edged disc, which reads as a sticker rather than as
 * something suspended in liquid.
 *
 * ## What this does instead
 *
 * A single custom shader doing the work a reflection pass would have:
 *
 *   - FRESNEL. Water seen from above is mostly sky reflection; water seen at
 *     a grazing angle is almost entirely reflection. Getting this term right
 *     is what stops a lake from looking like painted plastic.
 *
 *   - PROCEDURAL WAVES. Three octaves of scrolling gradient noise, with two
 *     layers travelling in different directions. No texture, and the derivative
 *     of the noise field gives the normal for free.
 *
 *   - CONTAMINATION THAT MIXES. The pollutant field is a radial spread from
 *     the outfall, warped by animated noise and evolving over time. The
 *     boundary is irregular and continuously deforming, so it reads as a
 *     substance dispersing in a liquid rather than as a decal on top of one.
 *     The colour is a muted ochre-olive, not neon green — bright green water
 *     is the single most common tell of a fake pollution effect.
 *
 *   - FOAM AND SCUM. A bright ring at the discharge point and a ragged leading
 *     edge on the contaminant front. Real effluent carries surfactant, and the
 *     foam is what makes the pollution read as *being discharged* rather than
 *     merely being present.
 *
 *   - THIN-FILM SHEEN. A very subtle iridescence near the source, where
 *     floating oil is thinnest. Kept almost invisible on purpose; at any
 *     higher strength it reads as a rainbow effect.
 */

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uSwell;

  varying vec3 vWorld;
  varying vec2 vSurfaceUv;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);

    // A long, low swell. Real lake surfaces are not flat even out of wind;
    // without this the fresnel term has nothing to break up and the whole
    // lake reads as a mirror.
    world.y += sin(world.x * 0.021 + uTime * 0.42) * uSwell
             + sin(world.z * 0.017 - uTime * 0.31) * uSwell * 0.7;

    vWorld = world.xyz;
    vSurfaceUv = world.xz;

    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec2  uSource;        // outfall position, world XZ
  uniform vec2  uLakeCentre;    // lake centre, world XZ
  uniform vec3  uSunDirection;
  uniform vec3  uDeepColor;
  uniform vec3  uShallowColor;
  uniform vec3  uSkyColor;
  uniform vec3  uContaminant;
  uniform vec3  uFoamColor;
  uniform vec3  uFogColor;
  uniform float uFogDensity;
  uniform float uContamination;  // 0..1, grows with time AND with camera proximity
  uniform float uClarity;        // 1 = clean, falls as contamination rises
  uniform float uRadius;

  varying vec3 vWorld;
  varying vec2 vSurfaceUv;

  // --- Cheap gradient noise ------------------------------------------------
  float hash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      s += noise(p) * a;
      p = p * 2.03 + vec2(1.7, -2.3);
      a *= 0.5;
    }
    return s;
  }

  // --- Wave field ----------------------------------------------------------
  // Returns a height field; the normal comes from its gradient, which is
  // cheaper than computing three noise samples and differentiating by hand.
  //
  // AMPLITUDES ARE THE POINT. The previous version returned a field with
  // amplitudes around 0.5-1.3 over wavelengths of tens of metres, so the
  // derived normal tilted by at most a few degrees. From 100m up, a surface
  // that is nearly flat looks completely still — the fresnel term barely
  // changes, so the reflection does not move, so there is nothing to see.
  //
  // Short wavelengths with larger amplitude give a normal that genuinely
  // swings, which is what makes the reflection crawl and the glitter flicker.
  // Sampled at 1.2m across a 95m lake that is fine, and it is what makes the
  // water read as water rather than as a blue plane.
  float waves(vec2 p, float t) {
    float h = 0.0;
    // Chop: short wavelength, large amplitude, fast.
    h += sin(p.x * 0.42 + p.y * 0.23 + t * 2.10) * 1.35;
    h += sin(p.x * 0.19 - p.y * 0.51 + t * 1.63) * 1.05;
    // Swell: long wavelength, slower. Gives the large-scale undulation the
    // chop rides on.
    h += (fbm(p * 0.055 + vec2(t * 0.075, -t * 0.052)) - 0.5) * 2.60;
    // Ripple: very short, small, and fast — the fine texture that catches the
    // specular highlight and makes it sparkle.
    h += (fbm(p * 0.34 - vec2(t * 0.24, t * 0.19)) - 0.5) * 0.95;
    h += (fbm(p * 0.92 + vec2(t * 0.55, -t * 0.41)) - 0.5) * 0.30;
    return h;
  }

  void main() {
    vec2 p = vSurfaceUv;
    vec3 viewVec = cameraPosition - vWorld;
    vec3 viewDir = normalize(viewVec);

    // --- Surface normal from the wave gradient ---------------------------
    // Finite differences on the height field. The epsilon is small (0.35m) so
    // the short-wavelength chop is actually resolved rather than averaged
    // away — a large epsilon flattens the normal and the water goes still.
    float e = 0.35;
    float hC = waves(p, uTime);
    float hX = waves(p + vec2(e, 0.0), uTime);
    float hZ = waves(p + vec2(0.0, e), uTime);
    vec3 normal = normalize(vec3(-(hX - hC) / e, 1.0, -(hZ - hC) / e));

    // --- Fresnel ---------------------------------------------------------
    float ndv = max(dot(normal, viewDir), 0.0);
    // Schlick, with F0 = 0.02, the correct value for water/air.
    float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    // Floated up from the physical value. Strict Schlick at this viewing
    // angle (100m up, looking down) gives fresnel around 0.02, which is
    // effectively no reflection at all — physically correct, and visually
    // indistinguishable from a flat blue plane. Real water is not a perfect
    // dielectric because of surface roughness, which raises the effective
    // reflection considerably at these angles.
    fresnel = 0.10 + 0.90 * pow(1.0 - ndv, 4.0);

    // --- Depth: shallower near the shore ---------------------------------
    // --- Depth: shallower near the shore ---------------------------------
    // Shoreline distance uses the lake centre, passed in as a uniform rather
    // than hard-coded. The old value (-300, 190) was the previous lake's
    // position and would have made the entire depth term meaningless.
    float shoreT = smoothstep(uRadius * 1.05, uRadius * 0.6, length(p - uLakeCentre));
    vec3 bodyColor = mix(uShallowColor, uDeepColor, shoreT);

    // --- Contamination ----------------------------------------------------
    // Radial spread from the outfall, warped by a slowly evolving noise
    // field. The warp is what turns a circle into a plume: the boundary
    // deforms continuously and irregularly, so it reads as a substance
    // dispersing rather than a shape being drawn.
    float fromSource = length(p - uSource);
    float warp = fbm(p * 0.011 + vec2(uTime * 0.020, -uTime * 0.014)) - 0.5;
    float warp2 = fbm(p * 0.045 - vec2(uTime * 0.055, uTime * 0.038)) - 0.5;

    // Effective front radius. Grows over time as the discharge continues,
    // then is pushed around by the noise so it never advances as a clean arc.
    float frontRadius = uRadius * (0.10 + uContamination * 0.85) + warp * uRadius * 0.30
                      + warp2 * uRadius * 0.11;

    // Distance from the plume front, normalised. Negative inside.
    float front = (fromSource - frontRadius) / max(frontRadius, 1.0);

    // Density falls off inside the plume, and the front edge is ragged
    // because the warp is already baked into frontRadius.
    float contam = 1.0 - smoothstep(-0.55, 0.30, front);
    // Streaky, filament-like variation within the plume.
    float streaks = 0.72 + 0.28 * fbm(p * 0.085 + vec2(uTime * 0.09, uTime * 0.05));
    contam *= streaks * uContamination;

    // --- Surface normal is flattened where the water is contaminated ------
    // Silt and surfactant damp capillary waves. The visible consequence is
    // that the polluted area reflects more smoothly than the clean water
    // around it, which is a real and very recognisable effect.
    normal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), contam * 0.62));

    // --- Composite --------------------------------------------------------
    vec3 color = mix(bodyColor, uContaminant, contam * 0.94);

    // Sky reflection, strengthened by the fresnel term and scaled by clarity:
    // contaminated water is turbid, so it stops behaving like a mirror long
    // before the colour fully changes. Seeing the reflection die before the
    // colour arrives is what makes the approach legible as a process.
    vec3 reflection = uSkyColor * (0.75 + 0.45 * max(dot(normalize(uSunDirection), normal), 0.0));
    color = mix(color, reflection, fresnel * 0.82 * uClarity);

    // Sun glitter. TWO lobes — a tight one for the hard sparkle, and a broad
    // one for the sheen across a larger area. One narrow lobe alone produces
    // a few isolated bright pixels that read as noise rather than as light on
    // water.
    vec3 halfVec = normalize(uSunDirection + viewDir);
    float spec = max(dot(normal, halfVec), 0.0);
    color += vec3(1.0, 0.94, 0.84) * pow(spec, 90.0) * 1.8;
    color += vec3(1.0, 0.95, 0.88) * pow(spec, 14.0) * 0.32;

    // --- Foam and scum -----------------------------------------------------
    // A bright ring hard against the outfall, where effluent is entering
    // fast enough to entrain air. Tight radius — the old 2-16m band was
    // scaled for a 190m lake and vanished entirely on a 95m one.
    float outfallFoam = 1.0 - smoothstep(1.0, 8.0, fromSource);
    outfallFoam *= 0.6 + 0.4 * fbm(p * 0.9 + vec2(uTime * 0.6, uTime * 0.4));

    // A ragged leading edge on the contaminant front: the classic scum line.
    float edgeFoam = (1.0 - smoothstep(0.0, 0.16, abs(front)))
                   * smoothstep(0.08, 0.4, uContamination)
                   * (0.35 + 0.65 * fbm(p * 0.38 + vec2(uTime * 0.3, -uTime * 0.25)));

    float foam = clamp(outfallFoam * 0.9 + edgeFoam * 0.75, 0.0, 1.0);
    color = mix(color, uFoamColor, foam * 0.78);

    // --- Thin-film sheen near the source ----------------------------------
    // Restrained on purpose. Floating oil is nearly invisible except at
    // grazing angles; anything stronger reads as a rainbow effect.
    float sheenBand = 1.0 - smoothstep(0.0, uRadius * 0.3, fromSource);
    float sheenPhase = (hC * 0.9 + fromSource * 0.12) * 6.283;
    vec3 sheen = vec3(
      0.5 + 0.5 * sin(sheenPhase),
      0.5 + 0.5 * sin(sheenPhase + 2.09),
      0.5 + 0.5 * sin(sheenPhase + 4.19)
    );
    color = mix(color, sheen, sheenBand * foam * 0.16 * fresnel);

    // --- Aerial perspective ----------------------------------------------
    // Same exponential-squared form and the same constant as the scene fog
    // (FOG_DENSITY²), so the water recedes at exactly the rate the terrain and
    // the forest do. A mismatched density between the water and everything
    // else is immediately visible as the lake not belonging to the scene.
    float dist = length(viewVec);
    float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    color = mix(color, uFogColor, clamp(fogF, 0.0, 1.0));

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * Suspended sediment just under the surface.
 *
 * Slow, small, and only inside the contaminated zone — which is what makes it
 * read as *suspended in this water* rather than as generic floating specks.
 * Counted against the quality tier because a water plane already fills the
 * frame at the end of the journey, and overdraw is the expensive part.
 */
function Sediment({ quality }: { quality: QualitySettings }) {
  const count = quality.tier === "low" ? 120 : quality.tier === "medium" ? 320 : 640;

  const geometry = useMemo(() => {
    const random = createRandom(5150);
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      // Clustered toward the outfall, because that is where the sediment
      // enters. A uniform spread would look like snow.
      const angle = random() * Math.PI * 2;
      const distance = Math.pow(random(), 0.6) * WORLD.lakeRadius * 0.62;
      positions[i * 3] = OUTFALL[0] + Math.cos(angle) * distance;
      positions[i * 3 + 1] = -0.6 - random() * 5.5;
      positions[i * 3 + 2] = OUTFALL[1] + Math.sin(angle) * distance;
      seeds[i] = random();
    }

    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(positions, 3));
    geo.setAttribute("aSeed", new BufferAttribute(seeds, 1));
    return geo;
  }, [count]);

  const uniforms = useMemo(
    () => new Uniforms({ uTime: { value: 0 }, uColor: { value: new Color("#6b5a3e") }, uSize: { value: 26 } }),
    []
  );

  useFrame(({ clock, gl }) => {
    uniforms.set("uTime", clock.elapsedTime);
    uniforms.set("uSize", gl.domElement.height * 0.008);
  });

  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={3}>
      <shaderMaterial
        transparent
        depthWrite={false}
        uniforms={uniforms.values}
        vertexShader={/* glsl */ `
          uniform float uTime;
          uniform float uSize;
          attribute float aSeed;
          varying float vFade;
          void main() {
            vec3 p = position;
            // Slow settling plus a lateral swirl, so the sediment drifts
            // rather than hanging perfectly still.
            p.y -= mod(uTime * 0.10 + aSeed * 12.0, 6.0);
            p.x += sin(uTime * 0.14 + aSeed * 20.0) * 3.0;
            p.z += cos(uTime * 0.11 + aSeed * 14.0) * 3.0;

            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = uSize * (0.5 + aSeed) / max(-mv.z, 1.0);
            // Fade with distance so the far side of the lake is not a wall of
            // specks.
            vFade = 1.0 - smoothstep(120.0, 460.0, -mv.z);
          }
        `}
        fragmentShader={/* glsl */ `
          uniform vec3 uColor;
          varying float vFade;
          void main() {
            float d = length(gl_PointCoord - 0.5) * 2.0;
            if (d > 1.0) discard;
            float a = pow(1.0 - d, 2.0) * 0.4 * vFade;
            gl_FragColor = vec4(uColor, a);
            #include <colorspace_fragment>
          }
        `}
      />
    </points>
  );
}

/** World XZ of the discharge. The lake is north-west of the plant, and the
 *  outfall sits on the near shore so the contamination spreads toward the
 *  camera's approach rather than away from it. */
const OUTFALL: [number, number] = [
  WORLD.lakeCentre[0] + WORLD.lakeRadius * 0.58,
  WORLD.lakeCentre[2] - WORLD.lakeRadius * 0.34,
];

export function Lake({ quality }: { quality: QualitySettings }) {
  const surface = useRef<Mesh>(null);
  const progress = useRef(0);

  const uniforms = useMemo(
    () =>
      new Uniforms({
        uTime: { value: 0 },
        uSwell: { value: 0.28 },
        uSource: { value: [OUTFALL[0], OUTFALL[1]] },
        uLakeCentre: { value: [WORLD.lakeCentre[0], WORLD.lakeCentre[2]] },
        uSunDirection: { value: new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z).normalize() },
        // Vibrant tropical water. The previous values (#0b1a1c / #1d3030) were
        // so dark that the body colour was nearly black and the lake read as a
        // void with a reflection on it rather than as water.
        uDeepColor: { value: new Color("#0e3d4a") },
        uShallowColor: { value: new Color("#2a9aa0") },
        // Sky reflection colour. Matched to the fog so the water belongs to the
        // same atmosphere as everything else rather than reading as a separate
        // blue object pasted onto the scene.
        uSkyColor: { value: new Color(FOG_COLOR) },
        // Deliberately NOT neon green — the brief rules that out and it is the
        // most common tell of a fake pollution effect. A saturated ochre-
        // olive: brown enough to read as contaminated, warm enough to contrast
        // hard against the clean teal, so the change is unmistakable.
        uContaminant: { value: new Color("#6b5520") },
        uFoamColor: { value: new Color("#d8d2be") },
        uFogColor: { value: new Color(FOG_COLOR) },
        uFogDensity: { value: FOG_DENSITY },
        uContamination: { value: 0 },
        // 1 = clean water, 0 = fully contaminated. Falls with uContamination
        // so the lake loses its mirror quality as the camera closes in.
        uClarity: { value: 1 },
        // Nearly the full lake radius. On a 95m lake a smaller plume read as
        // a small dirty patch rather than as a body of water being spoiled.
        uRadius: { value: WORLD.lakeRadius * 0.92 },
      }),
    []
  );

  useFrame(({ camera }, delta) => {
    uniforms.set("uTime", (uniforms.get("uTime") as number) + delta);

    // Time accumulation: the discharge has been running the whole time, so the
    // lake is worse later than earlier.
    progress.current = Math.min(1, progress.current + delta * 0.012);

    // PROXIMITY. This is the part that makes the reveal read.
    //
    // The previous version drove contamination purely from elapsed time, which
    // meant the pollution was already fully spread before the camera ever
    // arrived — so "watch the clear water get polluted as you approach" never
    // happened. The viewer just got a finished, uniformly-dirty lake.
    //
    // Driving it from the camera's distance to the outfall instead means the
    // contamination literally resolves out of the water as you descend: at
    // 300m the lake reads clean and blue, by 60m the plume is unmissable.
    // The two factors are combined with max(), so flying right up to the
    // outfall reveals it regardless of how long the page has been open.
    const dx = camera.position.x - OUTFALL[0];
    const dz = camera.position.z - OUTFALL[1];
    const distance = Math.hypot(dx, dz);
    // GLSL-style smoothstep, inlined. Imported from scene/noise it would drag
    // the terrain noise module into a component that only needs one curve.
    const t = Math.min(1, Math.max(0, (distance - 70) / (300 - 70)));
    const proximity = 1 - t * t * (3 - 2 * t);

    const contamination = Math.max(progress.current, proximity);
    uniforms.set("uContamination", contamination);
    // Reflection strength drops as the water gets contaminated, so the lake
    // visibly loses its mirror quality on approach. Dielectric properties
    // really do change — and it is a strong secondary cue that something
    // physical is in the water.
    uniforms.set("uClarity", 1 - contamination * 0.55);
  });

  return (
    <group>
      <mesh
        ref={surface}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[WORLD.lakeCentre[0], 0, WORLD.lakeCentre[2]]}
        renderOrder={1}
      >
        {/* Dense enough that the vertex-shader swell does not facet along the
            shoreline, which is where the camera spends its time. */}
        <circleGeometry args={[WORLD.lakeRadius, 160, 1]} />
        <shaderMaterial
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms.values}
        />
      </mesh>

      <Sediment quality={quality} />
    </group>
  );
}

/**
 * The outfall structure, exported so the factory can connect its pipe run to
 * the water rather than leaving the discharge appearing from nowhere — the
 * brief specifically asks for the outlet to visibly connect the facility to
 * the water.
 */
export function Outfall() {
  return (
    <group position={[OUTFALL[0], 1.6, OUTFALL[1]]} rotation={[0, 0, Math.PI / 2]}>
      <mesh>
        <cylinderGeometry args={[1.5, 1.5, 9, 14]} />
        <meshStandardMaterial color="#4a443c" roughness={0.85} metalness={0.35} />
      </mesh>
      {/* Support pier, so the pipe is not floating over the water. */}
      <mesh position={[0, -3.2, 0]}>
        <boxGeometry args={[1.6, 6.4, 1.6]} />
        <meshStandardMaterial color="#3c3830" roughness={0.95} />
      </mesh>
    </group>
  );
}

/** World position of the discharge, for placing the connecting channel. */
export const OUTFALL_POSITION: [number, number, number] = [OUTFALL[0], 0, OUTFALL[1]];

/**
 * THE DISCHARGE
 * =============
 * Polluted liquid pouring out of the outfall and sinking into the lake.
 *
 * This is the visible act that the water surface shader and the fish both react
 * to, and it is what makes the causal chain legible: something comes out of a
 * pipe, it enters the water, and then the water and the fish change.
 *
 * Rendered as instanced puffs with the same lit-soft-sprite approach as the
 * smoke, tinted to the contaminant colour. It sinks rather than rising, because
 * effluent is denser than water — which is also why it spreads along the bed
 * rather than dispersing evenly, and why the fish in the shallows are the last
 * to be affected.
 */
export function Discharge() {
  const count = 90;
  const points = useRef<Points>(null);

  const geometry = useMemo(() => {
    const random = createRandom(3311);
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;
      // x: phase, y: sink rate, z: spread
      seeds[i * 3] = random();
      seeds[i * 3 + 1] = 0.4 + random() * 0.6;
      seeds[i * 3 + 2] = 0.5 + random() * 0.9;
    }

    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(positions, 3));
    geo.setAttribute("aSeed", new BufferAttribute(seeds, 3));
    return geo;
  }, [count]);

  const uniforms = useMemo(
    () =>
      new Uniforms({
        uTime: { value: 0 },
        uPollution: { value: 0 },
        uColor: { value: new Color("#5a5230") },
        uSize: { value: 40 },
      }),
    []
  );

  useFrame(({ clock, gl }) => {
    uniforms.set("uTime", clock.elapsedTime);
    uniforms.set("uSize", gl.domElement.height * 0.03);
    // Driven by scroll progress, so scrolling back up stops the discharge.
    uniforms.set("uPollution", pollutionAt(scrollStore.smoothed));
  });

  return (
    <points
      ref={points}
      geometry={geometry}
      position={[OUTFALL[0], 0, OUTFALL[1]]}
      frustumCulled={false}
      renderOrder={3}
    >
      <shaderMaterial
        transparent
        depthWrite={false}
        uniforms={uniforms.values}
        vertexShader={/* glsl */ `
          uniform float uTime;
          uniform float uPollution;
          uniform float uSize;
          attribute vec3 aSeed;
          varying float vLife;
          varying float vFade;

          void main() {
            // Nothing pours until the story says so.
            if (uPollution < 0.02) {
              gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
              gl_PointSize = 0.0;
              vFade = 0.0;
              return;
            }

            float rate = aSeed.y;
            // Progress along the sink-and-spread path. The discharge takes
            // ~6s to reach the bed, which is fast for a real outfall but slow
            // enough to read as a plume rather than a puff of smoke.
            float life = fract(uTime * 0.16 * rate + aSeed.x);

            vLife = life;

            vec3 p = vec3(0.0);
            // Falls from the pipe mouth, spreading as it sinks.
            p.y = 0.4 - life * (7.5 + aSeed.y * 2.0);
            float angle = aSeed.x * 6.283 + life * 1.4;
            float spread = pow(life, 0.6) * (5.0 + aSeed.z * 5.0) * uPollution;
            p.x = cos(angle) * spread;
            p.z = sin(angle) * spread;

            // Fade in as it leaves the pipe, and out as it disperses into the
            // general body of water.
            vFade = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.55, 1.0, life));
            // The discharge weakens while pollution is still building, then
            // reaches full strength.
            vFade *= smoothstep(0.0, 0.3, uPollution);

            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = uSize * (0.4 + life * 2.4) / max(-mv.z, 1.0);
          }
        `}
        fragmentShader={/* glsl */ `
          uniform vec3 uColor;
          varying float vLife;
          varying float vFade;
          void main() {
            vec2 uv = gl_PointCoord - 0.5;
            float d = length(uv) * 2.0;
            if (d > 1.0) discard;
            // Soft, and denser at the core of each puff.
            float a = pow(1.0 - d, 1.7) * vFade * 0.42;
            // Slightly warmer at the head where it leaves the pipe.
            vec3 color = uColor * (0.85 + vLife * 0.4);
            gl_FragColor = vec4(color, a);
            #include <colorspace_fragment>
          }
        `}
      />
    </points>
  );
}

/**
 * THE UNDERWATER VOLUME
 * =====================
 * Everything that makes being inside the lake read as being inside water.
 *
 * Three parts, all switched on by the camera's own position rather than by
 * scroll progress — the camera genuinely is underwater at the end, and tying
 * the effect to the timeline instead would make it possible to see a dry
 * scene from below, which is worse than not having it at all.
 *
 *   1. FOG. The scene's own fog is overridden with a short-range, strongly
 *      tinted fog while submerged. Without it the underwater shot is a clear
 *      view of a fish in a void, with no sense of volume or of how far away
 *      anything is.
 *   2. LIGHT SHAFTS. Volumetric-ish beams from the surface. Faked with a
 *      camera-facing shell and a scrolling noise mask, which is affordable;
 *      real volumetrics are not on this hardware.
 *   3. FLOATING PARTICLES. Suspended matter, which is what actually sells
 *      "you are in a liquid" — it gives the eye something at every depth to
 *      parallax against.
 *
 * ## Underwater colour
 *
 * Real water absorbs red first, then green, so a submerged scene goes blue and
 * then green with depth. That shift is applied as a post-style tint on the fog
 * colour, and it is the single strongest cue that the camera is submerged.
 */
export function UnderwaterVolume({ quality }: { quality: QualitySettings }) {
  const shaftMesh = useRef<Mesh>(null);
  const particles = useRef<Points>(null);

  const count = quality.tier === "low" ? 180 : quality.tier === "medium" ? 420 : 800;

  const shafts = useMemo(() => {
    const random = createRandom(8123);
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2;
      // Suspended matter, spread through the whole volume.
      const distance = Math.sqrt(random()) * WORLD.lakeRadius * 0.9;
      positions[i * 3] = WORLD.lakeCentre[0] + Math.cos(angle) * distance;
      positions[i * 3 + 1] = -random() * WORLD.lakeBasinDepth * 0.95;
      positions[i * 3 + 2] = WORLD.lakeCentre[2] + Math.sin(angle) * distance;
      // x: phase, y: drift rate, z: size
      seeds[i * 3] = random();
      seeds[i * 3 + 1] = 0.3 + random() * 0.7;
      seeds[i * 3 + 2] = 0.4 + random() * 1.4;
    }

    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(positions, 3));
    geo.setAttribute("aSeed", new BufferAttribute(seeds, 3));
    return geo;
  }, [count]);

  const particleUniforms = useMemo(
    () =>
      new Uniforms({
        uTime: { value: 0 },
        uSize: { value: 20 },
        uColor: { value: new Color("#cfe4e0") },
      }),
    []
  );

  const shaftUniforms = useMemo(
    () =>
      new Uniforms({
        uTime: { value: 0 },
        uStrength: { value: 0 },
        uColor: { value: new Color("#a8d8d4") },
        uSunDirection: {
          value: new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z).normalize(),
        },
      }),
    []
  );

  useFrame(({ clock, camera, scene, gl }) => {
    // Submerged or not is a function of where the camera actually is.
    const submerged = camera.position.y < -0.15;
    const depth = submerged ? Math.min(1, -camera.position.y / 6) : 0;

    particleUniforms.set("uTime", clock.elapsedTime);
    particleUniforms.set("uSize", gl.domElement.height * 0.012);

    shaftUniforms.set("uTime", clock.elapsedTime);
    shaftUniforms.set("uStrength", depth);

    // The shafts are a shell around the camera, so they are always where the
    // viewer is looking without needing to be placed in the world.
    if (shaftMesh.current) {
      shaftMesh.current.position.copy(camera.position);
    }

    // Swap the scene fog while submerged. Restored to the scene default when
    // the camera comes back up, so the aerial view is unaffected.
    if (submerged) {
      // Blue at the surface, green with depth. Water absorbs red first, so
      // this is the physically-motivated direction of the shift.
      scene.fog = underwaterFog(depth);
    } else if (scene.fog instanceof FogExp2 && scene.fog.density < 0.01) {
      scene.fog = surfaceFog();
    }
  });

  return (
    <group>
      {/* Light shafts: a camera-locked shell, faded in by depth. */}
      <mesh ref={shaftMesh} frustumCulled={false} renderOrder={6}>
        <sphereGeometry args={[26, 16, 12]} />
        <shaderMaterial
          side={BackSide}
          transparent
          depthWrite={false}
          uniforms={shaftUniforms.values}
          vertexShader={/* glsl */ `
            varying vec3 vLocal;
            void main() {
              vLocal = position;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={/* glsl */ `
            uniform float uTime;
            uniform float uStrength;
            uniform vec3 uColor;
            varying vec3 vLocal;

            float hash(vec2 p) {
              p = fract(p * vec2(127.1, 311.7));
              p += dot(p, p + 34.23);
              return fract(p.x * p.y);
            }
            float noise(vec2 p) {
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
              // Vertical shafts: noise sampled in the horizontal plane and
              // stretched hard in Y, which is what gives parallel beams rather
              // than blobs.
              vec2 q = vLocal.xz * 0.09;
              float beams = noise(q + vec2(uTime * 0.035, uTime * 0.02));
              beams = pow(beams, 2.6);
              // Brighter looking up, fading out with depth.
              float upFade = smoothstep(-0.85, 0.55, normalize(vLocal).y);
              float a = beams * upFade * uStrength * 0.30;
              if (a < 0.004) discard;
              gl_FragColor = vec4(uColor, a);
              #include <colorspace_fragment>
            }
          `}
        />
      </mesh>

      {/* Suspended matter. */}
      <points ref={particles} geometry={shafts} frustumCulled={false} renderOrder={5}>
        <shaderMaterial
          transparent
          depthWrite={false}
          uniforms={particleUniforms.values}
          vertexShader={/* glsl */ `
            uniform float uTime;
            uniform float uSize;
            attribute vec3 aSeed;
            varying float vFade;
            void main() {
              vec3 p = position;
              // Slow settling plus lateral wander, so the matter drifts rather
              // than hanging perfectly still.
              p.y += sin(uTime * 0.16 * aSeed.y + aSeed.x * 20.0) * 0.7;
              p.x += sin(uTime * 0.11 * aSeed.y + aSeed.x * 14.0) * 1.1;
              p.z += cos(uTime * 0.09 * aSeed.y + aSeed.x * 9.0) * 1.1;

              vec4 mv = modelViewMatrix * vec4(p, 1.0);
              gl_Position = projectionMatrix * mv;
              gl_PointSize = uSize * aSeed.z / max(-mv.z, 1.0);
              // Only visible when the camera is near them, so they do not
              // clutter the aerial view of the lake.
              vFade = 1.0 - smoothstep(30.0, 95.0, -mv.z);
            }
          `}
          fragmentShader={/* glsl */ `
            uniform vec3 uColor;
            varying float vFade;
            void main() {
              float d = length(gl_PointCoord - 0.5) * 2.0;
              if (d > 1.0) discard;
              gl_FragColor = vec4(uColor, pow(1.0 - d, 2.2) * 0.5 * vFade);
              #include <colorspace_fragment>
            }
          `}
        />
      </points>
    </group>
  );
}

/** Underwater fog, recreated per frame because its colour depends on depth. */
let _underwater: FogExp2 | null = null;
function underwaterFog(depth: number): FogExp2 {
  if (!_underwater) _underwater = new FogExp2(new Color("#2e6d78"), 0.16);
  // Blue near the surface, green as it gets deeper.
  const color = _underwater.color;
  color.setRGB(0.18 - depth * 0.09, 0.42 - depth * 0.05, 0.47 + depth * 0.06);
  // Visibility collapses quickly — real lake water is opaque within a few tens
  // of metres, and that short range is what gives the shot its claustrophobic
  // quality.
  _underwater.density = 0.075 + depth * 0.10;
  return _underwater;
}

/** The scene's normal aerial fog, used whenever the camera is above water. */
let _surface: FogExp2 | null = null;
function surfaceFog(): FogExp2 {
  if (!_surface) _surface = new FogExp2(new Color(FOG_COLOR), FOG_DENSITY);
  return _surface;
}
