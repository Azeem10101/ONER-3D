"use client";

/**
 * VIDEO STATS BUS
 * ===============
 * A module-level bus for scrub diagnostics.
 *
 * The same shape the old renderer.info bus had, for the same reason: the panel
 * is a DOM component and the numbers come from a rAF loop, so passing them
 * through React state would re-render the panel every frame. The writer updates
 * this object and notifies listeners once a second.
 *
 * What is worth watching here is NOT frame rate — a paused video decodes almost
 * nothing, so fps is meaningless. What matters is whether the playhead is
 * keeping up with the scroll, which is what `lagMs` measures.
 */

export type VideoStats = {
  /** Playhead the scrubber last requested, seconds. */
  requested: number;
  /** Playhead the browser reports, seconds. */
  actual: number;
  /**
   * requested - actual, in seconds. Sustained values above ~1 frame mean the
   * decoder cannot keep up with the scroll and the footage will lag behind the
   * text. This is the number to look at.
   */
  lagMs: number;
  /** How many seeks were issued in the last second. */
  seeksPerSecond: number;
  /** Seconds of the clip buffered ahead of the playhead. */
  buffered: number;
  /** True once the scrubber considers the element seekable. */
  ready: boolean;
  /**
   * The element's own HAVE_METADATA state, 0-4.
   *
   * Worth showing on its own because it separates the two ways this can fail.
   * If readyState is 0 the media never loaded at all — a path, a range-request
   * or a decode problem. If readyState is 1 or more but `ready` is false, the
   * file is fine and the gating is at fault.
   */
  readyState: number;
  /** Intrinsic size of the source. */
  width: number;
  height: number;
  duration: number;
  /**
   * Total frames in the file, derived from duration and the source frame rate.
   * This is the resolution of the scrub: the number of distinct pictures the
   * playhead can actually land on.
   */
  frames: number;
  /** True once the play/pause prime has run. */
  primed: boolean;
};

const stats: VideoStats = {
  requested: 0,
  actual: 0,
  lagMs: 0,
  seeksPerSecond: 0,
  buffered: 0,
  ready: false,
  readyState: 0,
  width: 0,
  height: 0,
  duration: 0,
  frames: 0,
  primed: false,
};

const listeners = new Set<(value: VideoStats) => void>();

export function subscribeStats(listener: (value: VideoStats) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readStats(): VideoStats {
  return { ...stats };
}

/** Called by the scrubber's rAF loop. Cheap; only notifies once a second. */
export function publish(next: Partial<VideoStats>) {
  Object.assign(stats, next);
  for (const listener of listeners) listener({ ...stats });
}