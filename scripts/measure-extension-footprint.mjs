#!/usr/bin/env node
import { deflateRawSync } from "node:zlib";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildExtension } from "./build-extension.mjs";
import { certifyLexicalRelease } from "./certify-lexical-release.mjs";

const ZIP_END_OF_CENTRAL_DIRECTORY_BYTES = 22;
const ZIP_LOCAL_HEADER_BYTES = 30;
const ZIP_CENTRAL_HEADER_BYTES = 46;

export async function measureExtensionFootprint({
  releaseRoot = resolve("assets/lexicon")
} = {}) {
  const tempRoot = await mkdtemp(join(tmpdir(), "translateflow-footprint-"));
  const extensionDir = join(tempRoot, "extension");

  try {
    const build = await buildExtension({
      outDir: extensionDir,
      requireLexicon: true,
      allowExternalOutput: true
    });
    const entries = await readEntries(extensionDir);
    const categorized = categorizeEntries(entries);
    const zipProxy = zipDeflateProxy(entries);
    const cert = await certifyLexicalRelease({ root: resolve(releaseRoot) });

    const structuralFailures = [];
    const rawTotal = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    const rawLexical = categorized.lexical.reduce((sum, entry) => sum + entry.bytes, 0);
    if (rawTotal !== build.totalBytes) {
      structuralFailures.push(
        "production package byte drift: buildExtension=" + build.totalBytes + ", measured=" + rawTotal
      );
    }
    if (rawLexical !== build.lexicalBytes) {
      structuralFailures.push(
        "lexical package byte drift: buildExtension=" + build.lexicalBytes + ", measured=" + rawLexical
      );
    }
    if (!categorized.core.length) structuralFailures.push("production package is missing bundled Core");
    if (!categorized.technical.length) structuralFailures.push("production package is missing bundled Technical");
    if (cert.failures.length) {
      structuralFailures.push(...cert.failures.map((failure) => "release certifier: " + failure));
    }

    return {
      schemaVersion: 1,
      report: "production-extension-footprint-cost",
      productionBehaviorChanged: false,
      packageBoundary: {
        builder: "scripts/build-extension.mjs",
        allowlistAudited: true,
        validationAssetsIncluded: false
      },
      rawBytes: {
        total: rawTotal,
        runtimeWithoutLexicon: sumBytes(categorized.runtime),
        lexical: rawLexical,
        core: sumBytes(categorized.core),
        technical: sumBytes(categorized.technical),
        otherLexical: sumBytes(categorized.otherLexical),
        lexicalShare: ratio(rawLexical, rawTotal),
        coreShare: ratio(sumBytes(categorized.core), rawTotal)
      },
      zipDeflateProxy: {
        method: "per-file raw DEFLATE level 9 + minimal ZIP local/central headers",
        caveat: "This is a deterministic upload/install-size proxy, not a claim about Chrome Web Store CRX/download/delta bytes.",
        totalBytes: zipProxy.totalBytes,
        runtimeWithoutLexiconBytes: zipDeflateProxy(categorized.runtime).totalBytes,
        lexicalBytes: zipDeflateProxy(categorized.lexical).totalBytes,
        coreBytes: zipDeflateProxy(categorized.core).totalBytes,
        technicalBytes: zipDeflateProxy(categorized.technical).totalBytes,
        otherLexicalBytes: zipDeflateProxy(categorized.otherLexical).totalBytes,
        lexicalShare: ratio(zipDeflateProxy(categorized.lexical).totalBytes, zipProxy.totalBytes),
        coreShare: ratio(zipDeflateProxy(categorized.core).totalBytes, zipProxy.totalBytes)
      },
      coldLookup: {
        persistentMs: cert.timingMs.coldPersistent,
        packageReads: cert.reads.cold.reads,
        packageReadBytes: cert.reads.cold.bytes,
        warmPersistentMs: cert.timingMs.warmPersistent,
        warmReadDelta: {
          reads: cert.reads.warm.reads - cert.reads.cold.reads,
          bytes: cert.reads.warm.bytes - cert.reads.cold.bytes
        },
        decodedCacheBytes: cert.cache.bytes,
        decodedCacheBudgetBytes: cert.cache.maxBytes,
        heapDeltaObservedBytes: cert.heapObservation.deltaBytes,
        note: cert.heapObservation.note
      },
      files: {
        count: entries.length,
        largest: entries
          .slice()
          .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path, "en"))
          .slice(0, 20)
          .map(({ path, bytes, compressedBytes }) => ({ path, bytes, compressedBytes }))
      },
      structuralFailures
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
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

export function categorizeEntries(entries) {
  const result = {
    runtime: [],
    lexical: [],
    core: [],
    technical: [],
    otherLexical: []
  };

  for (const entry of Array.isArray(entries) ? entries : []) {
    const path = String(entry?.path || "");
    if (path.startsWith("assets/lexicon/")) {
      result.lexical.push(entry);
      if (path.startsWith("assets/lexicon/core/")) result.core.push(entry);
      else if (path.startsWith("assets/lexicon/technical/")) result.technical.push(entry);
      else result.otherLexical.push(entry);
    } else {
      result.runtime.push(entry);
    }
  }
  return result;
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

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
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
  const report = await measureExtensionFootprint({
    releaseRoot: args.root || undefined
  });
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
