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

/** Playback level. The bed is now mixed, not a raw take. */
const LEVEL = 0.62;

/** Dip while scrubbing, so the sweep sits under the reading. */
const SCRUB_LEVEL = 0.4;

/**
 * How hard the bed may chase the picture, as a playbackRate multiplier.
 *
 * Previously 2. That was too slow to converge: a reader scrolling faster than 2x
 * real time left the bed permanently behind, which meant `error` never fell, so
 * the steering never released, so the bed sat at SCRUB_LEVEL with a growing
 * offset forever. The panel showed exactly that: vol 0.34 with the sound ahead
 * of the picture and not closing.
 *
 * 3.5 converges for any realistic scroll, and the lowpass below is what keeps
 * that from sounding like a chipmunk. Rate alone is not what the ear objects to;
 * rate plus full bandwidth is.
 */
const MAX_RATE = 3.5;

/**
 * Re-anchor threshold, in seconds of drift.
 *
 * Past this the bed is too far out of position to chase smoothly, so it is
 * re-seated instead — through silence, so the jump is not audible. Chasing a
 * two-second gap at 3.5x takes over half a second of grotesque vocalised
 * ambience; a clean re-seat under a 30ms fade is both faster and nicer.
 */
const REANCHOR_HARD = 0.55;

/** Gentle correction threshold, when at rest. */
const REANCHOR = 0.12;

/** Fade time, seconds. */
const FADE = 0.12;

/**
 * Lowpass corner while scrubbing, in Hz.
 *
 * This is the single change that makes varispeed scrubbing sound like a
 * professional transport rather than a broken file. A resampler shifts the whole
 * spectrum, so 3.5x full-band ambient is a chipmunk siren. Band-limiting it while
 * the rate is off-normal removes the frequencies that do the shifting, so what is
 * left is a low, smooth sweep — which is exactly what a film scrub sounds like,
 * because a real one is a tape head passing over tape at speed.
 *
 * Open to 18kHz when the rate is normal, so a stationary bed is untouched.
 */
const SCRUB_CUTOFF = 900;
const OPEN_CUTOFF = 18000;

export function AudioBed() {
  useEffect(() => {
    let disposed = false;
    let frame = 0;
    let publishedAt = 0;

    // Audio graph. `null` until the reader has opted in, because an AudioContext
    // created without a gesture starts suspended and logs a warning.
    let ctx: AudioContext | null = null;
    let gain: GainNode | null = null;
    let tone: BiquadFilterNode | null = null;
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

        // source -> tone -> gain -> out. The band-limiting happens before the
        // level so the cutoff change is never shaped by a gain move.
        tone = ctx.createBiquadFilter();
        tone.type = "lowpass";
        tone.frequency.value = OPEN_CUTOFF;
        tone.Q.value = 0.7;

        source?.disconnect();
        tone.connect(gain);
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
      node.connect(tone ?? gain);
      node.start(0, clamped);
      source = node;
      pos = clamped;
    }

    /**
     * Band-limits the bed in proportion to how far off-normal the rate is.
     *
     * Called every frame; `setTargetAtTime` on an AudioParam is cheap and this is
     * the whole trick that makes varispeed scrubbing tolerable.
     */
    function setTone(rate: number) {
      if (!tone || !ctx) return;
      const deviation = Math.abs(rate - 1);
      // Below a rate this close to normal the bed is effectively stationary, so
      // leave it alone rather than filtering a signal that is not moving.
      if (deviation < 0.06) {
        tone.frequency.setTargetAtTime(OPEN_CUTOFF, ctx.currentTime, 0.08);
        return;
      }
      // Logarithmic interpolation so the ear hears a steady sweep rather than a
      // sudden drop the instant the rate leaves 1x.
      const t = Math.min(1, deviation / (MAX_RATE - 1));
      const cutoff = OPEN_CUTOFF * Math.pow(SCRUB_CUTOFF / OPEN_CUTOFF, t);
      tone.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.06);
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
            const error = target - pos;

            if (Math.abs(error) > REANCHOR_HARD) {
              // Too far out of position to chase. Re-seat through silence
              // rather than grinding seconds of ambience backwards at 3.5x, which
              // is both slower and much worse to listen to.
              ramp(0);
              anchor(target);
              ramp(SCRUB_LEVEL);
            } else {
              // Proportional control, clamped. The divisor is the time
              // constant: close the gap over about a quarter second.
              const wanted = Math.max(-MAX_RATE, Math.min(MAX_RATE, error / 0.25));
              source.playbackRate.setTargetAtTime(wanted, ctx.currentTime, 0.05);
              setTone(wanted);
              ramp(SCRUB_LEVEL);
            }
          } else {
            source.playbackRate.setTargetAtTime(1, ctx.currentTime, 0.08);
            setTone(1);
            if (Math.abs(target - pos) > REANCHOR) {
              anchor(target);
            }
            ramp(LEVEL);
          }

          if (pos >= buffer.duration - 0.05) {
            // The tail. This used to call anchor(0), which yanked the sound back
            // to the opening while the reader was looking at the lake — the
            // single most unpleasant thing the bed could do, and the complaint
            // that prompted this pass. The picture is finished at this point, so
            // there is nothing left to stay in sync with: hold the last moment.
            source.playbackRate.setTargetAtTime(0, ctx.currentTime, 0.05);
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