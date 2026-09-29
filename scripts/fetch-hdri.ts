/**
 * HDRI fetch.
 *
 *   npx tsx scripts/fetch-hdri.ts [id] [--res 1k]
 *
 * The environment map is the single largest change to the lighting from the
 * previous milestone. A hand-tuned hemisphere light fills uniformly from every
 * direction, which flattens form; a real HDRI gives directionally-varying fill,
 * so shadowed sides are not all the same brightness. That one difference does
 * more for perceived realism than any amount of shader work.
 *
 * Default is polyhaven's "dikhololo_sunset" — a low-sun clear sky, which is
 * the reference frames' light: warm key, long shadows, cool sky fill.
 */

import { join } from "node:path";
import { download, ensureDir, fileSize, SHIPPED_DIR } from "./lib/fs";

const DEFAULT_HDRI = "dikhololo_sunset";

const args = process.argv.slice(2);
const resolutionFlag = args.find((a) => a.startsWith("--res="))?.split("=")[1];
const resolution = (["1k", "2k", "4k"].includes(resolutionFlag ?? "") ? resolutionFlag : "1k") as
  | "1k"
  | "2k"
  | "4k";
const id = args.find((a) => !a.startsWith("--")) ?? DEFAULT_HDRI;

async function main() {
  console.log(`\nONER-3D HDRI fetch  ·  ${id}  ·  ${resolution}\n`);

  const response = await fetch(`https://api.polyhaven.com/files/${id}`);
  if (!response.ok) throw new Error(`polyhaven files ${id}: HTTP ${response.status}`);
  const files = (await response.json()) as {
    hdri?: Record<string, { hdr?: { url: string; size: number }; exr?: { url: string; size: number } }>;
  };

  // Radiance .hdr, not .exr: RGBELoader handles it in Three.js, whereas EXR
  // would need a separate loader. They are the same data at 1k.
  const entry = files.hdri?.[resolution]?.hdr;
  if (!entry?.url) {
    throw new Error(
      `${id}: no ${resolution} HDR (available: ${Object.keys(files.hdri ?? {}).join(", ")})`
    );
  }

  const dir = join(SHIPPED_DIR, "hdri");
  await ensureDir(dir);
  const destination = join(dir, `${id}_${resolution}.hdr`);

  await download(entry.url, destination);
  const actual = await fileSize(destination);

  console.log(`  ${entry.url}`);
  console.log(`  → public/assets/hdri/${id}_${resolution}.hdr`);
  console.log(`  ${(actual / 1048576).toFixed(2)}MB (declared ${(entry.size / 1048576).toFixed(2)}MB)\n`);
}

void main();
