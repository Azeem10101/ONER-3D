"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Vector3, type Points } from "three";
import { createRandom } from "@/scene/random";
import { WORLD } from "@/scene/world";
import { SUN_DIRECTION } from "@/scene/sun";
import { Uniforms } from "@/lib/uniforms";
import { FOG_COLOR } from "./Lighting";
import type { QualitySettings } from "@/scene/quality";

/**
 * THE SMOKE PLUME
 * ===============
 * The camera follows this from scroll 0.20 to 0.76, so it is the single most
 * important effect in the project. It was the weakest thing in the previous
 * version — 420 flat grey points on a linear path, which read exactly as
 * "grey transparent spheres" in a rigid column.
 *
 * ## What actually makes smoke look like smoke
 *
 * Four things, in order of importance:
 *
 * 1. LIGHTING. A lit puff is not a grey disc — it has a bright side and a dark
 *    side, and the boundary between them is soft because the medium is
 *    scattering. Each particle here derives a fake surface normal from its own
 *    radial offset and lights it against the sun, so puffs read as volumes.
 *    Without this, no amount of noise makes smoke look like anything but
 *    overlapping circles.
 *
 * 2. TURBULENCE. Real plumes are lumpy and chaotic, not conical. Two octaves
 *    of sin at different frequencies and phases, plus a slow rotation, give
 *    the column the irregular billowing that a straight radial path cannot.
 *
 * 3. EXPANSION AND DILUTION. A plume widens as it rises because it entrains
 *    surrounding air, and thins as a result. Size grows with age while opacity
 *    falls — that trade is what makes the top of the column look like it is
 *    dissipating rather than just stopping.
 *
 * 4. AERIAL PERSPECTIVE. Distant smoke is not darker or lighter, it is the
 *    colour of the air between you and it. Puffs blend toward the fog colour
 *    with height, which is what welds the plume to the sky instead of leaving
 *    it pasted on.
 *
 * ## All motion is computed in the vertex shader
 *
 * Per-particle seeds are static attributes; position is derived from uTime on
 * the GPU. The CPU touches nothing per frame. On integrated graphics that
 * matters — a few hundred particles updated in JS every frame is a measurable
 * slice of a 16ms budget spent on something the shader does for free.
 */

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uHeight;
  uniform float uSpread;
  uniform float uPixelScale;

  // Static per-particle attributes. Computed once, never touched again.
  attribute float aOffset;    // start phase, so the column is continuous
  attribute float aSpeed;     // rise rate
  attribute float aAngle;     // initial bearing
  attribute float aSpin;      // rotation rate
  attribute float aDrift;     // how far out this puff travels as it rises
  attribute float aSize;
  attribute float aSeed;

  varying float vLife;
  varying float vSeed;
  varying float vHeight01;

  void main() {
    // 0 at birth, 1 at death. fract() gives a seamless recycle, so the column
    // never pulses.
    float life = fract(uTime * aSpeed + aOffset);

    // Two octaves of lateral wander. A single sine reads as a corkscrew; the
    // beat between two frequencies is what reads as billowing.
    //
    // Rates are high because a plume is a fast, energetic thing. The previous
    // values (0.55 and 1.31 rad/s) combined with rise speeds of 0.019-0.037
    // meant a particle completed its journey in 30-50 seconds, so nothing
    // appeared to move.
    float wanderA = sin(uTime * 1.9 + aSeed * 6.283 + life * 9.0);
    float wanderB = sin(uTime * 4.3 + aSeed * 12.566 + life * 19.0);
    float wanderC = sin(uTime * 0.9 + aSeed * 3.1);
    float wander = wanderA * 0.5 + wanderB * 0.3 + wanderC * 0.2;

    // The plume widens as it entrains air.
    float radius = pow(life, 0.72) * uSpread * aDrift;
    float angle = aAngle + uTime * aSpin * 3.0 + wander * 0.9;

    // Lateral wander. Scaled against the layer's own spread so a wide layer
    // wanders proportionally further — an absolute offset that looked right on
    // a 20m core is invisible on a 74m outer layer.
    float wanderAmount = uSpread * 0.28;
    vec3 pos = vec3(
      cos(angle) * radius + wander * wanderAmount,
      life * uHeight,
      sin(angle) * radius + wanderA * wanderAmount * 0.7
    );

    // The whole column leans downwind, which is the cue that reads as "rising
    // and being carried" rather than "moving straight up".
    pos.x += life * life * uHeight * 0.16;
    pos.z += life * life * uHeight * 0.06;

    vLife = life;
    vSeed = aSeed;

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vHeight01 = clamp((world.y - 0.0) / (uHeight * 1.6), 0.0, 1.0);

    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;

    // Perspective-correct point size, growing with age as the puff expands.
    // Clamped hard, and the clamp was lowered from 260px in this revision.
    // A sprite large enough to cover a big fraction of the viewport is both a
    // fill-rate problem and a visual one: it flattens the region it covers into
    // a single uniform patch, which is precisely the featureless look the
    // plume is trying not to have.
    gl_PointSize = min(
      aSize * (0.32 + life * 1.5) * uPixelScale / max(-mvPosition.z, 1.0),
      150.0
    );
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSunDirectionView;
  uniform vec3 uSmokeDark;
  uniform vec3 uSmokeLit;
  uniform vec3 uFogColor;
  uniform float uOpacity;
  uniform float uExposure;

  varying float vLife;
  varying float vSeed;
  varying float vHeight01;

  void main() {
    // gl_PointCoord runs 0..1 across the point sprite. Centring it gives a
    // radial offset, which is everything below is built from.
    vec2 uv = gl_PointCoord - 0.5;

    // Per-particle rotation, so identical sprites do not read as a grid.
    float a = vSeed * 6.283 + vLife * 1.4;
    float c = cos(a);
    float s = sin(a);
    vec2 r = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);

    float d = length(r) * 2.0;
    if (d > 1.0) discard;

    // Soft falloff. A hard edge is what makes particles look like discs; a
    // gentle power curve is what makes them look like vapour. The slight
    // asymmetry (fuller on one side) mimics density variation within a puff.
    float density = pow(1.0 - d, 1.9);
    density *= 0.75 + 0.25 * cos(atan(r.y, r.x) * 3.0 + vSeed * 9.0);

    // PER-PARTICLE DENSITY. Load-bearing, and the reason the plume has any
    // structure at all.
    //
    // Every sprite was previously the same density, so several hundred of them
    // summed to a flat, fully saturated grey mass. A uniform mass has no
    // features, and a featureless mass reads as completely still no matter how
    // fast it is moving — which is exactly what was reported. Varying density
    // per particle produces billows: clumps of dense smoke with thinner gaps
    // between them, and those clumps are what the eye tracks as they rise and
    // shear apart.
    float weight = 0.18 + 0.82 * fract(vSeed * 43.758);
    // A second, coarser weight so the variation is clumpy rather than merely
    // per-puff random. Real plumes have coherent dense and thin regions.
    weight *= 0.45 + 0.55 * fract(vSeed * 7.113 + 0.5);
    density *= weight;

    // FAKE VOLUMETRIC LIGHTING.
    //
    // Treat the sprite as if it were a sphere: the surface normal at this
    // point is the radial offset, tilted back along the view axis so the puff
    // is lit from the side rather than flat-on. This one step is the
    // difference between smoke and a grey circle.
    vec3 normal = normalize(vec3(r * 1.35, 0.62));
    float ndl = dot(normal, normalize(uSunDirectionView));

    // Wrapped diffuse. Smoke is a dense scattering medium, so the terminator
    // is soft and the dark side is not black.
    float lightTerm = clamp(ndl * 0.5 + 0.5, 0.0, 1.0);
    lightTerm = pow(lightTerm, 1.35);

    // Forward scattering: a puff between you and the sun glows at the edges.
    // This is what real smoke does and it is cheap.
    float rim = pow(1.0 - abs(dot(normalize(vec3(r, 1.0)), vec3(0.0, 0.0, 1.0))), 2.0);
    lightTerm += rim * 0.28 * max(-ndl, 0.0);

    vec3 color = mix(uSmokeDark, uSmokeLit, lightTerm);

    // Aerial perspective. High puffs are mostly the air between camera and
    // smoke, which is what welds the plume into the sky.
    color = mix(color, uFogColor, smoothstep(0.15, 1.0, vHeight01) * 0.72);

    // Opacity, and the budget that goes with it.
    //
    // The fade curve is not just a birth/death envelope any more: the
    // dilution term makes the base of the column meaningfully denser than the
    // top, which is both what real smoke does and what stops the plume reading
    // as a uniform tube.
    float fade = smoothstep(0.0, 0.06, vLife) * (1.0 - smoothstep(0.22, 0.95, vLife));
    fade *= 1.0 - vLife * 0.45;

    float alpha = density * fade * uOpacity;

    gl_FragColor = vec4(color * uExposure, alpha);
    #include <colorspace_fragment>
  }
`;

type LayerConfig = {
  count: number;
  size: [number, number];
  opacity: number;
  spread: number;
  /** Height as a fraction of the plume. */
  height: number;
  speed: [number, number];
  /** Additive layers glow; normal blending is correct for opaque-ish smoke. */
  blending: typeof AdditiveBlending | undefined;
};

export function Plume({ quality }: { quality: QualitySettings }) {
  // Three layers, and the opacity numbers are a BUDGET, not a taste setting.
  //
  // Several hundred sprites overlap along any view ray through the column, so
  // accumulated alpha is 1 - Π(1 - αᵢ). Once that product saturates, the plume
  // is a solid grey mass — and a solid mass has no internal features, so it
  // reads as completely static no matter how fast the particles are travelling.
  // That is the bug the previous two rounds missed: raising the rise speed
  // could not help, because there was nothing in the image for the speed to
  // show up in.
  //
  // These values are set so the densest clumps land around 0.75-0.9 and the
  // thinner regions around 0.3, which is where structure becomes visible.
  const layers = useMemo<LayerConfig[]>(
    () => [
      {
        // Core: tight, dark, and relatively fast. This is the column.
        count: quality.tier === "low" ? 240 : quality.tier === "medium" ? 460 : 780,
        size: [10, 24],
        opacity: 0.26,
        spread: 20,
        height: WORLD.plumeHeight,
        speed: [0.045, 0.09],
        blending: undefined,
      },
      {
        // Mid: the main body of the plume, and where most of the visible
        // motion comes from.
        count: quality.tier === "low" ? 200 : quality.tier === "medium" ? 400 : 680,
        size: [20, 46],
        opacity: 0.15,
        spread: 40,
        height: WORLD.plumeHeight * 0.9,
        speed: [0.03, 0.062],
        blending: undefined,
      },
      {
        // Outer: thin, wide, slow. Legible as motion only because there are
        // many of them and they are small — which is the point.
        count: quality.tier === "low" ? 120 : quality.tier === "medium" ? 240 : 400,
        size: [42, 92],
        opacity: 0.065,
        spread: 74,
        height: WORLD.plumeHeight * 1.15,
        speed: [0.02, 0.042],
        blending: undefined,
      },
    ],
    [quality.tier]
  );

  const sunDirection = useMemo(
    () => new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z).normalize(),
    []
  );

  return (
    // Positioned at the stack mouth in WORLD space, not the local value the
    // factory is authored against — the factory group is offset onto the pad,
    // so the world stack mouth is higher than the local one.
    <group position={WORLD.chimneyTopWorld}>
      {layers.map((layer, layerIndex) => (
        <PlumeLayer key={layerIndex} layer={layer} sunDirection={sunDirection} />
      ))}
    </group>
  );
}

function PlumeLayer({ layer, sunDirection }: { layer: LayerConfig; sunDirection: Vector3 }) {
  const points = useRef<Points>(null);
  const material = useRef<import("three").ShaderMaterial>(null);

  const geometry = useMemo(() => {
    const random = createRandom(77321 + layerIndexSeed(layer));
    const count = layer.count;

    // Positions are unused — the vertex shader derives world position from the
    // attributes below — but three.js still requires the attribute to exist.
    const positions = new Float32Array(count * 3);
    const aOffset = new Float32Array(count);
    const aSpeed = new Float32Array(count);
    const aAngle = new Float32Array(count);
    const aSpin = new Float32Array(count);
    const aDrift = new Float32Array(count);
    const aSize = new Float32Array(count);
    const aSeed = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      aOffset[i] = random();
      aSpeed[i] = layer.speed[0] + random() * (layer.speed[1] - layer.speed[0]);
      aAngle[i] = random() * Math.PI * 2;
      // More spin than before, so particles visibly orbit as they rise rather
      // than translating in a straight line.
      aSpin[i] = (random() - 0.5) * 1.4;
      // Dispersion, and deliberately WIDE.
      //
      // A narrow range (it was 0.45-1.55) puts every particle at a similar
      // radius for a given age, so the column comes out as a smooth cone with
      // a clean edge — a shape, not a billow. Spanning 0.15-2.2 puts a dense
      // population near the axis and a thin scatter far outside it, which is
      // what gives the plume a ragged, irregular envelope.
      aDrift[i] = 0.15 + Math.pow(random(), 1.6) * 2.05;
      aSize[i] = layer.size[0] + random() * (layer.size[1] - layer.size[0]);
      aSeed[i] = random();
    }

    const geo = new BufferGeometry();
    // A bounding sphere large enough to never cull the plume. Frustum culling
    // on a 300m column that the camera flies through is a liability, not an
    // optimisation.
    geo.boundingSphere = null;
    geo.setAttribute("position", new BufferAttribute(positions, 3));
    geo.setAttribute("aOffset", new BufferAttribute(aOffset, 1));
    geo.setAttribute("aSpeed", new BufferAttribute(aSpeed, 1));
    geo.setAttribute("aAngle", new BufferAttribute(aAngle, 1));
    geo.setAttribute("aSpin", new BufferAttribute(aSpin, 1));
    geo.setAttribute("aDrift", new BufferAttribute(aDrift, 1));
    geo.setAttribute("aSize", new BufferAttribute(aSize, 1));
    geo.setAttribute("aSeed", new BufferAttribute(aSeed, 1));
    return geo;
  }, [layer]);

  const uniforms = useMemo(
    () =>
      new Uniforms({
        uTime: { value: 0 },
        uHeight: { value: layer.height },
        uSpread: { value: layer.spread },
        // Converts world size to pixels. Recomputed each frame from the real
        // drawing-buffer height, so the smoke keeps its apparent size when the
        // adaptive scaler changes render scale.
        uPixelScale: { value: 900 },
        uSunDirectionView: { value: new Vector3().copy(sunDirection) },
        uSmokeDark: { value: new Color("#2f2a24") },
        uSmokeLit: { value: new Color("#ded5c4") },
        uFogColor: { value: new Color(FOG_COLOR) },
        uOpacity: { value: layer.opacity },
        uExposure: { value: 1.0 },
      }),
    [layer, sunDirection]
  );

  useFrame(({ clock, gl, camera }) => {
    uniforms.set("uTime", clock.elapsedTime);
    uniforms.set("uPixelScale", gl.domElement.height * 0.55);
    // The sun direction has to be in VIEW space for the sprite-space normal to
    // line up with the light — a world-space vector would light the smoke from
    // the wrong angle as the camera orbits the plume, which it does for the
    // entire pullback beat.
    (uniforms.get("uSunDirectionView") as Vector3).copy(sunDirection).transformDirection(camera.matrixWorldInverse);
  });

  return (
    <points ref={points} geometry={geometry} frustumCulled={false} renderOrder={4}>
      <shaderMaterial
        ref={material}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms.values}
        transparent
        depthWrite={false}
        depthTest
        blending={layer.blending}
      />
    </points>
  );
}

/** Stable per-layer seed so the two layers never share a particle pattern. */
function layerIndexSeed(layer: LayerConfig) {
  return Math.round(layer.opacity * 1000);
}
