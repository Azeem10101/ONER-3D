"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

/**
 * RENDERER STATS BUS
 * ==================
 * A tiny module-level bus for renderer.info.
 *
 * The dev panel is a DOM component outside the <Canvas>, and renderer.info
 * lives on the WebGL renderer inside it. Passing that through React state
 * would re-render the panel on every frame, so instead the in-canvas reader
 * writes numbers here and the panel polls.
 *
 * Exported separately from the panel itself so the panel is not dragged into
 * the client bundle of anything that only wants the stats.
 */

export type RenderStats = {
  /** Median frame time over the last second, in ms. */
  frameMs: number;
  fps: number;
  drawCalls: number;
  triangles: number;
  programs: number;
  /** Pixel ratio actually applied, after the adaptive scaler. */
  pixelRatio: number;
};

const stats: RenderStats = {
  frameMs: 0,
  fps: 0,
  drawCalls: 0,
  triangles: 0,
  programs: 0,
  pixelRatio: 1,
};

const listeners = new Set<(value: RenderStats) => void>();

export function subscribeStats(listener: (value: RenderStats) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readStats(): RenderStats {
  return { ...stats };
}

/**
 * Reads renderer.info and the frame delta. Renders nothing.
 *
 * Mounted once inside <Canvas>.
 */
export function StatsReader() {
  const gl = useThree((state) => state.gl);
  const samples = useRef<number[]>([]);

  useFrame((_, delta) => {
    const bucket = samples.current;
    bucket.push(delta * 1000);
    if (bucket.length < 60) return;

    // Median rather than mean: one 200ms garbage-collection pause should not
    // make the readout claim 5fps.
    const sorted = [...bucket].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    bucket.length = 0;

    stats.frameMs = Number(median.toFixed(2));
    stats.fps = Math.round(1000 / median);
    stats.drawCalls = gl.info.render.calls;
    stats.triangles = gl.info.render.triangles;
    stats.programs = gl.info.programs?.length ?? 0;
    stats.pixelRatio = Number(gl.getPixelRatio().toFixed(3));

    for (const listener of listeners) listener({ ...stats });
  });

  return null;
}
