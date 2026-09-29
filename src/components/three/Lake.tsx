"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, Color, Vector3, BackSide, type Mesh, type Points } from "three";
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
 *
 * ## Why the water read as static, and what actually fixed it
 *
 * Three separate causes, found in order, because fixing any one of them alone
 * changed nothing visible. This is worth writing down, since the obvious
 * diagnosis — "the waves are too small" — was wrong twice.
 *
 * 1. ALPHA SATURATION, in the plume, not here. Worth mentioning because it is
 *    the same failure mode: hundreds of overlapping semi-transparent sprites
 *    summed to a flat mass, and a flat mass cannot show motion.
 *
 * 2. FRESNEL CANNOT CARRY MOTION. This is the non-obvious one. The obvious
 *    term for "how reflective is this water" is Schlick fresnel on the view
 *    angle — and looking down at a lake, that angle sits near 0.95 no matter
 *    how the surface tilts. So fresnel was a near-constant 0.10 and the
 *    reflection never changed, however violently the waves moved. Raising the
 *    wave amplitudes could only make the normals swing more, which changes
 *    nothing when the output term is insensitive to them. The fix was to
 *    sample a sky gradient along the REFLECTED VECTOR, which swings 20 degrees
 *    for every 10 degrees of normal tilt and is therefore very sensitive to
 *    exactly the motion we want to see.
 *
 * 3. TWO INDEPENDENT POLLUTION DRIVERS. The surface accumulated contamination
 *    from elapsed time while the fish used scroll progress, so the two could
 *    disagree completely — fish swimming happily under an ochre surface. Both
 *    now read `pollutionAt()`.
 *
 * ## Amplitude and wavelength are one decision
 *
 * The temptation with "the water is not moving" is to raise the wave
 * amplitudes. That is backwards. The normal comes from the gradient, so what
 * the eye sees is amplitude TIMES frequency, and a large amplitude at a short
 * wavelength produces a normal that swings tens of degrees between adjacent
 * pixels. That is aliased noise — visual grit that reads as a dirty lens, not
 * as motion, because there is no coherent shape to follow.
 *
 * So the two are coupled deliberately: long wavelengths carry large amplitude
 * (gentle slopes, clearly readable shapes) and short wavelengths carry small
 * amplitude (fine texture only). See `waves()`.
 */

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uSwell;

  varying vec3 vWorld;
  varying vec2 vSurfaceUv;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);

    // A long, low swell, evaluated on WORLD XZ.
    //
    // This is the same long-wavelength band the fragment shader uses for the
    // swell, deliberately in step with it: the vertex pass displaces the
    // geometry and the fragment pass shades the normal, and if the two
    // disagreed the surface would visibly tear. It matters much more than it
    // used to because the lake is now a subdivided radial grid rather than a
    // two-triangle disc, so this displacement actually has somewhere to go.
    vec2 p = world.xz;
    world.y += (sin(p.x * 0.105 + p.y * 0.048 + uTime * 0.62) * 0.42
              + sin(p.x * 0.061 - p.y * 0.089 - uTime * 0.44) * 0.30) * uSwell;

    vWorld = world.xyz;
    vSurfaceUv = p;

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
  uniform vec3  uSkyHorizon;
  uniform vec3  uSkyZenith;
  uniform vec3  uSunColor;
  uniform vec3  uContaminant;
  uniform vec3  uFoamColor;
  uniform vec3  uFogColor;
  uniform float uFogDensity;
  uniform float uContamination;  // 0..1, a pure function of scroll progress
  uniform float uClarity;        // 1 = clean, falls as contamination rises
  uniform float uRadius;
  /**
   * 0 above the surface, 1 when the camera is well under it.
   *
   * Drives the from-below terms at the end of the shader. Driven by the
   * camera's actual altitude rather than by scroll progress, because being
   * underwater is a property of where the camera is — tying it to the timeline
   * would allow a dry view from below, which is worse than having no
   * underwater treatment at all.
   */
  uniform float uUnderwater;

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

  // Three octaves, output roughly in [0, 0.875].
  //
  // The call count here matters more than it looks: waves() is evaluated FIVE
  // times per fragment for the central-difference normal, so every octave
  // added to this function costs five evaluations across the whole surface.
  // The lake covers most of the frame for the entire final act, so this is the
  // single most expensive shader in the project. Three octaves is the measured
  // compromise — a fourth is visible in the swell's silhouette but not worth
  // the frame time.
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
  // ## Why the amplitude/wavelength ratio matters more than the amplitude
  //
  // What the eye reads as "moving water" is the normal swinging as the surface
  // undulates, and the normal comes from the gradient dh/dx — which is
  // amplitude times frequency. An earlier revision raised the amplitudes 5x on
  // the theory that a flatter-looking surface was the problem. That made it
  // worse, and the reason is instructive: a large amplitude at a SHORT
  // wavelength gives a gradient so steep that the normal swings through tens of
  // degrees between adjacent pixels. That is not water, it is aliased noise —
  // a field of per-pixel static that reads as visual grit, not as motion,
  // because there is no coherent shape for the eye to follow.
  //
  // So the two are now deliberately coupled. Long wavelengths carry large
  // amplitude (gentle slopes, clearly readable shapes) and short wavelengths
  // carry small amplitude (fine texture). Slope stays in a believable range.
  //
  // ## Why there are exactly two bands
  //
  // Each band exists for a different viewing distance. The swell is ~15-30m
  // across and is what makes the lake read as moving from 300m up, where the
  // camera spends the entire approach. The chop is 2-5m and only resolves once
  // the camera is close, which is the underwater sequence. Wavelengths between
  // those two bands are what produce fizz rather than either.
  float waves(vec2 p, float t) {
    float h = 0.0;

    // --- Swell: long wavelength, the dominant read from altitude ---------
    // 2pi/0.105 = 60m wavelength. Slope contribution ~0.11.
    h += sin(p.x * 0.105 + p.y * 0.048 + t * 0.62) * 0.42;
    h += sin(p.x * 0.061 - p.y * 0.089 - t * 0.44) * 0.30;
    // Broad noise swell, so the two sine trains do not read as a regular
    // interference pattern. Slope contribution ~0.10.
    h += (fbm(p * 0.026 + vec2(t * 0.048, -t * 0.031)) - 0.5) * 1.30;

    // --- Chop: short wavelength, small amplitude, fast -------------------
    // ~4-8m wavelength. Slope contribution ~0.04 — an eighth of the swell's.
    // Kept deliberately small; this is texture, not shape.
    h += sin(p.x * 0.88 + p.y * 0.41 + t * 2.30) * 0.075;
    h += (fbm(p * 0.30 - vec2(t * 0.26, t * 0.19)) - 0.5) * 0.16;
    return h;
  }

  void main() {
    vec2 p = vSurfaceUv;
    vec3 viewVec = cameraPosition - vWorld;
    vec3 viewDir = normalize(viewVec);

    // --- Surface normal from the wave gradient ---------------------------
    // Central differences, not forward differences.
    //
    // Forward differences are cheaper (two extra samples instead of four) but
    // they systematically bias the slope by half an epsilon, and on a field
    // that is mostly low-frequency the bias is not evenly distributed — it
    // varies with the phase, which shows up as a slow shimmer in the
    // reflection even when the water is genuinely still. Four samples on a
    // 95m lake is a rounding error against the fill cost of the whole surface.
    //
    // Epsilon is 0.5m: comfortably smaller than the shortest wavelength in the
    // field (2pi/0.88 = 7m) so the chop resolves instead of aliasing, and
    // comfortably larger than a float's useful precision at 95m.
    float e = 0.5;
    float hC = waves(p, uTime);
    float hX = (waves(p + vec2(e, 0.0), uTime) - waves(p - vec2(e, 0.0), uTime)) / (2.0 * e);
    float hZ = (waves(p + vec2(0.0, e), uTime) - waves(p - vec2(0.0, e), uTime)) / (2.0 * e);
    vec3 normal = normalize(vec3(-hX, 1.0, -hZ));

    // --- Fresnel ---------------------------------------------------------
    float ndv = max(dot(normal, viewDir), 0.0);
    // Schlick with F0 floored at 0.22 rather than the physical 0.02.
    //
    // This floor is a fudge, and worth being honest about. Strict Schlick at
    // this viewing angle gives ~0.02, which is physically right and visually
    // useless: a lake reflecting 2% of the sky from above looks like a sheet of
    // coloured glass, not like water.
    //
    // Real water is not a smooth dielectric. Surface roughness, sub-pixel
    // capillary waves and a slightly turbid body all scatter far more than a
    // smooth Fresnel term predicts, and 0.22 is within the range real lakes
    // show at moderate viewing angles. The previous 0.10 was halfway to
    // nowhere — defensible, but not enough to read as a reflective surface.
    float fresnel = 0.22 + 0.78 * pow(1.0 - ndv, 4.0);

    // --- Depth: shallower near the shore ---------------------------------
    // Shoreline distance uses the lake centre, passed in as a uniform rather
    // than hard-coded. The old value (-300, 190) was the previous lake's
    // position and would have made the entire depth term meaningless.
    float shoreT = smoothstep(uRadius * 1.05, uRadius * 0.6, length(p - uLakeCentre));
    vec3 bodyColor = mix(uShallowColor, uDeepColor, shoreT);

    // Light reaching the bed and bouncing back up, which is what makes shallow
    // water look shallow.
    //
    // This is a second, independent reason the surface is never flat blue: the
    // body colour now varies with distance from the shore on top of the
    // reflection, so the lake has an internal gradient rather than one uniform
    // tone. Without it, the clean water read as a single sheet of colour with a
    // reflection painted on it.
    vec3 bedColour = uShallowColor * (0.55 + 0.45 * shoreT);
    bodyColor = mix(bodyColor, bodyColor * 0.72 + bedColour * 0.28, 0.6);

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

    // --- Surface normal is damped where the water is contaminated ----------
    // Silt and surfactant damp capillary waves. The visible consequence is that
    // the polluted area reflects more smoothly than the clean water around it,
    // which is a real and very recognisable effect.
    //
    // Held to 0.34 rather than the 0.62 it used to be. That value was actively
    // hiding the motion: a fully contaminated lake had its normal almost
    // entirely flattened toward straight-up, which is exactly the state in
    // which this surface has nothing to show. Polluted water still has a swell.
    normal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), contam * 0.34));

    // --- Reflected direction ---------------------------------------------
    // THIS IS THE TERM THAT MAKES WATER LOOK ALIVE, and it is the one that was
    // missing.
    //
    // Fresnel on its own cannot carry the motion. Looking down at a lake, ndv
    // sits near 0.95 however the surface tilts, so a Schlick term evaluated on
    // ndv is a near-constant 0.10 and the reflection barely changes. That is
    // the real reason the water read as static, and no amount of amplitude
    // tuning fixes it.
    //
    // The reflected VECTOR, though, swings enormously: a normal tilted by 10
    // degrees swings the reflected ray by 20 degrees, which samples a
    // completely different part of the sky. Sampling a sky gradient along that
    // direction converts wave motion directly into visible changes in
    // reflected colour.
    //
    // Computed here, AFTER the contamination damping, so a polluted patch
    // genuinely reflects a smoother, flatter sky than the clean water beside
    // it rather than merely being tinted over.
    vec3 reflected = reflect(-viewDir, normal);
    float upness = clamp(reflected.y, 0.0, 1.0);
    // Warm hazy horizon into deeper blue overhead, matching the analytic sky in
    // Sky.tsx so the water reflects the sky that is actually there.
    vec3 skyRefl = mix(uSkyHorizon, uSkyZenith, pow(upness, 0.55));

    // The sun's glitter path. Two broad lobes rather than one tight one,
    // because the track of light on water is an extended smear, not a point —
    // and a tight lobe breaks into isolated aliasing sparkles at any distance.
    float sunPath = max(dot(reflected, uSunDirection), 0.0);
    skyRefl += uSunColor * pow(sunPath, 26.0) * 0.55;
    skyRefl += uSunColor * pow(sunPath, 5.0) * 0.16;

    // --- Composite --------------------------------------------------------
    vec3 color = mix(bodyColor, uContaminant, contam * 0.94);

    // The sky, reflected along the actual bounce direction, weighted by
    // fresnel and scaled by clarity: contaminated water is turbid, so it stops
    // behaving like a mirror well before its colour has fully changed. Seeing
    // the reflection die before the colour arrives is what makes the pollution
    // read as a process rather than a switch.
    color = mix(color, skyRefl, fresnel * 0.95 * uClarity);

    // --- Travelling wave crests -------------------------------------------
    // The most legible single cue that a surface is moving, and unlike fresnel
    // it does not care about the viewing angle, so it works from directly
    // overhead as well as from underwater.
    //
    // Derived from the height field itself, so a crest is by construction on a
    // wave rather than painted on. The weight is higher than it looks like it
    // should be because at this viewing distance the crests are the only
    // high-frequency detail that survives — without them the surface is a smooth
    // gradient of one colour, which is what "the water isn't visible" looks
    // like even when the water is technically there.
    float crest = smoothstep(0.22, 0.58, hC) * uClarity;
    color += mix(vec3(0.62, 0.76, 0.80), uFoamColor, 0.4) * crest * 0.30;

    // Shadowed troughs, for the same reason: a wave is as legible by its dark
    // side as by its lit one.
    color *= 1.0 - smoothstep(-0.20, -0.54, hC) * 0.26;

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
    // (FOG_DENSITY squared), so the water recedes at exactly the rate the terrain
    // and the forest do. A mismatched density between the water and everything
    // else is immediately visible as the lake not belonging to the scene.
    float dist = length(viewVec);
    float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    color = mix(color, uFogColor, clamp(fogF, 0.0, 1.0));

    // --- Seen from BELOW --------------------------------------------------
    //
    // The camera spends the last 10% of the journey inside the lake, looking up
    // at the underside of this surface — and until now it saw the back of an
    // opaque plane, because the material is single-sided by default and the
    // shader shades it identically either way.
    //
    // Total internal reflection is what a submerged viewer actually gets: past
    // a critical angle the surface becomes a mirror of the lake floor, and
    // within it the sky above is visible as a bright disc (Snell's window). Both
    // are cheap here and together they are most of what makes an underwater
    // shot read as underwater rather than as a blue room.
    if (uUnderwater > 0.001) {
      // Grazing angles from below reflect almost everything.
      float below = max(-dot(normal, viewDir), 0.0);
      float tir = smoothstep(0.35, 0.92, below);
      // The floor colour, approximated from the deep water tone. Real
      // total internal reflection shows the bed, which is silt-dark.
      vec3 mirrored = mix(uDeepColor, uContaminant, contam * 0.8) * 0.85;
      color = mix(color, mirrored, tir * uUnderwater * 0.9);

      // Snell's window: the cone of sky visible from below, opening to a
      // half-angle of about 48.6 degrees.
      float window = smoothstep(0.62, 0.90, below);
      color = mix(color, uSkyZenith * 1.25, window * uUnderwater * 0.75);
    }

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

  /**
   * A radial grid for the surface, replacing `circleGeometry`.
   *
   * `CircleGeometry` is a centre vertex plus a rim: 160 triangles with no
   * interior subdivision whatsoever. The vertex-shader swell could only tilt
   * the whole disc between two points, and the second the camera crossed the
   * surface there was no geometry at all for the waves to live in — the
   * underwater shots were looking at a flat polygon.
   *
   * Rings are distributed with a square root so they bunch up near the middle,
   * which is where the camera spends the entire final act. The result is a
   * disc in the XZ plane, wound so that it faces +Y after the mesh's -90 degree
   * X rotation, with the rim on the last ring.
   */
  const geometry = useMemo(() => {
    const rings = 64;
    const segments = 128;
    const positions = new Float32Array((rings + 1) * (segments + 1) * 3);
    const indices = new Uint32Array(rings * segments * 6);

    let vertex = 0;
    for (let ring = 0; ring <= rings; ring++) {
      // sqrt spacing: near-uniform area coverage, so the tessellation is dense
      // where the camera is rather than where the geometry is largest.
      const t = ring / rings;
      const radius = WORLD.lakeRadius * Math.sqrt(t);
      for (let segment = 0; segment <= segments; segment++) {
        const angle = (segment / segments) * Math.PI * 2;
        positions[vertex * 3] = Math.cos(angle) * radius;
        positions[vertex * 3 + 1] = 0;
        positions[vertex * 3 + 2] = Math.sin(angle) * radius;
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
        // Wound so the visible face points along +Y.
        indices[index++] = a;
        indices[index++] = b;
        indices[index++] = c;
        indices[index++] = b;
        indices[index++] = d;
        indices[index++] = c;
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(positions, 3));
    geo.setIndex(new BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }, []);

  const uniforms = useMemo(
    () =>
      new Uniforms({
        uTime: { value: 0 },
        // The swell displacement in the vertex shader. Was 0.28m, which is
        // under a third of a metre on a 190m lake — invisible even in the
        // close shots. Now within the range a real lake of this size would
        // show in wind.
        uSwell: { value: 0.75 },
        uSource: { value: [OUTFALL[0], OUTFALL[1]] },
        uLakeCentre: { value: [WORLD.lakeCentre[0], WORLD.lakeCentre[2]] },
        uSunDirection: { value: new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z).normalize() },
        // Vibrant tropical water. The previous values (#0b1a1c / #1d3030) were
        // so dark that the body colour was nearly black and the lake read as a
        // void with a reflection on it rather than as water.
        uDeepColor: { value: new Color("#0e3d4a") },
        uShallowColor: { value: new Color("#2a9aa0") },
        // The two ends of the sky gradient the water reflects. Sampled along
        // the reflected ray rather than picked from a single fog colour, which
        // is what gives the reflection somewhere to go as the waves move.
        uSkyHorizon: { value: new Color("#b6b2a6") },
        uSkyZenith: { value: new Color("#5b83a8") },
        uSunColor: { value: new Color(1.0, 0.86, 0.66) },
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
        // so the lake loses its mirror quality as the plume arrives.
        uClarity: { value: 1 },
        // Driven from the camera's altitude in the frame loop below.
        uUnderwater: { value: 0 },
        // Nearly the full lake radius. On a 95m lake a smaller plume read as
        // a small dirty patch rather than as a body of water being spoiled.
        uRadius: { value: WORLD.lakeRadius * 0.92 },
      }),
    []
  );

  useFrame(({ clock, camera }) => {
    uniforms.set("uTime", clock.elapsedTime);

    // How submerged the camera is, 0 at the surface and 1 by 4m down. Sampled
    // over a short depth rather than switched at y=0 so the surface does not
    // pop as the camera crosses it — the crossing is a deliberate beat of the
    // final act and it needs to look like an event, not a discontinuity.
    uniforms.set("uUnderwater", Math.min(1, Math.max(0, -camera.position.y) / 4));

    // ONE pollution driver, shared with the fish, the discharge and the
    // sediment.
    //
    // This used to accumulate from mount time — `progress += delta * 0.012`,
    // saturating after 83 seconds — combined with a camera-proximity term. That
    // was wrong in three separate ways, and all three were visible:
    //
    //   1. It fought the brief. The water was supposed to be CLEAR at the
    //      start, but this made it progressively filthier just for having the
    //      tab open, so the lake was already half-spoiled in the opening
    //      bird's-eye and fully brown before the camera ever arrived.
    //   2. It disagreed with the fish. `pollutionAt()` in Life.tsx is a pure
    //      function of scroll progress, so fish were swimming happily in water
    //      that the surface shader was rendering as ochre.
    //   3. It never recovered. Accumulated state cannot be un-accumulated, so
    //      scrolling back up left the lake still foul and the fish dead.
    //
    // `pollutionAt` is a pure function of scroll, so all three resolve at once,
    // and the four systems are guaranteed to agree because they are literally
    // reading the same number.
    const contamination = pollutionAt(scrollStore.smoothed);
    uniforms.set("uContamination", contamination);
    // Reflection strength drops as the water gets contaminated, so the lake
    // visibly loses its mirror quality as the plume arrives. Dielectric
    // properties really do change — and it is a strong secondary cue that
    // something physical is in the water.
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
        {/*
          The radial grid built above, not `circleGeometry`.

          `CircleGeometry` is a centre vertex plus a rim — 160 triangles with no
          interior subdivision at all. The vertex-shader swell could therefore
          only tilt the disc between two points, and the moment the camera went
          under the surface there was no geometry for the waves to live in. The
          rings are sqrt-spaced so the subdivision is dense where the camera
          actually is, at the middle of the lake.
        */}
        <primitive object={geometry} attach="geometry" />
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

  useFrame(({ clock, camera, gl }) => {
    // Submersion, ramped over 4m rather than switched at y = 0. Matches the
    // ramp in <FogController> so the shafts, the particulate and the fog all
    // arrive together instead of in sequence.
    const depth = Math.min(1, Math.max(0, -camera.position.y) / 4);

    particleUniforms.set("uTime", clock.elapsedTime);
    particleUniforms.set("uSize", gl.domElement.height * 0.012);

    shaftUniforms.set("uTime", clock.elapsedTime);
    shaftUniforms.set("uStrength", depth);

    // The shafts are a shell around the camera, so they are always where the
    // viewer is looking without needing to be placed in the world.
    if (shaftMesh.current) {
      shaftMesh.current.position.copy(camera.position);
    }

    // NOTE: the scene fog is NOT touched here.
    //
    // It used to be, and it was the cause of a bug that survived the entire
    // reverse journey: scrolling back up out of the lake left the jungle
    // blue-green all the way to the bird's-eye. The restore condition was
    // inverted (it only fired when density < 0.01, but the underwater fog sits
    // at 0.075-0.175, so it never fired at all), and the "restore" allocated a
    // new object rather than mutating the existing one, leaving stale
    // references behind in the tree material.
    //
    // <FogController> now owns a single FogExp2 and writes into it every frame.
    // See the comment there for the full account.
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

// The scene's fog is owned by <FogController> and is never swapped from here.
// This file used to define both an underwater fog and a surface fog and install
// them into `scene.fog` on the way in and out of the water; that swap is what
// left the jungle looking submerged for the rest of the reverse journey.
