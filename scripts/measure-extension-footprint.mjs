#!/usr/bin/env node
import { deflateRawSync } from "node:zlib";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildExtension } from "./build-extension.mjs";

const ZIP_END_OF_CENTRAL_DIRECTORY_BYTES = 22;
const ZIP_LOCAL_HEADER_BYTES = 30;
const ZIP_CENTRAL_HEADER_BYTES = 46;

export async function measureExtensionFootprint() {
  const tempRoot = await mkdtemp(join(tmpdir(), "translateflow-footprint-"));
  const extensionDir = join(tempRoot, "extension");
  try {
    const build = await buildExtension({ outDir: extensionDir, allowExternalOutput: true });
    const entries = await readEntries(extensionDir);
    const rawTotal = sumBytes(entries);
    const structuralFailures = assessPackageInventory(entries);
    if (rawTotal !== build.totalBytes) structuralFailures.push("production package byte inventory drift");
    return {
      schemaVersion: 1,
      report: "production-extension-footprint-cost",
      packageBoundary: {
        builder: "scripts/build-extension.mjs",
        allowlistAudited: true,
        validationAssetsIncluded: false,
        dictionaryAssetsIncluded: false
      },
      rawBytes: { total: rawTotal },
      zipDeflateProxy: {
        method: "per-file raw DEFLATE level 9 + minimal ZIP local/central headers",
        caveat: "Deterministic size proxy; not Chrome Web Store CRX/download/delta bytes.",
        ...zipDeflateProxy(entries)
      },
      files: {
        count: entries.length,
        largest: entries.slice().sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path, "en"))
          .slice(0, 20).map(({ path, bytes, compressedBytes }) => ({ path, bytes, compressedBytes }))
      },
      structuralFailures
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export function assessPackageInventory(entries) {
  const forbidden = entries.filter(({ path }) => path.startsWith("assets/lexicon/") ||
    /^(?:tests|e2e|scripts|docs|lexicon|node_modules|\.github|\.release-sources)\//u.test(path));
  return forbidden.map(({ path }) => "dictionary or development asset entered production package: " + path);
}

export function zipDeflateProxy(entries) {
  const list = Array.isArray(entries) ? entries : [];
  let payloadBytes = 0;
  let envelopeBytes = ZIP_END_OF_CENTRAL_DIRECTORY_BYTES;

  for (const entry of list) {
    const pathBytes = Buffer.byteLength(String(entry?.path || ""), "utf8");
    if (!pathBytes) throw new Error("ZIP proxy entry path is required");
    const compressedBytes = Number(entry?.compressedBytes);
    if (!Number.isSafeInteger(compressedBytes) || compressedBytes < 0) {
      throw new Error("ZIP proxy compressedBytes must be a non-negative integer");
    }
    payloadBytes += compressedBytes;
    envelopeBytes += ZIP_LOCAL_HEADER_BYTES + pathBytes;
    envelopeBytes += ZIP_CENTRAL_HEADER_BYTES + pathBytes;
  }

  return {
    files: list.length,
    payloadBytes,
    envelopeBytes,
    totalBytes: payloadBytes + envelopeBytes
  };
}

async function readEntries(root) {
  const paths = await walkFiles(root);
  const entries = [];
  for (const path of paths) {
    const bytes = new Uint8Array(await readFile(path));
    const rel = relative(root, path).replaceAll("\\", "/");
    entries.push({
      path: rel,
      bytes: bytes.byteLength,
      compressedBytes: deflateRawSync(bytes, { level: 9 }).byteLength
    });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path, "en"));
  return entries;
}

async function walkFiles(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await walkFiles(path));
    else if (entry.isFile()) {
      await stat(path);
      result.push(path);
    }
  }
  return result;
}

function sumBytes(entries) {
  return (Array.isArray(entries) ? entries : []).reduce((sum, entry) => sum + Number(entry?.bytes || 0), 0);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("missing value for --" + key);
    result[key] = value;
    index += 1;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await measureExtensionFootprint();
  const output = JSON.stringify(report, null, 2) + "\n";
  if (args.out) await writeFile(resolve(args.out), output);
  process.stdout.write(output);
  if (report.structuralFailures.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
