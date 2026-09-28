#!/usr/bin/env node
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_OUT = resolve(ROOT, "dist/extension");
const RUNTIME_FILES = Object.freeze([
  "manifest.json",
  "background.js",
  "content.js",
  "content.css",
  "popup.html",
  "popup.js",
  "popup.css",
  "popup-appearance.js",
  "options.html",
  "options.js",
  "options.css"
]);
const RUNTIME_DIRS = Object.freeze(["src"]);
const OPTIONAL_RUNTIME_DIRS = Object.freeze(["assets/lexicon"]);
const FORBIDDEN_SEGMENTS = new Set([
  "tests",
  "e2e",
  "scripts",
  "docs",
  ".github",
  "lexicon",
  ".release-sources",
  "node_modules",
  "playwright-report",
  "test-results"
]);

export async function buildExtension({
  outDir = DEFAULT_OUT,
  requireLexicon = false
} = {}) {
  const output = resolve(outDir);
  if (output === ROOT || !relative(ROOT, output).startsWith("dist")) {
    throw new Error("extension output must stay under dist/");
  }

  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });

  for (const path of RUNTIME_FILES) {
    await copyRequired(path, output);
  }
  for (const path of RUNTIME_DIRS) {
    await copyRequired(path, output);
  }

  let lexicalAssetsIncluded = false;
  for (const path of OPTIONAL_RUNTIME_DIRS) {
    const source = resolve(ROOT, path);
    if (!existsSync(source)) continue;
    await cp(source, resolve(output, path), { recursive: true });
    lexicalAssetsIncluded = true;
  }

  if (requireLexicon && !lexicalAssetsIncluded) {
    throw new Error("release extension build requires generated assets/lexicon");
  }

  const files = await walkFiles(output);
  const forbidden = files.filter((path) => {
    const [topLevel] = relative(output, path).split(/[\\/]/);
    return FORBIDDEN_SEGMENTS.has(topLevel);
  });
  if (forbidden.length) {
    throw new Error("forbidden production extension paths: " +
      forbidden.map((path) => relative(output, path)).join(", "));
  }

  const entries = [];
  let totalBytes = 0;
  let lexicalBytes = 0;
  for (const path of files) {
    const size = (await stat(path)).size;
    const rel = relative(output, path).replaceAll("\\", "/");
    entries.push({ path: rel, size });
    totalBytes += size;
    if (rel.startsWith("assets/lexicon/")) lexicalBytes += size;
  }
  entries.sort((a, b) => b.size - a.size || a.path.localeCompare(b.path));

  return {
    output,
    fileCount: entries.length,
    totalBytes,
    lexicalBytes,
    lexicalAssetsIncluded,
    largestFiles: entries.slice(0, 20)
  };
}

async function copyRequired(path, output) {
  const source = resolve(ROOT, path);
  if (!existsSync(source)) throw new Error("missing runtime path: " + path);
  await cp(source, resolve(output, path), { recursive: true });
}

async function walkFiles(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await walkFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function parseArgs(argv) {
  const args = { outDir: DEFAULT_OUT, requireLexicon: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--require-lexicon") {
      args.requireLexicon = true;
      continue;
    }
    if (arg === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("missing value for --out");
      args.outDir = resolve(ROOT, value);
      index += 1;
      continue;
    }
    throw new Error("unknown argument: " + arg);
  }
  return args;
}

async function main() {
  const report = await buildExtension(parseArgs(process.argv.slice(2)));
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
