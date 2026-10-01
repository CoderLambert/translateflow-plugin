import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { certifyDictionaryEcosystemV2, REQUIRED_E2E_CASES, verifyRunBaseSha } from "../scripts/certify-dictionary-ecosystem-v2.mjs";
import { execFileSync } from "node:child_process";

const scopeTemplate = JSON.parse(await readFile(
  new URL("../docs/DICTIONARY_ECOSYSTEM_V2_RELEASE_SCOPE.json", import.meta.url),
  "utf8"
));
const preferredBaselineTemplate = JSON.parse(await readFile(
  new URL("../docs/DICTIONARY_ECOSYSTEM_V2_PREFERRED_BASELINE.json", import.meta.url),
  "utf8"
));
const certificationWorkflow = await readFile(
  new URL("../.github/workflows/dictionary-library-vnext-certification.yml", import.meta.url),
  "utf8"
);
const baseSha = "a".repeat(40);
const syntheticRepoFixtures = [
  { path: "tests/fixtures/mdd-interop/interop.mdx", bytes: 1194, sha256: "b8996c8cd7449e67a5049ba0cd284fb1528385ff090c82af4113c67e050a8a82" },
  { path: "tests/fixtures/mdd-interop/interop.mdd", bytes: 1723, sha256: "98adc93097939119d72d5d0257027099ab25d421b9df43d10867e29cc24fe4f5" }
];
const cancellationRunnerSha256 = "c".repeat(64);

function makeCancellationBaseline() {
  const rawSamplesMs = Array.from({ length: 30 }, (_, index) => index + 10);
  return {
    schemaVersion: 1,
    status: "PASS",
    baselineMainSha: "acbfa12a079a73d6eab0a1c17e7a8f63d856295b",
    baselineLookupPath: "src/background/packs/importers/mdict-rich-lookup.js",
    baselineLookupBlob: "abb6053146f4498c7b127131b391aed8b657f3e1",
    baselineFixturePath: "tests/helpers/rich-mdict-fixture.mjs",
    baselineFixtureBlob: "e4bc9ec0bc4e8b3994fcfb3de2a24bbbfd674c43",
    runnerPath: "scripts/measure-rich-lookup-cancellation-baseline.mjs",
    runnerSha256: cancellationRunnerSha256,
    workload: {
      kind: "synthetic bounded MDX exact lookup",
      gate: "one key-block range read waits for a 24ms timer; pinned baseline lookup ignores AbortSignal",
      rangeGateDelayMs: 24,
      sampleCount: 30
    },
    metric: "milliseconds from cancellation request to the final bounded source range read completing",
    rawSamplesMs,
    summary: { p50Ms: 24, p95Ms: 38, maxMs: 39, derivedCeilingMs: 76 }
  };
}

function makeRouteCancellationSamples() {
  const epochBaseMs = 1_800_000_000_000;
  return Array.from({ length: 10 }, (_, index) => {
    const routeStartEpochMs = epochBaseMs + index * 100 + 10;
    const durationMs = index + 5.25;
    return {
      method: index % 2 === 0 ? "pushState" : "replaceState",
      rangeReadStartedAtEpochMs: routeStartEpochMs - 5,
      routeStartEpochMs,
      nativeCancelCompletedAtEpochMs: routeStartEpochMs + 2,
      rangeStopEpochMs: routeStartEpochMs + durationMs,
      endpoint: "opfs-readBlobRange-finally-after-native-cancel",
      rangeReadActiveAtRoute: true,
      durationMs
    };
  });
}

function makeEvidence() {
  const scope = structuredClone(scopeTemplate);
  scope.scopeStatus = "frozen-for-certification";
  scope.mainBaseSha = baseSha;
  scope.scopeRevision.status = "shipped";
  const cancellationSlice = scope.requiredSlices.find((item) => item.issue === 224);
  cancellationSlice.status = "shipped";
  cancellationSlice.mergedPr = 777;

  const requiredSpecs = REQUIRED_E2E_CASES;
  const playwright = {
    stats: { expected: requiredSpecs.length, skipped: 0, unexpected: 0, flaky: 0 },
    suites: requiredSpecs.map(([file, title]) => ({
      file,
      specs: [{ title, tests: [{ expectedStatus: "passed", status: "expected", results: [{ status: "passed" }] }] }]
    }))
  };

  const vnextKeys = [
    "frozenLocks", "pinnedEcdict", "curatedInstallAndViewer", "mddInteropAndResources", "multiDictionary",
    "richViewerSecurity", "vnextProduct", "lexicalPrimaryLane", "productionPackage"
  ];
  const vnextCertification = {
    report: "dictionary-library-vnext-certification",
    status: "PASS",
    evidence: Object.fromEntries(vnextKeys.map((key) => [key, { status: "passed" }]))
  };
  vnextCertification.evidence.productionPackage.rawPayloads = [];
  vnextCertification.evidence.richViewerSecurity.externalRequests = 0;
  vnextCertification.evidence.richViewerSecurity.providerCalls = 0;

  const importReport = {
    status: "PASS",
    spec: "e2e/dictionary-ecosystem-v2-release.spec.mjs",
    mdxOnlyRichRoute: {
      status: "passed", fileCount: 1, associatedMddCount: 0,
      persistedAfterReload: true, visibleInSelection: true, keyboardImport: true, keyboardDismiss: true,
      accessibleFilePicker: true, selectedFilesAccessibleLabel: true, installAccessibleName: true,
      selectionChipAccessibleName: true, dismissAccessibleName: true, preflightLiveRegion: true,
      progressLiveRegion: true, viewportWidth: 390, horizontalOverflow: false, darkMode: true,
      reducedMotion: true, providerCalls: 0, externalRequests: 0
    }
  };

  const performanceReport = {
    status: "PASS",
    spec: "e2e/dictionary-ecosystem-v2-release.spec.mjs",
    repeatedPreferenceLookup: {
      status: "passed", sampleCount: 10, lookupsPerSelection: 2, totalLookups: 20,
      preferredFirstMs: { sampleCount: 10, p95NearestRank: 400 },
      bothRichCompleteMs: { sampleCount: 10, p95NearestRank: 420 },
      maxConcurrentLookups: 2,
      workload: {
        fixtureProfile: "multi-dictionary-viewer-alpha-beta-one-entry-v1",
        selectionQuery: "persistent", entriesPerDictionary: 1, encryptedKeyInfo: true,
        baselineRecordId: preferredBaselineTemplate.recordId,
        baselineMainSha: preferredBaselineTemplate.mainSha,
        freshInstallPerSample: true, uniquePackIds: 20, uniquePackVersions: 20,
        harnessResetBeforeEach: true
      },
      measuredBaselineP95Ms: {
        preferredFirst: preferredBaselineTemplate.summaryMs.preferredRichVisible.p95NearestRank,
        bothRichComplete: preferredBaselineTemplate.summaryMs.bothRichComplete.p95NearestRank
      },
      derivedCeilingsMs: {
        preferredFirst: preferredBaselineTemplate.summaryMs.preferredRichVisible.p95NearestRank * 2,
        bothRichComplete: preferredBaselineTemplate.summaryMs.bothRichComplete.p95NearestRank * 2
      }
    },
    selectionChangeStaleInvalidation: {
      status: "passed", sampleCount: 10,
      staleRequestsStartedPerSample: 2, delayedStaleResponsesObservedPerSample: 2,
      measuredBaselineP95Ms: 295, derivedCeilingMs: 590,
      freshLookupDispatchMs: { p95NearestRank: 300, max: 310 },
      staleResultsSuppressed: true,
      note: "Measures stale-result invalidation. It does not claim in-flight worker messages are cancelled."
    },
    providerCalls: 0,
    externalRequests: 0
  };

  const richLookupCancellation = {
    status: "PASS",
    spec: "e2e/selection-rich-lookup-cancel.spec.mjs",
    test: "Selection change cancels stale Rich lookups and preserves fresh results",
    activeRangeCancellationSamples: 12,
    cancellationLatency: {
      sampleCount: 12,
      p50Ms: 25,
      p95Ms: 30,
      maxMs: 35,
      baselineP95Ms: 38,
      baselineSampleCount: 30,
      baselineMainSha: "acbfa12a079a73d6eab0a1c17e7a8f63d856295b",
      baselineEvidenceFile: "rich-lookup-cancellation-baseline.json",
      baselineLookupBlob: "abb6053146f4498c7b127131b391aed8b657f3e1",
      baselineRunnerSha256: cancellationRunnerSha256,
      baselineWorkload: {
        kind: "synthetic bounded MDX exact lookup",
        gate: "one key-block range read waits for a 24ms timer; pinned baseline lookup ignores AbortSignal",
        rangeGateDelayMs: 24,
        sampleCount: 30
      },
      derivedCeilingMs: 76,
      ceilingPassed: true
    },
    routeCancellationLatency: {
      trigger: "same-document-history",
      clock: "performance.now",
      sampleCount: 10,
      samples: makeRouteCancellationSamples(),
      samplesMs: makeRouteCancellationSamples().map((sample) => sample.durationMs),
      methodSampleCounts: { pushState: 5, replaceState: 5 },
      p50Ms: 9.25,
      p95Ms: 14.25,
      maxMs: 14.25,
      baselineMetric: "milliseconds from cancellation request to the final bounded source range read completing",
      baselineInterpretation: "conservative-stop-latency-ceiling",
      baselineP95Ms: 38,
      derivedCeilingMs: 76,
      ceilingPassed: true
    },
    cancelledLookupCount: 10,
    postCancelRangeReads: 0,
    postCancelBlockDecodes: 0,
    maxConcurrentLookups: 2,
    lateStaleResultsRendered: 0,
    freshResultsRendered: 1,
    providerCalls: 0,
    externalRequests: 0
  };

  const richLookupCancellationUnitSuite = {
    status: "passed",
    testFile: "tests/rich-mdict-lookup-cancellation.test.mjs",
    passedTests: [
      "Selection cancellation aborts an active bounded key range before any later range or decode",
      "cancellation cancels a bounded decompression reader and remains AbortError",
      "Selection lookup cancellation is request-ID and content-owner scoped",
      "cancel-before-dispatch tombstones only the exact Selection request until its delayed lookup arrives",
      "OPFS range reads cancel their underlying Blob stream on Selection abort"
    ]
  };

  return {
    scope,
    expectedBaseSha: baseSha,
    vnextCertification,
    playwright,
    importReport,
    performanceReport,
    preferredBaseline: structuredClone(preferredBaselineTemplate),
    richLookupCancellation,
    richLookupCancellationBaseline: makeCancellationBaseline(),
    richLookupCancellationRunnerSha256: cancellationRunnerSha256,
    richLookupCancellationUnitSuite,
    repositoryFiles: ["manifest.json", "package.json", ...syntheticRepoFixtures.map((item) => item.path)],
    repositoryPayloads: structuredClone(syntheticRepoFixtures),
    packageFiles: ["manifest.json", "options.html"]
  };
}

test("certifies a frozen shipped scope against its exact declared run base and sanitized evidence", () => {
  const evidence = makeEvidence();
  evidence.importReport.rawDictionaryContent = "private-entry-sentinel";
  evidence.playwright.stdout = ["private-test-console-sentinel"];
  evidence.performanceReport.rawDictionaryContent = "private-performance-sentinel";
  evidence.richLookupCancellation.rawDictionaryContent = "private-cancellation-sentinel";
  const result = certifyDictionaryEcosystemV2(evidence);
  assert.equal(result.status, "PASS", result.failures.join("\n"));
  assert.equal(result.scope.mainBaseSha, baseSha);
  assert.equal(result.evidence.inFlightLookupCancellation.routeCancellationLatency.sampleCount, 10);
  assert.equal(result.evidence.inFlightLookupCancellation.routeCancellationLatency.pushStateSamples, 5);
  assert.equal(result.evidence.inFlightLookupCancellation.routeCancellationLatency.replaceStateSamples, 5);
  assert.equal(result.evidence.inFlightLookupCancellation.routeCancellationLatency.clock, "performance.now");
  assert.equal(result.evidence.inFlightLookupCancellation.routeCancellationLatency.baselineInterpretation, "conservative-stop-latency-ceiling");
  const output = JSON.stringify(result);
  for (const sentinel of ["private-entry-sentinel", "private-test-console-sentinel", "private-performance-sentinel", "private-cancellation-sentinel"]) {
    assert.equal(output.includes(sentinel), false);
  }
});

test("requires the authoritative #198 parent and #207 certification manifest identities", () => {
  const evidence = makeEvidence();
  evidence.scope.parentIssue = 197;
  const wrongParent = certifyDictionaryEcosystemV2(evidence);
  assert.equal(wrongParent.status, "FAIL");
  assert.ok(wrongParent.failures.some((failure) => failure.includes("authoritative parent Issue")));
});

test("workflow runs the aggregate only for a ready scope and uploads sanitized summaries only", () => {
  assert.match(certificationWorkflow, /docs\/DICTIONARY_ECOSYSTEM_V2_PREFERRED_BASELINE\.json/u);
  assert.match(certificationWorkflow, /if: steps\.ecosystem-scope\.outputs\.ready == 'true'/u);
  assert.match(certificationWorkflow, /hashFiles\('tests\/rich-mdict-lookup-cancellation\.test\.mjs'\)/u);
  assert.match(certificationWorkflow, /hashFiles\('scripts\/measure-rich-lookup-cancellation-baseline\.mjs'\)/u);
  const baselineStepAt = certificationWorkflow.indexOf("Generate pinned #224 cancellation baseline evidence");
  const e2eStepAt = certificationWorkflow.indexOf("Run focused Dictionary Library vNext product E2E gates");
  assert.ok(baselineStepAt >= 0 && baselineStepAt < e2eStepAt, "the pinned baseline must be generated before its browser report reads it");
  assert.match(certificationWorkflow.slice(baselineStepAt, e2eStepAt), /DICTIONARY_ECOSYSTEM_V2_EVIDENCE_DIR:.*evidence-private/u);
  assert.match(certificationWorkflow, /-f e2e\/selection-rich-lookup-cancel\.spec\.mjs/u);
  assert.match(certificationWorkflow, /npm run certify:dictionary-ecosystem-v2/u);
  const uploadStep = certificationWorkflow.slice(certificationWorkflow.indexOf("- name: Upload sanitized dictionary certification summaries"));
  assert.match(uploadStep, /evidence-published\/dictionary-library-vnext-certification\.json/u);
  assert.match(uploadStep, /evidence-published\/dictionary-ecosystem-v2-certification\.json/u);
  assert.doesNotMatch(uploadStep, /evidence-private|playwright-vnext-report|ecdict-mdx-28\.zip|\.mdx|\.mdd/u);
});

test("release case identities require real MDX, numbered MDD, StarDict, and #224 cancellation paths", () => {
  assert.ok(REQUIRED_E2E_CASES.some(([file, title]) => file === "e2e/rich-mdict-product.spec.mjs" && title.includes("safe text locally")));
  assert.ok(REQUIRED_E2E_CASES.some(([file, title]) => file === "e2e/stardict-import-product.spec.mjs" && title.includes("Selection")));
  assert.ok(REQUIRED_E2E_CASES.some(([file, title]) => file === "e2e/local-dictionary-import-v2-product.spec.mjs" && title.includes("numbered MDD")));
  assert.ok(REQUIRED_E2E_CASES.some(([file]) => file === "e2e/selection-rich-lookup-cancel.spec.mjs"));
});

test("fails when the final scope or #224 slice still has pending status", () => {
  const evidence = makeEvidence();
  evidence.scope.scopeRevision.status = "required-pending";
  evidence.scope.requiredSlices.find((item) => item.issue === 224).status = "required-pending";
  evidence.scope.requiredSlices.find((item) => item.issue === 224).mergedPr = null;
  const result = certifyDictionaryEcosystemV2(evidence);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((failure) => failure.includes("release-scope revision status")));
  assert.ok(result.failures.some((failure) => failure.includes("required Issue #224 status")));
});

test("fails when manifest base SHA is not the declared certification run base", () => {
  const evidence = makeEvidence();
  evidence.expectedBaseSha = "b".repeat(40);
  const result = certifyDictionaryEcosystemV2(evidence);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((failure) => failure.includes("frozen scope base SHA for this certification run")));
});

test("binds preferred lookup ceilings to the reviewed baseline identity, run, SHA, and exact samples", () => {
  for (const mutate of [
    (evidence) => { evidence.preferredBaseline.recordId = "unreviewed-run"; },
    (evidence) => { evidence.preferredBaseline.mainSha = "b".repeat(40); },
    (evidence) => { evidence.preferredBaseline.outcomes.passed = 9; },
    (evidence) => { evidence.preferredBaseline.command = "playwright --repeat-each=9"; },
    (evidence) => { evidence.preferredBaseline.samplesMs.preferredRichVisible[0] += 1; },
    (evidence) => { evidence.preferredBaseline.samplesMs.structuredPrimaryVisible[0] += 1; },
    (evidence) => { evidence.preferredBaseline.providerCalls = 1; }
  ]) {
    const evidence = makeEvidence();
    mutate(evidence);
    const result = certifyDictionaryEcosystemV2(evidence);
    assert.equal(result.status, "FAIL");
    assert.ok(result.failures.some((failure) => failure.includes("preferred lookup baseline")));
  }
});

test("requires fresh unique pack IDs and versions for every preferred timing sample", () => {
  const evidence = makeEvidence();
  evidence.performanceReport.repeatedPreferenceLookup.workload.uniquePackIds = 19;
  evidence.performanceReport.repeatedPreferenceLookup.workload.uniquePackVersions = 19;
  const result = certifyDictionaryEcosystemV2(evidence);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((failure) => failure.includes("unique installed pack count")));
  assert.ok(result.failures.some((failure) => failure.includes("unique installed pack-version count")));
});

test("CLI base binding accepts only an available ancestor commit", () => {
  const headSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const goodFailures = [];
  verifyRunBaseSha(headSha, goodFailures);
  assert.deepEqual(goodFailures, []);

  const badFailures = [];
  verifyRunBaseSha("b".repeat(40), badFailures);
  assert.ok(badFailures.some((failure) => failure.includes("not an available ancestor")));
});

test("fails closed when an import route loses an accessibility assertion", () => {
  const evidence = makeEvidence();
  evidence.importReport.mdxOnlyRichRoute.progressLiveRegion = false;
  const result = certifyDictionaryEcosystemV2(evidence);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((failure) => failure.includes("progressLiveRegion")));
});

test("accepts only the enumerated optional skips and never skips required E2E cases", () => {
  const evidence = makeEvidence();
  evidence.playwright.stats.skipped = 1;
  evidence.playwright.suites.push({
    file: "e2e/release-lexicon.spec.mjs",
    specs: [{
      title: "production extension resolves the built Core and Technical packs without Provider calls",
      tests: [{ expectedStatus: "passed", status: "skipped", results: [{ status: "skipped" }] }]
    }]
  });
  assert.equal(certifyDictionaryEcosystemV2(evidence).status, "PASS");

  evidence.playwright.stats.skipped = 2;
  evidence.playwright.suites.push({
    file: "e2e/unrelated.spec.mjs",
    specs: [{ title: "unexpected skip", tests: [{ expectedStatus: "passed", status: "skipped", results: [{ status: "skipped" }] }] }]
  });
  const unknownSkip = certifyDictionaryEcosystemV2(evidence);
  assert.equal(unknownSkip.status, "FAIL");
  assert.ok(unknownSkip.failures.some((failure) => failure.includes("non-allowlisted skipped cases")));
});

test("fails when required #224 cancellation evidence allows post-cancel reads", () => {
  const evidence = makeEvidence();
  evidence.richLookupCancellation.postCancelRangeReads = 1;
  const result = certifyDictionaryEcosystemV2(evidence);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((failure) => failure.includes("#224 post-cancel range reads")));
});

test("binds #224 route latency and browser report metadata to the private pinned raw baseline and runner", () => {
  const mutations = [
    (evidence) => { evidence.richLookupCancellation.cancellationLatency.baselineEvidenceFile = "untrusted.json"; },
    (evidence) => { evidence.richLookupCancellation.cancellationLatency.baselineWorkload.rangeGateDelayMs = 1; },
    (evidence) => { evidence.richLookupCancellation.cancellationLatency.baselineRunnerSha256 = "d".repeat(64); },
    (evidence) => { evidence.richLookupCancellation.routeCancellationLatency.sampleCount = 9; },
    (evidence) => { evidence.richLookupCancellation.routeCancellationLatency.samples[0].endpoint = "cancel-message-observed"; },
    (evidence) => { evidence.richLookupCancellation.routeCancellationLatency.baselineMetric = "route changed to message sent"; },
    (evidence) => { evidence.richLookupCancellation.routeCancellationLatency.baselineInterpretation = "like-for-like-benchmark"; },
    (evidence) => { evidence.richLookupCancellation.routeCancellationLatency.samples[0].method = "popstate"; },
    (evidence) => { evidence.richLookupCancellation.routeCancellationLatency.methodSampleCounts.pushState = 4; },
    (evidence) => { evidence.richLookupCancellation.cancelledLookupCount = 9; },
    (evidence) => { evidence.richLookupCancellation.routeCancellationLatency.samples[0].rangeReadActiveAtRoute = false; },
    (evidence) => { evidence.richLookupCancellation.routeCancellationLatency.samples[0].nativeCancelCompletedAtEpochMs += 100; },
    (evidence) => { evidence.richLookupCancellation.routeCancellationLatency.samplesMs[0] = Number.NaN; },
    (evidence) => { evidence.richLookupCancellation.routeCancellationLatency.p95Ms = 100; },
    (evidence) => { evidence.richLookupCancellation.routeCancellationLatency.ceilingPassed = false; },
    (evidence) => { evidence.richLookupCancellationBaseline.rawSamplesMs[0] = 1000; },
    (evidence) => { evidence.richLookupCancellationBaseline.baselineLookupBlob = "f".repeat(40); },
    (evidence) => { evidence.richLookupCancellationBaseline.runnerSha256 = "d".repeat(64); }
  ];
  for (const mutate of mutations) {
    const evidence = makeEvidence();
    mutate(evidence);
    const result = certifyDictionaryEcosystemV2(evidence);
    assert.equal(result.status, "FAIL");
    assert.ok(result.failures.some((failure) => failure.includes("#224")), result.failures.join("\n"));
  }
});

test("fails closed when the private #224 baseline report or checked-in runner identity is absent", () => {
  const missingReport = makeEvidence();
  missingReport.richLookupCancellationBaseline = null;
  const reportResult = certifyDictionaryEcosystemV2(missingReport);
  assert.equal(reportResult.status, "FAIL");
  assert.ok(reportResult.failures.some((failure) => failure.includes("pinned Rich lookup cancellation baseline evidence")));

  const missingRunner = makeEvidence();
  missingRunner.richLookupCancellationRunnerSha256 = null;
  const runnerResult = certifyDictionaryEcosystemV2(missingRunner);
  assert.equal(runnerResult.status, "FAIL");
  assert.ok(runnerResult.failures.some((failure) => failure.includes("runner source SHA-256")));
});

test("fails when #224 manager range/decode cancellation unit cases are missing", () => {
  const evidence = makeEvidence();
  evidence.richLookupCancellationUnitSuite.passedTests.pop();
  const result = certifyDictionaryEcosystemV2(evidence);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((failure) => failure.includes("OPFS range reads cancel their underlying Blob stream")));
});

test("fails when repository or production package inventories contain dictionary bytes", () => {
  const evidence = makeEvidence();
  evidence.repositoryFiles.push("fixtures/private.mdx");
  evidence.packageFiles.push("assets/dictionary.mdd");
  const result = certifyDictionaryEcosystemV2(evidence);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failures.some((failure) => failure.includes("repository contains 1 unapproved raw dictionary/archive payload")));
  assert.ok(result.failures.some((failure) => failure.includes("production package contains 1 raw dictionary/archive payload")));
});

test("allows only the exact locked synthetic MDD interoperability files in the repository", () => {
  const evidence = makeEvidence();
  evidence.repositoryPayloads[0].sha256 = "f".repeat(64);
  const changedFixture = certifyDictionaryEcosystemV2(evidence);
  assert.equal(changedFixture.status, "FAIL");
  assert.ok(changedFixture.failures.some((failure) => failure.includes("locked synthetic fixture tests/fixtures/mdd-interop/interop.mdx SHA-256")));

  const unapprovedFixture = makeEvidence();
  unapprovedFixture.repositoryFiles.push("dict/private.mdx");
  const unapprovedResult = certifyDictionaryEcosystemV2(unapprovedFixture);
  assert.equal(unapprovedResult.status, "FAIL");
  assert.ok(unapprovedResult.failures.some((failure) => failure.includes("repository contains 1 unapproved raw dictionary/archive payload")));
});
