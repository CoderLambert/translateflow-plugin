import { readFile, realpath, readdir, stat } from "node:fs/promises";
import platformPath, { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { BRAND_ICONS, WORKER_PATHS, YOUTUBE_MAIN_BRIDGE_FILES } from "../src/shared/runtime-assets.js";
import { pathRelation } from "./path-boundaries.mjs";

export const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function isInsideSourceRoot(root, candidate, pathApi = platformPath) {
  return pathRelation(root, candidate, pathApi) === "descendant";
}

export function assertAssetPath(path) {
  if (typeof path !== "string" || !path || path.includes("\\") || path.includes(":")
    || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe runtime asset path: ${path}`);
  }
  return path;
}

// WXT compiles ISOLATED Content. Only execution-context-specific MAIN/Worker
// resources remain raw assets with their stable runtime paths.
export function runtimeAssetRoots() {
  return [...Object.values(BRAND_ICONS), ...YOUTUBE_MAIN_BRIDGE_FILES, ...Object.values(WORKER_PATHS), "assets/licenses/free-mt.txt"];
}

export async function sourceClosure(roots, root = ROOT) {
  const files = new Set();
  const canonicalRoot = await realpath(root);
  async function visit(path) {
    assertAssetPath(path);
    if (files.has(path)) return;
    const source = await realpath(resolve(root, path));
    if (!isInsideSourceRoot(canonicalRoot, source)) throw new Error(`Asset escapes source root: ${path}`);
    files.add(path);
    const text = await readFile(source, "utf8");
    const matches = /\.[cm]?js$/u.test(path)
      ? [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'](\.[^"']+)["']/gu)].map((m) => m[1])
      : path.endsWith(".css")
        ? [...text.matchAll(/(?:@import\s*|url\(\s*)["']([^"']+)["']/gu)].map((m) => m[1]).filter((p) => !p.startsWith("data:"))
        : [];
    for (const dependency of matches) {
      await visit(relative(root, resolve(root, dirname(path), dependency)).replaceAll("\\", "/"));
    }
  }
  for (const rootPath of roots) await visit(rootPath);
  return [...files].sort();
}

export async function walkFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unexpected artifact entry: ${path}`);
  }
  return files;
}

export async function byteSummary(root) {
  const entries = await Promise.all((await walkFiles(root)).map(async (path) => ({
    path: relative(root, path).replaceAll("\\", "/"), size: (await stat(path)).size
  })));
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  const lexicalBytes = entries.filter((entry) => entry.path.startsWith("assets/lexicon/")).reduce((sum, entry) => sum + entry.size, 0);
  return { fileCount: entries.length, totalBytes, lexicalBytes, codeBytes: totalBytes - lexicalBytes,
    files: entries.sort((a, b) => a.path.localeCompare(b.path)) };
}
