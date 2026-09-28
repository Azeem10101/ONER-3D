/**
 * SCENE CONTENT
 * -------------
 * The copy and figures shown in the pop-up cards.
 *
 * Every card maps onto a metric the ONER platform already tracks
 * (CO2, energy, water, NOx, SOx, PM2.5, waste), so the narrative and the
 * dashboard are describing the same facility — the Orion Manufacturing Plant.
 *
 * Figures are typical values for a heavy industrial combustion source and are
 * presented as illustrative ranges, not measurements. The live dashboard
 * numbers should replace them via `src/lib/onerApi.ts` once that is wired up.
 */

import type { CardId } from "./timeline";

export type Card = {
  id: CardId;
  /** Large display symbol, e.g. "NO₂". Rendered with unicode subscripts. */
  symbol: string;
  /** Common name. */
  name: string;
  /** One-line hook shown large under the symbol. */
  tagline: string;
  /** Where it comes from at this facility. */
  source: string;
  /** The environmental consequence. */
  impact: string;
  /** The two or three stats worth pinning down. */
  stats: { label: string; value: string; note?: string }[];
  /** Accent colour, used by the card border and the 3D marker. */
  accent: string;
  /** Which ONER dashboard metric this relates to. */
  onerMetric: string;
};

export const CARDS: Record<CardId, Card> = {
  // ----- Air: the plume ----------------------------------------------------
  co2: {
    id: "co2",
    symbol: "CO₂",
    name: "Carbon dioxide",
    tagline: "The one you cannot see, and the one that lasts longest.",
    source:
      "Complete combustion of natural gas across the plant's boilers and Furnace #2. This is the exhaust product, not a malfunction — a perfectly efficient plant still emits it.",
    impact:
      "The dominant greenhouse gas emitted by human industry. CO₂ accumulates on a century-plus timescale, so every tonne released adds to a lasting atmospheric balance.",
    stats: [
      { label: "Typical range", value: "0.9 – 1.1", note: "t CO₂ per t fuel burned" },
      { label: "ONER tracks", value: "7-day", note: "GradientBoosting forecast" },
    ],
    accent: "#4b5563",
    onerMetric: "CO₂",
  },
  co: {
    id: "co",
    symbol: "CO",
    name: "Carbon monoxide",
    tagline: "The signature of a fire that did not finish burning.",
    source:
      "Incomplete combustion, concentrated in the burner of a poorly-tuned furnace. ONER's Isolation Forest flags this as the 'Furnace #2 — Thermal Efficiency Degradation' incident.",
    impact:
      "Colourless, odourless, and chemically inert enough to slip past detection. CO binds haemoglobin with roughly 200× the affinity of oxygen, starving the blood of oxygen delivery.",
    stats: [
      { label: "Safe exposure", value: "< 50", note: "ppm, 8-hour average" },
      { label: "Fatal", value: "> 1,500", note: "ppm, short exposure" },
    ],
    accent: "#a855f7",
    onerMetric: "Anomaly → Root cause",
  },
  no2: {
    id: "no2",
    symbol: "NO₂",
    name: "Nitrogen dioxide",
    tagline: "The air takes its nitrogen and burns it too.",
    source:
      "At the ~1500 °C inside a combustion chamber, atmospheric nitrogen and oxygen combine. The plant does not emit this directly — it is manufactured on site by heat alone.",
    impact:
      "A potent respiratory irritant that inflames the lining of the lungs and lowers infection resistance. It is also a primary precursor of ground-level ozone, so the damage outlives the emission by hours.",
    stats: [
      { label: "Onset of symptoms", value: "0.1", note: "ppm, detectable" },
      { label: "Health benchmark", value: "40", note: "µg/m³ annual mean (EU)" },
    ],
    accent: "#f97316",
    onerMetric: "NOx",
  },
  so2: {
    id: "so2",
    symbol: "SO₂",
    name: "Sulphur dioxide",
    tagline: "What coal leaves behind when it burns.",
    source:
      "Sulphur contained in fuel is oxidised during combustion and leaves with the flue gas. The more sulphur in the fuel, the more SO₂ — this tracks fuel quality as much as operating practice.",
    impact:
      "Irritates the airways and degrades vegetation near the source. In the atmosphere it oxidises further into sulphuric acid and returns as acid rain, acidifying lakes and soils far downwind of the plant.",
    stats: [
      { label: "Lifetime in air", value: "1 – 7", note: "days before oxidation" },
      { label: "ONER tracks", value: "SOx", note: "aggregated with PM2.5" },
    ],
    accent: "#eab308",
    onerMetric: "SOx",
  },
  pm25: {
    id: "pm25",
    symbol: "PM₂.₅",
    name: "Fine particulate matter",
    tagline: "The fraction small enough to cross into the bloodstream.",
    source:
      "Incomplete combustion and mechanical wear — grinding, conveying, and baghouse leakage. PM₂.₅ is defined purely by size: matter under 2.5 µm across.",
    impact:
      "Inhalable deep into the lung tissue and capable of passing into the bloodstream, where it drives cardiovascular and respiratory disease. There is no safe exposure threshold — risk falls with concentration, but never reaches zero.",
    stats: [
      { label: "WHO guideline", value: "5", note: "µg/m³ annual mean" },
      { label: "Reaches", value: "Alveoli", note: "and enters blood" },
    ],
    accent: "#6b7280",
    onerMetric: "PM2.5",
  },

  // ----- Water: the lake ----------------------------------------------------
  nutrients: {
    id: "nutrients",
    symbol: "N + P",
    name: "Nutrient loading",
    tagline: "The lake is starving, and this is why.",
    source:
      "Nitrates and phosphates washed off the plant yard and carried in by the outfall. Plant nutrients are the one pollutant the lake is actively starved for.",
    impact:
      "Fertilises algae until it consumes the dissolved oxygen it needs to survive. The bloom dies, rots, and strips oxygen from the water — producing hypoxic dead zones where only bacteria survive.",
    stats: [
      { label: "Eutrophication threshold", value: "> 0.1", note: "mg/L phosphorus" },
      { label: "Result", value: "Dead zone", note: "anaerobic sediment" },
    ],
    accent: "#22c55e",
    onerMetric: "Water",
  },
  metals: {
    id: "metals",
    symbol: "Pb · Cd · Hg",
    name: "Heavy metals",
    tagline: "They do not break down. They only move up the food chain.",
    source:
      "Leaching from cooling towers, metal finishing, and corrosion of older infrastructure. Small, deliberate releases that never show up in an air emissions report.",
    impact:
      "Lead, cadmium, mercury, and chromium are not biodegradable. They settle into sediment and bioaccumulate, so concentrations climb at each successive trophic level. There is no safe level — only degrees of harm.",
    stats: [
      { label: "Bioaccumulation factor", value: "10⁵ ×", note: "sediment to predatory fish" },
      { label: "Half-life", value: "∞", note: "no biological decay" },
    ],
    accent: "#a3e635",
    onerMetric: "Waste",
  },
  thermal: {
    id: "thermal",
    symbol: "ΔT",
    name: "Thermal discharge",
    tagline: "Waste heat is still waste, even when it is invisible.",
    source:
      "Cooling water drawn from the lake and returned warmer. Often the largest single flow out of an industrial site, and the one most consistently excluded from pollution permitting.",
    impact:
      "Warm water holds less dissolved oxygen, so the lake loses the ability to support life precisely where it is warmest. Simultaneously it raises the metabolic rate of resident organisms, which need more oxygen than the water can now carry.",
    stats: [
      { label: "Typical rise", value: "+8 – 12 °C", note: "at the outfall" },
      { label: "Oxygen solubility", value: "−30%", note: "per +10 °C" },
    ],
    accent: "#06b6d4",
    onerMetric: "Energy + Water",
  },
};

/** Closing line shown once the camera reaches the lake. */
export const EPILOGUE = {
  headline: "None of this was an accident.",
  body: "Every pollutant on this page is the output of a process someone chose. That is the point of ONER: not just measuring the damage after it is done, but identifying which decision to reverse next — ranked by what it saves, what it costs, and how long it takes to pay back.",
  cta: "Explore the live dashboard",
} as const;
