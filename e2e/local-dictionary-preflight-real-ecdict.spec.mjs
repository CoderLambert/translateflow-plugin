import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { preflightLocalDictionaryFiles } from "../src/background/packs/local-dictionary-preflight.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await readFile(
  resolve(repoRoot, "lexicon/build-evidence/ecdict-mdx-1.0.28-corpus-lock.json"),
  "utf8"
));
const mdxPath = process.env.RICH_MDICT_REAL_MDX || "";
const evidenceDir = process.env.RICH_MDICT_EVIDENCE_DIR ||
  resolve(repoRoot, "test-results/rich-mdict-evidence");

test("pinned real ECDICT MDX preflight stays local, bounded, and routes to the rich importer", async () => {
  test.skip(!mdxPath, "Set RICH_MDICT_REAL_MDX in the dedicated pinned-corpus compatibility gate.");
  const certifiedCorpus = JSON.parse(await readFile(
    resolve(evidenceDir, "ecdict-corpus-parser-report.json"),
    "utf8"
  ));
  expect(certifiedCorpus.status).toBe("PASS");
  expect(certifiedCorpus.mdx.sha256).toBe(lock.mdx.sha256);
  expect(certifiedCorpus.mdx.bytes).toBe(lock.mdx.bytes);
  const result = await preflightPinnedEcdictMdx(mdxPath);

  expect(result.compatibility.status).toBe("supported");
  expect(result.identity.family).toBe("mdict-rich");
  expect(result.route.importer).toBe("rich-mdict");
  expect(result.route.requiresSemanticConfirmation).toBe(false);
  expect(result.estimates.entryCount).toBe(lock.mdx.entryCount);
  expect(result.compatibility.capabilitiesRequired).toEqual(expect.arrayContaining([
    "mdx.engine.v2",
    "mdx.encoding.utf8",
    "mdx.key-info.compression-zlib"
  ]));
  expect(result.compatibility.unsupportedCapabilities).toEqual([]);
  expect(result.identity.hints.length).toBeGreaterThan(0);
  expect(result.identity.hints.every((hint) => hint.verified === false &&
    hint.verification === "unverified")).toBe(true);
  expect(result.identity.hints.every((hint) => hint.ranges.every((range) =>
    range.offset + range.length <= hint.readableEnd && hint.readableEnd < hint.size))).toBe(true);

  const report = {
    status: "PASS",
    sourceReleaseTag: lock.source.releaseTag,
    pinnedMdxSha256: lock.mdx.sha256,
    pinnedMdxBytes: lock.mdx.bytes,
    preflight: {
      status: result.compatibility.status,
      family: result.identity.family,
      importer: result.route.importer,
      requiresSemanticConfirmation: result.route.requiresSemanticConfirmation,
      entryCount: result.estimates.entryCount,
      capabilitiesPresent: result.compatibility.capabilitiesPresent,
      capabilitiesRequired: result.compatibility.capabilitiesRequired,
      unsupportedCapabilities: result.compatibility.unsupportedCapabilities,
      identityHints: result.identity.hints
    },
    generatedAt: new Date().toISOString()
  };
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(resolve(evidenceDir, "ecdict-local-preflight-report.json"),
    `${JSON.stringify(report, null, 2)}\n`);
  console.log("[LOCAL_DICTIONARY_PREFLIGHT_REAL_ECDICT]", JSON.stringify(report));
});

async function preflightPinnedEcdictMdx(path) {
  const fileStat = await stat(path);
  expect(fileStat.size).toBe(lock.mdx.bytes);
  const handle = await open(path, "r");
  const file = {
    name: lock.archive.entryName,
    size: fileStat.size,
    slice(start, end) {
      const length = end - start;
      return {
        async arrayBuffer() {
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, length, start);
          if (bytesRead !== length) throw new Error("Pinned MDX range read was incomplete.");
          return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        }
      };
    }
  };
  try {
    return await preflightLocalDictionaryFiles({ files: [file] });
  } finally {
    await handle.close();
  }
}
