"use client";

import dynamic from "next/dynamic";
import { ScrollProvider } from "./scroll/ScrollProvider";
import { Overlays } from "./overlays/Overlays";

/**
 * The WebGL layer is loaded client-side only, and only after the document
 * parses, for two reasons:
 *
 *   1. Three.js touches `window` at module scope, so importing it during SSR
 *      throws. `ssr: false` is the supported way to opt out in the App Router
 *      — and per the Next.js docs it only works inside a Client Component,
 *      which is why this file has "use client" at the top.
 *
 *   2. Deferring it means the scroll column and the opening title are painted
 *      by the server first. The user sees text immediately while the ~700KB of
 *      WebGL is still arriving, instead of staring at a black rectangle.
 */
const Scene = dynamic(() => import("./three/Scene").then((mod) => mod.Scene), {
  ssr: false,
  loading: () => <div className="fixed inset-0 z-0 bg-[#0b100f]" aria-hidden />,
});

/**
 * The whole experience: one fixed 3D scene, one tall scroll column, one rAF
 * loop driving the overlays, and one render loop driving the camera.
 */
export function Journey() {
  return (
    <ScrollProvider>
      <Scene />
      <Overlays />
    </ScrollProvider>
  );
}
