"use client";

import { useEffect } from "react";
import { scrollStore } from "@/lib/scrollStore";
import { soundStore } from "@/lib/soundStore";
import { publish } from "@/components/dev/statsBus";
import { VIDEO_DURATION } from "@/scene/beats";

/**
 * The ambient bed.
 *
 * ## Why this is Web Audio and not an <audio> element
 *
 * The previous three versions used `<audio>` and `currentTime`. That was the
 * wrong tool, and the reason it kept breaking is structural rather than a bug:
 *
 * **`currentTime` is a SEEK.** Assigning it does not move a playhead, it tells
 * the media pipeline "decode from somewhere else entirely" — flush the decoder,
 * find the keyframe, decode forward, present. At 34 seeks per second that is 34
 * decoder restarts per second. The result is a stutter, and it also loses the
 * buffer: the diagnostics panel caught `readyState 1 - metadata only` on the
 * video after a long session, because the browser had evicted data it was being
 * asked to re-fetch 34 times a second.
 *
 * There is no rate at which you can make that smooth. It is the wrong API for a
 * scrubbed sound.
 *
 * With Web Audio the whole 10s clip is decoded ONCE into an AudioBuffer, and from
 * then on nothing is ever re-decoded:
 *
 *   - playback position is set when the source node is created, for free
 *   - moving the position *during* playback is `playbackRate`, which is a
 *     resampler — continuous, no flush, no click
 *   - level is a GainNode, ramped on the audio thread
 *
 * So scrubbing the bed becomes a varispeed sweep, which is what a film scrub
 * actually sounds like, and it is sample-accurate at any rate.
 *
 * ## The trade
 *
 * An AudioContext has to be created inside a user gesture and its state has to
 * be resumed after every tab switch and suspend. Both are handled below. In
 * exchange the bed stops glitching, which three attempts with `<audio>` did not
 * achieve.
 */

/** Playback level. The source is -20.9 LUFS, a foreground mix level. */
const LEVEL = 0.5;

/** Dip applied while scrubbing, so the sweep sits under the reading. */
const SCRUB_LEVEL = 0.34;

/**
 * How hard the bed may chase the picture, as a playbackRate multiplier.
 *
 * Beyond about 2x, a resampler pitch-shifts audibly and the bed stops reading as
 * ambience and starts reading as a broken tape. Beyond the limit we simply fall
 * behind and re-anchor on settle, which is inaudible because it happens during
 * the silence of a fade.
 */
const MAX_RATE = 2;

/** Drift, in seconds of audio, that triggers a re-anchor when at rest. */
const REANCHOR = 0.12;

/** Fade time, seconds. */
const FADE = 0.12;

export function AudioBed() {
  useEffect(() => {
    let disposed = false;
    let frame = 0;
    let publishedAt = 0;

    // Audio graph. `null` until the reader has opted in, because an AudioContext
    // created without a gesture starts suspended and logs a warning.
    let ctx: AudioContext | null = null;
    let gain: GainNode | null = null;
    let buffer: AudioBuffer | null = null;
    let source: AudioBufferSourceNode | null = null;
    let loading = false;

    let level = 0;
    let blocked = false;
    let pos = 0; // our model of where the bed is

    /**
     * Creates the graph and decodes the clip. Called from the toggle's click, so
     * the context is born inside a user gesture.
     */
    async function boot() {
      if (ctx || loading) return;
      loading = true;
      try {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) {
          blocked = true;
          return;
        }
        ctx = new Ctor();
        if (ctx.state === "suspended") await ctx.resume();

        const response = await fetch("/media/ambient.m4a");
        if (!response.ok) throw new Error(`ambient.m4a ${response.status}`);
        const raw = await response.arrayBuffer();
        if (disposed) return;
        // Decoded once, in full. This is the step that makes everything after it
        // cheap: 10 seconds of AAC becomes a flat float buffer in memory and is
        // never decoded again.
        buffer = await ctx.decodeAudioData(raw);
        if (disposed) return;

        gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(ctx.destination);
      } catch {
        blocked = true;
      } finally {
        loading = false;
      }
    }

    /** Starts (or restarts) the source node at `offset` seconds. */
    function anchor(offset: number) {
      if (!ctx || !gain || !buffer) return;
      if (source) {
        try {
          source.stop();
        } catch {
          /* already stopped */
        }
        source.disconnect();
      }
      const clamped = Math.max(0, Math.min(buffer.duration - 0.02, offset));
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(gain);
      node.start(0, clamped);
      source = node;
      pos = clamped;
    }

    /**
     * Moves the gain toward `to` with a time constant, on the audio thread.
     *
     * `setTargetAtTime` rather than `linearRampToValueAtTime`: an interrupted
     * exponential bend approaches smoothly, whereas cancelling a linear ramp and
     * starting a new one from a stale scheduled value can jump, and that jump is
     * a click. Rapid scroll reversals interrupt these constantly.
     */
    function ramp(to: number) {
      if (!gain || !ctx) return;
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.setTargetAtTime(to, now, Math.max(0.01, FADE / 3));
      level = to;
    }

    let last = performance.now();
    function tick(now: number) {
      if (disposed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const target = scrollStore.smoothed * VIDEO_DURATION;
      const moving = Math.abs(scrollStore.target - scrollStore.smoothed) > 1e-4;

      if (soundStore.enabled && ctx && buffer && gain) {
        if (ctx.state === "suspended") {
          // Browsers suspend the context whenever the tab is hidden or the OS
          // suspends. Without this the bed is silently dead on return.
          ctx.resume().catch(() => { /* will retry next frame */ });
        }

        if (!source) {
          anchor(target);
        } else {
          // Advance our model of the playhead by real time, scaled by rate.
          pos += dt * (source.playbackRate.value || 1);

          if (moving) {
            // Steer with playbackRate. This is the whole trick: a resampler, not
            // a seek. No decoder flush, no click, and the position ends up correct
            // without ever re-seeking the element.
            const error = target - pos;
            // Proportional control, clamped. The divisor is the time constant:
            // close the gap over about a quarter second, which at 1x is gentle
            // enough to be inaudible and firm enough to arrive.
            const wanted = Math.max(-MAX_RATE, Math.min(MAX_RATE, error / 0.25));
            // setTargetAtTime rather than a bare assignment, so the pitch glide
            // is continuous instead of stepping once per frame.
            source.playbackRate.setTargetAtTime(wanted, ctx.currentTime, 0.05);
            ramp(SCRUB_LEVEL);
          } else {
            source.playbackRate.setTargetAtTime(1, ctx.currentTime, 0.08);
            if (Math.abs(target - pos) > REANCHOR) {
              // Only re-anchor when genuinely out of position, and only while
              // at rest, where the level change masks it.
              anchor(target);
            }
            ramp(LEVEL);
          }

          if (pos >= buffer.duration - 0.02) {
            // The bed is 10.03s against 9.93s of mapped scroll, so it runs out
            // at the very end. Restart rather than fall silent.
            anchor(0);
          }
        }
      } else if (ctx && gain) {
        ramp(0);
        if (source) {
          try {
            source.stop();
          } catch {
            /* already stopped */
          }
          source.disconnect();
          source = null;
        }
      }

      if (now - publishedAt > 200) {
        publishedAt = now;
        publish({
          soundEnabled: soundStore.enabled,
          soundBlocked: blocked,
          soundPaused: !source,
          soundVolume: level,
          soundTime: pos,
          soundPictureTime: target,
          soundRate: source ? source.playbackRate.value : 0,
        });
      }

      frame = requestAnimationFrame(tick);
    }

    /**
     * The toggle. Everything that requires a user gesture happens synchronously
     * inside here: the AudioContext is constructed and resumed, and the fetch
     * starts. Nothing in the rAF loop can do either.
     */
    const unsubscribe = soundStore.subscribe((enabled) => {
      if (disposed) return;
      if (!enabled) {
        ramp(0);
        if (source) {
          try {
            source.stop();
          } catch {
            /* already stopped */
          }
          source.disconnect();
          source = null;
        }
        return;
      }
      void boot().then(() => {
        if (!disposed && soundStore.enabled && !source) {
          anchor(scrollStore.smoothed * VIDEO_DURATION);
        }
      });
    });

    frame = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      unsubscribe();
      if (source) {
        try {
          source.stop();
        } catch {
          /* already stopped */
        }
      }
      void ctx?.close();
    };
  }, []);

  return null;
}