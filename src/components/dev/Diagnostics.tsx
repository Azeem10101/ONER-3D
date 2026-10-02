"use client";

import { useEffect, useState } from "react";
import { readStats, subscribeStats, type VideoStats } from "./statsBus";

/**
 * DEV DIAGNOSTICS
 * ===============
 * Scrub health: is the playhead keeping up with the scroll?
 *
 * ## What replaced what
 *
 * This used to report the detected GPU, the quality tier, the adaptive render
 * scale, draw calls, triangle count, shadow map size and vegetation count. Every
 * one of those was a property of the WebGL scene that no longer exists. A video
 * element has none of them, and inventing equivalents would be theatre.
 *
 * ## What actually needs watching
 *
 * A scrubbed video has exactly one way to fail visibly: the decoder cannot
 * decode a new frame fast enough, so `currentTime` lags behind where the scroll
 * says it should be, and the footage visibly trails the text. That is what
 * `lag` measures, and it is the number to read first.
 *
 * Render frame rate is deliberately absent. The video is paused — it is seeked,
 * never played — so it decodes a frame only when the playhead moves. An fps
 * counter here would read near zero and mean nothing. The frame count IS shown,
 * because that is the real limit on how smooth a scrub can be.
 */
export function Diagnostics() {
  const [stats, setStats] = useState<VideoStats>(() => readStats());

  useEffect(() => subscribeStats(setStats), []);

  // One frame of the 60fps source. Sustained lag beyond this is visible as the
  // footage trailing the text.
  const frameMs = 1000 / 60;
  const lagging = Math.abs(stats.lagMs) > frameMs;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 hidden justify-center p-4 lg:flex">
      <div className="pointer-events-auto w-full max-w-2xl rounded-lg border border-white/15 bg-black/60 font-mono text-[10px] leading-relaxed text-white/75 backdrop-blur-md">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
          <span className="text-white/50">ONER diagnostics · scrub</span>
          <div className="flex items-center gap-2">
            <span
              className="rounded px-1.5 py-0.5 font-semibold text-white"
              style={{ background: stats.ready ? "#166534" : "#854d0e" }}
            >
              {stats.ready ? "READY" : stats.readyState >= 1 ? "GATED" : "NO MEDIA"}
            </span>
            <span
              className="rounded px-1.5 py-0.5"
              style={{ background: lagging ? "#991b1b" : "#166534" }}
            >
              lag {stats.lagMs.toFixed(1)} ms
            </span>
          </div>
        </header>

        <div className="grid gap-x-6 gap-y-0 px-3 py-2 sm:grid-cols-2">
          <dl className="grid grid-cols-[7rem_1fr] gap-x-2">
            <dt className="text-white/40">Source</dt>
            <dd>
              {stats.width}×{stats.height} · {stats.duration.toFixed(3)}s ·{" "}
              {stats.frames} frames
            </dd>

            <dt className="text-white/40">Playhead</dt>
            <dd className="tabular-nums">
              {stats.actual.toFixed(3)}s
              <span className="text-white/40"> / {stats.duration.toFixed(3)}s</span>
            </dd>

            <dt className="text-white/40">Requested</dt>
            <dd className="tabular-nums">{stats.requested.toFixed(3)}s</dd>
          </dl>

          <dl className="grid grid-cols-[7rem_1fr] gap-x-2">
            <dt className="text-white/40">readyState</dt>
            <dd className="tabular-nums">
              {stats.readyState}
              <span className="text-white/40">
                {stats.readyState === 0
                  ? " — media never loaded"
                  : stats.readyState === 1
                    ? " — metadata only"
                    : " — has data"}
              </span>
            </dd>

            <dt className="text-white/40">Primed</dt>
            <dd>{stats.primed ? "yes" : "not yet"}</dd>

            <dt className="text-white/40">Seeks/s</dt>
            <dd className="tabular-nums">{stats.seeksPerSecond}</dd>

            <dt className="text-white/40">Buffered</dt>
            <dd className="tabular-nums">{stats.buffered.toFixed(2)}s ahead</dd>

            <dt className="text-white/40">Seek mode</dt>
            <dd>exact (never fastSeek)</dd>

            <dt className="text-white/40">Sound</dt>
            <dd>
              <span
                style={{
                  color: stats.soundBlocked ? "#fca5a5" : undefined,
                }}
              >
                {stats.soundBlocked
                  ? "BLOCKED by autoplay policy"
                  : !stats.soundEnabled
                    ? "off"
                    : stats.soundPaused
                      ? "on, muted while scrolling"
                      : "playing"}
              </span>
              <span className="text-white/40">
                {" "}
                vol {stats.soundVolume.toFixed(2)} @ {stats.soundTime.toFixed(2)}s
              </span>
            </dd>
          </dl>
        </div>
      </div>
    </div>
  );
}