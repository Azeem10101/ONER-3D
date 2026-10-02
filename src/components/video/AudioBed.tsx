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

/**
 * How fast the bed's playhead is allowed to chase the picture, in seconds of
 * audio per second of real time.
 *
 * While the reader is scrolling, the picture moves at whatever rate they choose,
 * sometimes twenty times faster than real time. Setting `currentTime` straight to
 * that target every frame is a discontinuity and clicks. Sliding at a bounded
 * rate turns a stutter of jumps into a continuous sweep, which is what a film
 * scrub actually sounds like.
 *
 * 14x real time is comfortably faster than any normal scroll through a 26-screen
 * page, so during ordinary reading the bed stays locked to the picture, and only
 * a hard fling produces the sweep.
 */
const SCRUB_RATE = 14;

/** Beyond this drift, at rest, the bed is snapped back rather than left to wander. */
const RESYNC_SECONDS = 0.2;

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
    let blocked = false;
    let publishedAt = 0;

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

    /** Sets the playhead, clamped into the element's real duration. */
    function setTime(t: number) {
      const max = Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration - 0.05
        : duration - 0.05;
      if (!Number.isFinite(t)) return;
      audio.currentTime = Math.max(0, Math.min(max, t));
    }

    /**
     * Moves the playhead toward `target` at a bounded rate.
     *
     * A hard `currentTime = target` on every frame while scrolling clicks
     * audibly, because it is a discontinuity. This instead slides at up to
     * SCRUB_RATE seconds of audio per second of real time, which is fast enough to
     * stay under the picture during a normal scroll but cannot produce a click.
     */
    function seekToward(el: HTMLAudioElement, target: number, dt: number) {
      const delta = target - el.currentTime;
      const limit = SCRUB_RATE * dt;
      if (Math.abs(delta) <= limit) {
        el.currentTime = Math.max(0, Math.min(el.duration || duration, target));
      } else {
        el.currentTime = Math.max(0, el.currentTime + Math.sign(delta) * limit);
      }
    }

    /** play(), with the rejection recorded rather than swallowed. */
    function start() {
      const started = audio.play();
      if (started && typeof started.then === "function") {
        started
          .then(() => {
            blocked = false;
          })
          .catch(() => {
            blocked = true;
          });
      }
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

      const target = scrollStore.smoothed * duration;

      if (!soundStore.enabled) {
        ramp(0, dt);
        if (!audio.paused) audio.pause();
      } else if (moving) {
        // Scrubbing, and the bed rides the scrub.
        //
        // This used to pause the bed on every scroll and resume it once the
        // scroll settled, on the theory that shuttling audio is unpleasant. That
        // was the wrong call and it produced the bug the reader reported as "not
        // syncing, not with the scroll".
        //
        // Two things were wrong with it. The bed only re-positioned on the
        // `audio.paused` branch, so while it played it never tracked the scroll
        // at all — it just ran on from wherever it started. The panel showed it
        // plainly: video at 5.29s, sound at 0.00s, and still "playing". And
        // muting meant the bed contributed nothing to the act of scrolling, which
        // is the one thing the piece is about.
        //
        // So the bed is now slaved to the playhead continuously, exactly as the
        // picture is. Scrolling fast produces a fast doppler-ish sweep, which is
        // what a film scrub sounds like and is the correct feedback for "you are
        // moving through this footage".
        // Gentle slew rather than a hard re-seek: a hard jump on every frame
        // would click, and would also fight the browser's own playback rate.
        seekToward(audio, target, dt);
        if (audio.paused) start();
        ramp(LEVEL * 0.85, dt);
      } else {
        if (audio.paused) {
          // Position exactly, then play. Reversing these clicks, because the
          // element starts from wherever it was left and jumps.
          setTime(target);
          start();
        } else {
          // At rest the bed is held to the picture with a tight leash, so it
          // cannot drift away over a long read.
          if (Math.abs(audio.currentTime - target) > RESYNC_SECONDS) {
            setTime(target);
          }
          // The bed is shorter than the piece (10.03s of audio against 9.93s of
          // mapped scroll), so at the very end it would run out and sit silent.
          // Restarting it is the least-bad option: there is no more footage to
          // stay in sync with at that point.
          if (audio.ended || audio.currentTime >= audio.duration - 0.02) {
            setTime(0);
            start();
          }
        }
        ramp(LEVEL, dt);
      }

      // Published on a slow cadence rather than every frame, because the panel
      // only needs to be readable and a React notification per frame would
      // defeat the point.
      if (now - publishedAt > 200) {
        publishedAt = now;
        publishAudio(soundStore.enabled, blocked, audio.paused, level, audio.currentTime, target);
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
        blocked = false;
        publishAudio(false, false, true, 0, audio.currentTime, 0);
        return;
      }
      // Position exactly at the picture's current position before playing, so
      // switching the bed on mid-scroll starts it in the right place rather than
      // at zero. This is the difference between "on" and "audibly wrong".
      setTime(scrollStore.smoothed * duration);
      start();
    });

    function publishAudio(
      enabled: boolean,
      wasBlocked: boolean,
      paused: boolean,
      volume: number,
      at: number,
      pictureTime: number
    ) {
      publish({
        soundEnabled: enabled,
        soundBlocked: wasBlocked,
        soundPaused: paused,
        soundVolume: volume,
        soundTime: at,
        soundPictureTime: pictureTime,
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