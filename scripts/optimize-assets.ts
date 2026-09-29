/**
 * Asset optimization.
 *
 *   npx tsx scripts/optimize-assets.ts [--only <id,...>] [--skip-lod]
 *
 * Reads .cache/raw/<id>/ (fetched by fetch-assets.ts) and writes optimized
 * .glb files plus a manifest to public/assets/.
 *
 * ## Why each step
 *
 *   weld     — Poly Haven ships leaf cards as split vertices, so the
 *              simplifier cannot collapse them. Welding first is what makes
 *              simplification work at all. Verified: island_tree_02 goes from
 *              874k verts to a mesh the simplifier can actually reduce.
 *   simplify — Generates the LOD chain. The glTF export contains ONLY LOD0
 *              (the .blend has more, but they are not exported), so the chain
 *              is ours to make. See docs/ASSET_ASSESSMENT.md §1.2.
 *   quantize — Shrinks attributes. Costs a little precision, buys a lot.
 *   meshopt  — Compresses geometry. Preferred over Draco because its decode
 *              is several times faster, which matters on a CPU-contended
 *              laptop with integrated graphics.
 *   webp     — Recompresses textures. Not as small as KTX2/BC7, but it needs
 *              no external binary and is ~30% smaller than the source JPEG.
 *
 * No Blender and no KTX2 anywhere in this pipeline.
 *
 * ## Scale normalisation
 *
 * Poly Haven assets are NOT in metres and are not consistent with each other:
 * island_tree_02 is 3.4 units tall, jacaranda_tree is 32. Each asset is scaled
 * so its real-world height matches `targetHeightM`, and the applied scale is
 * recorded in the manifest. Without this, a "tree" would be a 3-metre shrub.
 */

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  cloneDocument,
  dedup,
  join as joinPrimitives,
  meshopt,
  prune,
  quantize,
  resample,
  simplify,
  textureCompress,
  weld,
} from "@gltf-transform/functions";
// Named import, not default. meshoptimizer v1.3 has no default export — a
// default import yields undefined, which makes simplify() throw "simplifier
// dependency required" while looking like the dependency is installed.
import { MeshoptSimplifier } from "meshoptimizer";
import { RAW_DIR, SHIPPED_DIR, ensureDir, dirSize, fileSize } from "./lib/fs";

// meshoptimizer's WASM modules and the NodeIO that depends on them.
//
// Built by initIo() rather than at module scope: gltf-transform requires the
// encoder and decoder to be awaited, and top-level await is unavailable here
// because tsx compiles this project as CJS. Module state, assigned once from
// main(), keeps the rest of the file free of threading an io parameter
// through every function.
let io: NodeIO;
// Typed loosely because meshoptimizer's WASM objects are instances, not
// classes, and `typeof` on them produces a constructor type that does not
// satisfy the constraint simplify() and meshopt() declare.
let MeshoptEncoderRef: unknown;

async function initIo() {
  const meshopt = await import("meshoptimizer");
  await meshopt.MeshoptEncoder.ready;
  await meshopt.MeshoptDecoder.ready;
  MeshoptEncoderRef = meshopt.MeshoptEncoder;

  io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    "meshopt.simplifier": MeshoptSimplifier,
    "meshopt.encoder": meshopt.MeshoptEncoder,
    "meshopt.decoder": meshopt.MeshoptDecoder,
  });
}

// ---------------------------------------------------------------------------
// Per-asset configuration
// ---------------------------------------------------------------------------

type Kind = "tree" | "understory" | "rock" | "industrial";

type Profile = {
  id: string;
  kind: Kind;
  /**
   * Real-world height in metres after normalisation.
   *
   * Reference scale: a mature tropical emergent is 35-50m, the rainforest
   * canopy layer is 25-40m, understory is 0.5-8m, and the factory's main hall
   * is 20-30m to the eaves. These are the numbers that make the site read as
   * real; getting them wrong makes everything look like a toy regardless of
   * how good the textures are.
   *
   * Normalisation is necessary because Poly Haven assets are NOT in metres and
   * are not consistent with each other — island_tree_02 is 3.4 units tall,
   * jacaranda_tree is 32.
   */
  targetHeightM: number;
  /** LOD chain. `error` is the meshoptimizer error budget; `tex` is the
   *  maximum texture edge in pixels. */
  lods?: { name: string; ratio: number; error: number; tex: number }[];
};

/**
 * The LOD chain, chosen from a measured parameter sweep on island_tree_02
 * (874,494 welded vertices) — see scripts/probe-lod.ts.
 *
 *   ratio  error  lockBorder  vertices   kept
 *   0.18   0.0008      true     549,359   62.8%
 *   0.18   0.0008     false     250,415   28.6%
 *   0.08   0.004      false     141,022   16.1%
 *   0.02   0.02       false      46,733    5.3%
 *   0.01   0.05       false      24,131    2.8%
 *   0.01   0.1        false      12,963    1.5%
 *   0.002  0.2        false       5,794    0.7%
 *   0.001  0.4        false       3,494    0.4%
 *
 * Two findings from that table shaped these values:
 *
 * 1. lockBorder MUST be false. Poly Haven's leaves are isolated quads, and an
 *    isolated quad is entirely border, so locking borders leaves the
 *    simplifier almost nothing it may remove. With it on, a "LOD1" was 62.8%
 *    of the original — not a LOD in any useful sense.
 *
 * 2. File size plateaus at ~5.3MB no matter how far geometry is decimated,
 *    because the textures dominate. Geometry simplification alone is not a
 *    size win; the per-LOD `tex` value is what actually shrinks the payload.
 *
 * Instance counts are what make these numbers affordable, and they are the
 * thing to tune per quality tier. Instancing does not reduce per-instance
 * vertex processing, so 250 mid trees at 13k verts is 3.2M vertices a frame,
 * which is the number that has to stay in budget.
 */
const LOD_CHAIN: Profile["lods"] = [
  { name: "lod1", ratio: 0.01, error: 0.1, tex: 512 },
  { name: "lod2", ratio: 0.002, error: 0.2, tex: 256 },
];

/** LOD0: the near-camera tier, kept at full measured quality. */
const LOD0_TEX = 1024;

/** Very small assets gain nothing from a LOD chain — simplify them once. */
const SMALL_ASSET_TRIS = 4_000;

const PROFILES: Profile[] = [
  // --- Canopy -------------------------------------------------------------
  // 3.4 units tall as authored; a mature island tree is ~22-28m.
  { id: "island_tree_02", kind: "tree", targetHeightM: 26, lods: LOD_CHAIN },
  { id: "island_tree_01", kind: "tree", targetHeightM: 24, lods: LOD_CHAIN },
  { id: "pachira_aquatica_01", kind: "tree", targetHeightM: 11 },
  { id: "quiver_tree_01", kind: "tree", targetHeightM: 9 },

  // --- Understory ---------------------------------------------------------
  { id: "fern_02", kind: "understory", targetHeightM: 1.2 },
  { id: "calathea_orbifolia_01", kind: "understory", targetHeightM: 1.4 },
  { id: "nettle_plant", kind: "understory", targetHeightM: 1.1 },
  { id: "shrub_01", kind: "understory", targetHeightM: 2.4 },
  { id: "dead_tree_trunk_02", kind: "understory", targetHeightM: 4.5 },
  { id: "tree_stump_01", kind: "understory", targetHeightM: 1.8 },

  // --- Rock ---------------------------------------------------------------
  { id: "rock_face_01", kind: "rock", targetHeightM: 18 },
  { id: "boulder_01", kind: "rock", targetHeightM: 5 },
  { id: "mountainside", kind: "rock", targetHeightM: 90 },

  // --- Industrial ---------------------------------------------------------
  { id: "modular_factory_facade", kind: "industrial", targetHeightM: 26 },
  { id: "modular_pipes", kind: "industrial", targetHeightM: 1 },
  { id: "modular_industrial_pipes_01", kind: "industrial", targetHeightM: 1 },
  { id: "modular_airduct_rectangular_01", kind: "industrial", targetHeightM: 1 },
  { id: "overhead_crane", kind: "industrial", targetHeightM: 9 },
  { id: "old_military_compressor", kind: "industrial", targetHeightM: 3 },
  { id: "modular_fire_escape", kind: "industrial", targetHeightM: 4 },
  { id: "modular_electricity_poles", kind: "industrial", targetHeightM: 12 },
  { id: "modular_chainlink_fence", kind: "industrial", targetHeightM: 3 },
  { id: "rollershutter_door", kind: "industrial", targetHeightM: 4 },
  { id: "concrete_road_barrier", kind: "industrial", targetHeightM: 1.2 },
  { id: "Barrel_01", kind: "industrial", targetHeightM: 0.9 },
  { id: "wooden_crate_01", kind: "industrial", targetHeightM: 1.2 },
  { id: "industrial_storage_cart", kind: "industrial", targetHeightM: 1.4 },
];

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

type Stats = {
  meshes: number;
  primitives: number;
  vertices: number;
  triangles: number;
  materials: number;
  textures: number;
};

function measure(document: Document): Stats {
  let vertices = 0;
  let triangles = 0;
  let primitives = 0;
  let textures = 0;

  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      primitives++;
      vertices += primitive.getAttribute("POSITION")?.getCount() ?? 0;
      const indexCount = primitive.getIndices()?.getCount();
      triangles += indexCount ? indexCount / 3 : 0;
    }
  }
  textures = document.getRoot().listTextures().length;

  return {
    meshes: document.getRoot().listMeshes().length,
    primitives,
    vertices: Math.round(vertices),
    triangles: Math.round(triangles),
    materials: document.getRoot().listMaterials().length,
    textures,
  };
}

/** Bounding box of the whole scene, in the file's own units. */
function bounds(document: Document) {
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute("POSITION");
      if (!position) continue;
      // getElementSize(), not getItemSize() — the latter does not exist in
      // gltf-transform v4. It returns component count, not bytes, so it is
      // the correct stride for walking the array.
      const stride = position.getElementSize();
      const array = position.getArray() as ArrayLike<number>;
      for (let i = 0; i < array.length; i += stride) {
        const x = array[i];
        const y = array[i + 1];
        const z = array[i + 2];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
  }

  if (!Number.isFinite(minY)) return null;
  return {
    min: [minX, minY, minZ] as [number, number, number],
    max: [maxX, maxY, maxZ] as [number, number, number],
    height: maxY - minY,
  };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)}MB`;
const k = (count: number) => `${(count / 1000).toFixed(1)}k`;

async function findManifest(dir: string): Promise<string | null> {
  if (!existsSync(dir)) return null;
  const files = await readdir(dir);
  return files.find((f) => f.endsWith(".gltf")) ?? null;
}

async function processAsset(profile: Profile, skipLod: boolean): Promise<ManifestEntry | null> {
  const rawDir = join(RAW_DIR, profile.id);
  const manifestPath = await findManifest(rawDir);
  if (!manifestPath) {
    console.log(`  ${profile.id.padEnd(30)} SKIPPED — not fetched`);
    return null;
  }

  const rawBytes = await dirSize(rawDir);
  const outDir = join(SHIPPED_DIR, profile.kind, profile.id);
  await ensureDir(outDir);

  const original = await io.read(join(rawDir, manifestPath));

  // --- 1. Weld ------------------------------------------------------------
  // Leaf cards ship as split vertices, so nothing can be collapsed until
  // identical vertices are merged. This is the step that makes simplify work.
  //
  // In gltf-transform v4 these functions are *transform factories* — they take
  // options and return a transform, which is applied via document.transform().
  // Calling weld(document, options) silently produces a non-Document, which is
  // what a first pass did.
  const document = await original.transform(weld());
  const afterWeld = measure(document);

  // --- 2. Normalise scale ------------------------------------------------
  const box = bounds(document);
  if (!box) {
    console.log(`  ${profile.id.padEnd(30)} FAILED — no POSITION attribute`);
    return null;
  }
  // Industrial modules are sized by their largest dimension, not their height:
  // a pipe run is wide and flat, and scaling it by height would be wrong.
  const reference =
    profile.kind === "industrial"
      ? Math.max(box.height, box.max[0] - box.min[0], box.max[2] - box.min[2])
      : box.height;
  const scale = reference > 0 ? profile.targetHeightM / reference : 1;

  if (Math.abs(scale - 1) > 0.01) {
    for (const node of document.getRoot().listNodes()) {
      node.setScale([scale, scale, scale]);
    }
    document
      .getRoot()
      .listNodes()
      .forEach((node) => node.setTranslation(node.getTranslation()));
  }

  // --- 3. Decide the LOD chain ------------------------------------------
  const needsLod =
    profile.lods && !skipLod && afterWeld.triangles > SMALL_ASSET_TRIS;

  const outputs: { name: string; file: string; bytes: number; stats: Stats }[] = [];

  // Each level is built from a fresh clone. document.clone() was removed in
  // gltf-transform v4 in favour of the explicit cloneDocument() helper, which
  // copies extension state as well as the graph — cloning a document that
  // carries KHR_texture_transform without it produces silently broken
  // materials.
  const emit = async (source: Document, name: string, texSize: number) => {
    const chain = [
      dedup(),
      // Merge primitives that share a material.
      //
      // This is a draw-call fix, not a size fix. Poly Haven's industrial
      // modules are authored as kits: modular_factory_facade is 261 separate
      // primitives across 15 materials, which means 261 draw calls for one
      // building. Joining by material collapses that to roughly 15 — the
      // single largest draw-call saving available anywhere in this pipeline.
      joinPrimitives(),
      prune(),
      // AO baked to a texture is enough for our surfaces; vertex-colour AO
      // would need a renderer, which is a deliberate non-dependency here.
      resample(),
      quantize({
        pattern: /.*/,
        // Option names are quantizePosition / quantizeNormal / etc — the
        // short forms in glTF Transform's docs are not what the types accept.
        //
        // Positions keep 14 bits: across a 30m asset that is ~2mm, far below
        // what a camera at 600m can resolve, and 10 bits would visibly quantise
        // the terrain-scale geometry.
        quantizePosition: 14,
        quantizeNormal: 10,
        quantizeTexcoord: 12,
        quantizeColor: 8,
      }),
      // WebP instead of KTX2: no external binary needed, ~30% smaller than
      // the source JPEG, universally supported. Revisit if measurements show
      // texture memory is the binding constraint.
      textureCompress({
        targetFormat: "webp",
        resize: [texSize, texSize],
        slots: /.*/,
        quality: 82,
      }),
      meshopt({ encoder: MeshoptEncoderRef as never }),
    ].filter(Boolean) as never[];

    const processed = await source.transform(...chain);
    const file = `${name}.glb`;
    const path = join(outDir, file);
    await io.write(path, processed);
    return { name, file, bytes: await fileSize(path), stats: measure(processed) };
  };

  // LOD0: the near-camera tier. Welded and scale-normalised, but NOT
  // decimated — this is the version that has to look good. Only a few dozen
  // are ever visible at once, which is what pays for the vertex count.
  outputs.push(await emit(cloneDocument(document), "lod0", LOD0_TEX));

  if (needsLod) {
    for (const lod of profile.lods!) {
      try {
        const simplified = await cloneDocument(document).transform(
          simplify({
            // The simplifier is passed as an option, NOT registered as a
            // document dependency. Registering it on NodeIO alone satisfies
            // the writer but leaves simplify() throwing
            // "simplifier dependency required".
            simplifier: MeshoptSimplifier,
            ratio: lod.ratio,
            error: lod.error,
            // Deliberately false. Poly Haven's leaves are isolated quads, and
            // an isolated quad is entirely border — locking borders leaves
            // the simplifier nothing it may remove. Measured: 62.8% retained
            // with locking on, versus 28.6% off, at identical ratio/error.
            // See scripts/probe-lod.ts.
            lockBorder: false,
          })
        );
        outputs.push(await emit(simplified, lod.name, lod.tex));
      } catch (error) {
        console.log(
          `    ${lod.name} simplify failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  const totalBytes = outputs.reduce((sum, o) => sum + o.bytes, 0);

  console.log(
    `  ${profile.id.padEnd(30)} ${k(afterWeld.vertices).padStart(8)}v ` +
      `x${(scale).toFixed(1).padStart(5)}  ` +
      `${mb(rawBytes).padStart(8)} → ${mb(totalBytes).padStart(8)}  ` +
      `(${((1 - totalBytes / rawBytes) * 100).toFixed(0)}% smaller)  ` +
      `${outputs.map((o) => `${o.name}:${k(o.stats.vertices)}v`).join(" ")}`
  );

  return {
    id: profile.id,
    kind: profile.kind,
    targetHeightM: profile.targetHeightM,
    scaleApplied: Number(scale.toFixed(5)),
    sourceHeight: Number(box.height.toFixed(4)),
    rawBytes,
    shippedBytes: totalBytes,
    welded: afterWeld,
    levels: outputs.map((o) => ({
      name: o.name,
      file: `assets/${profile.kind}/${profile.id}/${o.file}`,
      bytes: o.bytes,
      stats: o.stats,
    })),
  };
}

type ManifestEntry = {
  id: string;
  kind: string;
  targetHeightM: number;
  scaleApplied: number;
  sourceHeight: number;
  rawBytes: number;
  shippedBytes: number;
  welded: Stats;
  levels: { name: string; file: string; bytes: number; stats: Stats }[];
};

// ---------------------------------------------------------------------------

async function main() {
  await initIo();

  const args = new Set(process.argv.slice(2));
  const skipLod = args.has("--skip-lod");
  // Accepts both --only=a,b and --only a,b, because PowerShell and npm treat
  // the two forms differently and picking one silently ignores the other.
  const inlineFlag = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
  const spacedFlag = args.has("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
  const onlyValue = inlineFlag ?? (spacedFlag && !spacedFlag.startsWith("--") ? spacedFlag : undefined);
  const only = onlyValue ? new Set(onlyValue.split(",").map((s) => s.trim())) : null;

  const profiles = only ? PROFILES.filter((p) => only.has(p.id)) : PROFILES;

  console.log(`\nONER-3D asset optimize  ·  ${profiles.length} assets  ·  web tooling only\n`);
  console.log("  asset                          welded  scale      raw → shipped   levels");
  console.log("  " + "─".repeat(94));

  await ensureDir(SHIPPED_DIR);
  const entries: ManifestEntry[] = [];

  for (const profile of profiles) {
    try {
      const entry = await processAsset(profile, skipLod);
      if (entry) entries.push(entry);
    } catch (error) {
      console.log(
        `  ${profile.id.padEnd(30)} FAILED — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // --- Manifest -----------------------------------------------------------
  // The runtime needs this: real file paths, real vertex counts, and the
  // scale that was baked in, so nothing has to be guessed at load time.
  const existingPath = join(SHIPPED_DIR, "manifest.json");
  let existing: Record<string, ManifestEntry> = {};
  try {
    existing = JSON.parse(await readFile(existingPath, "utf8"));
  } catch {
    // First run.
  }
  for (const entry of entries) existing[entry.id] = entry;
  await writeFile(existingPath, JSON.stringify(existing, null, 2));

  // --- Report -------------------------------------------------------------
  const rawTotal = entries.reduce((s, e) => s + e.rawBytes, 0);
  const shippedTotal = entries.reduce((s, e) => s + e.shippedBytes, 0);
  const lod0Verts = entries.reduce((s, e) => s + (e.levels.find((l) => l.name === "lod0")?.stats.vertices ?? 0), 0);
  const lod0Tris = entries.reduce((s, e) => s + (e.levels.find((l) => l.name === "lod0")?.stats.triangles ?? 0), 0);

  console.log("\n" + "=".repeat(72));
  console.log(`Processed:      ${entries.length}/${profiles.length}`);
  console.log(`Raw:            ${mb(rawTotal)}`);
  console.log(`Shipped:        ${mb(shippedTotal)}  (${((1 - shippedTotal / rawTotal) * 100).toFixed(0)}% smaller)`);
  console.log(`LOD0 geometry:  ${k(lod0Verts)} verts, ${k(lod0Tris)} tris across ALL assets`);
  console.log(`Manifest:       public/assets/manifest.json (${Object.keys(existing).length} entries)`);
  console.log(`\nNote: LOD0 is the summed worst case. The runtime only ever loads the`);
  console.log(`LOD appropriate to each distance band, and instancing means the`);
  console.log(`per-frame cost is a small fraction of this total.\n`);
}

void main();
