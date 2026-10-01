"use client";

import { useEffect, useRef } from "react";
import { scrollStore } from "@/lib/scrollStore";
import { VIDEO_DURATION } from "@/scene/beats";
import { publish } from "@/components/dev/statsBus";

/**
 * The scroll-scrubbed video layer.
 *
 * ## What replaced what
 *
 * This stands where <Canvas> stood. Previously an R3F render loop sampled a
 * camera path from `scrollStore` every frame and drew a procedural scene. Now a
 * single <video> is seeked to `progress * VIDEO_DURATION` every frame, and the
 * footage is the scene.
 *
 * ## Why seeking is not as bad as it sounds
 *
 * The instinct is that `currentTime = x` per frame is expensive, and for a long
 * video on a slow connection it is. But this file is a few MB, the browser is
 * told `preload="auto"`, and nothing is sought until `canplaythrough` fires — at
 * which point the whole clip is buffered and a seek is a local decode, not a
 * network round trip. For a 10-second clip that fits comfortably.
 *
 * Three things make it smooth rather than stuttery, and all three are
 * properties of the FILE rather than of this component:
 *
 *   1. 60fps rather than 24. 600 frames to land on instead of 240.
 *   2. A keyframe every 0.5s rather than every 3.3s. This is the big one: a seek
 *      costs whatever the decoder has to decode forward to reach the target, so
 *      keyframe spacing sets the worst-case cost of a seek directly.
 *   3. A quarter-frame dead zone, so seeks that cannot change the picture are
 *      not issued at all.
 *
 * See `SOURCE_FPS` below and the note on `video.currentTime` in `apply` for why
 * `fastSeek()` is deliberately not used — using it was the original bug.
 *
 * ## Why not requestVideoFrameCallback
 *
 * `requestVideoFrameCallback` fires when a *new frame is presented*, which is
 * the right tool for measuring decode latency but wrong for driving position:
 * on a paused video it simply never fires, so it cannot be used to move the
 * playhead.
 */

/**
 * Frames per second of the source, and therefore the resolution of the
 * scrub.
 *
 * public/media/journey.mp4 is re-encoded to 60fps from a 24fps original. That
 * is not cosmetic: the original had 240 distinct frames across the clip, so at
 * any given scroll position the playhead had at most 240 places it could be, and
 * a smooth scroll had to jump between them. 60fps means 600, so the same scroll
 * distance crosses 2.5x as many frames and each step covers a third of the time.
 *
 * The re-encode is motion-compensated, so those extra frames are synthesised
 * positions rather than copies of their neighbours. Plain frame duplication
 * would have raised the frame count and changed nothing about the motion.
 */
const SOURCE_FPS = 60;

/**
 * Half a frame. Below this, a seek cannot change what is on screen, so issuing
 * one would cost a decode for no visible result.
 *
 * A quarter-frame is used rather than a half. With a 60fps source a half-frame
 * step is 8.3ms, and at the scroll speeds this is driven by that is often two
 * or three consecutive frames of movement getting collapsed into one, which is
 * exactly the visible stepping it is supposed to prevent. Halving it costs one
 * extra seek on a slow scroll and removes the stair-stepping on a fast one.
 */
const FRAME_EPSILON = 1 / (SOURCE_FPS * 4);

/**
 * How hard the playhead chases the scroll.
 *
 * Exponential smoothing, frame-rate independent. 0.28 was tuned when the source
 * was 24fps with three keyframes, where smoothing was doing most of the work of
 * hiding decode lag. With dense keyframes the decoder keeps up on its own, so
 * the lag is no longer needed and only reads as rubber-banding: the footage
 * trailing the text by a visible margin. Lowered to 0.16.
 */
const FOLLOW_LAG = 0.16;

export function VideoLayer() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    // Re-bound to an explicitly non-null type. TypeScript will not carry the
    // narrowing above into the hoisted function declarations below, so without
    // this every use of `video` inside them is `possibly null`.
    const video: HTMLVideoElement = element;

    let frame = 0;
    let timer = 0;
    let ready = false;
    let primed = false;
    let disposed = false;
    let seeksThisSecond = 0;

    // The value we last ASKED for, as opposed to video.currentTime, which is
    // the value the browser says it has reached. Comparing against the request
    // rather than the report is what stops a seek being re-issued every frame
    // while the decoder catches up.
    let lastRequested = -1;

    // Read from the element once metadata has actually arrived, not at mount.
    //
    // At mount `video.duration` is NaN, because the <source> child is still
    // being fetched, so this used to fall back to the constant in beats.ts. That
    // happened to agree with the file and so went unnoticed — but it means the
    // scrub was mapped against a number the browser had not confirmed, and if
    // they ever disagree the last beat lands in the wrong place. `loadedmetadata`
    // below replaces it with the truth.
    let duration = VIDEO_DURATION;

    function apply(progress: number) {
      // Nothing is seekable until metadata has loaded. Assigning currentTime
      // before HAVE_METADATA is not an error, it is silently DISCARDED — and
      // that discard is the bug this guard exists to prevent.
      //
      // The original code advanced `lastRequested` to the target before issuing
      // the seek, so a seek dropped this way was still recorded as delivered. The
      // moment the reader stopped scrolling, `target` stopped changing, the
      // dead-zone test below started skipping, and the playhead was never moved
      // again: a permanently frozen first frame, showing the poster, for the rest
      // of the session. Because the drop is silent there was nothing to log and
      // nothing to see except a background that would not move.
      if (video.readyState < 1 /* HAVE_METADATA */) return;

      const target = progress * duration;

      // The two clamped ends always go through exactly. The epsilon test below
      // is an absolute-distance test, so a backwards scrub that happens to land
      // within a quarter-frame of the current value is correctly skipped — but
      // the very first and last frames must not depend on that.
      if (target <= 0) {
        if (lastRequested !== 0) {
          video.currentTime = 0;
          lastRequested = 0;
          seeksThisSecond++;
        }
        return;
      }
      if (target >= duration) {
        if (lastRequested !== duration) {
          video.currentTime = duration;
          lastRequested = duration;
          seeksThisSecond++;
        }
        return;
      }

      if (Math.abs(target - lastRequested) < FRAME_EPSILON) return;
      lastRequested = target;
      seeksThisSecond++;

      // Exact seek. Deliberately NOT `fastSeek()`.
      //
      // `fastSeek` is allowed to land on any nearby frame rather than the one
      // asked for, which sounds ideal and is not: on this material it lands on
      // the nearest KEYFRAME, and the original had three across ten seconds —
      // one every 3.3s. So a fastSeek could put the playhead up to 3.3 seconds
      // from where the scroll said it should be, which is not a subtle stutter
      // but a jump across whole scenes, and it got worse the faster you scrolled.
      //
      // The keyframe density is fixed at encode time instead (a fixed 30-frame
      // GOP, 0.5s), so an exact seek now has at most 0.5s to decode forward
      // rather than 3.3s. That is the real fix, and it does not cost accuracy.
      video.currentTime = target;
    }

    function tick() {
      if (disposed) return;

      // Damped, so a flung scrollbar does not turn into a strobe.
      scrollStore.step(FOLLOW_LAG);

      if (ready) {
        apply(scrollStore.smoothed);

        // Watchdog.
        //
        // A seek can be dropped without any error being raised — a decode
        // cancelled by a resize, a backgrounded tab, a media-element reload.
        // The dead-zone check in apply() compares against `lastRequested`, which
        // is what we ASKED for, not where the playhead ended up, so a dropped
        // seek is invisible to it and the drift becomes permanent.
        //
        // This re-asserts the playhead whenever the scroll has settled and the
        // two have diverged. It costs one comparison per frame at rest and turns
        // every silent-drop failure mode into a self-correcting one.
        const atRest = Math.abs(scrollStore.target - scrollStore.smoothed) < 1e-4;
        if (
          atRest &&
          video.readyState >= 2 /* HAVE_CURRENT_DATA */ &&
          lastRequested >= 0 &&
          Math.abs(video.currentTime - lastRequested) > FRAME_EPSILON * 2
        ) {
          video.currentTime = lastRequested;
          seeksThisSecond++;
        }
      }

      frame = requestAnimationFrame(tick);
    }

    /**
     * Diagnostics. Sampled on a timer rather than every frame, because the
     * whole point is to read a sustained condition and a per-frame React
     * notification would defeat that.
     *
     * `lagMs` is the only metric that matters and it is the difference between
     * where the scroll wants the playhead and where the browser has actually
     * put it. One frame of the 60fps source is 16.7ms; anything consistently
     * beyond that means the footage is trailing the text.
     */
    function sample() {
      if (disposed) return;
      const ranges = video.buffered;
      let ahead = 0;
      for (let i = 0; i < ranges.length; i++) {
        if (ranges.start(i) <= video.currentTime && ranges.end(i) >= video.currentTime) {
          ahead = ranges.end(i) - video.currentTime;
          break;
        }
      }
      publish({
        requested: lastRequested,
        actual: video.currentTime,
        lagMs: (lastRequested - video.currentTime) * 1000,
        seeksPerSecond: seeksThisSecond,
        buffered: ahead,
        ready,
        readyState: video.readyState,
        primed,
        width: video.videoWidth,
        height: video.videoHeight,
        duration,
        frames: Math.round(duration * SOURCE_FPS),
      });
      seeksThisSecond = 0;
      timer = window.setTimeout(sample, 1000);
    }

    function onReady() {
      if (ready) return;
      ready = true;

      // Prime the media pipeline, exactly once.
      //
      // Some engines will not present a seeked frame for a <video> that has
      // never been played — the decode is requested but nothing commits it to
      // the compositor, and the element just sits on its poster. A single muted
      // play/pause cycle is the standard way to commit it.
      //
      // It is paused again immediately and the playhead is re-asserted straight
      // after, so nothing is audible and no motion is shown. The promise is
      // caught because a rejected play() is not exceptional here — autoplay
      // policy, an unsupported source, a torn-down element all land in the same
      // place, and the watchdog covers us if the prime did not take.
      const priming = video.play();
      primed = true;
      if (priming && typeof priming.then === "function") {
        priming.then(() => video.pause()).catch(() => { /* covered by the watchdog */ });
      } else {
        video.pause();
      }

      // The browser parks a paused video at 0. Without this the first frame
      // after load would be frame zero even if the reader had already scrolled.
      apply(scrollStore.smoothed);
    }

    /**
     * Adopt the element's real duration and real intrinsic size the moment the
     * browser tells us, rather than trusting the constant.
     *
     * `VIDEO_DURATION` is a hard-coded value that check-beats.ts verifies against
     * the file's mvhd atom. It is right, but it is a second source of truth, and
     * a `<video>` already knows the answer. Taking the element's word costs
     * nothing and removes the possibility of the two disagreeing at runtime.
     */
    function onMetadata() {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        duration = video.duration;
      }
      // Metadata means seeking is now legal, so put the playhead where the
      // scroll already is. Without this, a reader who scrolled during load would
      // sit on frame zero until they moved again.
      if (ready) apply(scrollStore.smoothed);
      else if (video.readyState >= 2 /* HAVE_CURRENT_DATA */) onReady();
    }

    video.addEventListener("loadedmetadata", onMetadata);
    video.addEventListener("canplaythrough", onReady, { once: true });

    // If `canplaythrough` never arrives — a stalled connection, an element the
    // browser decided to lazy-load — still start scrubbing, but ONLY once the
    // element genuinely has data. Setting `ready` unconditionally was the second
    // half of the frozen-frame bug: it declared the video usable while every seek
    // was being discarded, and nothing ever corrected it.
    const bail = window.setTimeout(() => {
      if (video.readyState >= 2) onReady();
    }, 6000);

    frame = requestAnimationFrame(tick);
    timer = window.setTimeout(sample, 1000);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(bail);
      window.clearTimeout(timer);
      video.removeEventListener("canplaythrough", onReady);
      video.removeEventListener("loadedmetadata", onMetadata);
    };
  }, []);

  return (
    <video
      ref={videoRef}
      className="fixed inset-0 z-0 h-full w-full object-cover"
      // `poster` is what a visitor sees before the first frame decodes, and what
      // they see if JavaScript never runs at all. It is the establishing aerial.
      poster="/media/poster.jpg"
      preload="auto"
      // Muted because the element is primed with one play/pause cycle (see
      // onReady), which autoplay policy only permits on a muted element, and
      // because scrubbing must never produce a burst of audio.
      muted
      playsInline
      // Not decorative: the footage is the entire narrative, so it is labelled
      // for assistive tech rather than hidden.
      aria-label="Aerial footage of the Orion Manufacturing Plant: rainforest cleared around an industrial mill, three chimneys emitting a dark plume, and an outfall pipe discharging into the lake."
      tabIndex={-1}
    >
      <source src="/media/journey.mp4" type="video/mp4" />
    </video>
  );
}