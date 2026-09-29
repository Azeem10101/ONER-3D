/**
 * Fetch assets from Poly Haven, and report their real cost.
 *
 *   npx tsx scripts/fetch-assets.ts [--dry] [--res 1k]
 *
 * Downloads into .cache/raw (gitignored) so the optimize step can work on
 * them. Prints measured geometry statistics for every asset, because the API's
 * reported polycount is not a usable budget number — see polyhaven.ts.
 *
 * Read-only with respect to the project: writes nothing outside .cache/.
 */

import { join } from "./lib/fs";
import { download, dirSize, ensureDir, RAW_DIR } from "./lib/fs";
import { resolve, type ResolvedAsset } from "./lib/polyhaven";

/**
 * The asset shortlist.
 *
 * Every entry is CC0. Costs are indicative from measured manifest reads and
 * are treated as a guide, not a guarantee — the pipeline re-measures after
 * optimization and fails the budget check if reality disagrees.
 */
export const SHORTLIST = [
  // --- Canopy: near LOD0 -------------------------------------------------
  { id: "pachira_aquatica_01", role: "tropical understory + small canopy" },
  { id: "quiver_tree_01", role: "succulent-canopy mid tree" },

  // --- Canopy: hero, needs LOD generation --------------------------------
  // island_tree_02 is the canopy workhorse. Measured: 874k verts, of which
  // 625k (72%) are leaf cards. Leaves are what must be decimated hard; the
  // woody structure is only 15k verts and survives simplification intact.
  { id: "island_tree_02", role: "mid broadleaf, dense canopy" },
  { id: "island_tree_01", role: "emergent, gnarled trunk" },

  // jacaranda_tree is deliberately NOT in the default set. Measured: 3.68M
  // verts / 205MB at 1K, of which 2.64M are leaf cards — and it is
  // purple-flowered, so it needs desaturating before it reads as rainforest.
  // Rejected from v1 on both cost and appearance; see docs/ASSET_ASSESSMENT.md
  // §2. Opt in with: npx tsx scripts/fetch-assets.ts --include jacaranda_tree
  // { id: "jacaranda_tree", role: "broadleaf — purple, evaluate on sight" },

  // --- Understory ---------------------------------------------------------
  { id: "fern_02", role: "fern clumps" },
  { id: "calathea_orbifolia_01", role: "broadleaf understory" },
  { id: "nettle_plant", role: "wet-climate understory" },
  { id: "shrub_01", role: "shrub mass" },
  { id: "dead_tree_trunk_02", role: "forest floor debris" },
  { id: "tree_stump_01", role: "stump" },

  // --- Rock ---------------------------------------------------------------
  { id: "rock_face_01", role: "cliff and lake edge" },
  { id: "boulder_01", role: "boulders" },
  { id: "mountainside", role: "mountain mass" },

  // --- Industrial ---------------------------------------------------------
  { id: "modular_factory_facade", role: "building shells" },
  { id: "modular_pipes", role: "pipe runs and fittings" },
  { id: "modular_industrial_pipes_01", role: "flanges, elbows, valve" },
  { id: "modular_airduct_rectangular_01", role: "rectangular ducting" },
  { id: "overhead_crane", role: "crane hoist" },
  { id: "old_military_compressor", role: "machinery" },
  { id: "modular_fire_escape", role: "catwalks, stairs, railings" },
  { id: "modular_electricity_poles", role: "utility poles and transformers" },
  { id: "modular_chainlink_fence", role: "perimeter fencing" },
  { id: "rollershutter_door", role: "loading bay doors" },
  { id: "concrete_road_barrier", role: "site barriers" },
  { id: "Barrel_01", role: "drums" },
  { id: "wooden_crate_01", role: "storage crates" },
  { id: "industrial_storage_cart", role: "plant equipment" },
] as const;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry");
/** Opt-in extras, comma-separated. Kept out of the default set where they are
 *  expensive or need a visual judgement we cannot make from metadata. */
const includeFlag = process.argv.find((a) => a.startsWith("--include="))?.split("=")[1];
const extraIds = includeFlag ? includeFlag.split(",").map((s) => s.trim()) : [];

/** Rejected from the default set, available via --include. */
export const OPTIONAL: Record<string, { role: string; reason: string }> = {
  jacaranda_tree: {
    role: "broadleaf, dense canopy",
    reason: "3.68M verts / 205MB at 1K, 72% leaf cards. Also purple-flowered, so it needs desaturating before it reads as rainforest.",
  },
  moss_01: {
    role: "ground cover",
    reason: "Reports 246k polys but only 204 unique POSITION verts across 12 primitives — a geometry-nodes scatter baked into the file. Needs visual inspection before it can be trusted.",
  },
  grass_medium_02: {
    role: "grass tufts",
    reason: "Also a geometry-nodes scatter; same concern as moss_01.",
  },
};
const resolutionFlag = process.argv.find((a) => a.startsWith("--res="))?.split("=")[1];
const resolution = (["1k", "2k", "4k", "8k"].includes(resolutionFlag ?? "")
  ? resolutionFlag
  : "1k") as "1k" | "2k" | "4k" | "8k";

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)}MB`;
const k = (count: number) => `${(count / 1000).toFixed(1)}k`;

async function main() {
  const manifest = [
    ...SHORTLIST.map((entry) => ({ ...entry })),
    ...extraIds.map((id) => ({ id, role: OPTIONAL[id]?.role ?? "opt-in" })),
  ];

  console.log(`\nONER-3D asset fetch  ·  ${resolution} textures  ·  ${manifest.length} assets\n`);
  if (dryRun) console.log("DRY RUN — resolving metadata only, downloading nothing\n");

  if (extraIds.length) {
    console.log(`Opted in: ${extraIds.join(", ")}`);
    for (const id of extraIds) {
      if (OPTIONAL[id]) console.log(`  note — ${id}: ${OPTIONAL[id].reason}`);
    }
    console.log("");
  }

  await ensureDir(RAW_DIR);

  const resolved: ResolvedAsset[] = [];
  const failures: { id: string; reason: string }[] = [];

  for (const entry of manifest) {
    process.stdout.write(`  ${entry.id.padEnd(32)} `);
    try {
      const asset = await resolve(entry.id, { resolution });
      resolved.push(asset);
      console.log(
        `${k(asset.stats.vertices).padStart(8)} verts  ` +
          `${k(asset.stats.triangles).padStart(8)} tris  ` +
          `${String(asset.stats.primitives).padStart(3)} prims  ` +
          `${mb(asset.totalBytes).padStart(9)}  1K`
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push({ id: entry.id, reason });
      console.log(`FAILED — ${reason}`);
    }
  }

  // --- Per-primitive breakdown for the expensive assets -------------------
  const expensive = resolved.filter((a) => a.stats.vertices > 400_000);
  if (expensive.length) {
    console.log(`\nPer-primitive breakdown for assets over 400k vertices:`);
    for (const asset of expensive) {
      console.log(`\n  ${asset.id}  (${asset.info.name})`);
      console.log(`    tags: ${asset.info.tags.slice(0, 8).join(", ")}`);
      for (const part of asset.stats.perPrimitive) {
        console.log(
          `    ${part.material.padEnd(24)} ${k(part.vertices).padStart(9)} verts  ` +
            `${k(part.triangles).padStart(9)} tris  ` +
            `${((part.vertices / asset.stats.vertices) * 100).toFixed(0)}% of verts`
        );
      }
      if (asset.stats.extensions.length) {
        console.log(`    extensions: ${asset.stats.extensions.join(", ")}`);
      }
    }
  }

  // --- Download -----------------------------------------------------------
  if (!dryRun) {
    console.log(`\nDownloading to .cache/raw ...`);
    for (const asset of resolved) {
      const target = join(RAW_DIR, asset.id);
      await ensureDir(target);
      let written = 0;
      for (const file of asset.files) {
        if (file.bytes === 0 && !file.name.endsWith(".bin")) continue;
        // Preserve the manifest's own relative layout. The .gltf references
        // "textures/foo.jpg", so flattening the directory breaks the URIs and
        // gltf-transform cannot open the file at all.
        written += await download(file.url, join(target, file.name));
      }
      console.log(`  ${asset.id.padEnd(32)} ${mb(written).padStart(9)}  ${asset.files.length} files`);
    }
    console.log(`\nRaw cache total: ${mb(await dirSize(RAW_DIR))}`);
  }

  // --- Summary ------------------------------------------------------------
  const totalVerts = resolved.reduce((s, a) => s + a.stats.vertices, 0);
  const totalTris = resolved.reduce((s, a) => s + a.stats.triangles, 0);
  const totalBytes = resolved.reduce((s, a) => s + a.totalBytes, 0);

  console.log(`\n${"=".repeat(72)}`);
  console.log(`Assets resolved: ${resolved.length}/${manifest.length}`);
  console.log(`Total geometry:  ${k(totalVerts)} verts, ${k(totalTris)} tris (unoptimized)`);
  console.log(`Total download:  ${mb(totalBytes)} at ${resolution}`);

  if (failures.length) {
    console.log(`\nFailed (${failures.length}):`);
    for (const failure of failures) console.log(`  ${failure.id}: ${failure.reason}`);
  }

  console.log(`\nNext: npx tsx scripts/optimize-assets.ts\n`);
  if (failures.length) process.exit(1);
}

// Top-level await requires ESM. package.json has no "type": "module" (the
// Next.js config is CommonJS-friendly), so this is invoked explicitly rather
// than via a bare top-level await.
void main();
