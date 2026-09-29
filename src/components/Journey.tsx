"use client";

import dynamic from "next/dynamic";
import { QualityProvider } from "./three/QualityGate";
import { ScrollProvider } from "./scroll/ScrollProvider";
import { Overlays } from "./overlays/Overlays";
import { Diagnostics } from "./dev/Diagnostics";

/**
 * The WebGL layer is loaded client-side only, for two reasons:
 *
 *   1. Three.js touches `window` at module scope, and GPU detection calls
 *      `getContext("webgl")`, so importing any of this during SSR throws.
 *      `ssr: false` is the supported opt-out in the App Router — and per the
 *      Next.js docs it only works inside a Client Component, which is why this
 *      file has "use client" at the top.
 *
 *   2. Deferring it means the scroll column and the opening title are painted
 *      by the server first. The viewer sees text immediately while the WebGL
 *      bundle is still arriving, instead of a black rectangle.
 */
const Scene = dynamic(() => import("./three/Scene").then((mod) => mod.Scene), {
  ssr: false,
  loading: () => <div className="fixed inset-0 z-0 bg-[#9ea7ad]" aria-hidden />,
});

/**
 * The whole experience: one fixed 3D scene, one tall scroll column, one rAF
 * loop driving the overlays, and one render loop driving the camera.
 *
 * <QualityProvider> wraps everything and renders nothing until GPU detection
 * completes, which is why <Scene> sits inside it — the scene needs the
 * resolved tier to size its render targets correctly on first mount.
 */
export function Journey() {
  return (
    <QualityProvider>
      <ScrollProvider>
        <Scene />
        <Overlays />
        {/* Dev-only, and tree-shaken out of production builds. */}
        <Diagnostics />
      </ScrollProvider>
    </QualityProvider>
  );
}
