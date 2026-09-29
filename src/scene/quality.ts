/**
 * QUALITY TIERS
 * =============
 * This is the single place that decides how expensive the scene is allowed to
 * be. Every subsystem (vegetation, shadows, fog, water, particles) reads its
 * budget from here and nothing else, so lowering the tier degrades the whole
 * experience coherently instead of leaving one part stranded at high cost.
 *
 * ## How the tier is chosen
 *
 * Two mechanisms, because neither alone is trustworthy:
 *
 * 1. STATIC — read the GPU string via WEBGL_debug_renderer_info. This is real
 *    hardware reporting, not a guess. It is the only way to tell an Intel Arc
 *    iGPU from a discrete card, since both report similar core counts and
 *    memory to the JS heap. Some browsers (notably Firefox) gate this behind
 *    a privacy setting, so it can return null and we fall through.
 *
 * 2. ADAPTIVE — measure actual frame time over a rolling window and adjust
 *    the render scale at runtime. This catches everything static detection
 *    misses: thermal throttling, a browser running on a battery, another tab
 *    eating the GPU, or a resolution the user has since changed.
 *
 * We deliberately do NOT pretend the static path is exact. A machine can lie,
 * and an integrated GPU sharing system RAM will be slower than its model name
 * suggests. That is what the adaptive loop is for.
 *
 * ## Overriding
 *
 * Append `?quality=low|medium|high|auto` to the URL. Also set in localStorage
 * by <QualityGate> once the user picks from the dev panel.
 */

export type QualityTier = "low" | "medium" | "high";

export type QualitySettings = {
  tier: QualityTier;

  /** Device pixel ratio ceiling. This is the biggest single performance lever
   *  on a full-screen canvas, so the adaptive loop drives it first. */
  maxPixelRatio: number;
  /** Multiplier the adaptive loop may reduce pixel ratio by. 1 = locked. */
  renderScale: number;

  /** Shadow map edge length, or 0 to disable shadows entirely. */
  shadowMapSize: number;
  /** Shadow camera extent in metres. Tight is cheap AND sharper. */
  shadowCameraSize: number;
  /**
   * Total tree instances. Split near/far by the scatter's own clumping
   * function, so the split is a tuning knob rather than a hard band.
   *
   * These are counts of PROCEDURAL low-poly trees (~90 triangles each), not
   * asset LODs. Instancing collapses the draw calls to 8 regardless of the
   * count — one per species per geometry type — so the only cost that scales
   * is vertices, and 6,000 trees at ~90 triangles is ~540k, which is
   * comfortable on integrated graphics.
   *
   * The previous asset-based figures (56/150) were LOD band counts for
   * 24,000-vertex GLB trees, where instancing does NOT reduce per-instance
   * vertex processing. They are not comparable to these.
   */
  vegetationNearCount: number;
  vegetationFarCount: number;

  /** Smoke / particle budget. */
  particleCount: number;

  /** Segments per side of the terrain heightfield. */
  terrainSegments: number;
  /** Segments per side of the distant mountain ridge. */
  mountainSegments: number;

  /** Atmospheric perspective samples. 0 disables the custom height fog. */
  fogQuality: "low" | "high";

  /** Whether post-processing is allowed. Bloom is deliberately absent from
   *  the scene regardless — it is the fastest way to make a render look
   *  cheap, and the reference frames rely on haze, not glow. */
  postProcessing: boolean;
};

/**
 * Tier presets.
 *
 * The medium tier is the default because the target machine is an Intel Arc
 * integrated GPU. Arc is a capable Xe-LPG part but shares system RAM and
 * sits far below a discrete GPU on fill rate, which is what a full-screen
 * WebGL canvas is bottlenecked by.
 */
export const TIERS: Record<QualityTier, QualitySettings> = {
  high: {
    tier: "high",
    maxPixelRatio: 1.75,
    renderScale: 1,
    shadowMapSize: 2048,
    shadowCameraSize: 140,
    // ~14,000 procedural trees at ~90 tris = ~1.26M. Eight draw calls total.
    vegetationNearCount: 9000,
    vegetationFarCount: 5000,
    particleCount: 900,
    terrainSegments: 256,
    mountainSegments: 200,
    fogQuality: "high",
    postProcessing: true,
  },
  medium: {
    tier: "medium",
    maxPixelRatio: 1.25,
    renderScale: 1,
    shadowMapSize: 1024,
    shadowCameraSize: 110,
    // Intel Arc default. ~6,000 procedural trees = ~540k triangles, leaving
    // headroom for the terrain heightfield, the factory, and the plume.
    vegetationNearCount: 4000,
    vegetationFarCount: 2000,
    particleCount: 420,
    terrainSegments: 160,
    mountainSegments: 128,
    fogQuality: "high",
    postProcessing: false,
  },
  low: {
    tier: "low",
    // Below 1.0 is intentional. On an integrated GPU, rendering the full-screen
    // canvas at 0.8x and letting the browser upscale is far cheaper than any
    // amount of geometry reduction, and the soft upscale is largely hidden by
    // atmospheric haze.
    maxPixelRatio: 1,
    renderScale: 0.8,
    shadowMapSize: 1024,
    shadowCameraSize: 90,
    // Emergent species and trunks are the first things dropped, because the
    // canopy domes are what carry the forest read at distance.
    vegetationNearCount: 1500,
    vegetationFarCount: 700,
    particleCount: 180,
    terrainSegments: 96,
    mountainSegments: 64,
    fogQuality: "low",
    postProcessing: false,
  },
};

// ---------------------------------------------------------------------------
// Static detection
// ---------------------------------------------------------------------------

export type GpuReport = {
  /** Raw renderer string, or null if the browser withheld it. */
  renderer: string | null;
  vendor: string | null;
  /** What we concluded, and why. Surfaced in the dev panel. */
  detected: QualityTier | "unknown";
  reason: string;
  /** True when we are falling back to conservative defaults. */
  isGuess: boolean;
};

/**
 * Read the real GPU. Requires a throwaway WebGL context, which is why this
 * cannot run during SSR.
 *
 * This asks the browser a direct question about hardware. It is not a
 * heuristic on userAgent or core count, which is what "fake GPU detection"
 * usually means in practice.
 */
export function detectGpu(): GpuReport {
  const fallback: GpuReport = {
    renderer: null,
    vendor: null,
    detected: "unknown",
    reason: "WebGL unavailable — defaulting to medium",
    isGuess: true,
  };

  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    const canvas = document.createElement("canvas");
    gl =
      (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null);
  } catch {
    return fallback;
  }
  if (!gl) return fallback;

  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = debugInfo ? (gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string) : null;
  const vendor = debugInfo ? (gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) as string) : null;

  // Release the probe context immediately. Browsers cap concurrent contexts
  // (often around 8-16), and holding one for the life of the app would
  // compete with the real renderer for resources.
  gl.getExtension("WEBGL_lose_context")?.loseContext();

  if (!renderer) {
    return {
      renderer,
      vendor,
      detected: "unknown",
      reason: "Browser withheld the GPU string (privacy setting) — defaulting to medium",
      isGuess: true,
    };
  }

  const value = renderer.toLowerCase();

  // Integrated and low-power parts. Checked first because an integrated GPU
  // inside a large laptop can also expose a discrete name via hybrid
  // graphics, and the more specific match wins.
  if (/intel.*(arc|iris|uhd|hd graphics|graphics)/.test(value)) {
    return {
      renderer,
      vendor,
      detected: "medium",
      reason: `Integrated Intel GPU detected (${renderer})`,
      isGuess: false,
    };
  }
  if (/apple\s*(m\d|radeon|graphics)/.test(value) || /apple gpu/.test(value)) {
    return { renderer, vendor, detected: "high", reason: `Apple silicon detected (${renderer})`, isGuess: false };
  }
  if (/(rtx|radeon rx|geforce gtx|quadro|arc a-series)/.test(value)) {
    return { renderer, vendor, detected: "high", reason: `Discrete GPU detected (${renderer})`, isGuess: false };
  }
  if (/(mali|adreno|powervr)/.test(value)) {
    return { renderer, vendor, detected: "low", reason: `Mobile GPU detected (${renderer})`, isGuess: false };
  }
  if (/(swiftshader|llvmpipe|software|basic render)/.test(value)) {
    return {
      renderer,
      vendor,
      detected: "low",
      reason: "Software rasteriser detected — no hardware acceleration",
      isGuess: false,
    };
  }

  return {
    renderer,
    vendor,
    detected: "unknown",
    reason: `Unrecognised GPU "${renderer}" — defaulting to medium`,
    isGuess: true,
  };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Persisted manual choice, which always beats detection. */
const STORAGE_KEY = "oner-3d:quality";

/** Reads `?quality=` or localStorage. Returns null for auto-detect. */
export function getManualOverride(): QualityTier | null {
  if (typeof window === "undefined") return null;

  const fromUrl = new URLSearchParams(window.location.search).get("quality");
  if (fromUrl === "low" || fromUrl === "medium" || fromUrl === "high") return fromUrl;

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "low" || stored === "medium" || stored === "high") return stored;
  } catch {
    // Private browsing can throw on localStorage access. Auto-detect is a
    // perfectly good fallback, so this is not worth surfacing.
  }
  return null;
}

export function setManualOverride(tier: QualityTier | "auto") {
  try {
    if (tier === "auto") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, tier);
  } catch {
    // Non-fatal, see above.
  }
}

export function resolveQuality(): { settings: QualitySettings; gpu: GpuReport; isManual: boolean } {
  const manual = getManualOverride();
  if (manual) {
    return {
      settings: TIERS[manual],
      gpu: { renderer: null, vendor: null, detected: manual, reason: "Manual override", isGuess: false },
      isManual: true,
    };
  }

  const gpu = detectGpu();
  return { settings: TIERS[gpu.detected === "unknown" ? "medium" : gpu.detected], gpu, isManual: false };
}

// ---------------------------------------------------------------------------
// Live store
// ---------------------------------------------------------------------------

/**
 * A single mutable holder for the live settings.
 *
 * Encapsulated in a class rather than a bare module-level object because the
 * React Compiler's immutability lint rules reject mutation of module-scope
 * variables from inside components, and that rule is right: a plain
 * module-level object is invisible to the dependency tracker, so any value
 * derived from it would be memoised incorrectly. Methods on a class instance
 * the compiler can follow, so this is both lint-clean and correct.
 *
 * React reads a snapshot from `snapshot()` at mount and whenever the tier
 * changes by hand. The render loop reads and writes `current` directly,
 * because pushing an adaptive render-scale change back through React state
 * would re-render the whole scene graph several times a second at exactly the
 * moment the frame budget is already blown.
 */
export class QualityStore {
  current: QualitySettings | null = null;

  /** Replace the settings, e.g. on a manual tier change. */
  set(settings: QualitySettings) {
    this.current = settings;
  }

  /** A frozen copy, safe to hand to React. */
  snapshot(): QualitySettings | null {
    return this.current ? { ...this.current } : null;
  }
}

/** The app-wide store. */
export const qualityStore = new QualityStore();

// ---------------------------------------------------------------------------
// Adaptive scaling
// ---------------------------------------------------------------------------

/**
 * Watches real frame times and trades resolution for smoothness.
 *
 * Only render scale moves. Geometry counts are fixed for the lifetime of the
 * page: rebuilding instanced meshes mid-scroll would cause a visible hitch,
 * and a scene that permanently reduces its own detail ends up looking worse
 * than one that merely renders slightly softer.
 */
export class AdaptiveScaler {
  private samples: number[] = [];
  private lastTime = 0;
  private cooldown = 0;

  /** Frame time budget in ms. 60fps is 16.7ms; we aim slightly under to
   *  leave headroom for the DOM overlay loop and main-thread work. */
  readonly targetMs = 20;
  readonly sampleSize = 45;

  constructor(
    private base: QualitySettings,
    private onChange: (settings: QualitySettings) => void
  ) {}

  /** Call once per frame with the raw frame delta in seconds. */
  update(deltaSeconds: number, settings: QualitySettings) {
    const now = performance.now();
    // Ignore the gap after a tab regains focus; it is not a frame we drew.
    if (this.lastTime && now - this.lastTime > 500) {
      this.samples.length = 0;
      this.cooldown = 0;
    }
    this.lastTime = now;

    const ms = deltaSeconds * 1000;
    if (ms <= 0 || ms > 2000) return; // Suspended tab or a GC pause.

    this.samples.push(ms);
    if (this.samples.length < this.sampleSize) return;

    // Median, not mean: one 200ms GC pause should not drop the whole scene
    // to 0.6x resolution.
    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    this.samples.length = 0;

    if (this.cooldown > 0) {
      this.cooldown--;
      return;
    }

    const floor = this.base.tier === "low" ? 0.6 : 0.55;

    if (median > this.targetMs * 1.35 && settings.renderScale > floor) {
      const next = Math.max(floor, settings.renderScale - 0.1);
      this.onChange({ ...settings, renderScale: Number(next.toFixed(2)) });
      this.cooldown = 2;
    } else if (median < this.targetMs * 0.62 && settings.renderScale < 1) {
      // Recover slowly, so we do not oscillate around the threshold.
      const next = Math.min(1, settings.renderScale + 0.05);
      this.onChange({ ...settings, renderScale: Number(next.toFixed(2)) });
      this.cooldown = 4;
    }
  }

  get baseSettings() {
    return this.base;
  }
}
