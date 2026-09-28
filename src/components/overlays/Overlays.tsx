"use client";

import { useEffect, useRef } from "react";
import { CardPanel } from "./CardPanel";
import { EPILOGUE } from "@/scene/content";
import { SHOTS, cardVisibility, shotAt, type CardId } from "@/scene/timeline";
import { scrollStore } from "@/lib/scrollStore";
import { validateTimeline } from "@/scene/validate";

/**
 * Total scrollable height of the journey, in vh.
 *
 * Every shot's height is `(to - from) * TOTAL_VH`, so the DOM column and the
 * camera timeline are the same numbers. Change this to make the whole
 * experience longer or shorter without touching the timeline.
 */
const TOTAL_VH = 1500;

/** Overlay damping, tuned slightly snappier than the camera so the text
 *  feels attached to the scroll rather than trailing the camera. */
const LAG = 0.2;

/** Pixels a card travels as it fades in. */
const SHIFT = 26;

/**
 * The scroll-driven DOM layer.
 *
 * ## Why there is no React state in here
 *
 * The obvious implementation puts `progress` in `useState` and lets React
 * re-render the cards. That means a re-render on every frame of scrolling,
 * reconciling a subtree, for an effect that amounts to writing one number
 * onto one element. Instead this component mounts every card once, caches the
 * DOM nodes, and runs a single rAF loop that writes `opacity` and a CSS
 * variable directly. React renders exactly once.
 *
 * The tradeoff is that these elements are written imperatively, so they must
 * not also be driven declaratively — there is no `style` prop on a card.
 */
export function Overlays() {
  const cards = useRef(new Map<CardId, HTMLElement>());
  const rail = useRef<HTMLDivElement>(null);
  const hudLabel = useRef<HTMLSpanElement>(null);
  const intro = useRef<HTMLDivElement>(null);
  const outro = useRef<HTMLDivElement>(null);
  const lastLabel = useRef("");

  useEffect(() => {
    let frame = 0;
    let progress = 0;

    if (process.env.NODE_ENV !== "production") {
      const { problems } = validateTimeline();
      if (problems.length) {
        console.group(`Timeline: ${problems.length} problem(s)`);
        for (const problem of problems) console.warn(problem);
        console.groupEnd();
      }
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function tick() {
      const target = scrollStore.target;
      progress += (target - progress) * (reduceMotion ? 1 : LAG);
      if (Math.abs(target - progress) < 0.0001) progress = target;

      // --- Cards: fade in and out on their own shot's range -----------------
      for (const [id, element] of cards.current) {
        const visibility = cardVisibility(id, progress);
        if (visibility === 0 && element.style.opacity === "0") continue; // already hidden, skip the write

        element.style.opacity = visibility.toFixed(3);
        element.style.setProperty("--card-shift", `${((1 - visibility) * SHIFT).toFixed(1)}px`);

        // Only interactive when actually readable, so a half-faded card can
        // never swallow a click meant for the scene behind it.
        const active = visibility > 0.85 ? "true" : "false";
        if (element.dataset.active !== active) element.dataset.active = active;
      }

      // --- Progress rail ----------------------------------------------------
      if (rail.current) {
        rail.current.style.setProperty("--progress", progress.toFixed(4));
      }

      // --- Current beat label ------------------------------------------------
      // Written only when the text actually changes. Assigning textContent
      // unconditionally forces a layout every frame.
      const label = shotAt(progress).label;
      if (label !== lastLabel.current && hudLabel.current) {
        hudLabel.current.textContent = label;
        lastLabel.current = label;
      }

      // --- Intro, which clears as soon as the journey begins ---------------
      if (intro.current) {
        const visible = progress < 0.012;
        intro.current.style.opacity = visible ? "1" : "0";
        intro.current.style.pointerEvents = visible ? "auto" : "none";
      }

      // --- Outro, which only appears over the final beat --------------------
      if (outro.current) {
        // The outro is the last shot, so drive it off the shot boundary rather
        // than a magic number.
        const start = SHOTS[SHOTS.length - 1].from;
        const t = Math.min(1, Math.max(0, (progress - start) / 0.015));
        const eased = t * t * (3 - 2 * t);
        outro.current.style.opacity = eased.toFixed(3);
        outro.current.style.transform = `translate3d(0, ${((1 - eased) * 18).toFixed(1)}px, 0)`;
        outro.current.style.pointerEvents = eased > 0.85 ? "auto" : "none";
      }

      frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <>
      {/* The scroll column. Each section is as tall as its shot, and each card
          is sticky so it holds centre-frame for the length of its shot. */}
      <main className="relative z-10">
        {SHOTS.map((shot) => (
          <section
            key={shot.id}
            aria-label={shot.label}
            style={{ height: `${Math.round((shot.to - shot.from) * TOTAL_VH * 100) / 100}vh` }}
            className="relative"
          >
            {shot.card ? (
              <div className="sticky top-0 flex h-screen items-center justify-end px-6 sm:px-10 lg:pr-24">
                <CardPanel id={shot.card} ref={registerCard(shot.card, cards)} />
              </div>
            ) : null}
          </section>
        ))}
      </main>

      {/* --- Chrome --------------------------------------------------------- */}

      <div ref={intro} className="pointer-events-none fixed inset-0 z-20 flex flex-col items-center justify-center px-6 text-center">
        <p className="hud-label">ONER · Environmental AI Autopilot</p>
        <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          Every tonne starts at a chimney.
        </h1>
        <p className="mt-5 max-w-md text-base text-white/65 sm:text-lg">
          Scroll to follow the plume from the plant to the sky, then back down to the water.
        </p>
        <div className="mt-12 flex flex-col items-center gap-2">
          <span className="hud-label">Scroll</span>
          <span className="h-10 w-px animate-pulse bg-white/40" />
        </div>
      </div>

      <div className="pointer-events-none fixed inset-x-0 top-0 z-20 flex items-center justify-between gap-4 px-6 py-5 sm:px-10">
        <span className="hud-label text-white/80">ONER</span>
        <span ref={hudLabel} className="hud-label truncate text-right">
          {SHOTS[0].label}
        </span>
      </div>

      <div aria-hidden className="progress-rail z-20">
        <div ref={rail} className="progress-rail-fill" />
      </div>

      <div
        ref={outro}
        className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-6 pb-16"
      >
        <div className="pointer-events-auto max-w-xl text-center opacity-0">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{EPILOGUE.headline}</h2>
          <p className="mt-4 text-base leading-relaxed text-white/70">{EPILOGUE.body}</p>
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

/** Callback ref that caches each card's DOM node for the rAF loop. */
function registerCard(id: CardId, registry: React.RefObject<Map<CardId, HTMLElement>>) {
  return (element: HTMLElement | null) => {
    if (element) registry.current.set(id, element);
    else registry.current.delete(id);
  };
}
