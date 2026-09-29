/**
 * LOD parameter probe.
 *
 *   npx tsx scripts/probe-lod.ts <assetId>
 *
 * Tries a matrix of simplify settings against one welded asset and prints the
 * resulting vertex counts and file sizes. Used to pick the real LOD chain
 * instead of guessing ratios.
 *
 * The first guess at these numbers was badly wrong: lockBorder:true on a
 * leaf-card tree locks almost every edge, because an isolated quad is all
 * border, so the simplifier has almost nothing it is allowed to remove. That
 * produced a "LOD chain" of 874k → 549k → 507k vertices, which is not a LOD
 * chain in any useful sense. This probe is how the real values were found.
 */

import { join } from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { cloneDocument, prune, simplify, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptSimplifier } from "meshoptimizer";
import { RAW_DIR, fileSize } from "./lib/fs";

const MATRIX = [
  { ratio: 0.18, error: 0.0008, lockBorder: true },
  { ratio: 0.18, error: 0.0008, lockBorder: false },
  { ratio: 0.08, error: 0.004, lockBorder: false },
  { ratio: 0.02, error: 0.02, lockBorder: false },
  { ratio: 0.01, error: 0.05, lockBorder: false },
  { ratio: 0.005, error: 0.1, lockBorder: false },
  { ratio: 0.002, error: 0.2, lockBorder: false },
  { ratio: 0.001, error: 0.4, lockBorder: false },
];

function countVertices(document: Document) {
  const seen = new Set<number>();
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute("POSITION");
      if (position) seen.add(position.getCount());
    }
  }
  let total = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      total += primitive.getAttribute("POSITION")?.getCount() ?? 0;
    }
  }
  return total;
}

async function main() {
  const assetId = process.argv[2] ?? "island_tree_02";
  await MeshoptDecoder.ready;

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    "meshopt.simplifier": MeshoptSimplifier,
  });

  const rawDir = join(RAW_DIR, assetId);
  const { readdir } = await import("node:fs/promises");
  const manifest = (await readdir(rawDir)).find((f) => f.endsWith(".gltf"));
  if (!manifest) throw new Error(`no manifest in ${rawDir}`);

  const source = await io.read(join(rawDir, manifest));
  const base = await source.transform(weld(), prune());
  const baseVerts = countVertices(base);

  console.log(`\n${assetId}  ·  welded: ${baseVerts.toLocaleString()} vertices\n`);
  console.log("  ratio    error   lockBorder    vertices        kept    file");
  console.log("  " + "─".repeat(64));

  for (const params of MATRIX) {
    try {
      const simplified = await cloneDocument(base).transform(
        simplify({
          simplifier: MeshoptSimplifier,
          ratio: params.ratio,
          error: params.error,
          lockBorder: params.lockBorder,
        }),
        prune()
      );
      const verts = countVertices(simplified);
      const path = join(rawDir, `_probe.glb`);
      await io.write(path, simplified);
      const mb = (await fileSize(path)) / 1048576;
      console.log(
        `  ${params.ratio.toFixed(2)}   ${String(params.error).padEnd(6)}  ` +
          `${String(params.lockBorder).padEnd(12)} ${verts.toLocaleString().padStart(9)}  ` +
          `${((verts / baseVerts) * 100).toFixed(1).padStart(6)}%  ${mb.toFixed(1).padStart(6)}MB`
      );
    } catch (error) {
      console.log(
        `  ${params.ratio.toFixed(2)}   ${String(params.error).padEnd(6)}  ` +
          `${String(params.lockBorder).padEnd(12)} FAILED: ` +
          (error instanceof Error ? error.message.slice(0, 40) : String(error))
      );
    }
  }
  console.log("");
}

void main();
