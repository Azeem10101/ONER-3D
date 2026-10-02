"use client";

import { useEffect, useRef } from "react";
import { BEATS, EPILOGUE, TOTAL_VH, VIDEO_DURATION, beatAt, beatVisibility, progressAt } from "@/scene/beats";
import { scrollStore } from "@/lib/scrollStore";
import { SoundToggle } from "./SoundToggle";

/** Pixels a block travels as it fades in. */
const SHIFT = 22;

/**
 * The scroll-driven DOM layer.
 *
 * ## What changed and why
 *
 * The footage now carries its own metric annotations — CO, NO₂, PM₂.₅, SO₂, and
 * the outfall load — burnt into the pixels by the generator. Keeping the HTML
 * card panel as well meant every one of those metrics appeared twice on screen,
 * once in our typography and once in the video's, at different sizes and
 * positions, in the same frame.
 *
 * So the cards are gone and the prose has moved into the scroll column as plain
 * text. What is kept is what the video cannot do: the explanation of *why* each
 * number matters, the threshold it is measured against, and the ONER metric it
 * maps to. That was always the point of the cards — the video labels are nouns,
 * and the prose is the sentence around them.
 *
 * ## Why there is still no React state
 *
 * Same reason as before, and it is still worth it: `progress` in `useState`
 * would re-render the tree sixty times a second to write one number onto one
 * element. React renders once; a single rAF loop writes styles imperatively.
 */
export function Overlays() {
  const blocks = useRef<(HTMLDivElement | null)[]>([]);
  const rail = useRef<HTMLDivElement>(null);
  const hudLabel = useRef<HTMLSpanElement>(null);
  const intro = useRef<HTMLDivElement>(null);
  const outro = useRef<HTMLDivElement>(null);
  const lastLabel = useRef("");

  useEffect(() => {
    let frame = 0;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function tick() {
      // Reads the store's ALREADY-damped value rather than damping a second,
      // private copy of the scroll.
      //
      // These two used to run independent exponential smoothers — the video at
      // 0.16 and this one at 0.2 — so the text was always chasing a different
      // number than the picture and arrived slightly ahead of it. Two smoothers
      // over one input is one smoother too many. <VideoLayer> steps the store
      // once per frame and this reads the result, which is why the type and the
      // footage are now locked together.
      const progress = reduceMotion ? scrollStore.target : scrollStore.smoothed;

      // --- Beat text ---------------------------------------------------------
      for (let i = 0; i < blocks.current.length; i++) {
        const element = blocks.current[i];
        if (!element) continue;
        const visibility = beatVisibility(i, progress);
        // Skip the write when already fully hidden — setting a style property
        // that did not change still costs a style recalculation.
        if (visibility === 0 && element.style.opacity === "0") continue;

        element.style.opacity = visibility.toFixed(3);
        element.style.setProperty("--shift", `${((1 - visibility) * SHIFT).toFixed(1)}px`);
        const isActive = visibility > 0.85 ? "true" : "false";
        if (element.dataset.active !== isActive) element.dataset.active = isActive;
      }

      // --- Progress rail ------------------------------------------------------
      if (rail.current) {
        rail.current.style.setProperty("--progress", progress.toFixed(4));
      }

      // --- Current beat label, written only when it actually changes ---------
      const label = beatAt(progress).label;
      if (label !== lastLabel.current && hudLabel.current) {
        hudLabel.current.textContent = label;
        lastLabel.current = label;
      }

      // --- Intro, which clears as soon as the journey begins -----------------
      if (intro.current) {
        const visible = progress < 0.012;
        intro.current.style.opacity = visible ? "1" : "0";
        intro.current.style.pointerEvents = visible ? "auto" : "none";
      }

      // --- Outro, over the tail of the last beat -----------------------------
      if (outro.current) {
        const start = progressAt(BEATS[BEATS.length - 1].end - VIDEO_DURATION * 0.06);
        const t = Math.min(1, Math.max(0, (progress - start) / 0.02));
        const eased = t * t * (3 - 2 * t);
        outro.current.style.opacity = eased.toFixed(3);
        outro.current.style.transform = `translate3d(0, ${((1 - eased) * 16).toFixed(1)}px, 0)`;
        outro.current.style.pointerEvents = eased > 0.85 ? "auto" : "none";
      }

      frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <>
      {/* The scroll column. Each section is as tall as its beat, and its text is
          sticky so it holds for the length of the beat. Heights come from the
          video timings, so the column is exactly as long as the footage needs. */}
      <main className="relative z-10">
        {BEATS.map((beat, i) => {
          const seconds = beat.end - beat.start;
          const heightVh = (seconds / VIDEO_DURATION) * TOTAL_VH;
          return (
            <section
              key={beat.id}
              aria-label={beat.label}
              style={{ height: `${Math.round(heightVh * 100) / 100}vh` }}
              className="relative"
            >
              <div className="sticky top-0 flex h-screen items-center justify-end px-6 sm:px-10 lg:pr-24">
                <div
                  ref={(el) => {
                    blocks.current[i] = el;
                  }}
                  style={{ opacity: 0 }}
                  className="beat max-w-sm"
                >
                  <p className="hud-label">{beat.label}</p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                    {beat.heading}
                  </h2>
                  <p className="mt-4 text-sm leading-relaxed text-white/75 sm:text-base">
                    {beat.body}
                  </p>
                  {beat.metrics.length > 0 ? (
                    <dl className="mt-6 space-y-4 border-t border-white/15 pt-4">
                      {beat.metrics.map((metric) => (
                        <div key={metric.label}>
                          <dt className="hud-label">{metric.label}</dt>
                          <dd className="mt-1 text-2xl font-semibold tabular-nums">
                            {metric.value}
                          </dd>
                          {metric.note ? (
                            <dd className="mt-1 text-xs text-white/50">{metric.note}</dd>
                          ) : null}
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {beat.onerMetric ? (
                    <p className="mt-4 text-xs text-white/40">
                      ONER metric · {beat.onerMetric}
                    </p>
                  ) : null}
                </div>
              </div>
            </section>
          );
        })}
      </main>

      {/* --- Chrome ----------------------------------------------------------- */}

      <div
        ref={intro}
        className="pointer-events-none fixed inset-0 z-20 flex flex-col items-center justify-center px-6 text-center"
      >
        <p className="hud-label">ONER · Environmental AI Autopilot</p>
        <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          Every tonne starts at a chimney.
        </h1>
        <p className="mt-5 max-w-md text-base text-white/70 sm:text-lg">
          Scroll to follow the plume from the stack to the sky, then back down to
          the water.
        </p>
        <div className="mt-12 flex flex-col items-center gap-2">
          <span className="hud-label">Scroll</span>
          <span className="h-10 w-px animate-pulse bg-white/40" />
        </div>
      </div>

      <div className="pointer-events-none fixed inset-x-0 top-0 z-20 flex items-center justify-between gap-4 bg-gradient-to-b from-black/45 to-transparent px-6 py-5 sm:px-10">
        <span className="hud-label text-white/85">ONER</span>
        <div className="flex items-center gap-4">
          <SoundToggle />
          <span ref={hudLabel} className="hud-label truncate text-right">
            {BEATS[0].label}
          </span>
        </div>
      </div>

      <div aria-hidden className="progress-rail z-20">
        <div ref={rail} className="progress-rail-fill" />
      </div>

      <div
        ref={outro}
        className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center bg-gradient-to-t from-black/70 to-transparent px-6 pb-16 pt-24"
      >
        <div className="pointer-events-auto max-w-xl text-center opacity-0">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {EPILOGUE.headline}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/75">
            {EPILOGUE.body}
          </p>
          <a
            href="/dashboard"
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-[#0b100f] transition hover:bg-white/90"
          >
            {EPILOGUE.cta}
            <span aria-hidden>→</span>
          </a>
        </div>
      </div>
    </>
  );
}