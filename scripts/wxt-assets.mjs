import { readFile, realpath, readdir, stat } from "node:fs/promises";
import platformPath, { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../src/shared/constants.js";
import { WORKER_PATHS, YOUTUBE_MAIN_BRIDGE_FILES, BUNDLED_LEXICON_PATHS } from "../src/shared/runtime-assets.js";
import { validateTflexManifest, verifyTflexManifestFingerprint, verifyTflexDescriptor } from "../src/background/lexical/tflex-integrity.js";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

export function isInsideSourceRoot(root, candidate, pathApi = platformPath) {
  const within = pathApi.relative(root, candidate);
  return Boolean(within) && !pathApi.isAbsolute(within)
    && within !== ".." && !within.startsWith(`..${pathApi.sep}`);
}

export function assertAssetPath(path) {
  if (typeof path !== "string" || !path || path.includes("\\") || path.includes(":")
    || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe runtime asset path: ${path}`);
  }
  return path;
}

// Only explicit classic/MAIN/Worker roots and their relative module/CSS closure.
export function legacyAssetRoots() {
  return [...CONTENT_SCRIPT_FILES, ...CONTENT_STYLE_FILES,
    ...YOUTUBE_MAIN_BRIDGE_FILES, ...Object.values(WORKER_PATHS)];
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

export async function lexicalAssetFiles({ root = ROOT, requireLexicon = false } = {}) {
  const files = [];
  const missing = [];
  const canonicalRoot = await realpath(root);
  for (const packRoot of Object.values(BUNDLED_LEXICON_PATHS)) {
    let text;
    try { text = await readFile(resolve(root, packRoot, "manifest.json"), "utf8"); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      missing.push(packRoot);
      continue;
    }
    const manifest = JSON.parse(text);
    if (manifest.format !== "tflex" || !Array.isArray(manifest.files)) throw new Error(`Invalid generated pack: ${packRoot}`);
    const paths = ["manifest.json", ...manifest.files.map((entry) => assertAssetPath(entry.path))];
    if (new Set(paths).size !== paths.length) throw new Error(`Duplicate pack path: ${packRoot}`);
    validateTflexManifest(manifest, 1);
    await verifyTflexManifestFingerprint(manifest, webcrypto);
    for (const entry of manifest.files) {
      const allowed = entry.role === "lookup-index" && entry.path === "directory.json"
        || entry.role === "license-notice" && entry.path === "THIRD_PARTY_NOTICES.txt"
        || entry.role === "lexical-data" && /^shards\/[a-zA-Z0-9_-]+\.jsonl$/u.test(entry.path);
      if (!allowed) throw new Error(`Unregistered generated pack asset: ${packRoot}/${entry.path}`);
    }
    for (const path of paths) {
      const asset = `${packRoot}/${path}`;
      // Verify existence and confinement; never copy an entire generated directory.
      const canonical = await realpath(resolve(root, asset));
      if (!isInsideSourceRoot(canonicalRoot, canonical)) throw new Error(`Asset escapes source root: ${asset}`);
      if (!(await stat(canonical)).isFile()) throw new Error(`Asset must be a file: ${asset}`);
      if (path !== "manifest.json") await verifyTflexDescriptor(manifest.files.find((entry) => entry.path === path), await readFile(canonical), webcrypto, manifest.packId);
      files.push(asset);
    }
  }
  if (requireLexicon && missing.length) throw new Error(`Release WXT build requires generated packs: ${missing.join(", ")}`);
  return { files: files.sort(), missing };
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
