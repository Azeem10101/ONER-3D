"use client";

import { ScrollProvider } from "./scroll/ScrollProvider";
import { VideoLayer } from "./video/VideoLayer";
import { AudioBed } from "./video/AudioBed";
import { Overlays } from "./overlays/Overlays";
import { Diagnostics } from "./dev/Diagnostics";

/**
 * The whole experience: one fixed video layer, one tall scroll column, and one
 * rAF loop driving both the playhead and the text.
 *
 * ## What this used to be
 *
 * <Scene> — a React Three Fiber canvas holding a procedurally generated
 * landscape: terrain, jungle scatter, water shader, particle plume, birds, fish,
 * an analytic sky and a 16-shot camera rig. It was about 4,000 lines across
 * thirteen components, plus a world generator, a quality-tier system with an
 * adaptive scaler, and six validation scripts that asserted things about
 * terrain relief, camera seam velocity, sprite budgets and fish placement.
 *
 * All of it is gone. It was replaced by a 10-second video of the same story,
 * generated elsewhere, which is both far better looking and a fraction of the
 * maintenance. Nothing about a <video> needs a quality tier.
 *
 * The parts worth keeping were kept: native document scroll, the progress store,
 * the fixed HUD, the progress rail, and the intro/outro treatment. The scroll
 * store is now read by two rAF loops instead of by a render loop, which is the
 * only interface the old system had with the new one.
 */
export function Journey() {
  return (
    <ScrollProvider>
      <VideoLayer />
      {/* The ambient bed. Silent until the reader asks for it, and silent again
          whenever the scroll is moving — see AudioBed for why. */}
      <AudioBed />
      <Overlays />
      {/* Dev-only, and tree-shaken out of production builds. */}
      <Diagnostics />
    </ScrollProvider>
  );
}