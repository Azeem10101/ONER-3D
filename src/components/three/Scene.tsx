"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { AdaptiveQuality, useQuality } from "./QualityGate";
import { CameraRig } from "./CameraRig";
import { SkyDome } from "./Sky";
import { Lighting, FOG_COLOR, FOG_DENSITY } from "./Lighting";
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
      <fogExp2 attach="fog" args={[FOG_COLOR, FOG_DENSITY]} />

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
  return <color attach="background" args={["#9ea7ad"]} />;
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
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
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
