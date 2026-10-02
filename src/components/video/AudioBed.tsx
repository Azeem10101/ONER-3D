"use client";

import { useEffect, useRef } from "react";
import { scrollStore } from "@/lib/scrollStore";
import { soundStore } from "@/lib/soundStore";
import { publish } from "@/components/dev/statsBus";
import { VIDEO_DURATION } from "@/scene/beats";

/**
 * The ambient bed.
 *
 * ## The problem this solves
 *
 * A scrubbed video is never *played*. It is seeked, over and over, to wherever
 * the scroll says it should be. That is fine for pictures and useless for sound:
 * there is no continuous playback for an audio track to ride along with, and
 * naively mirroring the playhead produces a stutter of 16ms fragments that
 * sounds like a jammed tape recorder.
 *
 * So the bed is deliberately NOT slaved to the scrub. It behaves like a room
 * tone:
 *
 *   - While the reader is scrolling, the bed is silent. Shuttling through a
 *     soundtrack produces the same artefact as shuttling a film reel, and it
 *     covers up the picture, which is the thing worth looking at.
 *   - Once scrolling settles, it fades in from the position the video is
 *     actually sitting at, so the sound and the image agree.
 *   - It drifts back into sync if it has fallen more than a third of a second
 *     behind, which happens after a long settle or a backgrounded tab.
 *
 * That means scrolling is silent and reading has atmosphere, which is the
 * opposite trade from a video that machine-guns while you scroll and then falls
 * silent when you stop to read.
 *
 * ## Why not Web Audio
 *
 * A gain node would make the fade in and out sample-accurate instead of relying
 * on `volume` being ramped by the main thread. That is a real improvement and it
 * is not worth an AudioContext here: the fades are 200ms on a bed that is
 * already smoothed by the scroll damping, and an AudioContext has to be created
 * inside a user gesture and resumed on every tab switch, which is a well-known
 * source of bugs for very little audible gain.
 */

/** How long after scrolling stops before the bed fades in. */
const SETTLE_MS = 220;

/** Fade duration, seconds. */
const FADE = 0.2;

/**
 * Playback level.
 *
 * The source measures -20.9 LUFS integrated, which is a documentary foreground
 * level -- correct for a mix, far too hot for something playing under body copy
 * the whole time. At 0.55 it sits roughly 12dB under the dialogue it would be
 * mixed against, which is the conventional bed level.
 */
const LEVEL = 0.55;

/** Beyond this drift the bed is re-seeked rather than left to wander. */
const RESYNC_SECONDS = 0.34;

export function AudioBed() {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    // Re-bound to an explicitly non-null type. TypeScript will not carry the
    // narrowing above into the hoisted function declarations below.
    const audio: HTMLAudioElement = element;

    let frame = 0;
    let disposed = false;
    let level = 0;

    // When the scroll last moved, as a timestamp. Negative infinity means
    // "never", so the bed counts as settled from the very first frame.
    //
    // This was previously a boolean `settling`, initialised to TRUE, and cleared
    // only by a timer that was itself armed only inside the "is moving" branch.
    // So on a page that was opened and never scrolled, `settling` stayed true
    // forever and the `else if (settling)` branch ran on every frame — muting
    // the bed permanently. Clicking the toggle before scrolling did nothing at
    // all; the sound only appeared if you happened to scroll first, which is
    // exactly the "no sound even when I switch it on" report.
    let lastMoveAt = Number.NEGATIVE_INFINITY;

    const duration = VIDEO_DURATION;
    audio.volume = 0;

    /** Fades `audio.volume` toward `target` by `dt` seconds, in place. */
    function ramp(target: number, dt: number) {
      const delta = target - level;
      if (Math.abs(delta) < 0.002) {
        level = target;
        audio.volume = target;
        return;
      }
      // Fraction of the remaining distance to cover this frame, clamped so a
      // huge dt from a backgrounded tab cannot overshoot past the target and
      // oscillate.
      const step = Math.max(-1, Math.min(1, delta * (dt / FADE)));
      level += step;
      audio.volume = level;
    }

    let last = performance.now();
    function tick(now: number) {
      if (disposed) return;
      // Seconds since the previous frame, clamped: after a tab has been
      // backgrounded `now - last` can be many seconds.
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // Deliberately does NOT call scrollStore.step(). The video layer owns the
      // damping and is the only thing that should advance it.
      //
      // This originally called `step(0)` believing it to be a no-op reading the
      // store. It is the opposite: `step(0)` takes the `lag <= 0` branch in
      // scrollStore, which SNAPS progress to target. Calling it from a second
      // rAF loop would therefore have stripped out every bit of damping the
      // video layer applies, and made the background jumpier rather than calmer.
      const moving = Math.abs(scrollStore.target - scrollStore.smoothed) > 1e-4;

      if (moving) {
        lastMoveAt = now;
        ramp(0, dt);
        if (!audio.paused) audio.pause();
      } else if (now - lastMoveAt < SETTLE_MS) {
        // Scrolling has only just stopped; hold the silence for the settle
        // window so a reader who scrolls in bursts does not get a stutter of
        // bed starting and stopping.
        ramp(0, dt);
      } else if (soundStore.enabled) {
        if (audio.paused) {
          // Position first, THEN play. Reversing these produces a click, because
          // the element starts from wherever it was left and jumps.
          const target = scrollStore.smoothed * duration;
          if (Number.isFinite(target) && target >= 0 && target < duration) {
            audio.currentTime = target;
          }
          const started = audio.play();
          if (started && typeof started.catch === "function") {
            started.catch(() => {
              /* autoplay policy, or the element was torn down */
            });
          }
        } else {
          const target = scrollStore.smoothed * duration;
          // Near the end of the piece the target is the final moment, and the
          // bed is allowed to simply run out. Re-seeking it there would snap it
          // backwards every 340ms and click.
          //
          // This previously "held the last moment" by jumping back 1.2s once
          // the playhead passed the end, which looped the final second over and
          // over — an audible stutter roughly once a second for as long as the
          // reader sat on the outro.
          const nearEnd = target >= duration - 0.25;
          if (!nearEnd && Math.abs(audio.currentTime - target) > RESYNC_SECONDS) {
            audio.currentTime = target;
          }
          // Once the bed has genuinely finished, let it rest rather than trying
          // to restart it. The outro is meant to be quiet.
          if (audio.ended || audio.currentTime >= audio.duration - 0.02) {
            audio.pause();
            ramp(0, dt);
            frame = requestAnimationFrame(tick);
            return;
          }
        }
        ramp(LEVEL, dt);
      } else {
        ramp(0, dt);
        if (!audio.paused) audio.pause();
      }

      frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);

    /**
     * React to the toggle from inside the click that flipped it.
     *
     * Autoplay policy is evaluated against the user-activation state at the
     * moment `play()` is called. The rAF loop calls it up to 220ms after the
     * click, and while a click anywhere on the document does grant activation,
     * relying on that is a needless risk — and it is the difference between sound
     * working and not depending on nothing more than the browser's mood.
     *
     * Because `soundStore.set()` runs synchronously inside the button's onClick,
     * this listener is still within the gesture's task, so the play() below is
     * unambiguously user-initiated. The rAF loop then keeps it running.
     */
    const unsubscribe = soundStore.subscribe((enabled) => {
      if (disposed) return;
      if (!enabled) {
        audio.pause();
        level = 0;
        audio.volume = 0;
        publishAudio(false, false, 0, 0);
        return;
      }
      const target = scrollStore.smoothed * duration;
      if (Number.isFinite(target) && target >= 0 && target < duration) {
        audio.currentTime = target;
      }
      const started = audio.play();
      if (started && typeof started.then === "function") {
        started
          .then(() => publishAudio(true, false, LEVEL, audio.currentTime))
          .catch(() => publishAudio(true, true, 0, audio.currentTime));
      }
    });

    function publishAudio(
      enabled: boolean,
      blocked: boolean,
      volume: number,
      at: number
    ) {
      publish({
        soundEnabled: enabled,
        soundBlocked: blocked,
        soundPaused: audio.paused,
        soundVolume: volume,
        soundTime: at,
      });
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      unsubscribe();
      audio.pause();
    };
  }, []);

  return (
    <audio
      ref={audioRef}
      src="/media/ambient.m4a"
      preload="auto"
      // No loop: the bed is meant to end with the piece.
      playsInline
      aria-hidden
      tabIndex={-1}
    />
  );
}