"use client";

import { useEffect, useState } from "react";
import { currentSettings, useQuality } from "@/components/three/QualityGate";
import { readStats, subscribeStats, type RenderStats } from "./statsBus";
import type { QualityTier } from "@/scene/quality";

/**
 * DEV DIAGNOSTICS
 * ===============
 * Shows the detected GPU, the live quality tier, the adaptive render scale,
 * and a rolling frame time.
 *
 * Development only. It exists because the two questions that matter when
 * judging this scene on a specific machine — "which tier did it choose?" and
 * "what frame rate is it actually hitting?" — are otherwise unanswerable
 * without attaching a debugger.
 */

const TIER_LABELS: Record<QualityTier, string> = {
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
};

const TIER_COLOURS: Record<QualityTier, string> = {
  low: "#991b1b",
  medium: "#854d0e",
  high: "#166534",
};

export function Diagnostics() {
  const [stats, setStats] = useState<RenderStats>(() => readStats());

  useEffect(() => {
    // subscribeStats only fires on a stats update, which the bus emits once
    // a second. No polling timer, no wasted renders.
    return subscribeStats(setStats);
  }, []);

  const { settings, gpu, isManual, setTier } = useQuality();

  const vegetationTotal = settings.vegetationNearCount + settings.vegetationFarCount;
  const frameBudget = 1000 / 60;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 hidden justify-center p-4 lg:flex">
      <div className="pointer-events-auto w-full max-w-2xl rounded-lg border border-white/15 bg-black/60 font-mono text-[10px] leading-relaxed text-white/75 backdrop-blur-md">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
          <span className="text-white/50">ONER diagnostics</span>
          <div className="flex items-center gap-2">
            <span
              className="rounded px-1.5 py-0.5 font-semibold text-white"
              style={{ background: TIER_COLOURS[settings.tier] }}
            >
              {TIER_LABELS[settings.tier]}
            </span>
            <span
              className="rounded px-1.5 py-0.5"
              style={{
                background: stats.frameMs > frameBudget * 1.5 ? "#991b1b" : "#166534",
              }}
            >
              {stats.fps} fps · {stats.frameMs.toFixed(1)} ms
            </span>
          </div>
        </header>

        <div className="grid gap-x-6 gap-y-0 px-3 py-2 sm:grid-cols-2">
          <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2">
            <dt className="text-white/40">GPU</dt>
            <dd className="truncate" title={gpu.renderer ?? undefined}>
              {gpu.renderer ?? "not reported"}
            </dd>

            <dt className="text-white/40">Why</dt>
            <dd className="text-white/55">{gpu.reason}</dd>

            <dt className="text-white/40">Source</dt>
            <dd>{isManual ? "manual override" : gpu.isGuess ? "guessed" : "detected"}</dd>

            <dt className="text-white/40">Render scale</dt>
            <dd>
              {settings.renderScale.toFixed(2)}× · dpr {stats.pixelRatio.toFixed(2)}
            </dd>
          </dl>

          <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2">
            <dt className="text-white/40">Draw calls</dt>
            <dd>{stats.drawCalls}</dd>

            <dt className="text-white/40">Triangles</dt>
            <dd>{stats.triangles.toLocaleString()}</dd>

            <dt className="text-white/40">Shadows</dt>
            <dd>
              {settings.shadowMapSize > 0
                ? `${settings.shadowMapSize}px / ${settings.shadowCameraSize}m`
                : "disabled"}
            </dd>

            <dt className="text-white/40">Vegetation</dt>
            <dd>
              {vegetationTotal.toLocaleString()} trees
              <span className="text-white/40">
                {" "}
                ({settings.vegetationNearCount} near)
              </span>
            </dd>
          </dl>
        </div>

        <footer className="flex items-center gap-1 border-t border-white/10 px-3 py-2">
          <span className="mr-1 text-white/40">Override</span>
          {(["auto", "low", "medium", "high"] as const).map((tier) => {
            const selected = tier === "auto" ? !isManual : isManual && settings.tier === tier;
            return (
              <button
                key={tier}
                type="button"
                onClick={() => setTier(tier)}
                className={`rounded px-2 py-0.5 transition ${
                  selected ? "bg-white text-black" : "bg-white/10 text-white/70 hover:bg-white/20"
                }`}
              >
                {tier}
              </button>
            );
          })}
          <span className="ml-auto text-white/30">?quality=low|medium|high|auto</span>
        </footer>
      </div>
    </div>
  );
}

/** Reads the live settings outside React, for quick console checks. */
export { currentSettings };
