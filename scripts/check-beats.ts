/**
 * Is the narrative still lined up with the footage?
 *
 *   npx tsx scripts/check-beats.ts
 *
 * ## What replaced what
 *
 * Six checks used to live here, all of them about the WebGL scene that no
 * longer exists: terrain relief and lake containment, world layout and factory
 * clearance, camera seam velocity continuity, plume sprite budget, fish
 * placement, and sky luminance versus ground.
 *
 * None of those questions apply to a video element. This replaces them with the
 * one question that does: **does the copy still arrive when the picture does?**
 *
 * ## Why that can silently break
 *
 * The beats are timed in video seconds and the scroll fractions are derived from
 * them. So the mapping is correct by construction — but only as long as two
 * independent numbers agree: `VIDEO_DURATION` in beats.ts, and the real duration
 * of public/media/journey.mp4. Change the video, trim a frame, re-encode with a
 * different container, and they diverge.
 *
 * The failure is nasty precisely because it is silent. If VIDEO_DURATION is
 * longer than the file, the last beat's text appears at a scroll position the
 * footage has already run past, and every beat after the divergence is late by
 * a constant offset. Nothing throws. It just looks slightly out of sync, which
 * reads as "the animation feels off" rather than as a bug.
 *
 * So this reads the file's real duration and asserts they match.
 */

import { existsSync, statSync } from "node:fs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BEATS,
  EPILOGUE,
  TOTAL_VH,
  VIDEO_DURATION,
  VIDEO_FPS,
  beatIndexAt,
  progressAt,
  timeAt,
} from "../src/scene/beats";

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

console.log("\nONER beat check");
console.log("=".repeat(68));

// --- The file exists --------------------------------------------------------
console.log("\nMedia");
const mediaPath = resolve(process.cwd(), "public/media/journey.mp4");
const posterPath = resolve(process.cwd(), "public/media/poster.jpg");

check(
  "public/media/journey.mp4 exists",
  existsSync(mediaPath),
  `expected at ${mediaPath}`
);

if (existsSync(mediaPath)) {
  const bytes = statSync(mediaPath).size;
  // 12 MB is roughly the point where a first-visit payload stops being
  // defensible for a single background asset. This file is 7 MB.
  check(
    "the video is a sane download size",
    bytes < 12 * 1024 * 1024,
    `${(bytes / 1024 / 1024).toFixed(1)} MB`
  );
}

check(
  "public/media/poster.jpg exists, for before-first-frame and no-JS",
  existsSync(posterPath),
  `expected at ${posterPath}`
);

// --- The ambient bed --------------------------------------------------------
//
// Extracted from the source footage's own audio track, which measures -20.9
// LUFS integrated and -3.1 dBFS true peak: a clean documentary mix with ample
// headroom, so it is worth keeping at full quality rather than re-encoding.
//
// It lives in its own file rather than in the video's audio track, because the
// video element is muted and never played — there is no continuous playback for
// an audio track to ride along with. A separate <audio> element is driven by the
// scroll instead.
const audioPath = resolve(process.cwd(), "public/media/ambient.m4a");
check("public/media/ambient.m4a exists", existsSync(audioPath), `expected at ${audioPath}`);

if (existsSync(audioPath)) {
  const audioBytes = statSync(audioPath).size;
  check(
    "the ambient bed is small enough to not matter",
    audioBytes < 512 * 1024,
    `${(audioBytes / 1024).toFixed(0)} KB`
  );
  // An m4a carries its own moov, and the bed has to be playable the instant the
  // reader hits the toggle. A moov at the end means a round trip first.
  const audioHead = readFileSync(audioPath).subarray(0, 4096).toString("latin1");
  check(
    "the audio is faststart, so the toggle is instant",
    audioHead.indexOf("moov") >= 0 && audioHead.indexOf("moov") < audioHead.indexOf("mdat"),
    audioHead.indexOf("moov") < 0
      ? "no moov in the first 4KB"
      : "moov appears after mdat"
  );
}

// --- The declared duration matches the file ---------------------------------
//
// Read out of the MP4 container directly rather than shelling out to ffprobe,
// because ffprobe is not a dependency of this project and a check that only
// runs on one machine is not a check.
//
// The `mvhd` atom's own fields carry timescale and duration, and the box is at a
// fixed offset from the start of the `moov` atom, so this is enough to locate
// it without walking the atom tree.
function durationFromMp4(path: string): number | null {
  const buf = readFileSync(path);
  const text = buf.toString("latin1");

  const moovIndex = text.indexOf("moov");
  if (moovIndex < 0) return null;

  const mvhdIndex = text.indexOf("mvhd", moovIndex);
  if (mvhdIndex < 0) return null;

  // version(1) + flags(3), then either
  //   v0: created(4) modified(4) timescale(4) duration(4)
  //   v1: created(8) modified(8) timescale(4) duration(8)
  const version = buf[mvhdIndex + 4];
  const p = mvhdIndex + 4 + 4;

  if (version === 1) {
    const timescale = buf.readUInt32BE(p + 16);
    const hi = buf.readUInt32BE(p + 20);
    const lo = buf.readUInt32BE(p + 24);
    return (hi * 2 ** 32 + lo) / timescale;
  }
  const timescale = buf.readUInt32BE(p + 8);
  const duration = buf.readUInt32BE(p + 12);
  return duration / timescale;
}

if (existsSync(mediaPath)) {
  const real = durationFromMp4(mediaPath);
  check(
    "the MP4 duration could be read from the container",
    real !== null,
    "no mvhd atom found — is this really an MP4?"
  );
  if (real !== null) {
    // A tenth of a second is a tenth of a second of copy arriving late; tighter
    // than that and a normal re-encode would fail the build for no reason.
    check(
      "VIDEO_DURATION matches the file's real duration",
      Math.abs(real - VIDEO_DURATION) < 0.1,
      `declared ${VIDEO_DURATION.toFixed(3)}s, file is ${real.toFixed(3)}s — ` +
        `${real > VIDEO_DURATION ? "the last beats would never play" : "the last beat is cut off early"}`
    );
  }
}

// --- Scrub quality: frame rate and keyframe density --------------------------
//
// These two are the properties that decide whether scrubbing looks smooth, and
// neither is visible from the app. Nothing about a <video> element tells you that
// the file has three keyframes in ten seconds; you find out by scrolling and
// concluding that it "feels choppy", which is exactly what happened.
//
// A seek costs whatever the decoder must decode forward to reach the target, and
// that is bounded by the distance to the nearest preceding keyframe. So keyframe
// spacing sets the worst-case cost of a seek directly, and a file with one
// keyframe every 3.3s makes every seek up to 3.3s of decoding.
//
// The original Gemini export had exactly that: 3 keyframes, 24fps. It is
// re-encoded to 60fps with a fixed 30-frame GOP. These assertions exist so that
// swapping in a fresh export cannot quietly reintroduce it.

/** Boxes whose payload is a list of further boxes rather than data. */
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf"]);

/**
 * Walk the MP4 box tree and return the first occurrence of each named box.
 *
 * `mvhd` alone is a fixed offset from `moov` and can be found with indexOf, but
 * the sample tables are not — they sit under moov/trak/mdia/minf/stbl and
 * sibling tracks may appear in any order, so the boxes genuinely have to be
 * walked. Doing it here rather than shelling out to ffprobe keeps the check
 * runnable on a machine with no ffmpeg, which is the point of a check.
 */
function findBoxes(
  buf: Buffer,
  start: number,
  end: number
): Map<string, { start: number; end: number }> {
  const found = new Map<string, { start: number; end: number }>();
  let p = start;

  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString("latin1", p + 4, p + 8);
    let header = 8;

    if (size === 1) {
      // 64-bit extended size.
      if (p + 16 > end) break;
      size = Number(buf.readBigUInt64BE(p + 8));
      header = 16;
    } else if (size === 0) {
      size = end - p;
    }

    if (size < header || p + size > end) break;

    if (!found.has(type)) found.set(type, { start: p + header, end: p + size });

    if (CONTAINERS.has(type)) {
      for (const [name, range] of findBoxes(buf, p + header, p + size)) {
        if (!found.has(name)) found.set(name, range);
      }
    }

    p += size;
  }
  return found;
}

if (existsSync(mediaPath)) {
  console.log("\nScrub quality");
  const buf = readFileSync(mediaPath);
  const boxes = findBoxes(buf, 0, buf.length);

  // stsz: sample_size(4) then sample_count(4), or a per-sample table if
  // sample_size is 0. Either way sample_count is at the same offset.
  const stsz = boxes.get("stsz");
  const frames = stsz ? buf.readUInt32BE(stsz.start + 8) : 0;

  check(
    "the sample table could be read",
    frames > 0,
    "no stsz box — is this really an MP4 with a video track?"
  );

  const real = durationFromMp4(mediaPath);
  const fps = real && frames > 0 ? frames / real : 60;

  if (frames > 0 && real) {
    console.log(`  ${frames} frames over ${real.toFixed(3)}s = ${fps.toFixed(1)} fps`);
    // The scrub can only be as smooth as the number of distinct frames the
    // playhead has to land on. 240 frames over a 15-screen scroll means each
    // scroll step jumps several frames; 600 gives 2.5x the resolution.
    check(
      "the source is 60fps, so a scrub has 600 frames to land on",
      fps >= 55,
      `${fps.toFixed(1)} fps — at 24fps there are only ${frames} ` +
        `pictures for the whole clip and scrubbing visibly steps`
    );
  }

  // stss: the sync-sample table. version/flags(4), entry_count(4), then one
  // uint32 per keyframe, 1-based sample numbers. If stss is absent, every
  // sample is a keyframe.
  const stss = boxes.get("stss");
  const keyframes = stss ? buf.readUInt32BE(stss.start + 4) : frames;

  // The WORST gap, not the average.
  //
  // The first version of this check divided duration by the keyframe count and
  // called the result the worst-case seek cost. That is the mean GOP, and a mean
  // is exactly the wrong statistic here: a file with one 8-second stall in the
  // middle and dense keyframes everywhere else has a small mean and a terrible
  // worst case, and it is the stall that makes one seek in the piece feel broken.
  //
  // Sample numbers are 1-based, and sample n sits at (n - 1) / fps.
  const sampleTimes: number[] = [];
  if (stss) {
    for (let i = 0; i < keyframes; i++) {
      sampleTimes.push((buf.readUInt32BE(stss.start + 8 + i * 4) - 1) / fps);
    }
  }

  let worstGap = 0;
  for (let i = 1; i < sampleTimes.length; i++) {
    worstGap = Math.max(worstGap, sampleTimes[i] - sampleTimes[i - 1]);
  }
  const meanGap = sampleTimes.length > 1
    ? (sampleTimes[sampleTimes.length - 1] - sampleTimes[0]) / (sampleTimes.length - 1)
    : 0;

  console.log(
    `  ${keyframes} keyframes · mean gap ${meanGap.toFixed(3)}s · ` +
      `WORST gap ${worstGap.toFixed(3)}s (${(worstGap * fps).toFixed(0)} frames)`
  );

  check(
    "keyframe density is high enough that a seek is cheap",
    keyframes >= 15,
    `${keyframes} keyframes over ${(real ?? 0).toFixed(1)}s. Every seek decodes forward ` +
      `from the previous keyframe, so this bounds the worst case. The original Gemini export ` +
      `had 3, one every 3.3s, which is what made scrubbing feel choppy.`
  );

  // 0.75s of decode-forward is 45 frames at 60fps. Hardware H.264 decode runs at
  // several hundred frames per second for 720p, so that completes well inside a
  // single 60fps frame interval (16.7ms) and is not the thing limiting the scrub.
  // The frame RATE and the exactness of the seek are; keyframe spacing only had
  // to come down far enough to stop dominating them.
  check(
    "the worst-case seek cost stays under 0.75s of decode-forward",
    worstGap < 0.75,
    `${worstGap.toFixed(2)}s worst-case gap = ${(worstGap * fps).toFixed(0)} frames to decode ` +
      `forward per seek`
  );
}

// --- Beats tile the clip exactly --------------------------------------------
console.log("\nBeats");

check("the first beat starts at 0", BEATS[0].start === 0, `got ${BEATS[0].start}`);

const last = BEATS[BEATS.length - 1];
check(
  "the last beat ends exactly at the end of the clip",
  Math.abs(last.end - VIDEO_DURATION) < 1e-9,
  `got ${last.end}, expected ${VIDEO_DURATION}`
);

let gaps = 0;
let inversions = 0;
for (let i = 1; i < BEATS.length; i++) {
  const previous = BEATS[i - 1];
  const beat = BEATS[i];
  if (Math.abs(previous.end - beat.start) > 1e-9) {
    gaps++;
    console.log(`         gap or overlap between "${previous.id}" and "${beat.id}"`);
  }
  if (beat.end <= beat.start) inversions++;
}
check("no gaps or overlaps between beats", gaps === 0, `${gaps} seam(s) broken`);
check("every beat has positive length", inversions === 0, `${inversions} zero-length`);

check(
  "every beat fits inside the clip",
  BEATS.every((b) => b.start >= 0 && b.end <= VIDEO_DURATION + 1e-9),
  BEATS.filter((b) => b.start < 0 || b.end > VIDEO_DURATION + 1e-9)
    .map((b) => b.id)
    .join(", ")
);

// --- Derived scroll mapping --------------------------------------------------
console.log("\nScroll mapping");

check(
  "scroll maps to the whole clip, end to end",
  timeAt(0) === 0 && Math.abs(timeAt(1) - VIDEO_DURATION) < 1e-9,
  `timeAt(1) = ${timeAt(1).toFixed(3)}`
);

check(
  "timeAt clamps outside 0..1",
  timeAt(-0.5) === 0 && timeAt(1.5) === VIDEO_DURATION,
  `got ${timeAt(-0.5)} and ${timeAt(1.5)}`
);

check(
  "progressAt is the inverse of timeAt",
  Math.abs(timeAt(progressAt(3.5)) - 3.5) < 1e-9,
  `round trip gave ${timeAt(progressAt(3.5))}`
);

// A text block long enough to read needs scroll room. Under about 0.9s of
// footage a paragraph cannot be read before it fades, and that is a copy problem
// rather than a timing one — but it is worth surfacing.
const tooShort = BEATS.filter((b) => b.end - b.start < 0.9);
check(
  "no beat is too short to read its own paragraph",
  tooShort.length === 0,
  tooShort.length > 0
    ? `${tooShort.map((b) => `"${b.id}" at ${(b.end - b.start).toFixed(2)}s`).join(", ")}`
    : ""
);

const viewportSeconds = (100 / TOTAL_VH) * VIDEO_DURATION;

// Scroll step per video frame, in pixels, at a reference viewport.
//
// This is the number that decides whether scrubbing reads as smooth or as
// chopped, and it is not a property of the decoder at all. It is the
// distribution of 596 frames across however many pixels the reader has to
// scroll through. A mouse wheel notch is ~100px, so `framesPerNotch` is how many
// video frames the picture jumps by on a single click.
//
// TOTAL_VH is in units of 1vh, and 1vh is ONE PERCENT of the viewport, so the
// total scrollable distance is TOTAL_VH/100 viewports. The first version of this
// omitted that /100 and reported 6107px per frame, which would have meant the
// smoothness dial was a hundred times less effective than it is.
const REF_VIEWPORT_PX = 1400;
const totalScrollPx = (TOTAL_VH / 100) * REF_VIEWPORT_PX;
const frameCount = Math.round(VIDEO_DURATION * VIDEO_FPS);
const pxPerFrame = totalScrollPx / frameCount;
const framesPerNotch = 100 / pxPerFrame;

console.log(
  `\n  ${TOTAL_VH}vh of scroll for ${VIDEO_DURATION.toFixed(2)}s of footage:` +
    `\n    one screen scrolled = ${viewportSeconds.toFixed(2)}s of video` +
    `\n    one beat = ${((BEATS[0].end - BEATS[0].start) / VIDEO_DURATION * TOTAL_VH).toFixed(0)}vh` +
    ` at the shortest` +
    `\n    ${Math.round(totalScrollPx)}px of scroll total, ${pxPerFrame.toFixed(0)}px per video frame` +
    `\n    a 100px wheel notch moves ${framesPerNotch.toFixed(1)} frames`
);

// Above about 2.5 frames per notch the picture visibly skips. This is a much
// more useful place to catch a regression than a frame-time measurement, because
// a perfectly healthy scrub can still step this coarsely.
check(
  "a wheel notch does not skip more than about 2.5 video frames",
  framesPerNotch <= 2.5,
  `a notch moves ${framesPerNotch.toFixed(1)} frames at ${TOTAL_VH}vh — ` +
    `raise TOTAL_VH in beats.ts. Smoothness is linear in that number, and page ` +
    `length is the only thing it costs.`
);

// --- Every beat resolves to itself -------------------------------------------
console.log("\nLookup");

let lookupFails = 0;
for (let i = 0; i < BEATS.length; i++) {
  // Sample inside the beat, clear of its fades.
  const midpoint = progressAt((BEATS[i].start + BEATS[i].end) / 2);
  if (beatIndexAt(midpoint) !== i) {
    lookupFails++;
    console.log(`         "${BEATS[i].id}" does not resolve to itself at its midpoint`);
  }
}
check(
  "every beat resolves to itself at its midpoint",
  lookupFails === 0,
  `${lookupFails} beat(s) misresolved`
);

// --- Copy -------------------------------------------------------------------
console.log("\nCopy");

const ids = new Set<string>();
const dupeIds = BEATS.filter((b) => (ids.has(b.id) ? true : (ids.add(b.id), false)));
check("beat ids are unique", dupeIds.length === 0, dupeIds.map((b) => b.id).join(", "));

const noBody = BEATS.filter((b) => b.body.trim().length < 40);
check(
  "every beat has real body copy",
  noBody.length === 0,
  noBody.map((b) => b.id).join(", ")
);

const noLabel = BEATS.filter((b) => b.label.trim().length === 0);
check("every beat has a HUD label", noLabel.length === 0, noLabel.map((b) => b.id).join(", "));

check(
  "the epilogue has a headline and a call to action",
  EPILOGUE.headline.length > 0 && EPILOGUE.cta.length > 0
);

// --- Accessibility ----------------------------------------------------------
console.log("\nAccessibility");

const source = readFileSync(resolve(process.cwd(), "src/components/video/VideoLayer.tsx"), "utf8");

/**
 * The source with comments removed, for the structural assertions below.
 *
 * This matters because the file explains at length why it does NOT do several
 * things — including `fastSeek`, by name, in prose containing the exact
 * `fastSeek()` spelling the check looks for. Asserting against the raw text
 * therefore failed on a comment describing the thing the check is guarding
 * against, which is the worst possible failure mode for a check: it reports a
 * violation that is documentation of its own absence.
 *
 * Naive but adequate here: this is our own source, not arbitrary input, and the
 * only risk is a `//` inside a string literal, which this file does not contain.
 */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");
check(
  "the video has an aria-label, since it carries the whole narrative",
  /aria-label=/.test(source),
  "a <video> with no label is announced as an unlabelled media element"
);
check(
  "the video is muted, so it never fights the scrub",
  /\bmuted\b/.test(source)
);
check(
  "the video has a poster, for before-first-frame and no-JS",
  /poster=/.test(source)
);
check(
  "the video is playsInline, so iOS does not hijack it fullscreen",
  /playsInline/.test(source)
);

// --- Scrubber guards --------------------------------------------------------
//
// These are assertions about the SHAPE of the scrubber rather than about the
// media, and they exist because of a bug that produced a completely silent
// failure: the background froze on its poster and never moved again.
//
// Assigning `currentTime` before the element reaches HAVE_METADATA is not an
// error — the browser discards it. The original code recorded the target as
// delivered before issuing the seek, so once the reader stopped scrolling the
// dead-zone check skipped forever and the playhead was never moved again. The
// six-second fallback timer made it worse by marking the video "ready" while
// every seek was still being thrown away.
//
// There is no test for any of this and no way to catch it without a browser, so
// the guards are asserted structurally: if someone simplifies the readiness
// handling, this fails.
console.log("\nScrubber");

check(
  "apply() refuses to seek before HAVE_METADATA",
  /readyState\s*<\s*1/.test(code),
  "a seek issued before metadata loads is silently discarded by the browser"
);

check(
  "the fallback timer only enables scrubbing once data exists",
  /setTimeout\([\s\S]{0,240}readyState\s*>=\s*2/.test(code),
  "an unconditional fallback marks the video ready while seeks are still being dropped"
);

check(
  "the real duration is read from the element, not assumed at mount",
  /addEventListener\(\s*["']loadedmetadata["']/.test(code) &&
    /duration\s*=\s*video\.duration/.test(code),
  "at mount video.duration is NaN, so anything read then is a guess"
);

check(
  "a dropped seek is re-asserted by a watchdog",
  /video\.currentTime\s*=\s*lastRequested/.test(code) && /atRest/.test(code),
  "without this, any silently dropped seek becomes permanent drift"
);

check(
  "the media pipeline is primed once with play/pause",
  /video\.play\(\)/.test(code) && /video\.pause\(\)/.test(code),
  "some engines will not present a seeked frame for a never-played video"
);

check(
  "fastSeek is genuinely not called, not merely mentioned",
  !/fastSeek/.test(code),
  "fastSeek lands on the nearest keyframe, which was 3.3s away in the source"
);

// --- The ambient bed's gate --------------------------------------------------
//
// The bed used to be gated on a boolean `settling` that was initialised to true
// and cleared only by a timer armed inside the "the scroll is moving" branch.
// On a page that was opened and never scrolled — which is exactly what happens
// when someone clicks the sound toggle straight away — that branch never ran,
// `settling` stayed true forever, and the `else if (settling)` arm muted the bed
// on every frame. Sound only appeared if you happened to scroll first.
//
// The gate is now derived from a timestamp of the last movement, initialised to
// negative infinity so the bed counts as settled from the very first frame.
const audioSource = readFileSync(
  resolve(process.cwd(), "src/components/video/AudioBed.tsx"),
  "utf8"
);
const audioCode = audioSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

check(
  "the bed is settled from the first frame, not gated shut",
  /lastMoveAt\s*=\s*Number\.NEGATIVE_INFINITY/.test(audioCode),
  "a gate that starts closed means no sound until the reader happens to scroll"
);

check(
  "the bed has no boolean settle flag to get stuck",
  !/let\s+settling\s*=/.test(audioCode) && !/settleTimer/.test(audioCode),
  "the settle gate must be derived from a timestamp, not a flag cleared by a timer"
);

check(
  "play() is called from inside the toggle's user gesture",
  /soundStore\.subscribe\(/.test(audioCode) && /audio\.play\(\)/.test(audioCode),
  "play() from a rAF callback can be refused by autoplay policy"
);

check(
  "the bed never calls scrollStore.step()",
  !/scrollStore\.step\(/.test(audioCode),
  "step(0) SNAPS progress to target and would strip out all damping; only the " +
    "video layer may advance the store"
);

check(
  "the bed is not looped",
  !/\bloop\b/.test(audioCode),
  "looping the ambient bed would desynchronise it from the picture"
);

console.log();
if (failures > 0) {
  console.log(`FAIL — ${failures} failure(s).`);
  process.exitCode = 1;
} else {
  console.log("PASS");
}