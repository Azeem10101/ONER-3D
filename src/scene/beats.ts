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
 * ## The boundaries are read off the footage, not chosen
 *
 * The first version of this file had one beat per pollutant, on the assumption
 * that the video's annotations appeared one at a time. Sampling the clip every
 * 0.4s shows they do not. They are cumulative:
 *
 *     2.0 - 2.8s   no annotation
 *     3.2 - 4.0s   CO and NO₂
 *     4.4 - 5.2s   CO, NO₂, PM₂.₅ and SO₂ all four at once
 *     6.0 - 6.4s   fading, camera pulling back to the aerial
 *     8.8s+        Nitrogen and Phosphorus at the outfall
 *
 * So the labels group into two moments, not four: a pair, then all four. Timing
 * prose to a beat per pollutant put the PM₂.₅ text under a frame showing SO₂,
 * because the video simply never showed PM₂.₅ on its own. Four beats is the
 * honest structure, and it is also what the picture supports.
 *
 * Re-verify with the frame-sampling approach in scripts/ if the video is ever
 * replaced — do not assume these numbers still hold.
 */
export const BEATS: Beat[] = [
  {
    id: "site",
    label: "The site",
    start: 0,
    end: 3.05,
    heading: "Orion Manufacturing Plant",
    body:
      "Eleven hundred acres of rainforest, cleared once. A pulp and paper mill, a thermal generator, and a lake that used to belong to the trees. The plume leaves all of it from three stacks, and everything downstream starts here.",
    metrics: [{ label: "Site", value: "1,140", note: "acres, cleared 1974" }],
    onerMetric: "Facility",
  },
  {
    id: "co-no2",
    label: "CO and NO₂",
    start: 3.05,
    end: 4.45,
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
    start: 4.45,
    end: 6.35,
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
    start: 6.35,
    end: 8.55,
    heading: "None of it stays here",
    body:
      "What leaves the stacks does not stop at the property line. The plume flattens, spreads, and mixes into the same air the valley shares. CO₂ accumulates on a century-plus timescale, so every tonne released adds to a lasting balance rather than a passing one.",
    metrics: [{ label: "CO₂ per tonne of fuel", value: "0.9 – 1.1", note: "t, unavoidable" }],
    onerMetric: "CO₂",
  },
  {
    id: "water",
    label: "Nutrient loading",
    start: 8.55,
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

/** Total scrollable height of the experience, in vh. */
export const TOTAL_VH = 1500;