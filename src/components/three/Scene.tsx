"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { CameraRig } from "./CameraRig";
import { Environment } from "./Environment";

/**
 * The fixed full-viewport WebGL layer.
 *
 * Rendered as a sibling of the tall scroll content (not inside it), so the
 * canvas never moves — the camera does. That is what makes this feel like a
 * scroll-driven camera rather than a scrolling image.
 *
 * `dpr={[1, 1.75]}` is deliberate: a full-screen WebGL canvas at dpr 2 is
 * 4x the fragment work for a difference nobody can see on a moving scene.
 */
export function Scene() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0">
      <Canvas
        dpr={[1, 1.75]}
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          // The scene is hazy by design, so tone mapping mostly affects
          // highlights. ACES keeps the sky from clipping to flat white.
          toneMappingExposure: 1.05,
        }}
        camera={{ fov: 46, near: 0.5, far: 900, position: [96, 74, 128] }}
      >
        <Suspense fallback={null}>
          <Environment />
        </Suspense>
        {/* Outside Suspense: the camera must never be paused, even while a
            model or texture is still streaming in. */}
        <CameraRig />
      </Canvas>
    </div>
  );
}
