import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { certifyVnextDictionaryLibrary } from "../scripts/certify-vnext-dictionary-library.mjs";

const ecdict = JSON.parse(await readFile(new URL("../lexicon/build-evidence/ecdict-mdx-1.0.28-corpus-lock.json", import.meta.url), "utf8"));
const mdd = JSON.parse(await readFile(new URL("fixtures/mdd-interop/corpus-lock.json", import.meta.url), "utf8"));

test("integrated vNext certification accepts the pinned corpus, fresh product reports, lexical lane, and package boundary", () => {
  const report = certifyVnextDictionaryLibrary(passingEvidence());
  assert.equal(report.status, "PASS");
  assert.equal(report.report, "dictionary-library-vnext-certification");
  assert.equal(report.evidence.frozenLocks.status, "passed");
  assert.equal(report.evidence.pinnedEcdict.parser.indexRangeIo.totalRangeBytes, 27_504_767);
  assert.equal(report.evidence.pinnedEcdict.parser.lookups.length, 7);
  assert.equal(report.evidence.pinnedEcdict.header.styleSheetRuleCount, 4);
  assert.equal(report.evidence.pinnedEcdict.parser.compactIndexJsonBytes, 1_149_152);
  assert.equal(report.evidence.pinnedEcdict.parser.processRssPeakDeltaBytes, 73_547_776);
  assert.equal(report.evidence.mddInteropAndResources.syntheticRangeIo.uncompressedPayloadBytes, 104_857_676);
  assert.equal(report.evidence.vnextProduct.cleanup.objectUrlsAfterResourceOwnerDeletion, 0);
  assert.equal(report.evidence.multiDictionary.newProductFile.status, "passed");
  assert.ok(report.evidence.multiDictionary.requiredCases.some((item) =>
    item.file === "e2e/multi-dictionary-viewer.spec.mjs" &&
    item.title === "personal preference persists and opens first beside the unchanged structured primary" &&
    item.status === "passed"
  ));
  assert.equal(report.evidence.productionPackage.rawPayloads.length, 0);
  assert.equal(report.evidence.lexicalPrimaryLane.status, "passed");
  const serialized = JSON.stringify(report);
  for (const sample of ecdict.independentDecode.recordExcerpts) {
    assert.equal(serialized.includes(sample.rawRecordIncludes), false, "published aggregate must not include dictionary definitions");
  }
  assert.equal(serialized.includes("font-size:180%"), false, "published aggregate must not include MDX StyleSheet source");
});

test("vNext certification fails closed for missing evidence and wrong corpus identities", () => {
  const missing = passingEvidence();
  missing.corpusParser = undefined;
  missing.mddProduct = undefined;
  const missingReport = certifyVnextDictionaryLibrary(missing);
  assert.equal(missingReport.status, "FAIL");
  assert.ok(missingReport.failures.some((failure) => failure.includes("parser report is missing")));
  assert.ok(missingReport.failures.some((failure) => failure.includes("MDD browser product report is missing")));

  const wrongIdentity = passingEvidence();
  wrongIdentity.realCorpusProduct.mdxSha256 = "0".repeat(64);
  wrongIdentity.mddInterop.interop.independentWriter.commit = "latest";
  const wrongReport = certifyVnextDictionaryLibrary(wrongIdentity);
  assert.equal(wrongReport.status, "FAIL");
  assert.ok(wrongReport.failures.some((failure) => failure.includes("browser ECDICT MDX SHA-256")));
  assert.ok(wrongReport.failures.some((failure) => failure.includes("independent MDict writer commit")));
});

test("vNext certification requires the current personal-preference Selection case identity", () => {
  const evidence = passingEvidence();
  const suite = evidence.playwright.suites.find((item) => item.file === "e2e/multi-dictionary-viewer.spec.mjs");
  const current = suite.specs.find((item) => item.title ===
    "personal preference persists and opens first beside the unchanged structured primary");
  assert.ok(current);
  current.title = "configured order and collapsed defaults survive reload beside the unchanged structured primary";

  const report = certifyVnextDictionaryLibrary(evidence);
  assert.equal(report.status, "FAIL");
  assert.ok(report.failures.some((failure) => failure.includes(
    "personal preference persists and opens first beside the unchanged structured primary (found 0)"
  )));
});

test("vNext certification rejects skipped, failed, flaky, missing, and retried product E2E outcomes", () => {
  const skipped = passingEvidence();
  const skippedCase = skipped.playwright.suites
    .flatMap((suite) => suite.specs)
    .find((spec) => spec.title === "disabling a dictionary hides it from Selection while its installed bytes remain available").tests[0];
  skippedCase.status = "skipped";
  skippedCase.results = [];
  skipped.playwright.stats.skipped = 1;
  skipped.playwright.stats.expected -= 1;
  const skippedReport = certifyVnextDictionaryLibrary(skipped);
  assert.equal(skippedReport.status, "FAIL");
  assert.ok(skippedReport.failures.some((failure) => failure.includes("skipped outcomes")));
  assert.ok(skippedReport.failures.some((failure) => failure.includes("disabling a dictionary") && failure.includes("skipped")));

  const failed = passingEvidence();
  failed.playwright.suites[0].specs[0].tests[0].results[0].status = "failed";
  failed.playwright.stats.unexpected = 1;
  const failedReport = certifyVnextDictionaryLibrary(failed);
  assert.equal(failedReport.status, "FAIL");
  assert.ok(failedReport.failures.some((failure) => failure.includes("unexpected outcomes")));

  const flaky = passingEvidence();
  flaky.playwright.stats.flaky = 1;
  const flakyReport = certifyVnextDictionaryLibrary(flaky);
  assert.equal(flakyReport.status, "FAIL");
  assert.ok(flakyReport.failures.some((failure) => failure.includes("flaky outcomes")));

  const retried = passingEvidence();
  retried.playwright.suites.at(-1).specs[0].tests[0].results.unshift({ status: "failed" });
  const retriedReport = certifyVnextDictionaryLibrary(retried);
  assert.equal(retriedReport.status, "FAIL");
  assert.ok(retriedReport.failures.some((failure) => failure.includes("retried attempt")));

  const missing = passingEvidence();
  missing.playwright.suites = missing.playwright.suites.filter((suite) => suite.file !== "e2e/settings-ia.spec.mjs");
  const missingReport = certifyVnextDictionaryLibrary(missing);
  assert.equal(missingReport.status, "FAIL");
  assert.ok(missingReport.failures.some((failure) => failure.includes("dictionary library separates trust classes")));
});

test("vNext certification rejects security drift, remote calls, missing range metrics, and bundled dictionary payloads", () => {
  const reports = passingEvidence();
  reports.richViewerSecurity.externalRequests = 1;
  reports.vnextProduct.providerCalls = 1;
  reports.corpusParser.parserEvidence.lookups.find((item) => item.query === "run").lookupMetrics.sourceBytesRead += 1;
  reports.mddInterop.rangeIo.corpusKind = "real-dictionary-corpus";
  reports.packageBoundary.files.push("assets/dictionaries/payload.mdx");
  const result = certifyVnextDictionaryLibrary(reports);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((failure) => failure.includes("rich viewer external requests")));
  assert.ok(result.failures.some((failure) => failure.includes("vNext product Provider calls")));
  assert.ok(result.failures.some((failure) => failure.includes("ECDICT run runtime source bytes")));
  assert.ok(result.failures.some((failure) => failure.includes("synthetic MDD corpus identity")));
  assert.ok(result.failures.some((failure) => failure.includes("raw dictionary/archive payloads")));
});

test("vNext certification fails closed when the real corpus exceeds its bounded memory limits", () => {
  const oversizedIndex = passingEvidence();
  oversizedIndex.corpusParser.parserEvidence.compactIndexJsonBytes = 2 * 1024 * 1024 + 1;
  const oversizedIndexReport = certifyVnextDictionaryLibrary(oversizedIndex);
  assert.equal(oversizedIndexReport.status, "FAIL");
  assert.ok(oversizedIndexReport.failures.some((failure) => failure.includes("compact index must be present")));

  const oversizedRss = passingEvidence();
  oversizedRss.corpusParser.parserEvidence.processRssPeakDeltaBytes = 128 * 1024 * 1024 + 1;
  const oversizedRssReport = certifyVnextDictionaryLibrary(oversizedRss);
  assert.equal(oversizedRssReport.status, "FAIL");
  assert.ok(oversizedRssReport.failures.some((failure) => failure.includes("RSS peak delta must be present")));
});

function passingEvidence() {
  const ids = {
    beta: "rich-mdict-11111111-2222-4333-8444-555555555555",
    alpha: "rich-mdict-66666666-7777-4888-8999-aaaaaaaaaaaa"
  };
  const samples = ecdict.independentDecode.recordExcerpts;
  const lookupRangeBytes = { run: 33515, state: 30189, process: 27683, issue: 33104, branch: 28650, container: 27325, cache: 30659 };
  const mddResources = mdd.generation.resources;
  const requiredCases = [
    ["e2e/rich-mdict-real-corpus.spec.mjs", "Settings install survives reload, Selection shows a real record with zero Provider calls, and delete removes it"],
    ["e2e/rich-mdict-real-corpus.spec.mjs", "the Settings card requests the exact host pair, installs/reinstalls the real archive, preserves the active version on failure/cancel, works offline, and deletes"],
    ["e2e/mdd-resources.spec.mjs", "independent MDX/MDD pair restores image, gated audio, and safe CSS after reload"],
    ["e2e/multi-dictionary-viewer.spec.mjs", "personal preference persists and opens first beside the unchanged structured primary"],
    ["e2e/multi-dictionary-viewer.spec.mjs", "disabling a dictionary hides it from Selection while its installed bytes remain available"],
    ["e2e/multi-dictionary-viewer.spec.mjs", "a corrupted dictionary reports its own error while another card and the structured primary render"],
    ["e2e/settings-ia.spec.mjs", "dictionary library separates trust classes and stays usable at narrow width"],
    ["e2e/rich-viewer-security.spec.mjs", "hostile HTML and styles stay inert while readable dictionary structure remains available"],
    ["e2e/rich-mdict-product.spec.mjs", "Settings install persists, Selection reads safe text locally, and delete clears it"],
    ["e2e/rich-mdict-product.spec.mjs", "corrupt key-info metadata is rejected without creating an installed dictionary"],
    ["e2e/dictionary-library-vnext-product.spec.mjs", "two local rich MDX dictionaries and one attached MDD keep isolated cards, preferences, and resources"]
  ];
  return {
    corpusParser: {
      status: "PASS",
      source: ecdict.source.releaseUrl,
      archive: { bytes: ecdict.archive.bytes, sha256: ecdict.archive.sha256 },
      mdx: { bytes: ecdict.mdx.bytes, sha256: ecdict.mdx.sha256 },
      header: {
        title: ecdict.mdx.title,
        generatedByEngineVersion: ecdict.mdx.generatedByEngineVersion,
        requiredEngineVersion: ecdict.mdx.requiredEngineVersion,
        format: ecdict.mdx.format,
        encoding: ecdict.mdx.encoding,
        encrypted: String(ecdict.mdx.encrypted),
        compact: "Yes",
        compat: "Yes",
        styleSheetRuleCount: ecdict.mdx.styleSheetRules
      },
      parserEvidence: {
        sourceBytes: ecdict.mdx.bytes,
        entryCount: ecdict.mdx.entryCount,
        keyBlockCount: ecdict.mdx.keyBlockCount,
        recordBlockCount: ecdict.mdx.recordBlockCount,
        compactIndexJsonBytes: 1_149_152,
        processRssBaselineBytes: 96_825_344,
        processRssPeakBytes: 170_373_120,
        processRssPeakDeltaBytes: 73_547_776,
        maximumDecompressedKeyBlockBytes: 32769,
        maximumDecompressedRecordBlockBytes: 65536,
        indexRangeIo: { readCalls: 2512, totalRangeBytes: 27_504_767, largestRangeBytes: 61_253 },
        lookups: samples.map((sample) => ({
          query: sample.query,
          headword: sample.headword,
          rangeIo: {
            readCalls: 2,
            totalRangeBytes: lookupRangeBytes[sample.query],
            largestRangeBytes: 1,
            keyBlocksRead: 1,
            keyCompressedBytes: 1,
            recordBlocksRead: 1,
            recordCompressedBytes: lookupRangeBytes[sample.query] - 1,
            recordDecompressedBytes: 65530,
            largestRecordBlockDecompressedBytes: 65530
          },
          lookupMetrics: {
            sourceRangeReads: 2,
            sourceBytesRead: lookupRangeBytes[sample.query],
            keyBlockDecodes: 1,
            recordBlockDecodes: 1
          }
        }))
      }
    },
    realCorpusProduct: {
      status: "PASS",
      source: ecdict.source.releaseUrl,
      assetSha256: ecdict.archive.sha256,
      mdxSha256: ecdict.mdx.sha256,
      mdxBytes: ecdict.mdx.bytes,
      entryCount: ecdict.mdx.entryCount,
      keyBlockCount: ecdict.mdx.keyBlockCount,
      recordBlockCount: ecdict.mdx.recordBlockCount,
      encryptedKeyInfo: true,
      installMs: 25000,
      corpusLookups: samples.map((sample) => ({ query: sample.query, lookupMs: 40, headword: sample.headword, recordVerified: true, metrics: null })),
      richViewer: { shadowRoot: true, structuredPrimary: "local", providerCalls: 0 },
      providerCalls: 0,
      deleted: true,
      providerCallsAfterDelete: 0
    },
    curatedArchiveProduct: {
      status: "PASS",
      archiveBytes: ecdict.archive.bytes,
      archiveSha256: ecdict.archive.sha256,
      mdxBytes: ecdict.mdx.bytes,
      mdxSha256: ecdict.mdx.sha256,
      entryCount: ecdict.mdx.entryCount,
      permissionOrigins: ["https://github.com/*", "https://release-assets.githubusercontent.com/*"],
      initialInstallMs: 30000,
      reinstallMs: 30000,
      failedAndCancelledReinstallsPreservedVersion: true,
      offlineLookup: "run",
      providerCalls: 0,
      deleted: true,
      testOnlyArchiveBridge: {
        pinnedFinalOrigin: "https://release-assets.githubusercontent.com",
        localRequests: [{ path: "/__e2e/ecdict-mdx-28.zip", mode: "archive" }]
      }
    },
    mddInterop: {
      status: "PASS",
      purpose: mdd.purpose,
      interop: {
        independentWriter: {
          performed: true,
          commit: mdd.independentWriter.commit,
          license: "MIT",
          sourceSha256: mdd.independentWriter.writerFileSha256,
          licenseSha256: mdd.independentWriter.licenseSha256,
          artifacts: [
            { file: "interop.mdx", bytes: mdd.generation.mdx.bytes, sha256: mdd.generation.mdx.sha256 },
            { file: "interop.mdd", bytes: mdd.generation.mdd.bytes, sha256: mdd.generation.mdd.sha256 }
          ]
        },
        artifacts: [
          { file: "interop.mdx", bytes: mdd.generation.mdx.bytes, sha256: mdd.generation.mdx.sha256 },
          { file: "interop.mdd", bytes: mdd.generation.mdd.bytes, sha256: mdd.generation.mdd.sha256 }
        ],
        parser: {
          status: "PASS",
          sourceBytes: 1723,
          indexSourceBytesRead: 1072,
          indexReadResourceRecordBodies: false,
          resourceObjectsMaterializedAtIndexTime: false,
          resources: mddResources.map((resource) => ({ path: resource.path, bytes: resource.bytes, mime: resource.mime, sourceRangeReads: 2, sourceBytesRead: 200, recordBlockDecodes: 1 }))
        },
        resources: mddResources.map(({ path, bytes, sha256, mime }) => ({ path, bytes, sha256, mime })),
        hasFullValidPngAndWavBytes: true,
        rawBytesAreHashedBeforeLookup: true
      },
      rangeIo: {
        status: "PASS",
        corpusKind: "synthetic-shake256-incompressible-range-read-evidence-not-a-real-dictionary-corpus",
        uncompressedPayloadBytes: 104_857_676,
        physicalMddBytes: 104_894_176,
        sha256: "9".repeat(64),
        resourceCount: 101,
        recordBlockCount: 101,
        indexSourceBytesRead: 3095,
        indexReadRecordBodies: false,
        lookup: { sourceRangeReads: 2, sourceBytesRead: 642, recordBlockDecodes: 1, distinctRecordBlocksRead: 1 },
        temporaryCorpusRemovedAfterMeasurement: true
      }
    },
    mddProduct: {
      status: "PASS",
      purpose: mdd.purpose,
      writerCommit: mdd.independentWriter.commit,
      resourceMimeAndHashesMatched: true,
      resourcesPersistedAfterSettingsReload: true,
      corruptReplacementPreservedOldResources: true,
      visibleImageAfterReload: true,
      userPlaybackEvent: "play",
      css: { width: 250, scrollWidth: 250 },
      darkColorScheme: true,
      viewport: { width: 320, horizontalOverflow: false },
      remoteRequests: 0,
      providerCalls: 0,
      objectUrlsAfterViewerClose: 0,
      objectUrlsAfterDictionaryDelete: 0,
      deleted: true
    },
    richViewerSecurity: {
      status: "PASS",
      fixture: "bounded-synthetic-hostile-rich-mdx-v2",
      shadowRoot: true,
      dangerousElementsInViewer: 0,
      maximumRenderedFontSizePx: 48,
      genericLocalPlaceholders: [{ kind: "image", text: "local image" }, { kind: "audio", text: "local audio" }],
      externalRequests: 0,
      providerCalls: 0,
      scriptExecuted: false,
      theme: {
        light: { foreground: "rgb(60, 70, 61)", background: "rgba(0, 0, 0, 0)" },
        dark: { foreground: "rgb(225, 233, 222)", background: "rgba(0, 0, 0, 0)", left: 35, right: 325, viewportWidth: 360, tabIndex: 0 }
      },
      compact: { headword: { fontWeight: "700" }, pronunciation: "rgb(30, 144, 255)", note: "rgb(119, 119, 119)" },
      escapeClosesViewer: true
    },
    vnextProduct: {
      schemaVersion: 1,
      spec: "e2e/dictionary-library-vnext-product.spec.mjs",
      test: "two local rich MDX dictionaries and one attached MDD keep isolated cards, preferences, and resources",
      status: "PASS",
      dictionaries: {
        order: [
          { id: ids.beta, title: "Field Notes · Beta", sourceId: "local-rich-mdict", trustLabel: "本地导入 · 用户提供 / 未验证" },
          { id: ids.alpha, title: "Field Notes · Alpha", sourceId: "local-rich-mdict", trustLabel: "本地导入 · 用户提供 / 未验证" }
        ],
        lookups: [{ dictionaryId: ids.beta, text: "persistent" }, { dictionaryId: ids.alpha, text: "persistent" }],
        betaBytesWhileAlphaDisabled: 100,
        alphaBytesWhileDisabled: 100,
        alphaBytesAfterCorruption: 1,
        sourceBytesAfterDeletion: { beta: 0, alpha: 0 }
      },
      structuredPrimary: { route: "local", topCandidateId: "candidate-1", candidateIds: ["candidate-1"], firstVisibleMs: 20, afterReloadVisibleMs: 25, unchanged: true },
      isolatedFailureDelayMs: 800,
      mdd: {
        matchingDictionary: ids.beta,
        mismatchedDictionary: ids.alpha,
        mismatchedDictionaryFound: false,
        resourceRequests: [{ dictionaryId: ids.beta, path: "interop/sample.png" }],
        matchingImageWidth: 2,
        resourceFoundAfterDeletion: false
      },
      cleanup: { preferencesCleared: true, objectUrlsAfterResourceOwnerDeletion: 0, noInstalledDictionaries: true },
      providerCalls: 0,
      remoteRequests: 0
    },
    playwright: {
      stats: { expected: requiredCases.length, skipped: 0, unexpected: 0, flaky: 0 },
      suites: requiredCases.map(([file, title]) => ({
        file,
        specs: [{ file, title, tests: [{ expectedStatus: "passed", status: "expected", results: [{ status: "passed" }] }] }]
      }))
    },
    packageBoundary: {
      status: "PASS",
      builder: "scripts/build-extension.mjs",
      allowlistAudited: true,
      validationAssetsIncluded: false,
      lexicalAssetsIncluded: true,
      totalBytes: 38_000_000,
      fileCount: 3,
      files: ["manifest.json", "assets/lexicon/core/manifest.json", "assets/lexicon/technical/manifest.json"],
      hostPermissions: ["https://api.deepseek.com/*"]
    }
  };
}
