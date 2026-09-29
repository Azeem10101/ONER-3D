/**
 * Filesystem helpers for the asset pipeline.
 *
 * Shared so the fetch and optimize scripts agree on where raw downloads land
 * and where shipped assets end up.
 */

import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const ROOT = resolve(import.meta.dirname, "..", "..");
export const RAW_DIR = join(ROOT, ".cache", "raw");
export const SHIPPED_DIR = join(ROOT, "public", "assets");

export async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });
}

/** Stream a URL to disk. Streams rather than buffering, because a single
 *  tree's .bin can be 200MB and buffering that into memory on a 16GB laptop
 *  is a real risk. */
export async function download(url: string, destination: string): Promise<number> {
  await ensureDir(dirname(destination));

  const response = await fetch(url);
  if (!response.ok) throw new Error(`download ${url}: HTTP ${response.status}`);

  const declared = Number(response.headers.get("content-length") ?? 0);

  if (declared > 0) {
    try {
      const existing = await stat(destination);
      // Already fetched. Avoids re-pulling ~300MB when re-running the script.
      if (existing.size === declared) return declared;
    } catch {
      // Not present yet; fall through.
    }
  }

  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(destination));
  return declared;
}

export async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

export async function dirSize(path: string): Promise<number> {
  const { readdir } = await import("node:fs/promises");
  let total = 0;
  const walk = async (current: string) => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else total += await fileSize(full);
    }
  };
  await walk(path);
  return total;
}

export { join, rm, rename };
