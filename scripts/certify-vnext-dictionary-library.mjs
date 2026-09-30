#!/usr/bin/env node
import { readFile, mkdir, writeFile, rename, rm, readdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildExtension } from "./build-extension.mjs";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const ECDICT_LOCK = JSON.parse(await readFile(
  join(REPO_ROOT, "lexicon/build-evidence/ecdict-mdx-1.0.28-corpus-lock.json"),
  "utf8"
));
const MDD_LOCK = JSON.parse(await readFile(
  join(REPO_ROOT, "tests/fixtures/mdd-interop/corpus-lock.json"),
  "utf8"
));
const FROZEN_ECDICT = Object.freeze({
  releaseTag: "1.0.28",
  releaseUrl: "https://github.com/skywind3000/ECDICT/releases/tag/1.0.28",
  assetUrl: "https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-mdx-28.zip",
  archiveBytes: 97755340,
  archiveSha256: "b06a72a0cfc37485a0466ee62fb43137559ea75eea147d8b7715142faca2229f",
  mdxBytes: 97786525,
  mdxSha256: "275e71b58fd359bfe649af1cbee533ea81770bdbc53ec4a34567f84720a5751b",
  title: "简明英汉字典增强版",
  entryCount: 3402564,
  keyBlockCount: 2506,
  recordBlockCount: 3768,
  excerpts: Object.freeze([
    { query: "run", headword: "run", rawRecordIncludes: "n. 跑, 赛跑, 奔跑, 奔跑的路程" },
    { query: "state", headword: "state", rawRecordIncludes: "n. 州, 状态, 情形" },
    { query: "process", headword: "process", rawRecordIncludes: "n. 程序, 进行, 过程" },
    { query: "issue", headword: "issue", rawRecordIncludes: "n. 发行, 问题, 后果" },
    { query: "branch", headword: "branch", rawRecordIncludes: "n. 树枝, 支店, 支流" },
    { query: "container", headword: "container", rawRecordIncludes: "n. 容器, 集装箱" },
    { query: "cache", headword: "cache", rawRecordIncludes: "n. 隐藏所, 隐藏的粮食或物资, 贮藏物, 高速缓冲存储器" }
  ])
});
const FROZEN_MDD = Object.freeze({
  purpose: "synthetic-interoperability-fixture-not-dictionary-corpus",
  writerCommit: "f0240b30cabd2f0470d3ee1a0641fc7f8c38dcf5",
  writerSourceSha256: "f47452af9296b79d8f4fc39e0432d72278079857482bc6d74b1b5e35e4b65081",
  writerLicenseSha256: "050b25702f152882a65e1ec147009cc90abe0624c87918b34f771026419aa19e",
  generatorSha256: "84f48e36be9298746e970f3b9ccd8839712c563c97816725829cbe44fa844e74",
  mdx: { file: "interop.mdx", bytes: 1194, sha256: "b8996c8cd7449e67a5049ba0cd284fb1528385ff090c82af4113c67e050a8a82" },
  mdd: { file: "interop.mdd", bytes: 1723, sha256: "98adc93097939119d72d5d0257027099ab25d421b9df43d10867e29cc24fe4f5" },
  resources: Object.freeze([
    { path: "interop/fixture.css", bytes: 94, sha256: "33e74c93a0fb2a4d0696fc4b2537fa4709c57492f248c6c6b129329fcb6bf880", mime: "text/css" },
    { path: "interop/sample.png", bytes: 76, sha256: "620edd992210ef75c3db8d80aab7b51249446c5ac83eb465ab79ff328a44e4c5", mime: "image/png" },
    { path: "interop/tone.wav", bytes: 1964, sha256: "72d5eaa59b2265c56b6fc2bb8f7eb3b3438f2a90e00f1e47fe2581e210fb1108", mime: "audio/wav" }
  ])
});

export const VNEXT_EVIDENCE_FILES = Object.freeze({
  corpusParser: "ecdict-corpus-parser-report.json",
  realCorpusProduct: "ecdict-real-corpus-report.json",
  curatedArchiveProduct: "ecdict-one-click-real-archive-report.json",
  mddInterop: "mdd-interop-certification.json",
  mddProduct: "mdd-resources-e2e-report.json",
  richViewerSecurity: "rich-viewer-security-report.json",
  vnextProduct: "dictionary-library-vnext-product-report.json",
  playwright: "playwright-vnext-report.json"
});

const REQUIRED_E2E_CASES = Object.freeze([
  ["e2e/rich-mdict-real-corpus.spec.mjs", "Settings install survives reload, Selection shows a real record with zero Provider calls, and delete removes it"],
  ["e2e/rich-mdict-real-corpus.spec.mjs", "the Settings card requests the exact host pair, installs/reinstalls the real archive, preserves the active version on failure/cancel, works offline, and deletes"],
  ["e2e/mdd-resources.spec.mjs", "independent MDX/MDD pair restores image, gated audio, and safe CSS after reload"],
  ["e2e/multi-dictionary-viewer.spec.mjs", "configured order and collapsed defaults survive reload beside the unchanged structured primary"],
  ["e2e/multi-dictionary-viewer.spec.mjs", "disabling a dictionary hides it from Selection while its installed bytes remain available"],
  ["e2e/multi-dictionary-viewer.spec.mjs", "a corrupted dictionary reports its own error while another card and the structured primary render"],
  ["e2e/settings-ia.spec.mjs", "dictionary library separates trust classes and stays usable at narrow width"],
  ["e2e/rich-viewer-security.spec.mjs", "hostile HTML and styles stay inert while readable dictionary structure remains available"],
  ["e2e/rich-mdict-product.spec.mjs", "Settings install persists, Selection reads safe text locally, and delete clears it"],
  ["e2e/rich-mdict-product.spec.mjs", "corrupt key-info metadata is rejected without creating an installed dictionary"]
]);
const REQUIRED_NEW_PRODUCT_FILE = "e2e/dictionary-library-vnext-product.spec.mjs";
const REQUIRED_NEW_PRODUCT_TITLE = "two local rich MDX dictionaries and one attached MDD keep isolated cards, preferences, and resources";
const PERMISSION_ORIGINS = Object.freeze([
  "https://github.com/*",
  "https://release-assets.githubusercontent.com/*"
]);
const ECDICT_INDEX_RANGE_METRICS = Object.freeze({
  readCalls: 2512,
  totalRangeBytes: 27504767,
  largestRangeBytes: 61253
});
const ECDICT_MEMORY_LIMITS = Object.freeze({
  maximumCompactIndexJsonBytes: 2 * 1024 * 1024,
  maximumProcessRssPeakDeltaBytes: 128 * 1024 * 1024
});
const ECDICT_LOOKUP_RANGE_BYTES = Object.freeze({
  run: 33515,
  state: 30189,
  process: 27683,
  issue: 33104,
  branch: 28650,
  container: 27325,
  cache: 30659
});

export function certifyVnextDictionaryLibrary({
  corpusParser,
  realCorpusProduct,
  curatedArchiveProduct,
  mddInterop,
  mddProduct,
  richViewerSecurity,
  vnextProduct,
  playwright,
  packageBoundary
} = {}) {
  const failures = [];
  const lockEvidence = certifyFrozenLocks(failures);
  const playwrightEvidence = certifyPlaywright(playwright, failures);
  const productEvidence = certifyVnextProduct(vnextProduct, failures);
  const evidence = {
    frozenLocks: lockEvidence,
    pinnedEcdict: certifyCorpusParser(corpusParser, failures),
    curatedInstallAndViewer: certifyEcdictProduct(realCorpusProduct, curatedArchiveProduct, failures),
    mddInteropAndResources: certifyMdd(mddInterop, mddProduct, failures),
    multiDictionary: playwrightEvidence,
    richViewerSecurity: certifySecurity(richViewerSecurity, failures),
    vnextProduct: productEvidence,
    lexicalPrimaryLane: certifyLexicalPrimary(vnextProduct, playwrightEvidence, failures),
    productionPackage: certifyPackage(packageBoundary, failures)
  };

  return {
    schemaVersion: 1,
    report: "dictionary-library-vnext-certification",
    status: failures.length ? "FAIL" : "PASS",
    corpus: {
      source: ECDICT_LOCK.source.releaseUrl,
      releaseTag: ECDICT_LOCK.source.releaseTag,
      archive: { bytes: ECDICT_LOCK.archive.bytes, sha256: ECDICT_LOCK.archive.sha256 },
      mdx: {
        bytes: ECDICT_LOCK.mdx.bytes,
        sha256: ECDICT_LOCK.mdx.sha256,
        entryCount: ECDICT_LOCK.mdx.entryCount,
        keyBlockCount: ECDICT_LOCK.mdx.keyBlockCount,
        recordBlockCount: ECDICT_LOCK.mdx.recordBlockCount
      },
      independentWriter: {
        commit: MDD_LOCK.independentWriter.commit,
        mdxSha256: MDD_LOCK.generation.mdx.sha256,
        mddSha256: MDD_LOCK.generation.mdd.sha256
      }
    },
    evidence,
    failures
  };
}

function certifyFrozenLocks(failures) {
  const before = failures.length;
  requireEqual(ECDICT_LOCK.source.releaseTag, FROZEN_ECDICT.releaseTag, "frozen ECDICT release tag", failures);
  requireEqual(ECDICT_LOCK.source.releaseUrl, FROZEN_ECDICT.releaseUrl, "frozen ECDICT release URL", failures);
  requireEqual(ECDICT_LOCK.source.assetUrl, FROZEN_ECDICT.assetUrl, "frozen ECDICT asset URL", failures);
  requireEqual(ECDICT_LOCK.archive.bytes, FROZEN_ECDICT.archiveBytes, "frozen ECDICT archive bytes", failures);
  requireEqual(ECDICT_LOCK.archive.sha256, FROZEN_ECDICT.archiveSha256, "frozen ECDICT archive SHA-256", failures);
  requireEqual(ECDICT_LOCK.mdx.bytes, FROZEN_ECDICT.mdxBytes, "frozen ECDICT MDX bytes", failures);
  requireEqual(ECDICT_LOCK.mdx.sha256, FROZEN_ECDICT.mdxSha256, "frozen ECDICT MDX SHA-256", failures);
  requireEqual(ECDICT_LOCK.mdx.title, FROZEN_ECDICT.title, "frozen ECDICT MDX title", failures);
  requireEqual(ECDICT_LOCK.mdx.entryCount, FROZEN_ECDICT.entryCount, "frozen ECDICT entry count", failures);
  requireEqual(ECDICT_LOCK.mdx.keyBlockCount, FROZEN_ECDICT.keyBlockCount, "frozen ECDICT key-block count", failures);
  requireEqual(ECDICT_LOCK.mdx.recordBlockCount, FROZEN_ECDICT.recordBlockCount, "frozen ECDICT record-block count", failures);
  if (!sameJson(ECDICT_LOCK.independentDecode?.recordExcerpts, FROZEN_ECDICT.excerpts)) {
    failures.push("frozen ECDICT independent record excerpts changed");
  }

  requireEqual(MDD_LOCK.purpose, FROZEN_MDD.purpose, "frozen MDD fixture purpose", failures);
  requireEqual(MDD_LOCK.independentWriter?.commit, FROZEN_MDD.writerCommit, "frozen independent MDict writer commit", failures);
  requireEqual(MDD_LOCK.independentWriter?.writerFileSha256, FROZEN_MDD.writerSourceSha256, "frozen independent writer source hash", failures);
  requireEqual(MDD_LOCK.independentWriter?.licenseSha256, FROZEN_MDD.writerLicenseSha256, "frozen independent writer license hash", failures);
  requireEqual(MDD_LOCK.generation?.scriptSha256, FROZEN_MDD.generatorSha256, "frozen MDD fixture generator hash", failures);
  for (const expected of [FROZEN_MDD.mdx, FROZEN_MDD.mdd]) {
    const actual = expected.file === FROZEN_MDD.mdx.file ? MDD_LOCK.generation?.mdx : MDD_LOCK.generation?.mdd;
    requireEqual(actual?.file, expected.file, `frozen MDD ${expected.file} filename`, failures);
    requireEqual(actual?.bytes, expected.bytes, `frozen MDD ${expected.file} byte count`, failures);
    requireEqual(actual?.sha256, expected.sha256, `frozen MDD ${expected.file} SHA-256`, failures);
  }
  if (!sameJson(MDD_LOCK.generation?.resources?.map(({ path, bytes, sha256, mime }) => ({ path, bytes, sha256, mime })), FROZEN_MDD.resources)) {
    failures.push("frozen MDD resource identities, hashes, or MIME values changed");
  }
  return {
    status: failures.length === before ? "passed" : "failed",
    ecdict: {
      releaseTag: ECDICT_LOCK.source.releaseTag,
      archiveBytes: ECDICT_LOCK.archive.bytes,
      archiveSha256: ECDICT_LOCK.archive.sha256,
      mdxBytes: ECDICT_LOCK.mdx.bytes,
      mdxSha256: ECDICT_LOCK.mdx.sha256,
      entryCount: ECDICT_LOCK.mdx.entryCount,
      keyBlockCount: ECDICT_LOCK.mdx.keyBlockCount,
      recordBlockCount: ECDICT_LOCK.mdx.recordBlockCount
    },
    mdd: {
      writerCommit: MDD_LOCK.independentWriter?.commit,
      writerSourceSha256: MDD_LOCK.independentWriter?.writerFileSha256,
      writerLicenseSha256: MDD_LOCK.independentWriter?.licenseSha256,
      generatorSha256: MDD_LOCK.generation?.scriptSha256,
      mdx: MDD_LOCK.generation?.mdx,
      mdd: MDD_LOCK.generation?.mdd
    }
  };
}

function certifyCorpusParser(report, failures) {
  const before = failures.length;
  if (!isObject(report) || report.status !== "PASS") {
    failures.push("pinned ECDICT parser report is missing or did not pass");
    return { status: isObject(report) ? "failed" : "missing" };
  }
  requireEqual(report.source, ECDICT_LOCK.source.releaseUrl, "ECDICT parser source release", failures);
  requireEqual(report.archive?.bytes, ECDICT_LOCK.archive.bytes, "ECDICT archive bytes", failures);
  requireEqual(report.archive?.sha256, ECDICT_LOCK.archive.sha256, "ECDICT archive SHA-256", failures);
  requireEqual(report.mdx?.bytes, ECDICT_LOCK.mdx.bytes, "ECDICT MDX bytes", failures);
  requireEqual(report.mdx?.sha256, ECDICT_LOCK.mdx.sha256, "ECDICT MDX SHA-256", failures);
  for (const [field, expected] of Object.entries({
    title: ECDICT_LOCK.mdx.title,
    generatedByEngineVersion: ECDICT_LOCK.mdx.generatedByEngineVersion,
    requiredEngineVersion: ECDICT_LOCK.mdx.requiredEngineVersion,
    format: ECDICT_LOCK.mdx.format,
    encoding: ECDICT_LOCK.mdx.encoding,
    encrypted: String(ECDICT_LOCK.mdx.encrypted),
    compact: ECDICT_LOCK.mdx.compact ? "Yes" : "No",
    compat: ECDICT_LOCK.mdx.compat ? "Yes" : "No"
  })) {
    requireEqual(report.header?.[field], expected, `ECDICT MDX header ${field}`, failures);
  }
  requireEqual(report.header?.styleSheetRuleCount, ECDICT_LOCK.mdx.styleSheetRules, "ECDICT MDX StyleSheet rule count", failures);

  const parser = report.parserEvidence;
  requireEqual(parser?.sourceBytes, ECDICT_LOCK.mdx.bytes, "parser source byte count", failures);
  requireEqual(parser?.entryCount, ECDICT_LOCK.mdx.entryCount, "parser entry count", failures);
  requireEqual(parser?.keyBlockCount, ECDICT_LOCK.mdx.keyBlockCount, "parser key-block count", failures);
  requireEqual(parser?.recordBlockCount, ECDICT_LOCK.mdx.recordBlockCount, "parser record-block count", failures);
  requireEqual(
    parser?.maximumDecompressedKeyBlockBytes,
    32769,
    "maximum decompressed key-block bytes",
    failures
  );
  requireEqual(
    parser?.maximumDecompressedRecordBlockBytes,
    ECDICT_LOCK.mdx.maximumDecompressedRecordBlockBytes,
    "maximum decompressed record-block bytes",
    failures
  );
  if (!isPositiveInteger(parser?.compactIndexJsonBytes) || parser.compactIndexJsonBytes > ECDICT_MEMORY_LIMITS.maximumCompactIndexJsonBytes) {
    failures.push(`ECDICT compact index must be present and at most ${ECDICT_MEMORY_LIMITS.maximumCompactIndexJsonBytes} bytes`);
  }
  if (!isPositiveInteger(parser?.processRssPeakDeltaBytes) || parser.processRssPeakDeltaBytes > ECDICT_MEMORY_LIMITS.maximumProcessRssPeakDeltaBytes) {
    failures.push(`ECDICT parser RSS peak delta must be present and at most ${ECDICT_MEMORY_LIMITS.maximumProcessRssPeakDeltaBytes} bytes`);
  }
  const indexIo = parser?.indexRangeIo;
  for (const [field, expected] of Object.entries(ECDICT_INDEX_RANGE_METRICS)) {
    requireEqual(indexIo?.[field], expected, `ECDICT index ${field}`, failures);
  }
  const expectedQueries = ECDICT_LOCK.independentDecode.recordExcerpts;
  const lookups = parser?.lookups;
  if (!Array.isArray(lookups) || lookups.length !== expectedQueries.length) {
    failures.push(`ECDICT parser must report exactly ${expectedQueries.length} pinned lookup range measurements`);
  }
  const lookupEvidence = [];
  for (const expected of expectedQueries) {
    const matches = Array.isArray(lookups) ? lookups.filter((item) => item?.query === expected.query) : [];
    if (matches.length !== 1) {
      failures.push(`ECDICT parser lookup ${expected.query} must occur once (found ${matches.length})`);
      lookupEvidence.push({ query: expected.query, status: matches.length ? "duplicate" : "missing" });
      continue;
    }
    const item = matches[0];
    const expectedBytes = ECDICT_LOOKUP_RANGE_BYTES[expected.query];
    requireEqual(item.headword, expected.headword, `ECDICT ${expected.query} headword`, failures);
    requireEqual(item.rangeIo?.readCalls, 2, `ECDICT ${expected.query} range reads`, failures);
    requireEqual(item.rangeIo?.keyBlocksRead, 1, `ECDICT ${expected.query} key blocks`, failures);
    requireEqual(item.rangeIo?.recordBlocksRead, 1, `ECDICT ${expected.query} record blocks`, failures);
    requireEqual(item.rangeIo?.totalRangeBytes, expectedBytes, `ECDICT ${expected.query} source bytes`, failures);
    requireEqual(item.lookupMetrics?.sourceRangeReads, 2, `ECDICT ${expected.query} runtime range reads`, failures);
    requireEqual(item.lookupMetrics?.sourceBytesRead, expectedBytes, `ECDICT ${expected.query} runtime source bytes`, failures);
    requireEqual(item.lookupMetrics?.keyBlockDecodes, 1, `ECDICT ${expected.query} key-block decodes`, failures);
    requireEqual(item.lookupMetrics?.recordBlockDecodes, 1, `ECDICT ${expected.query} record-block decodes`, failures);
    lookupEvidence.push({
      query: expected.query,
      headword: item.headword,
      sourceRangeReads: item.lookupMetrics?.sourceRangeReads ?? null,
      sourceBytesRead: item.lookupMetrics?.sourceBytesRead ?? null,
      keyBlocksRead: item.rangeIo?.keyBlocksRead ?? null,
      recordBlocksRead: item.rangeIo?.recordBlocksRead ?? null
    });
  }
  return {
    status: failures.length === before ? "passed" : "failed",
    archive: report.archive,
    mdx: report.mdx,
    header: {
      title: report.header?.title,
      engineVersion: report.header?.generatedByEngineVersion,
      requiredEngineVersion: report.header?.requiredEngineVersion,
      format: report.header?.format,
      encoding: report.header?.encoding,
      encrypted: report.header?.encrypted,
      compact: report.header?.compact,
      compat: report.header?.compat,
      styleSheetRuleCount: report.header?.styleSheetRuleCount
    },
    parser: {
      entryCount: parser?.entryCount,
      keyBlockCount: parser?.keyBlockCount,
      recordBlockCount: parser?.recordBlockCount,
      compactIndexJsonBytes: parser?.compactIndexJsonBytes,
      processRssBaselineBytes: parser?.processRssBaselineBytes,
      processRssPeakBytes: parser?.processRssPeakBytes,
      processRssPeakDeltaBytes: parser?.processRssPeakDeltaBytes,
      memoryLimits: ECDICT_MEMORY_LIMITS,
      maximumDecompressedKeyBlockBytes: parser?.maximumDecompressedKeyBlockBytes,
      maximumDecompressedRecordBlockBytes: parser?.maximumDecompressedRecordBlockBytes,
      indexRangeIo: indexIo || null,
      lookups: lookupEvidence
    }
  };
}

function certifyEcdictProduct(realReport, curatedReport, failures) {
  const before = failures.length;
  if (!isObject(realReport) || realReport.status !== "PASS") {
    failures.push("pinned ECDICT local viewer browser report is missing or did not pass");
  } else {
    requireEqual(realReport.source, ECDICT_LOCK.source.releaseUrl, "browser ECDICT release", failures);
    requireEqual(realReport.assetSha256, ECDICT_LOCK.archive.sha256, "browser ECDICT archive SHA-256", failures);
    requireEqual(realReport.mdxSha256, ECDICT_LOCK.mdx.sha256, "browser ECDICT MDX SHA-256", failures);
    requireEqual(realReport.mdxBytes, ECDICT_LOCK.mdx.bytes, "browser ECDICT MDX bytes", failures);
    requireEqual(realReport.entryCount, ECDICT_LOCK.mdx.entryCount, "browser ECDICT entry count", failures);
    requireEqual(realReport.keyBlockCount, ECDICT_LOCK.mdx.keyBlockCount, "browser ECDICT key-block count", failures);
    requireEqual(realReport.recordBlockCount, ECDICT_LOCK.mdx.recordBlockCount, "browser ECDICT record-block count", failures);
    requireEqual(realReport.encryptedKeyInfo, true, "browser ECDICT encrypted key-info evidence", failures);
    requireEqual(realReport.deleted, true, "browser ECDICT deletion", failures);
    requireEqual(realReport.providerCalls, 0, "browser ECDICT Provider calls", failures);
    requireEqual(realReport.providerCallsAfterDelete, 0, "browser ECDICT Provider calls after delete", failures);
    requireEqual(realReport.richViewer?.shadowRoot, true, "local rich viewer ShadowRoot", failures);
    requireEqual(realReport.richViewer?.structuredPrimary, "local", "structured primary route", failures);
    requireEqual(realReport.richViewer?.providerCalls, 0, "rich viewer Provider calls", failures);
    const samples = Array.isArray(realReport.corpusLookups) ? realReport.corpusLookups : [];
    for (const expected of ECDICT_LOCK.independentDecode.recordExcerpts) {
      const found = samples.filter((item) => item?.query === expected.query);
      if (found.length !== 1) failures.push(`browser ECDICT lookup ${expected.query} must occur once (found ${found.length})`);
      else {
        requireEqual(found[0].headword, expected.headword, `browser ECDICT ${expected.query} headword`, failures);
        requireEqual(found[0].recordVerified, true, `browser ECDICT ${expected.query} independently decoded record`, failures);
        if (!isPositiveInteger(found[0].lookupMs)) failures.push(`browser ECDICT lookup ${expected.query} is missing runtime latency`);
      }
    }
  }

  if (!isObject(curatedReport) || curatedReport.status !== "PASS") {
    failures.push("curated ECDICT one-click browser report is missing or did not pass");
  } else {
    requireEqual(curatedReport.archiveBytes, ECDICT_LOCK.archive.bytes, "curated archive bytes", failures);
    requireEqual(curatedReport.archiveSha256, ECDICT_LOCK.archive.sha256, "curated archive SHA-256", failures);
    requireEqual(curatedReport.mdxBytes, ECDICT_LOCK.mdx.bytes, "curated MDX bytes", failures);
    requireEqual(curatedReport.mdxSha256, ECDICT_LOCK.mdx.sha256, "curated MDX SHA-256", failures);
    requireEqual(curatedReport.entryCount, ECDICT_LOCK.mdx.entryCount, "curated ECDICT entry count", failures);
    if (!sameJson(curatedReport.permissionOrigins, PERMISSION_ORIGINS)) {
      failures.push("curated ECDICT permission origins differ from the exact reviewed GitHub pair");
    }
    if (!isPositiveInteger(curatedReport.initialInstallMs) || !isPositiveInteger(curatedReport.reinstallMs)) {
      failures.push("curated ECDICT report lacks measured install and reinstall timings");
    }
    requireEqual(curatedReport.failedAndCancelledReinstallsPreservedVersion, true, "curated ECDICT failed/cancelled reinstall preservation", failures);
    requireEqual(curatedReport.offlineLookup, "run", "curated ECDICT offline lookup", failures);
    requireEqual(curatedReport.providerCalls, 0, "curated ECDICT Provider calls", failures);
    requireEqual(curatedReport.deleted, true, "curated ECDICT deletion", failures);
    requireEqual(curatedReport.testOnlyArchiveBridge?.pinnedFinalOrigin, "https://release-assets.githubusercontent.com", "curated archive final redirect origin", failures);
    if (!Array.isArray(curatedReport.testOnlyArchiveBridge?.localRequests) || curatedReport.testOnlyArchiveBridge.localRequests.length < 1) {
      failures.push("curated ECDICT report lacks local test-only archive bridge observations");
    }
  }
  return {
    status: failures.length === before ? "passed" : (!realReport || !curatedReport ? "missing" : "failed"),
    realCorpus: realReport ? {
      archiveSha256: realReport.assetSha256,
      mdxSha256: realReport.mdxSha256,
      mdxBytes: realReport.mdxBytes,
      entryCount: realReport.entryCount,
      lookups: (realReport.corpusLookups || []).map((item) => ({ query: item.query, headword: item.headword, lookupMs: item.lookupMs, sourceIoMetrics: item.metrics ?? null })),
      structuredPrimary: realReport.richViewer?.structuredPrimary,
      providerCalls: realReport.providerCalls,
      deleted: realReport.deleted
    } : null,
    curatedInstall: curatedReport ? {
      archiveSha256: curatedReport.archiveSha256,
      mdxSha256: curatedReport.mdxSha256,
      permissionOrigins: curatedReport.permissionOrigins,
      initialInstallMs: curatedReport.initialInstallMs,
      reinstallMs: curatedReport.reinstallMs,
      offlineLookup: curatedReport.offlineLookup,
      providerCalls: curatedReport.providerCalls,
      deleted: curatedReport.deleted
    } : null
  };
}

function certifyMdd(interop, product, failures) {
  const before = failures.length;
  if (!isObject(interop) || interop.status !== "PASS") {
    failures.push("independent MDD interoperability report is missing or did not pass");
  } else {
    requireEqual(interop.purpose, MDD_LOCK.purpose, "MDD interoperability purpose", failures);
    requireEqual(interop.interop?.independentWriter?.performed, true, "independent MDict writer regeneration", failures);
    requireEqual(interop.interop?.independentWriter?.commit, MDD_LOCK.independentWriter.commit, "independent MDict writer commit", failures);
    requireEqual(interop.interop?.independentWriter?.sourceSha256, MDD_LOCK.independentWriter.writerFileSha256, "independent writer source hash", failures);
    requireEqual(interop.interop?.independentWriter?.licenseSha256, MDD_LOCK.independentWriter.licenseSha256, "independent writer license hash", failures);
    compareArtifacts(interop.interop?.artifacts, failures, "MDD fixture");
    compareArtifacts(interop.interop?.independentWriter?.artifacts, failures, "regenerated MDD fixture");
    const parser = interop.interop?.parser;
    requireEqual(parser?.status, "PASS", "MDD parser interoperability status", failures);
    requireEqual(parser?.indexReadResourceRecordBodies, false, "MDD index avoids resource record bodies", failures);
    requireEqual(parser?.resourceObjectsMaterializedAtIndexTime, false, "MDD index avoids materialized resource objects", failures);
    const resources = Array.isArray(parser?.resources) ? parser.resources : [];
    if (resources.length !== MDD_LOCK.generation.resources.length) failures.push("MDD parser report has the wrong resource count");
    for (const expected of MDD_LOCK.generation.resources) {
      const found = resources.filter((item) => item?.path === expected.path);
      if (found.length !== 1) failures.push(`MDD parser resource ${expected.path} must occur once (found ${found.length})`);
      else {
        requireEqual(found[0].bytes, expected.bytes, `MDD resource ${expected.path} bytes`, failures);
        requireEqual(found[0].mime, expected.mime, `MDD resource ${expected.path} MIME`, failures);
        requireEqual(found[0].sourceRangeReads, 2, `MDD resource ${expected.path} range reads`, failures);
        requireEqual(found[0].recordBlockDecodes, 1, `MDD resource ${expected.path} block decodes`, failures);
        if (!isPositiveInteger(found[0].sourceBytesRead)) failures.push(`MDD resource ${expected.path} is missing observed source bytes`);
      }
    }
    for (const expected of MDD_LOCK.generation.resources) {
      const found = interop.interop?.resources?.filter((item) => item?.path === expected.path) || [];
      if (found.length !== 1) failures.push(`MDD hash evidence for ${expected.path} must occur once (found ${found.length})`);
      else {
        requireEqual(found[0].bytes, expected.bytes, `MDD hash evidence ${expected.path} bytes`, failures);
        requireEqual(found[0].sha256, expected.sha256, `MDD resource ${expected.path} SHA-256`, failures);
        requireEqual(found[0].mime, expected.mime, `MDD hash evidence ${expected.path} MIME`, failures);
      }
    }
    requireEqual(interop.interop?.hasFullValidPngAndWavBytes, true, "MDD valid image/audio evidence", failures);
    requireEqual(interop.interop?.rawBytesAreHashedBeforeLookup, true, "MDD hashes raw bytes before lookup", failures);

    const rangeIo = interop.rangeIo;
    requireEqual(rangeIo?.status, "PASS", "synthetic 100 MiB MDD range report", failures);
    requireEqual(rangeIo?.corpusKind, "synthetic-shake256-incompressible-range-read-evidence-not-a-real-dictionary-corpus", "synthetic MDD corpus identity", failures);
    if (!Number.isSafeInteger(rangeIo?.uncompressedPayloadBytes) || rangeIo.uncompressedPayloadBytes < 100 * 1024 * 1024) {
      failures.push("MDD range report is smaller than the required 100 MiB synthetic payload");
    }
    if (!isPositiveInteger(rangeIo?.physicalMddBytes) || !/^[a-f0-9]{64}$/u.test(rangeIo?.sha256 || "")) failures.push("MDD range report lacks physical byte count or SHA-256");
    requireEqual(rangeIo?.indexReadRecordBodies, false, "large MDD index avoids record bodies", failures);
    if (!isPositiveInteger(rangeIo?.resourceCount) || !isPositiveInteger(rangeIo?.recordBlockCount)) failures.push("large MDD report lacks resource and record-block counts");
    if (!isPositiveInteger(rangeIo?.indexSourceBytesRead) || rangeIo.indexSourceBytesRead >= rangeIo.physicalMddBytes / 100) failures.push("large MDD index read more than one percent of the synthetic file");
    requireEqual(rangeIo?.lookup?.sourceRangeReads, 2, "large MDD asset lookup range reads", failures);
    requireEqual(rangeIo?.lookup?.recordBlockDecodes, 1, "large MDD one-resource decode count", failures);
    requireEqual(rangeIo?.lookup?.distinctRecordBlocksRead, 1, "large MDD distinct lookup block count", failures);
    if (!isPositiveInteger(rangeIo?.lookup?.sourceBytesRead) || rangeIo.lookup.sourceBytesRead >= rangeIo.physicalMddBytes / 100) {
      failures.push("large MDD asset lookup read more than one percent of the synthetic resource source");
    }
    requireEqual(rangeIo?.temporaryCorpusRemovedAfterMeasurement, true, "large synthetic MDD cleanup", failures);
  }

  if (!isObject(product) || product.status !== "PASS") {
    failures.push("MDD browser product report is missing or did not pass");
  } else {
    requireEqual(product.purpose, MDD_LOCK.purpose, "MDD browser fixture purpose", failures);
    requireEqual(product.writerCommit, MDD_LOCK.independentWriter.commit, "MDD browser writer commit", failures);
    for (const field of ["resourceMimeAndHashesMatched", "resourcesPersistedAfterSettingsReload", "corruptReplacementPreservedOldResources", "visibleImageAfterReload", "darkColorScheme", "deleted"]) {
      requireEqual(product[field], true, `MDD browser ${field}`, failures);
    }
    requireEqual(product.userPlaybackEvent, "play", "MDD gated audio playback", failures);
    requireEqual(product.remoteRequests, 0, "MDD remote resource requests", failures);
    requireEqual(product.providerCalls, 0, "MDD Provider calls", failures);
    requireEqual(product.objectUrlsAfterViewerClose, 0, "MDD object URLs after viewer close", failures);
    requireEqual(product.objectUrlsAfterDictionaryDelete, 0, "MDD object URLs after delete", failures);
    requireEqual(product.viewport?.width, 320, "MDD narrow viewport width", failures);
    requireEqual(product.viewport?.horizontalOverflow, false, "MDD narrow viewport overflow", failures);
    requireEqual(product.css?.scrollWidth, product.css?.width, "MDD viewer width fit", failures);
  }
  return {
    status: failures.length === before ? "passed" : (!interop || !product ? "missing" : "failed"),
    independentWriter: interop?.interop?.independentWriter ? {
      commit: interop.interop.independentWriter.commit,
      license: interop.interop.independentWriter.license,
      regeneratedArtifacts: interop.interop.independentWriter.artifacts
    } : null,
    parser: interop?.interop?.parser ? {
      sourceBytes: interop.interop.parser.sourceBytes,
      indexSourceBytesRead: interop.interop.parser.indexSourceBytesRead,
      indexReadResourceRecordBodies: interop.interop.parser.indexReadResourceRecordBodies,
      resourceObjectsMaterializedAtIndexTime: interop.interop.parser.resourceObjectsMaterializedAtIndexTime,
      resources: interop.interop.parser.resources
    } : null,
    syntheticRangeIo: interop?.rangeIo ? {
      corpusKind: interop.rangeIo.corpusKind,
      uncompressedPayloadBytes: interop.rangeIo.uncompressedPayloadBytes,
      physicalMddBytes: interop.rangeIo.physicalMddBytes,
      sha256: interop.rangeIo.sha256,
      lookup: interop.rangeIo.lookup,
      temporaryCorpusRemovedAfterMeasurement: interop.rangeIo.temporaryCorpusRemovedAfterMeasurement
    } : null,
    browser: product ? {
      resourceMimeAndHashesMatched: product.resourceMimeAndHashesMatched,
      resourcesPersistedAfterSettingsReload: product.resourcesPersistedAfterSettingsReload,
      corruptReplacementPreservedOldResources: product.corruptReplacementPreservedOldResources,
      userPlaybackEvent: product.userPlaybackEvent,
      remoteRequests: product.remoteRequests,
      providerCalls: product.providerCalls,
      deleted: product.deleted
    } : null
  };
}

function certifyPlaywright(report, failures) {
  const before = failures.length;
  const cases = collectPlaywrightCases(report, failures);
  const required = [];
  for (const [file, title] of REQUIRED_E2E_CASES) {
    const matches = cases.filter((item) => item.file === file && item.title === title);
    if (matches.length !== 1) {
      failures.push(`required vNext Chromium case must occur once: ${file} :: ${title} (found ${matches.length})`);
      required.push({ file, title, status: matches.length ? "duplicate" : "missing" });
      continue;
    }
    const status = certifyPlaywrightCase(matches[0], failures);
    required.push({ file, title, status });
  }
  const vnextCases = cases.filter((item) => item.file === REQUIRED_NEW_PRODUCT_FILE);
  if (!vnextCases.length) {
    failures.push(`new Dictionary Library vNext product E2E file is missing or has no executed cases: ${REQUIRED_NEW_PRODUCT_FILE}`);
  }
  const vnextStatuses = vnextCases.map((item) => certifyPlaywrightCase(item, failures));
  const vnextRequired = vnextCases.filter((item) => item.title === REQUIRED_NEW_PRODUCT_TITLE);
  if (vnextRequired.length !== 1) failures.push(`new vNext product E2E case must occur once: ${REQUIRED_NEW_PRODUCT_TITLE} (found ${vnextRequired.length})`);
  return {
    status: failures.length === before ? "passed" : "failed",
    requiredCases: required,
    newProductFile: {
      file: REQUIRED_NEW_PRODUCT_FILE,
      testCount: vnextCases.length,
      requiredTitle: REQUIRED_NEW_PRODUCT_TITLE,
      status: vnextCases.length && vnextRequired.length === 1 && vnextStatuses.every((status) => status === "passed") ? "passed" : "failed"
    },
    stats: report?.stats || null,
    lexicalPrimary: {
      primaryRoute: "local structured lexical result",
      evidenceCases: [
        "e2e/rich-mdict-real-corpus.spec.mjs: real ECDICT rich detail keeps the structured primary local",
        "e2e/multi-dictionary-viewer.spec.mjs: dictionary preferences leave the structured primary result/candidates unchanged"
      ]
    }
  };
}

function certifyVnextProduct(report, failures) {
  const before = failures.length;
  if (!isObject(report) || report.status !== "PASS") {
    failures.push("integrated Dictionary Library vNext browser evidence report is missing or did not pass");
    return { status: isObject(report) ? "failed" : "missing" };
  }
  requireEqual(report.schemaVersion, 1, "vNext product report schema", failures);
  requireEqual(report.spec, REQUIRED_NEW_PRODUCT_FILE, "vNext product spec identity", failures);
  requireEqual(report.test, REQUIRED_NEW_PRODUCT_TITLE, "vNext product case identity", failures);
  const ordered = report.dictionaries?.order;
  if (!Array.isArray(ordered) || ordered.length !== 2) {
    failures.push("vNext product must report two ordered dictionaries");
  } else {
    const [beta, alpha] = ordered;
    for (const entry of ordered) {
      if (!/^rich-mdict-[a-f0-9-]{36}$/u.test(entry?.id || "")) failures.push("vNext product dictionary ID is missing or malformed");
      requireEqual(entry?.sourceId, "local-rich-mdict", "vNext imported source identity", failures);
      requireEqual(entry?.trustLabel, "本地导入 · 用户提供 / 未验证", "vNext imported trust label", failures);
    }
    requireEqual(beta?.title, "Field Notes · Beta", "vNext first dictionary order", failures);
    requireEqual(alpha?.title, "Field Notes · Alpha", "vNext second dictionary order", failures);
    if (beta?.id === alpha?.id) failures.push("vNext product dictionary IDs must be distinct");
    if (!Array.isArray(report.dictionaries?.lookups) ||
        !sameJson(report.dictionaries.lookups, [
          { dictionaryId: beta?.id, text: "persistent" },
          { dictionaryId: alpha?.id, text: "persistent" }
        ])) failures.push("vNext viewer must request the enabled Beta and Alpha dictionaries in configured order");
    if (!isPositiveInteger(report.dictionaries?.betaBytesWhileAlphaDisabled) || !isPositiveInteger(report.dictionaries?.alphaBytesWhileDisabled)) {
      failures.push("vNext disabled dictionary evidence does not show installed source files remain present");
    }
    requireEqual(report.dictionaries?.alphaBytesAfterCorruption, 1, "vNext isolated corrupt dictionary byte count", failures);
    requireEqual(report.dictionaries?.sourceBytesAfterDeletion?.beta, 0, "vNext Beta source bytes after deletion", failures);
    requireEqual(report.dictionaries?.sourceBytesAfterDeletion?.alpha, 0, "vNext Alpha source bytes after deletion", failures);
  }
  requireEqual(report.structuredPrimary?.route, "local", "vNext structured primary route", failures);
  requireEqual(report.structuredPrimary?.unchanged, true, "vNext structured primary identity", failures);
  if (!report.structuredPrimary?.topCandidateId || !Array.isArray(report.structuredPrimary?.candidateIds) ||
      !report.structuredPrimary.candidateIds.includes(report.structuredPrimary.topCandidateId)) {
    failures.push("vNext structured primary report lacks stable candidate identity");
  }
  if (!isPositiveInteger(report.structuredPrimary?.firstVisibleMs) || !isPositiveInteger(report.structuredPrimary?.afterReloadVisibleMs)) {
    failures.push("vNext structured primary response timings are missing");
  }
  if (!isPositiveInteger(report.isolatedFailureDelayMs) || report.isolatedFailureDelayMs < 800) failures.push("vNext isolated dictionary failure delay evidence is missing or below its gate");
  const betaId = ordered?.[0]?.id;
  const alphaId = ordered?.[1]?.id;
  requireEqual(report.mdd?.matchingDictionary, betaId, "vNext MDD owner identity", failures);
  requireEqual(report.mdd?.mismatchedDictionary, alphaId, "vNext MDD mismatched dictionary identity", failures);
  requireEqual(report.mdd?.mismatchedDictionaryFound, false, "vNext MDD cross-dictionary isolation", failures);
  requireEqual(report.mdd?.matchingImageWidth, 2, "vNext MDD matching image dimensions", failures);
  requireEqual(report.mdd?.resourceFoundAfterDeletion, false, "vNext MDD resource after deletion", failures);
  if (!sameJson(report.mdd?.resourceRequests, [{ dictionaryId: betaId, path: "interop/sample.png" }])) {
    failures.push("vNext MDD resource request must be scoped to its owning dictionary");
  }
  requireEqual(report.cleanup?.preferencesCleared, true, "vNext preference cleanup after deletion", failures);
  requireEqual(report.cleanup?.objectUrlsAfterResourceOwnerDeletion, 0, "vNext resource object URL cleanup", failures);
  requireEqual(report.cleanup?.noInstalledDictionaries, true, "vNext dictionary cleanup", failures);
  requireEqual(report.providerCalls, 0, "vNext product Provider calls", failures);
  requireEqual(report.remoteRequests, 0, "vNext product remote resource requests", failures);
  return {
    status: failures.length === before ? "passed" : "failed",
    test: report.test,
    dictionaryOrder: ordered?.map((item) => ({ id: item.id, title: item.title, sourceId: item.sourceId, trustLabel: item.trustLabel })) || [],
    structuredPrimary: report.structuredPrimary,
    isolatedFailureDelayMs: report.isolatedFailureDelayMs,
    mdd: report.mdd,
    cleanup: report.cleanup,
    remoteRequests: report.remoteRequests,
    providerCalls: report.providerCalls,
    deleted: report.cleanup?.noInstalledDictionaries === true
  };
}

function collectPlaywrightCases(report, failures) {
  if (!isObject(report) || !Array.isArray(report.suites)) {
    failures.push("Playwright JSON reporter output is missing suites");
    return [];
  }
  const counts = ["expected", "skipped", "unexpected", "flaky"];
  if (!isObject(report.stats) || !counts.every((key) => Number.isSafeInteger(report.stats[key]))) {
    failures.push("Playwright JSON report is missing complete test outcome counts");
  } else {
    for (const key of ["skipped", "unexpected", "flaky"]) {
      requireEqual(report.stats[key], 0, `Playwright ${key} outcomes`, failures);
    }
    if (report.stats.expected <= 0) failures.push("Playwright JSON report has no passing expected cases");
  }
  const result = [];
  const visit = (suites, inheritedFile = "") => {
    for (const suite of Array.isArray(suites) ? suites : []) {
      const file = normalizeFile(suite?.file || inheritedFile);
      for (const spec of Array.isArray(suite?.specs) ? suite.specs : []) {
        const specFile = normalizeFile(spec?.file || file);
        for (const test of Array.isArray(spec?.tests) ? spec.tests : []) {
          result.push({
            file: specFile,
            title: String(spec?.title || test?.title || ""),
            expectedStatus: test?.expectedStatus,
            outcome: test?.status,
            results: Array.isArray(test?.results) ? test.results : []
          });
        }
      }
      visit(suite?.suites, file);
    }
  };
  visit(report.suites);
  return result;
}

function certifyPlaywrightCase(item, failures) {
  if (item.expectedStatus !== "passed") {
    failures.push(`${item.file} :: ${item.title} expected status is ${String(item.expectedStatus)}`);
    return "failed";
  }
  if (item.outcome !== "expected") {
    failures.push(`${item.file} :: ${item.title} outcome is ${String(item.outcome)}, expected passed`);
    return item.outcome === "skipped" ? "skipped" : "failed";
  }
  if (!item.results.length || item.results.some((attempt) => attempt?.status !== "passed")) {
    failures.push(`${item.file} :: ${item.title} has a missing, skipped, failed, or retried attempt`);
    return "failed";
  }
  return "passed";
}

function certifySecurity(report, failures) {
  const before = failures.length;
  if (!isObject(report) || report.status !== "PASS") {
    failures.push("rich-viewer security browser report is missing or did not pass");
    return { status: isObject(report) ? "failed" : "missing" };
  }
  requireEqual(report.fixture, "bounded-synthetic-hostile-rich-mdx-v2", "rich viewer hostile fixture identity", failures);
  requireEqual(report.shadowRoot, true, "rich viewer ShadowRoot isolation", failures);
  requireEqual(report.dangerousElementsInViewer, 0, "rich viewer active elements", failures);
  requireEqual(report.externalRequests, 0, "rich viewer external requests", failures);
  requireEqual(report.providerCalls, 0, "rich viewer Provider calls", failures);
  requireEqual(report.scriptExecuted, false, "rich viewer script execution", failures);
  requireEqual(report.escapeClosesViewer, true, "rich viewer keyboard Escape close", failures);
  if (!isPositiveInteger(report.maximumRenderedFontSizePx) || report.maximumRenderedFontSizePx > 48) failures.push("rich viewer font size bound is missing or exceeded");
  const kinds = (report.genericLocalPlaceholders || []).map((item) => item?.kind).sort();
  if (!sameJson(kinds, ["audio", "image"])) failures.push("rich viewer must expose only generic local image/audio placeholders");
  if (!report.theme?.light?.foreground || !report.theme?.light?.background ||
      report.theme.light.foreground === report.theme.light.background) {
    failures.push("rich viewer light theme colors are missing or indistinguishable");
  }
  const dark = report.theme?.dark;
  if (!dark?.foreground || !dark?.background || dark.foreground === dark.background) failures.push("rich viewer dark theme colors are missing or indistinguishable");
  if (!isFiniteNumber(dark?.left) || dark.left < 0 || !isFiniteNumber(dark?.right) || dark.right > dark.viewportWidth) {
    failures.push("rich viewer dark narrow layout exceeds its viewport");
  }
  requireEqual(dark?.viewportWidth, 360, "rich viewer narrow viewport width", failures);
  requireEqual(dark?.tabIndex, 0, "rich viewer keyboard focus target", failures);
  requireEqual(report.compact?.headword?.fontWeight !== "400", true, "rich viewer compact headword hierarchy", failures);
  requireEqual(report.compact?.pronunciation, "rgb(30, 144, 255)", "rich viewer compact pronunciation style", failures);
  requireEqual(report.compact?.note, "rgb(119, 119, 119)", "rich viewer compact note style", failures);
  return {
    status: failures.length === before ? "passed" : "failed",
    shadowRoot: report.shadowRoot,
    dangerousElements: report.dangerousElementsInViewer,
    externalRequests: report.externalRequests,
    providerCalls: report.providerCalls,
    scriptExecuted: report.scriptExecuted,
    genericLocalPlaceholders: kinds,
    themeAndLayout: {
      light: report.theme?.light,
      dark: {
        foreground: dark?.foreground,
        background: dark?.background,
        left: dark?.left,
        right: dark?.right,
        viewportWidth: dark?.viewportWidth,
        tabIndex: dark?.tabIndex
      },
      escapeClosesViewer: report.escapeClosesViewer
    }
  };
}

function certifyLexicalPrimary(productReport, playwrightEvidence, failures) {
  const before = failures.length;
  if (!isObject(productReport) || productReport.status !== "PASS") {
    failures.push("vNext product primary-lane evidence report is missing or did not pass");
  } else {
    requireEqual(productReport.structuredPrimary?.route, "local", "vNext structured lexical primary route", failures);
    requireEqual(productReport.structuredPrimary?.unchanged, true, "vNext stable structured lexical answer", failures);
    if (!productReport.structuredPrimary?.topCandidateId || !Array.isArray(productReport.structuredPrimary?.candidateIds) ||
        !productReport.structuredPrimary.candidateIds.includes(productReport.structuredPrimary.topCandidateId)) {
      failures.push("vNext product report lacks the structured primary candidate identity");
    }
  }
  requireEqual(playwrightEvidence?.status, "passed", "structured primary E2E outcomes", failures);
  return {
    status: failures.length === before ? "passed" : "failed",
    primaryRoute: productReport?.structuredPrimary?.route || null,
    topCandidateId: productReport?.structuredPrimary?.topCandidateId || null,
    candidateIds: productReport?.structuredPrimary?.candidateIds || [],
    unchangedAfterDictionaryWork: productReport?.structuredPrimary?.unchanged === true,
    releaseGate: "lexicon-release workflow remains the quantitative primary-lane regression gate"
  };
}

function certifyPackage(report, failures) {
  const before = failures.length;
  if (!isObject(report) || report.status !== "PASS") {
    failures.push("production extension package-boundary report is missing or did not pass");
    return { status: isObject(report) ? "failed" : "missing" };
  }
  requireEqual(report.builder, "scripts/build-extension.mjs", "production package builder", failures);
  requireEqual(report.allowlistAudited, true, "production package allowlist audit", failures);
  requireEqual(report.validationAssetsIncluded, false, "package excludes validation assets", failures);
  requireEqual(report.lexicalAssetsIncluded, true, "production package includes the certified lexical lane", failures);
  if (!Array.isArray(report.files) || !report.files.some((path) => path.startsWith("assets/lexicon/core/")) || !report.files.some((path) => path.startsWith("assets/lexicon/technical/"))) {
    failures.push("production package does not contain both Core and Technical lexical assets");
  }
  if (!Number.isSafeInteger(report.totalBytes) || report.totalBytes <= 0 || report.totalBytes >= ECDICT_LOCK.mdx.bytes) {
    failures.push("production extension size is missing or not smaller than the pinned MDX corpus");
  }
  if (!Number.isSafeInteger(report.fileCount) || report.fileCount <= 0 || !Array.isArray(report.files)) failures.push("production package file inventory is missing");
  const rawPayloads = (report.files || []).filter((path) => typeof path === "string" && /\.(?:mdx|mdd|zip)$/iu.test(path));
  if (rawPayloads.length) failures.push(`production package contains raw dictionary/archive payloads: ${rawPayloads.join(", ")}`);
  if (!sameJson(report.hostPermissions, ["https://api.deepseek.com/*"])) failures.push("production package host permission list drifted from the reviewed provider-only origin");
  return {
    status: failures.length === before ? "passed" : "failed",
    builder: report.builder,
    allowlistAudited: report.allowlistAudited,
    validationAssetsIncluded: report.validationAssetsIncluded,
    lexicalAssetsIncluded: report.lexicalAssetsIncluded,
    totalBytes: report.totalBytes,
    fileCount: report.fileCount,
    rawPayloads,
    hostPermissions: report.hostPermissions
  };
}

function compareArtifacts(actual, failures, label) {
  if (!Array.isArray(actual) || actual.length !== 2) {
    failures.push(`${label} artifacts must contain exactly the locked MDX and MDD pair`);
    return;
  }
  for (const [file, expected] of [[MDD_LOCK.generation.mdx.file, MDD_LOCK.generation.mdx], [MDD_LOCK.generation.mdd.file, MDD_LOCK.generation.mdd]]) {
    const matches = actual.filter((item) => item?.file === file);
    if (matches.length !== 1) failures.push(`${label} ${file} must occur once (found ${matches.length})`);
    else {
      requireEqual(matches[0].bytes, expected.bytes, `${label} ${file} bytes`, failures);
      requireEqual(matches[0].sha256, expected.sha256, `${label} ${file} SHA-256`, failures);
    }
  }
}

function normalizeFile(file) {
  const normalized = String(file || "").replaceAll("\\", "/").replace(/^\.\//u, "");
  return normalized.includes("/") ? normalized : `e2e/${normalized}`;
}

function requireEqual(actual, expected, label, failures) {
  if (actual !== expected) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function sameJson(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

async function inspectProductionPackage() {
  const tempRoot = await mkdtemp(join(tmpdir(), "translateflow-vnext-package-"));
  const extensionDir = join(tempRoot, "extension");
  try {
    const built = await buildExtension({ outDir: extensionDir, requireLexicon: true, allowExternalOutput: true });
    const files = await listFiles(extensionDir);
    const paths = files.map((file) => relative(extensionDir, file).replaceAll("\\", "/")).sort();
    const manifest = JSON.parse(await readFile(join(extensionDir, "manifest.json"), "utf8"));
    const forbidden = paths.filter((path) => /^(?:tests|e2e|scripts|docs|\.github|lexicon|\.release-sources|node_modules|test-results|playwright-report)\//u.test(path));
    return {
      status: "PASS",
      builder: "scripts/build-extension.mjs",
      allowlistAudited: forbidden.length === 0,
      validationAssetsIncluded: forbidden.length > 0,
      totalBytes: built.totalBytes,
      fileCount: paths.length,
      files: paths,
      lexicalAssetsIncluded: built.lexicalAssetsIncluded,
      hostPermissions: manifest.host_permissions,
      forbiddenPaths: forbidden
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function listFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

async function readEvidenceFile(directory, name, failures) {
  const path = join(directory, name);
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    failures.push(`required evidence file ${name} is missing or invalid JSON: ${error?.message || error}`);
    return null;
  }
}

function parseArgs(argv) {
  const args = { evidenceDir: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key !== "--evidence-dir" && key !== "--out") throw new Error(`unknown argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${key}`);
    if (key === "--evidence-dir") args.evidenceDir = resolve(value);
    else args.out = resolve(value);
    index += 1;
  }
  if (!args.evidenceDir) throw new Error("--evidence-dir is required");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputFailures = [];
  const reports = {};
  for (const [key, name] of Object.entries(VNEXT_EVIDENCE_FILES)) {
    reports[key] = await readEvidenceFile(args.evidenceDir, name, inputFailures);
  }
  let packageBoundary;
  try {
    packageBoundary = await inspectProductionPackage();
  } catch (error) {
    inputFailures.push(`production package audit failed: ${error?.stack || error}`);
    packageBoundary = null;
  }
  const report = certifyVnextDictionaryLibrary({
    corpusParser: reports.corpusParser,
    realCorpusProduct: reports.realCorpusProduct,
    curatedArchiveProduct: reports.curatedArchiveProduct,
    mddInterop: reports.mddInterop,
    mddProduct: reports.mddProduct,
    richViewerSecurity: reports.richViewerSecurity,
    vnextProduct: reports.vnextProduct,
    playwright: reports.playwright,
    packageBoundary
  });
  report.failures.unshift(...inputFailures);
  if (inputFailures.length) report.status = "FAIL";
  const outputPath = args.out || join(args.evidenceDir, "dictionary-library-vnext-certification.json");
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  const temporaryPath = outputPath + ".part";
  await rm(temporaryPath, { force: true });
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  await rename(temporaryPath, outputPath);
  process.stdout.write(`${JSON.stringify({ ...report, reportPath: outputPath }, null, 2)}\n`);
  if (report.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
