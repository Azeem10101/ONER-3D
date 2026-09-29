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
          <span className="hud-label shrink-0 rounded-sm border border-white/10 px-2.5 py-1 whitespace-nowrap">
            {card.onerMetric}
          </span>
        </div>

        <div className="card-rule mt-5" />

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

        {/*
          The figures block.

          Previously a 2px grid gap over a `bg-white/10` background, which puts
          a visible light grid between every cell — the look of a marketing
          comparison table rather than of a measurement readout. This uses hairline
          dividers instead, and a single flat panel, so the numbers read as one
          record.
        */}
        <dl className="mt-6 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-white/10 pt-5">
          {card.stats.map((stat) => (
            <div key={stat.label}>
              <dt className="hud-label">{stat.label}</dt>
              <dd className="mt-1.5 font-mono text-lg font-semibold leading-none" style={{ color: card.accent }}>
                {stat.value}
              </dd>
              {stat.note ? <p className="mt-1.5 text-[0.6875rem] leading-snug text-white/45">{stat.note}</p> : null}
            </div>
          ))}
        </dl>

        {/*
          A provenance line. The figures are illustrative, and an illustrative
          number presented in the same typeface as a measured one is the single
          most misleading thing this card can do. Saying so on the card is what
          separates a report from a poster.
        */}
        <p className="mt-6 border-t border-white/10 pt-4 text-[0.6875rem] leading-relaxed text-white/35">
          Typical values for a heavy industrial combustion source. Illustrative
          ranges, not measurements from this facility.
        </p>
      </div>
    </div>
  );
}
