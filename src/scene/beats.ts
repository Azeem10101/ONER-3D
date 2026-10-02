/**
 * BEATS
 * =====
 * The narrative structure, timed in VIDEO SECONDS.
 *
 * ## Why seconds and not scroll fractions
 *
 * The previous version of this file timed 16 camera shots as fractions of scroll
 * progress, and the camera path was generated from those fractions. That worked
 * because the thing being timed and the thing being scrolled were the same
 * system.
 *
 * They are not any more. The footage is a fixed 10.027s file with its own
 * internal cuts — the label for CO appears at 2.4s because the generator put it
 * there, not because of anything we decide. So the copy has to be timed against
 * the video, and the only honest unit for that is seconds. Scroll fractions are
 * then *derived* from seconds, which is what `beatAt` and `beatVisibility` do.
 *
 * Writing the fractions by hand would let the copy and the footage drift apart
 * silently: change the video and every label lands on the wrong frame, with
 * nothing to notice it. check-beats.ts asserts the derived fractions still tile
 * 0..1 exactly and that no beat runs past the end of the file.
 *
 * ## The beat boundaries
 *
 * Taken from the clip itself: the on-screen annotations appear at these times,
 * so the prose is timed to arrive as each label does rather than fighting it.
 */

/**
 * Duration of public/media/journey.mp4, seconds. Verified by check-beats.ts,
 * which reads it out of the MP4's mvhd atom rather than trusting this number.
 *
 * It was 10.027 against the original Gemini export and is 9.934 now. The original
 * declared 27ms more than its 240 frames actually contained, and the
 * motion-compensated re-encode to 60fps produced 596 frames — 9.934s. Nothing
 * shifted in the content; only the tail padding differs. Both are recorded here
 * because the constant is load-bearing: it divides the scroll into beat
 * fractions.
 */
export const VIDEO_DURATION = 9.934;

/** Frame rate of the same file. Re-encoded from 24; see the encode notes. */
export const VIDEO_FPS = 60;

export type Metric = { label: string; value: string; note?: string };

export type Beat = {
  id: string;
  /** Short label for the fixed HUD readout, top right. */
  label: string;
  /** Start, in seconds of video. */
  start: number;
  /** End, in seconds of video. */
  end: number;
  /** Displayed heading in the scroll column. */
  heading: string;
  /** Body copy. Plain prose — the footage carries its own metric labels. */
  body: string;
  /** The figures worth pinning down. More than one where the footage shows
   *  several annotations at once. */
  metrics: Metric[];
  /** Which ONER dashboard metric this relates to. */
  onerMetric?: string;
};

/**
 * Five beats, not six.
 *
 * ## The boundaries are read off THIS clip, and the clip has changed
 *
 * The boundaries are not stylistic choices — they are the times at which this
 * particular video puts its annotations on screen. They were measured by
 * sampling the footage every 0.4s and looking at what was actually labelled.
 *
 * Measured on the current clip (gemini_generated_video_0169f839):
 *
 *     2.6s          no annotation yet
 *     2.9 - 4.4s    CO and NO₂
 *     4.1 - 5.2s    all four: CO, NO₂, PM₂.₅ and SO₂
 *     5.2 - 6.0s    fading
 *     6.0 - 8.4s    camera retreating to the aerial
 *     8.5s+         Nitrogen and Phosphorus at the outfall
 *
 * The previous clip was timed differently — CO arrived at 3.2s rather than 2.9s,
 * and the four-label moment ran 4.4-5.6s rather than 4.1-5.2s. Copy timed to one
 * clip lands under the wrong frame on the next, silently, with nothing to notice
 * it. **If the video is ever replaced, re-measure these numbers; do not carry
 * them across.**
 *
 * Two labels per beat, not one per pollutant, because the video never shows them
 * one at a time. At 4.4s all four are on screen simultaneously.
 */
export const BEATS: Beat[] = [
  {
    id: "site",
    label: "The site",
    start: 0,
    end: 2.85,
    heading: "Orion Manufacturing Plant",
    body:
      "Eleven hundred acres of rainforest, cleared once. A pulp and paper mill, a thermal generator, and a lake that used to belong to the trees. The plume leaves all of it from three stacks, and everything downstream starts here.",
    metrics: [{ label: "Site", value: "1,140", note: "acres, cleared 1974" }],
    onerMetric: "Facility",
  },
  {
    id: "co-no2",
    label: "CO and NO₂",
    start: 2.85,
    end: 4.1,
    heading: "CO, and the NO₂ it makes for you",
    body:
      "Carbon monoxide is a direct read on incomplete combustion — a burner not performing to design. NO₂ is not released at all: at 1500 °C inside the chamber, atmospheric nitrogen and oxygen combine, so the molecule is manufactured on site by heat alone.",
    metrics: [
      { label: "CO safe exposure", value: "< 50", note: "ppm, 8-hour average" },
      { label: "NO₂ health benchmark", value: "40", note: "µg/m³ annual mean (EU)" },
    ],
    onerMetric: "CO → NOx",
  },
  {
    id: "pm25-so2",
    label: "PM₂.₅ and SO₂",
    start: 4.1,
    end: 5.6,
    heading: "PM₂.₅, and SO₂ as a fuel-quality reading",
    body:
      "Particulate matter is defined by size alone: under 2.5 µm, fine enough to pass from lung tissue into the blood. Sulphur dioxide tracks fuel sulphur content, so it measures fuel quality as much as operating practice — and oxidises further into sulphuric acid before it returns as acid rain.",
    metrics: [
      { label: "PM₂.₅ WHO guideline", value: "5", note: "µg/m³ annual mean" },
      { label: "SO₂ lifetime in air", value: "1 – 7", note: "days before oxidation" },
    ],
    onerMetric: "PM2.5 · SOx",
  },
  {
    id: "drift",
    label: "Downwind",
    start: 5.6,
    end: 8.45,
    heading: "None of it stays here",
    body:
      "What leaves the stacks does not stop at the property line. The plume flattens, spreads, and mixes into the same air the valley shares. CO₂ accumulates on a century-plus timescale, so every tonne released adds to a lasting balance rather than a passing one.",
    metrics: [{ label: "CO₂ per tonne of fuel", value: "0.9 – 1.1", note: "t, unavoidable" }],
    onerMetric: "CO₂",
  },
  {
    id: "water",
    label: "Nutrient loading",
    start: 8.45,
    end: VIDEO_DURATION,
    heading: "N + P — nutrient loading",
    body:
      "Nitrates and phosphates carried in by the outfall. Nutrients are the one pollutant this lake is actively short of, and the fastest-acting of any of them. They fertilise algae until it strips the dissolved oxygen it needed to survive — a hypoxic dead zone where only bacteria remain.",
    metrics: [{ label: "Eutrophication threshold", value: "> 0.1", note: "mg/L phosphorus" }],
    onerMetric: "Water",
  },
];

/** Closing line, shown once the footage reaches the outfall. */
export const EPILOGUE = {
  headline: "None of this was an accident.",
  body: "Every pollutant in this piece is the output of a process someone chose. That is the point of ONER: not just measuring the damage after it is done, but identifying which decision to reverse next — ranked by what it saves, what it costs, and how long it takes to pay back.",
  cta: "Explore the live dashboard",
} as const;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Scroll fraction -> video seconds. The only place that mapping exists. */
export function timeAt(progress: number): number {
  return clamp01(progress) * VIDEO_DURATION;
}

/** Scroll fraction -> index into BEATS. */
export function beatIndexAt(progress: number): number {
  const t = timeAt(progress);
  for (let i = BEATS.length - 1; i >= 0; i--) {
    if (t >= BEATS[i].start) return i;
  }
  return 0;
}

/** Scroll fraction -> the beat that should be showing. */
export function beatAt(progress: number): Beat {
  return BEATS[beatIndexAt(progress)];
}

/**
 * Opacity for a beat's text, with a fade at each end.
 *
 * The fade is in *seconds of video* and converted to progress, so retiming a
 * beat changes where its text appears and appears not. Previously the fade was
 * expressed as a fraction of the beat's own length, which meant shortening a
 * beat silently sped its fade up.
 */
const FADE_IN = 0.42;
const FADE_OUT = 0.42;

export function beatVisibility(index: number, progress: number): number {
  const beat = BEATS[index];
  if (!beat) return 0;
  const t = timeAt(progress);
  const inT = clamp01((t - beat.start) / FADE_IN);
  const outT = clamp01((beat.end - t) / FADE_OUT);
  const ease = (n: number) => n * n * (3 - 2 * n);
  return Math.min(ease(inT), ease(outT));
}

/** Scroll fraction at which a beat starts, derived from its video time. */
export function progressAt(seconds: number): number {
  return seconds / VIDEO_DURATION;
}

/**
 * Total scrollable height of the experience, in vh.
 *
 * ## This is the smoothness dial, and it was set wrong
 *
 * The background is a scrubbed video, so the size of each visible step is set by
 * how much scroll one video frame is spread across:
 *
 *     pixels per frame = (TOTAL_VH * viewportHeight) / frameCount
 *
 * At 1500vh with 596 frames and a ~1400px viewport that is ~35px of scroll per
 * video frame. A single mouse-wheel notch is roughly 100px, so **every wheel
 * click skipped about three video frames at once.** Nothing was dropping frames —
 * the diagnostics panel read `lag 0.0ms`, `readyState 4`, and the scrub was
 * keeping up perfectly — the motion was simply quantised into 100px jumps.
 *
 * That is why it read as "chopped" while every measurement said it was working.
 * The fix is not a better decoder or a higher frame rate; it is giving each frame
 * more room. At 2600vh a wheel notch moves ~1.7 frames instead of three.
 *
 * The trade is honest and worth stating: a longer page is more scrolling for the
 * same ten seconds of footage. This is the knob to turn if it still feels steppy
 * — smoothness is linear in this number, and page length is the only cost.
 */
export const TOTAL_VH = 2600;