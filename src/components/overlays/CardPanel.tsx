"use client";

import type { CSSProperties } from "react";
import { CARDS } from "@/scene/content";
import type { CardId } from "@/scene/timeline";

type CardPanelProps = {
  id: CardId;
  /** Registered with the overlay rAF loop, which owns visibility. */
  ref?: React.Ref<HTMLDivElement>;
};

/**
 * A single emissions card.
 *
 * Deliberately plain HTML rather than 3D text. Rendered this way the text stays
 * vector-crisp at any resolution, is selectable and screen-reader accessible,
 * costs nothing in the WebGL frame budget, and can be styled with CSS.
 *
 * This component is pure presentational. Visibility is written by the rAF loop
 * in <ScrollSections> straight onto `opacity` and `--card-shift`, so React
 * never re-renders while scrolling.
 */
export function CardPanel({ id, ref }: CardPanelProps) {
  const card = CARDS[id];

  return (
    <div
      ref={ref}
      data-card={id}
      data-active="false"
      className="card-panel"
      style={{ "--card-accent": card.accent } as CSSProperties}
    >
      <div className="card-shell max-w-[min(30rem,calc(100vw-3rem))] p-6 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="card-symbol text-5xl sm:text-6xl">{card.symbol}</div>
            <p className="mt-2 text-sm font-medium text-white/90">{card.name}</p>
          </div>
          <span className="hud-label shrink-0 rounded-full border border-white/10 px-2.5 py-1 whitespace-nowrap">
            {card.onerMetric}
          </span>
        </div>

        <p className="mt-5 text-lg leading-snug font-medium text-balance" style={{ color: card.accent }}>
          {card.tagline}
        </p>

        <dl className="mt-5 space-y-4 text-sm leading-relaxed">
          <div>
            <dt className="hud-label">Where it comes from</dt>
            <dd className="mt-1.5 text-white/75">{card.source}</dd>
          </div>
          <div>
            <dt className="hud-label">Why it matters</dt>
            <dd className="mt-1.5 text-white/75">{card.impact}</dd>
          </div>
        </dl>

        <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-white/10">
          {card.stats.map((stat) => (
            <div key={stat.label} className="bg-[#0b100f]/90 px-3.5 py-3">
              <dt className="text-[0.6875rem] text-white/50">{stat.label}</dt>
              <dd className="mt-1 font-mono text-base font-semibold" style={{ color: card.accent }}>
                {stat.value}
              </dd>
              {stat.note ? <p className="mt-0.5 text-[0.6875rem] text-white/45">{stat.note}</p> : null}
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
