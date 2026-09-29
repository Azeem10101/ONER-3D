"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { AdaptiveQuality, useQuality } from "./QualityGate";
import { CameraRig } from "./CameraRig";
import { SkyDome } from "./Sky";
import { Lighting, FOG_COLOR } from "./Lighting";
import { EXPOSURE } from "@/scene/tone";
import { FogController } from "./FogController";
import { Environment } from "./Environment";
import { StatsReader } from "@/components/dev/statsBus";
import { ACESFilmicToneMapping, PCFSoftShadowMap } from "three";

/**
 * The scene contents. Split from <Scene> because everything here needs the
 * quality context, which only exists once GPU detection has run.
 */
function SceneContents() {
  const { settings } = useQuality();

  return (
    <>
      {/*
        Sky first. The fog colour is this model's horizon colour, so the
        atmosphere has to be established before anything else is lit.

        fogExp2 rather than fog: exponential-squared falloff matches how haze
        actually accumulates along a sight line, and never produces the hard
        "wall of fog" edge that linear fog shows near its far plane.
      */}
      {/*
        NOT `<fogExp2 attach="fog">`.

        <FogController> owns a single FogExp2 for the lifetime of the page and
        writes into it every frame, so it can blend between aerial haze and
        underwater murk continuously as the camera crosses the waterline. A JSX
        fog element cannot do that: it constructs its own instance from
        constructor args and nothing can reach in to change it afterwards.

        The previous arrangement — a fogExp2 element plus a component that
        reassigned `scene.fog` on the way in and out of the lake — was the cause
        of the jungle staying blue-green for the whole reverse journey.
      */}
      <FogController />

      <SkyDome />
      <Lighting quality={settings} />

      <Environment quality={settings} />

      {/*
        Outside Suspense: the camera must never be paused, even while a shader
        is still compiling.
      */}
      <CameraRig />
      <AdaptiveQuality />
      <StatsReader />
    </>
  );
}

function Fallback() {
  // Matches the sky's horizon so there is no flash before the first real frame.
  // Darker than the fog colour this used to mirror — distance fog is gone, and
  // a light background here shows as a white frame edge on slow first paint.
  return <color attach="background" args={[FOG_COLOR]} />;
}

/**
 * The fixed full-viewport WebGL layer.
 *
 * Rendered as a sibling of the tall scroll content, not inside it, so the
 * canvas never moves — the camera does. That is what makes this read as a
 * scroll-driven camera rather than a scrolling image.
 */
export function Scene() {
  const { settings } = useQuality();

  return (
    <div className="pointer-events-none fixed inset-0 z-0">
      <Canvas
        dpr={[1, settings.maxPixelRatio]}
        shadows={settings.shadowMapSize > 0 ? { type: PCFSoftShadowMap } : false}
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          // ACES rather than the default. The default clips the sun and the
          // bright end of the sky to flat white, which is exactly where this
          // scene spends most of its dynamic range.
          //
          // ACES is not sufficient on its own. A Preetham sky with the sun at
          // 11 degrees produces a radiance high enough to sit on the shoulder
          // of this curve, and anything on the shoulder has already lost its
          // hue. The exposure therefore has to come DOWN as well, and it lives
          // in scene/tone.ts so check-sky.ts can read it and assert the sky is
          // neither clipped nor desaturated.
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: EXPOSURE,
        }}
        // Near plane at 1.0: depth precision is non-linear, so a closer near
        // plane wastes precision on a scene viewed from hundreds of metres.
        // Far plane at 40km so the 6km mountain ring is not clipped.
        camera={{ fov: 48, near: 1, far: 40000, position: [-880, 620, 1520] }}
      >
        <Suspense fallback={<Fallback />}>
          <SceneContents />
        </Suspense>
      </Canvas>
    </div>
  );
}
