#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildExtension } from "./build-extension.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SCOPE_PATH = join(ROOT, "docs/DICTIONARY_ECOSYSTEM_V2_RELEASE_SCOPE.json");
const PREFERRED_BASELINE_PATH = join(ROOT, "docs/DICTIONARY_ECOSYSTEM_V2_PREFERRED_BASELINE.json");
const EVIDENCE_FILES = Object.freeze({
  playwright: "playwright-vnext-report.json",
  import: "dictionary-ecosystem-v2-import-report.json",
  performance: "dictionary-ecosystem-v2-performance-report.json",
  richLookupCancellation: "rich-lookup-cancellation-report.json",
  richLookupCancellationBaseline: "rich-lookup-cancellation-baseline.json"
});
const REQUIRED_SLICES = Object.freeze([199, 200, 202, 215, 203, 204, 224]);
const PREFERRED_BASELINE_RECORD_ID = "preferred-lookup-acbfa12-repeat10-20261001";
const PREFERRED_BASELINE_SHA = "acbfa12a079a73d6eab0a1c17e7a8f63d856295b";
const PREFERRED_BASELINE_CASE = "e2e/multi-dictionary-viewer.spec.mjs :: personal preference persists and opens first beside the unchanged structured primary";
const PREFERRED_BASELINE_COMMAND = "CI=true npx playwright test e2e/multi-dictionary-viewer.spec.mjs --grep 'personal preference persists and opens first beside the unchanged structured primary' --repeat-each=10 --reporter=line,json";
const PREFERRED_BASELINE_SAMPLES = Object.freeze({
  structuredPrimaryVisible: Object.freeze([278, 259, 255, 269, 267, 267, 283, 273, 281, 275]),
  preferredRichVisible: Object.freeze([378, 337, 343, 363, 364, 375, 385, 370, 384, 371]),
  bothRichComplete: Object.freeze([395, 350, 358, 384, 381, 392, 402, 388, 402, 388])
});
// These two tiny files are the locked MIT synthetic MDD interoperability fixture.
// Every other MDX/MDD/archive in the repository remains a boundary failure.
const ALLOWED_SYNTHETIC_REPOSITORY_FIXTURES = Object.freeze({
  "tests/fixtures/mdd-interop/interop.mdx": Object.freeze({ bytes: 1194, sha256: "b8996c8cd7449e67a5049ba0cd284fb1528385ff090c82af4113c67e050a8a82" }),
  "tests/fixtures/mdd-interop/interop.mdd": Object.freeze({ bytes: 1723, sha256: "98adc93097939119d72d5d0257027099ab25d421b9df43d10867e29cc24fe4f5" })
});
const REQUIRED_CANCELLATION_UNIT_CASES = Object.freeze([
  "Selection cancellation aborts an active bounded key range before any later range or decode",
  "cancellation cancels a bounded decompression reader and remains AbortError",
  "Selection lookup cancellation is request-ID and content-owner scoped",
  "cancel-before-dispatch tombstones only the exact Selection request until its delayed lookup arrives",
  "OPFS range reads cancel their underlying Blob stream on Selection abort"
]);
const CANCELLATION_BASELINE = Object.freeze({
  mainSha: "acbfa12a079a73d6eab0a1c17e7a8f63d856295b",
  lookupPath: "src/background/packs/importers/mdict-rich-lookup.js",
  lookupBlob: "abb6053146f4498c7b127131b391aed8b657f3e1",
  fixturePath: "tests/helpers/rich-mdict-fixture.mjs",
  fixtureBlob: "e4bc9ec0bc4e8b3994fcfb3de2a24bbbfd674c43",
  runnerPath: "scripts/measure-rich-lookup-cancellation-baseline.mjs",
  sampleCount: 30,
  rangeGateDelayMs: 24,
  workloadKind: "synthetic bounded MDX exact lookup",
  workloadGate: "one key-block range read waits for a 24ms timer; pinned baseline lookup ignores AbortSignal"
});
export const EXPECTED_OPTIONAL_SKIPS = Object.freeze([
  ["e2e/local-dictionary-preflight-real-ecdict.spec.mjs", "pinned real ECDICT MDX preflight stays local, bounded, and routes to the rich importer"],
  ["e2e/rich-mdict-real-corpus.spec.mjs", "Settings install survives reload, Selection shows a real record with zero Provider calls, and delete removes it"],
  ["e2e/rich-mdict-real-corpus.spec.mjs", "the Settings card requests the exact host pair, installs/reinstalls the real archive, preserves the active version on failure/cancel, works offline, and deletes"],
  ["e2e/release-lexicon.spec.mjs", "production extension resolves the built Core and Technical packs without Provider calls"]
]);
export const REQUIRED_E2E_CASES = Object.freeze([
  ["e2e/dictionary-library-v2-product.spec.mjs", "separates source freshness, review, trust and installed lifecycle with accessible responsive UX"],
  ["e2e/rich-mdict-product.spec.mjs", "Settings install persists, Selection reads safe text locally, and delete clears it"],
  ["e2e/dictionary-ecosystem-v2-release.spec.mjs", "unified MDX-only Rich route installs locally and exposes accessible keyboard states"],
  ["e2e/dictionary-ecosystem-v2-release.spec.mjs", "repeated preferred-first lookup stays within bounds on the measured one-entry baseline fixture"],
  ["e2e/dictionary-ecosystem-v2-release.spec.mjs", "repeated selection changes invalidate stale responses and dispatch fresh lookups"],
  ["e2e/local-dictionary-import-v2-product.spec.mjs", "one picker safely installs Rich MDX with base and numbered MDD locally"],
  ["e2e/local-dictionary-import-v2-product.spec.mjs", "unsupported LZO reports a human readable reason and cannot install"],
  ["e2e/local-dictionary-import-v2-product.spec.mjs", "partial MDX with resources stays Rich unless structured semantics are explicitly confirmed"],
  ["e2e/local-dictionary-import-v2-product.spec.mjs", "ambiguous numbered MDD companions fail before import with the numbering reason"],
  ["e2e/local-dictionary-import-v2-product.spec.mjs", "same-title MDX requires an explicit keep-as-another-dictionary decision"],
  ["e2e/local-dictionary-import-v2-product.spec.mjs", "cancelling a delayed local preflight shows cancellation and never activates a dictionary"],
  ["e2e/local-dictionary-import-v2-product.spec.mjs", "cancelling Rich MDX index creation removes partial state and permits a clean retry"],
  ["e2e/local-dictionary-import-v2-product.spec.mjs", "TFLex full-validation failure never activates partial files"],
  ["e2e/local-dictionary-import-v2-product.spec.mjs", "same-packId TFLex replacement requires confirmation and a bad hash preserves the active version and lookup"],
  ["e2e/local-dictionary-import-v2-product.spec.mjs", "cancelling the initial MDD attachment keeps previously active MDD resources intact"],
  ["e2e/mdict-import-product.spec.mjs", "Settings MDX import activates Selection with zero Provider calls and remains uninstallable"],
  ["e2e/stardict-import-product.spec.mjs", "Settings import reaches Selection without Provider and uninstall removes lookup"],
  ["e2e/mdd-resources.spec.mjs", "independent MDX/MDD pair restores image, gated audio, and safe CSS after reload"],
  ["e2e/multi-dictionary-viewer.spec.mjs", "personal preference persists and opens first beside the unchanged structured primary"],
  ["e2e/multi-dictionary-viewer.spec.mjs", "a preferred no-hit leaves the next dictionary visible and deleting it promotes the next enabled card"],
  ["e2e/multi-dictionary-viewer.spec.mjs", "a corrupted dictionary reports its own error while another card and the structured primary render"],
  ["e2e/rich-viewer-security.spec.mjs", "hostile HTML and styles stay inert while readable dictionary structure remains available"],
  ["e2e/selection-rich-lookup-cancel.spec.mjs", "cancels the prior local request and renders only the fresh selection"]
]);

export function certifyDictionaryEcosystemV2({
  scope,
  expectedBaseSha,
  vnextCertification,
  playwright,
  importReport,
  performanceReport,
  preferredBaseline,
  richLookupCancellation,
  richLookupCancellationBaseline,
  richLookupCancellationRunnerSha256,
  richLookupCancellationUnitSuite,
  repositoryFiles = [],
  repositoryPayloads = [],
  packageFiles = []
} = {}) {
  const failures = [];
  const evidence = {
    scope: certifyScope(scope, expectedBaseSha, failures),
    vnext: certifyVnext(vnextCertification, failures),
    requiredE2E: certifyRequiredE2E(playwright, failures),
    unifiedRichRoute: certifyImportReport(importReport, failures),
    selectionPerformance: certifyPerformance(performanceReport, preferredBaseline, failures),
    inFlightLookupCancellation: certifyRichLookupCancellation(richLookupCancellation, richLookupCancellationBaseline, richLookupCancellationRunnerSha256, failures),
    inFlightLookupCancellationUnitSuite: certifyRichLookupCancellationUnitSuite(richLookupCancellationUnitSuite, failures),
    packageAndRepositoryBoundary: certifyBoundary(repositoryFiles, repositoryPayloads, packageFiles, failures)
  };
  return {
    schemaVersion: 1,
    report: "dictionary-ecosystem-v2-certification",
    status: failures.length ? "FAIL" : "PASS",
    scope: {
      mainBaseSha: scope?.mainBaseSha || null,
      expectedBaseSha: expectedBaseSha || null,
      requiredIssueNumbers: REQUIRED_SLICES,
      promotedParserCapabilities: Array.isArray(scope?.promotedParserCapabilities) ? scope.promotedParserCapabilities : null,
      promotedRichSemantics: Array.isArray(scope?.promotedRichSemantics) ? scope.promotedRichSemantics : null,
      officialPack: scope?.conditionalDecisions?.["122"]?.status || null,
      scopeSha256: scope ? sha256(JSON.stringify(scope)) : null
    },
    evidence,
    failures
  };
}

function certifyScope(scope, expectedBaseSha, failures) {
  const before = failures.length;
  if (!isObject(scope)) {
    failures.push("frozen Dictionary Ecosystem v2 scope manifest is missing");
    return { status: "missing" };
  }
  requireEqual(scope.schemaVersion, 1, "ecosystem scope schema version", failures);
  requireEqual(scope.manifest, "dictionary-ecosystem-v2-release-scope", "ecosystem scope manifest identity", failures);
  requireEqual(scope.parentIssue, 198, "ecosystem authoritative parent Issue", failures);
  requireEqual(scope.certificationIssue, 207, "ecosystem certification Issue", failures);
  requireEqual(scope.scopeStatus, "frozen-for-certification", "ecosystem final scope status", failures);
  if (!/^[0-9a-f]{40}$/u.test(scope.mainBaseSha || "")) failures.push("ecosystem scope base SHA is missing or invalid");
  if (!/^[0-9a-f]{40}$/u.test(expectedBaseSha || "")) failures.push("declared certification run base SHA is missing or invalid");
  requireEqual(scope.mainBaseSha, expectedBaseSha, "frozen scope base SHA for this certification run", failures);
  const slices = Array.isArray(scope.requiredSlices) ? scope.requiredSlices : [];
  const sliceNumbers = slices.map((slice) => slice?.issue).sort((a, b) => a - b);
  if (!sameJson(sliceNumbers, [...REQUIRED_SLICES].sort((a, b) => a - b))) {
    failures.push(`frozen scope required issue set must be exactly ${REQUIRED_SLICES.join(", ")}`);
  }
  for (const issue of REQUIRED_SLICES) {
    const matches = slices.filter((slice) => slice?.issue === issue);
    if (matches.length !== 1) continue;
    const item = matches[0];
    const expectedStatus = issue === 215 ? "shipped-through-203" : "shipped";
    if (item.status !== expectedStatus) failures.push(`required Issue #${issue} status must be ${expectedStatus}`);
    if (!Number.isSafeInteger(item.mergedPr) || item.mergedPr <= 0) failures.push(`required Issue #${issue} lacks a merged PR identity`);
  }
  requireEqual(scope.scopeRevision?.issue, 224, "release-scope revision Issue", failures);
  requireEqual(scope.scopeRevision?.status, "shipped", "release-scope revision status", failures);
  if (!Array.isArray(scope.promotedParserCapabilities) || scope.promotedParserCapabilities.length !== 0) {
    failures.push("no parser/container capability may be promoted without a separate measured approval");
  }
  if (!Array.isArray(scope.promotedRichSemantics) || scope.promotedRichSemantics.length !== 0) {
    failures.push("no Rich semantic capability may be promoted without a separate measured approval");
  }
  const decisions = scope.conditionalDecisions || {};
  for (const [issue, status] of [["187", "not-planned"], ["201", "not-planned"], ["205", "no-go"], ["206", "not-planned"], ["122", "open-blocked"]]) {
    requireEqual(decisions[issue]?.status, status, `conditional Issue #${issue} scope decision`, failures);
  }
  requireEqual(decisions["205"]?.qualifiedCandidates, 0, "qualified additional dictionary source count", failures);
  requireEqual(decisions["122"]?.officialPack, "absent", "Official dictionary pack status", failures);
  const ecdict = (scope.curatedCatalogSources || []).find((item) => item?.id === "ecdict-en-zh-mdx-curated");
  requireEqual(ecdict?.trustClass, "curated-upstream", "ECDICT trust class", failures);
  requireEqual(ecdict?.sourceVersion, "1.0.28", "ECDICT source version", failures);
  requireEqual(ecdict?.releaseDate, "2017-09-20", "ECDICT release date", failures);
  requireEqual(ecdict?.contentDate, "2017-06-03", "ECDICT content date", failures);
  requireEqual(ecdict?.compatibility, "reviewed-compatible", "ECDICT compatibility review", failures);
  requireEqual(scope.compatibilityClaims?.commercialUserOwnedDictionaries, "NOT_TESTED unless a sanitized lawful local report is present", "commercial user-owned compatibility claim", failures);
  requireEqual(scope.dataBoundary?.commercialDictionaryPayloadsInRepository, false, "commercial payload repository boundary", failures);
  requireEqual(scope.dataBoundary?.commercialDictionaryPayloadsInCiArtifacts, false, "commercial payload CI artifact boundary", failures);
  requireEqual(scope.dataBoundary?.userOwnedDictionaryPayloadsInRepository, false, "user-owned payload repository boundary", failures);
  requireEqual(scope.dataBoundary?.officialDictionaryPayloadsBundled, false, "Official payload package boundary", failures);
  return { status: failures.length === before ? "passed" : "failed", requiredIssueNumbers: sliceNumbers, ecdict: { sourceVersion: ecdict?.sourceVersion, releaseDate: ecdict?.releaseDate, contentDate: ecdict?.contentDate, compatibility: ecdict?.compatibility } };
}

function certifyVnext(report, failures) {
  const before = failures.length;
  if (!isObject(report) || report.status !== "PASS" || report.report !== "dictionary-library-vnext-certification") {
    failures.push("fresh Dictionary Library vNext certification is missing or did not pass");
    return { status: isObject(report) ? "failed" : "missing" };
  }
  const requiredEvidence = ["frozenLocks", "pinnedEcdict", "curatedInstallAndViewer", "mddInteropAndResources", "multiDictionary", "richViewerSecurity", "vnextProduct", "lexicalPrimaryLane", "productionPackage"];
  for (const key of requiredEvidence) {
    if (report.evidence?.[key]?.status !== "passed") failures.push(`vNext evidence ${key} is missing or did not pass`);
  }
  requireEqual(report.evidence?.productionPackage?.rawPayloads?.length, 0, "vNext raw package payload count", failures);
  requireEqual(report.evidence?.richViewerSecurity?.externalRequests, 0, "vNext Rich viewer external request count", failures);
  requireEqual(report.evidence?.richViewerSecurity?.providerCalls, 0, "vNext Rich viewer Provider call count", failures);
  return { status: failures.length === before ? "passed" : "failed", requiredSubreports: requiredEvidence.length, packageRawPayloads: report.evidence?.productionPackage?.rawPayloads?.length ?? null };
}

function certifyRequiredE2E(report, failures) {
  const before = failures.length;
  const cases = collectCases(report);
  if (!isObject(report) || !isObject(report.stats)) failures.push("fresh ecosystem Playwright JSON report is missing complete test outcome statistics");
  for (const key of ["unexpected", "flaky"]) requireEqual(report?.stats?.[key], 0, `ecosystem Playwright ${key} outcomes`, failures);
  if (!Number.isSafeInteger(report?.stats?.skipped) || report.stats.skipped < 0) failures.push("ecosystem Playwright skipped count is missing or invalid");
  if (!Number.isSafeInteger(report?.stats?.expected) || report.stats.expected <= 0) failures.push("ecosystem Playwright report has no expected passing cases");
  const expectedSkips = new Set(EXPECTED_OPTIONAL_SKIPS.map(([file, title]) => `${file}::${title}`));
  const skippedCases = cases.filter((item) => item.outcome === "skipped" || item.results.some((result) => result?.status === "skipped"));
  const unexpectedSkips = skippedCases.filter((item) => !expectedSkips.has(`${item.file}::${item.title}`));
  if (unexpectedSkips.length) failures.push(`ecosystem Playwright contains non-allowlisted skipped cases: ${unexpectedSkips.map((item) => `${item.file} :: ${item.title}`).join("; ")}`);
  if (Number.isSafeInteger(report?.stats?.skipped) && report.stats.skipped !== skippedCases.length) failures.push("ecosystem Playwright skipped count does not match the reported skipped case identities");
  const result = [];
  for (const [file, title] of REQUIRED_E2E_CASES) {
    const matches = cases.filter((item) => item.file === file && item.title === title);
    if (matches.length !== 1) {
      failures.push(`required ecosystem Chromium case must occur once: ${file} :: ${title} (found ${matches.length})`);
      result.push({ file, title, status: matches.length ? "duplicate" : "missing" });
      continue;
    }
    const item = matches[0];
    const passed = item.expectedStatus === "passed" && item.outcome === "expected" && item.results.length === 1 && item.results[0]?.status === "passed";
    if (!passed) failures.push(`required ecosystem Chromium case did not pass exactly once: ${file} :: ${title}`);
    result.push({ file, title, status: passed ? "passed" : "failed" });
  }
  const optionalCases = EXPECTED_OPTIONAL_SKIPS.map(([file, title]) => {
    const matches = cases.filter((item) => item.file === file && item.title === title);
    if (matches.length > 1) failures.push(`known optional Chromium case occurs more than once: ${file} :: ${title}`);
    if (!matches.length) return { file, title, status: "not-in-this-run" };
    const item = matches[0];
    const passed = item.expectedStatus === "passed" && item.outcome === "expected" && item.results.length === 1 && item.results[0]?.status === "passed";
    const skipped = item.outcome === "skipped" && item.results.length === 1 && item.results[0]?.status === "skipped";
    if (!passed && !skipped) failures.push(`known optional Chromium case failed or has an unexpected status: ${file} :: ${title}`);
    return { file, title, status: passed ? "passed" : skipped ? "expected-skip" : "failed" };
  });
  return { status: failures.length === before ? "passed" : "failed", requiredCases: result, optionalCases, expectedOptionalSkips: skippedCases.map(({ file, title }) => ({ file, title })), stats: { expected: report?.stats?.expected ?? null, skipped: report?.stats?.skipped ?? null, unexpected: report?.stats?.unexpected ?? null, flaky: report?.stats?.flaky ?? null } };
}

function certifyImportReport(report, failures) {
  const before = failures.length;
  if (!isObject(report) || report.status !== "PASS" || report.spec !== "e2e/dictionary-ecosystem-v2-release.spec.mjs") {
    failures.push("sanitized ecosystem local Rich route report is missing or did not pass");
    return { status: isObject(report) ? "failed" : "missing" };
  }
  const route = report.mdxOnlyRichRoute || {};
  for (const key of ["persistedAfterReload", "visibleInSelection", "keyboardImport", "keyboardDismiss", "accessibleFilePicker", "selectedFilesAccessibleLabel", "installAccessibleName", "selectionChipAccessibleName", "dismissAccessibleName", "preflightLiveRegion", "progressLiveRegion", "darkMode", "reducedMotion"]) requireEqual(route[key], true, `MDX-only Rich route ${key}`, failures);
  requireEqual(route.status, "passed", "MDX-only Rich route status", failures);
  requireEqual(route.fileCount, 1, "MDX-only Rich input file count", failures);
  requireEqual(route.associatedMddCount, 0, "MDX-only Rich MDD count", failures);
  requireEqual(route.viewportWidth, 390, "MDX-only Rich viewport width", failures);
  requireEqual(route.horizontalOverflow, false, "MDX-only Rich horizontal overflow", failures);
  requireEqual(route.providerCalls, 0, "MDX-only Rich Provider calls", failures);
  requireEqual(route.externalRequests, 0, "MDX-only Rich external requests", failures);
  return { status: failures.length === before ? "passed" : "failed", viewportWidth: route.viewportWidth, keyboardImport: route.keyboardImport, keyboardDismiss: route.keyboardDismiss, providerCalls: route.providerCalls, externalRequests: route.externalRequests };
}

function certifyPerformance(report, baselineReport, failures) {
  const before = failures.length;
  if (!isObject(report) || report.status !== "PASS" || report.spec !== "e2e/dictionary-ecosystem-v2-release.spec.mjs") {
    failures.push("sanitized ecosystem Selection performance report is missing or did not pass");
    return { status: isObject(report) ? "failed" : "missing" };
  }
  const preference = report.repeatedPreferenceLookup || {};
  const baseline = certifyPreferredBaseline(baselineReport, failures);
  requireEqual(preference.status, "passed", "repeated preferred lookup status", failures);
  requireEqual(preference.sampleCount, 10, "preferred lookup sample count", failures);
  requireEqual(preference.lookupsPerSelection, 2, "Rich lookup requests per selection", failures);
  requireEqual(preference.totalLookups, 20, "repeated preference total Rich lookups", failures);
  const baselineProfile = preference.workload || {};
  requireEqual(baselineProfile.fixtureProfile, "multi-dictionary-viewer-alpha-beta-one-entry-v1", "preferred lookup baseline fixture profile", failures);
  requireEqual(baselineProfile.selectionQuery, "persistent", "preferred lookup baseline selection query", failures);
  requireEqual(baselineProfile.entriesPerDictionary, 1, "preferred lookup baseline entries per dictionary", failures);
  requireEqual(baselineProfile.encryptedKeyInfo, true, "preferred lookup baseline key-info encryption", failures);
  requireEqual(baselineProfile.baselineRecordId, PREFERRED_BASELINE_RECORD_ID, "preferred lookup baseline record identity on measured report", failures);
  requireEqual(baselineProfile.baselineMainSha, PREFERRED_BASELINE_SHA, "preferred lookup baseline source SHA on measured report", failures);
  requireEqual(baselineProfile.freshInstallPerSample, true, "preferred lookup fresh install per timing sample", failures);
  requireEqual(baselineProfile.uniquePackIds, 20, "preferred lookup unique installed pack count", failures);
  requireEqual(baselineProfile.uniquePackVersions, 20, "preferred lookup unique installed pack-version count", failures);
  requireEqual(baselineProfile.harnessResetBeforeEach, true, "preferred lookup harness reset before each sample", failures);
  requireEqual(preference.preferredFirstMs?.sampleCount, 10, "preferred-first timing sample count", failures);
  requireEqual(preference.bothRichCompleteMs?.sampleCount, 10, "both-Rich timing sample count", failures);
  requireEqual(preference.measuredBaselineP95Ms?.preferredFirst, baseline.preferredP95Ms, "preferred-first measured baseline p95", failures);
  requireEqual(preference.measuredBaselineP95Ms?.bothRichComplete, baseline.bothRichP95Ms, "both-Rich measured baseline p95", failures);
  requireEqual(preference.derivedCeilingsMs?.preferredFirst, Math.ceil(baseline.preferredP95Ms * 2), "preferred-first derived ceiling", failures);
  requireEqual(preference.derivedCeilingsMs?.bothRichComplete, Math.ceil(baseline.bothRichP95Ms * 2), "both-Rich derived ceiling", failures);
  if (!isFiniteNumber(preference.preferredFirstMs?.p95NearestRank) || preference.preferredFirstMs.p95NearestRank > preference.derivedCeilingsMs?.preferredFirst) failures.push("preferred-first p95 exceeds its measured workload ceiling");
  if (!isFiniteNumber(preference.bothRichCompleteMs?.p95NearestRank) || preference.bothRichCompleteMs.p95NearestRank > preference.derivedCeilingsMs?.bothRichComplete) failures.push("both-Rich-complete p95 exceeds its measured workload ceiling");
  if (!Number.isSafeInteger(preference.maxConcurrentLookups) || preference.maxConcurrentLookups < 1 || preference.maxConcurrentLookups > 3) failures.push("Rich lookup concurrency is missing or outside the maximum of 3");
  requireEqual(preference.measuredBaselineP95Ms?.preferredFirst, 385, "preferred-first measured baseline p95", failures);
  requireEqual(preference.measuredBaselineP95Ms?.bothRichComplete, 402, "both-Rich measured baseline p95", failures);
  const invalidation = report.selectionChangeStaleInvalidation || {};
  requireEqual(invalidation.status, "passed", "selection stale-response invalidation status", failures);
  requireEqual(invalidation.sampleCount, 10, "selection stale-response invalidation sample count", failures);
  requireEqual(invalidation.staleRequestsStartedPerSample, 2, "stale lookups started per selection-change sample", failures);
  requireEqual(invalidation.delayedStaleResponsesObservedPerSample, 2, "stale callbacks observed per selection-change sample", failures);
  requireEqual(invalidation.measuredBaselineP95Ms, 295, "stale-response invalidation measured baseline p95", failures);
  requireEqual(invalidation.derivedCeilingMs, 590, "stale-response invalidation ceiling", failures);
  if (!isFiniteNumber(invalidation.freshLookupDispatchMs?.p95NearestRank) || invalidation.freshLookupDispatchMs.p95NearestRank > 590 || invalidation.freshLookupDispatchMs.max > 590) failures.push("selection-change fresh dispatch exceeds its measured 590 ms ceiling");
  requireEqual(invalidation.staleResultsSuppressed, true, "late stale-result suppression", failures);
  if (!String(invalidation.note || "").includes("does not claim in-flight worker messages are cancelled")) failures.push("stale-response measurement must state it does not prove in-flight cancellation");
  requireEqual(report.providerCalls, 0, "Selection performance Provider calls", failures);
  requireEqual(report.externalRequests, 0, "Selection performance external requests", failures);
  return { status: failures.length === before ? "passed" : "failed", baselineMainSha: baseline.mainSha, preferredBaselineP95Ms: baseline.preferredP95Ms, bothRichBaselineP95Ms: baseline.bothRichP95Ms, preferredFirstP95Ms: preference.preferredFirstMs?.p95NearestRank ?? null, bothRichCompleteP95Ms: preference.bothRichCompleteMs?.p95NearestRank ?? null, staleInvalidationP95Ms: invalidation.freshLookupDispatchMs?.p95NearestRank ?? null, maxConcurrentLookups: preference.maxConcurrentLookups ?? null, providerCalls: report.providerCalls, externalRequests: report.externalRequests };
}

function certifyPreferredBaseline(baseline, failures) {
  const before = failures.length;
  if (!isObject(baseline) || baseline.report !== "dictionary-ecosystem-v2-preferred-lookup-baseline" || baseline.status !== "PASS") {
    failures.push("sanitized unchanged-main preferred lookup baseline record is missing or invalid");
    return { status: "missing", mainSha: null, preferredP95Ms: null, bothRichP95Ms: null };
  }
  requireEqual(baseline.recordId, PREFERRED_BASELINE_RECORD_ID, "preferred lookup baseline record identity", failures);
  requireEqual(baseline.sourceFile, "docs/DICTIONARY_ECOSYSTEM_V2_PREFERRED_BASELINE.json", "preferred lookup baseline source file", failures);
  requireEqual(baseline.mainSha, PREFERRED_BASELINE_SHA, "preferred lookup baseline main SHA", failures);
  requireEqual(baseline.startedAt, "2026-10-01T14:59:03.136Z", "preferred lookup baseline run start", failures);
  requireEqual(baseline.durationMs, 66181.578, "preferred lookup baseline run duration", failures);
  requireEqual(baseline.outcomes?.passed, 10, "preferred lookup baseline passing run count", failures);
  requireEqual(baseline.outcomes?.skipped, 0, "preferred lookup baseline skipped run count", failures);
  requireEqual(baseline.outcomes?.unexpected, 0, "preferred lookup baseline unexpected run count", failures);
  requireEqual(baseline.outcomes?.flaky, 0, "preferred lookup baseline flaky run count", failures);
  requireEqual(baseline.providerCalls, 0, "preferred lookup baseline Provider calls", failures);
  requireEqual(baseline.command, PREFERRED_BASELINE_COMMAND, "preferred lookup baseline exact run command", failures);
  requireEqual(baseline.case, PREFERRED_BASELINE_CASE, "preferred lookup baseline E2E identity", failures);
  requireEqual(baseline.workload?.fixtureProfile, "multi-dictionary-viewer-alpha-beta-one-entry-v1", "preferred lookup recorded fixture profile", failures);
  requireEqual(baseline.workload?.selectionQuery, "persistent", "preferred lookup recorded query", failures);
  requireEqual(baseline.workload?.entriesPerDictionary, 1, "preferred lookup recorded entry count", failures);
  requireEqual(baseline.workload?.encryptedKeyInfo, true, "preferred lookup recorded key-info encryption", failures);
  requireEqual(baseline.workload?.freshInstallPerSample, true, "preferred lookup baseline fresh installation state", failures);
  requireEqual(baseline.workload?.uniquePackIds, 20, "preferred lookup baseline unique installed pack count", failures);
  requireEqual(baseline.workload?.uniquePackVersions, 20, "preferred lookup baseline unique pack-version count", failures);
  requireEqual(baseline.workload?.harnessResetBeforeEach, true, "preferred lookup baseline harness reset state", failures);
  requireEqual(baseline.workload?.richLookupsPerSelection, 2, "preferred lookup baseline lookup count", failures);
  requireEqual(baseline.workload?.cacheStatePerSample, "harness reset clears extension storage and translation cache; each repeat installs fresh random-ID Alpha/Beta dictionaries before the first measured Selection lookup; same local Chromium process", "preferred lookup baseline cache state", failures);
  requireSameJson(baseline.samplesMs?.structuredPrimaryVisible, PREFERRED_BASELINE_SAMPLES.structuredPrimaryVisible, "preferred lookup baseline recorded structured-primary samples", failures);
  requireSameJson(baseline.samplesMs?.preferredRichVisible, PREFERRED_BASELINE_SAMPLES.preferredRichVisible, "preferred lookup baseline recorded preferred samples", failures);
  requireSameJson(baseline.samplesMs?.bothRichComplete, PREFERRED_BASELINE_SAMPLES.bothRichComplete, "preferred lookup baseline recorded completion samples", failures);
  compareSummaries(summarizeRecordedSamples(baseline.samplesMs?.structuredPrimaryVisible), baseline.summaryMs?.structuredPrimaryVisible, "structured-primary baseline samples", failures);
  const preferred = summarizeRecordedSamples(baseline.samplesMs?.preferredRichVisible);
  const both = summarizeRecordedSamples(baseline.samplesMs?.bothRichComplete);
  compareSummaries(preferred, baseline.summaryMs?.preferredRichVisible, "preferred lookup baseline samples", failures);
  compareSummaries(both, baseline.summaryMs?.bothRichComplete, "both-Rich baseline samples", failures);
  return { status: failures.length === before ? "passed" : "failed", mainSha: baseline.mainSha, preferredP95Ms: preferred?.p95NearestRank ?? null, bothRichP95Ms: both?.p95NearestRank ?? null };
}

function summarizeRecordedSamples(values) {
  if (!Array.isArray(values) || values.length !== 10 || values.some((value) => !isFiniteNumber(value) || value < 0)) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return {
    sampleCount: sorted.length,
    min: sorted[0],
    median: (sorted[4] + sorted[5]) / 2,
    p95NearestRank: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1)
  };
}

function compareSummaries(actual, expected, label, failures) {
  if (!actual || !isObject(expected)) {
    failures.push(`${label} must contain exactly 10 sanitized timing samples and a summary`);
    return;
  }
  for (const field of ["sampleCount", "min", "median", "p95NearestRank", "max"]) requireEqual(expected[field], actual[field], `${label} ${field}`, failures);
}

function requireSameJson(actual, expected, label, failures) {
  if (!sameJson(actual, expected)) failures.push(`${label}: recorded run results do not match the reviewed baseline`);
}

function certifyRichLookupCancellation(report, baseline, runnerSha256, failures) {
  const before = failures.length;
  if (!isObject(report) || report.status !== "PASS" || report.spec !== "e2e/selection-rich-lookup-cancel.spec.mjs" || report.test !== "Selection change cancels stale Rich lookups and preserves fresh results") {
    failures.push("required #224 in-flight Rich lookup cancellation report is missing or did not pass");
    return { status: isObject(report) ? "failed" : "missing" };
  }
  const baselineResult = certifyRichLookupCancellationBaseline(baseline, runnerSha256, failures);
  const latency = report.cancellationLatency || {};
  if (!Number.isSafeInteger(latency.sampleCount) || latency.sampleCount < 10) failures.push("#224 active range cancellation latency requires at least 10 samples");
  if (!Number.isSafeInteger(report.activeRangeCancellationSamples) || report.activeRangeCancellationSamples < 10) failures.push("#224 active range cancellation requires at least 10 direct range samples");
  for (const [field, value] of Object.entries({
    baselineP95Ms: latency.baselineP95Ms,
    p50Ms: latency.p50Ms,
    p95Ms: latency.p95Ms,
    maxMs: latency.maxMs,
    derivedCeilingMs: latency.derivedCeilingMs
  })) {
    if (!isFiniteNumber(value) || value < 0) failures.push(`#224 cancellation latency ${field} is missing or invalid`);
  }
  requireEqual(latency.baselineP95Ms, baselineResult.p95Ms, "#224 cancellation baseline p95", failures);
  requireEqual(latency.baselineSampleCount, CANCELLATION_BASELINE.sampleCount, "#224 cancellation baseline sample count", failures);
  requireEqual(latency.baselineMainSha, CANCELLATION_BASELINE.mainSha, "#224 cancellation baseline main SHA", failures);
  requireEqual(latency.baselineEvidenceFile, "rich-lookup-cancellation-baseline.json", "#224 cancellation baseline evidence filename", failures);
  requireEqual(latency.baselineLookupBlob, CANCELLATION_BASELINE.lookupBlob, "#224 cancellation baseline lookup blob", failures);
  requireEqual(latency.baselineRunnerSha256, baselineResult.runnerSha256, "#224 cancellation baseline runner SHA", failures);
  requireSameJson(latency.baselineWorkload, baseline?.workload, "#224 cancellation baseline workload", failures);
  requireEqual(latency.derivedCeilingMs, baselineResult.derivedCeilingMs, "#224 cancellation derived ceiling", failures);
  if (isFiniteNumber(latency.baselineP95Ms) && isFiniteNumber(latency.derivedCeilingMs) && Math.abs(latency.derivedCeilingMs - Math.ceil(latency.baselineP95Ms * 2)) > 0.001) {
    failures.push("#224 cancellation ceiling must be exactly 2× the measured baseline p95");
  }
  requireEqual(latency.ceilingPassed, true, "#224 measured cancellation ceiling result", failures);
  if (isFiniteNumber(latency.maxMs) && isFiniteNumber(latency.derivedCeilingMs) && latency.maxMs > latency.derivedCeilingMs) failures.push("#224 cancellation maximum exceeds the measured ceiling");
  if (isFiniteNumber(latency.p95Ms) && isFiniteNumber(latency.derivedCeilingMs) && latency.p95Ms > latency.derivedCeilingMs) failures.push("#224 cancellation p95 exceeds the measured ceiling");
  const routeLatency = report.routeCancellationLatency || {};
  const routeRecords = Array.isArray(routeLatency.samples) ? routeLatency.samples : [];
  const routeDurations = Array.isArray(routeLatency.samplesMs) ? routeLatency.samplesMs : [];
  const routeSummary = summarizeNearestRankSamples(routeDurations);
  requireEqual(routeLatency.trigger, "same-document-history", "#224 route cancellation trigger", failures);
  requireEqual(routeLatency.clock, "performance.now", "#224 route cancellation clock", failures);
  if (!Number.isSafeInteger(routeLatency.sampleCount) || routeLatency.sampleCount < 10) failures.push("#224 route cancellation requires at least 10 route-triggered samples");
  if (routeRecords.length !== routeLatency.sampleCount || routeDurations.length !== routeLatency.sampleCount || routeRecords.length < 10) {
    failures.push("#224 route cancellation requires at least 10 sample records and durations matching sampleCount");
  }
  const methodCounts = { pushState: 0, replaceState: 0 };
  for (const [index, sample] of routeRecords.entries()) {
    const label = `#224 route cancellation sample ${index + 1}`;
    if (sample?.method === "pushState" || sample?.method === "replaceState") methodCounts[sample.method] += 1;
    else failures.push(`${label} method must be pushState or replaceState`);
    const timestamps = [
      sample?.rangeReadStartedAtEpochMs,
      sample?.routeStartEpochMs,
      sample?.nativeCancelCompletedAtEpochMs,
      sample?.rangeStopEpochMs
    ];
    if (timestamps.some((value) => !isFiniteNumber(value) || value < 1_000_000_000_000)) {
      failures.push(`${label} must contain finite epoch-millisecond timestamps`);
    } else {
      const [rangeStarted, routeStarted, nativeCancelCompleted, rangeStopped] = timestamps;
      if (!(rangeStarted <= routeStarted && routeStarted < nativeCancelCompleted && nativeCancelCompleted < rangeStopped)) {
        failures.push(`${label} event order must be active range start, route start, completed native cancel, then final range stop`);
      }
      if (Math.abs((rangeStopped - routeStarted) - sample.durationMs) > 0.01) {
        failures.push(`${label} duration must equal route-start to final range-stop elapsed time`);
      }
    }
    requireEqual(sample?.endpoint, "opfs-readBlobRange-finally-after-native-cancel", `${label} endpoint`, failures);
    requireEqual(sample?.rangeReadActiveAtRoute, true, `${label} active range at route change`, failures);
    if (!isFiniteNumber(sample?.durationMs) || sample.durationMs < 0) failures.push(`${label} durationMs must be a finite non-negative number`);
    if (routeDurations[index] !== sample?.durationMs) failures.push(`${label} duration does not match its samplesMs vector entry`);
  }
  if (methodCounts.pushState < 5 || methodCounts.replaceState < 5) failures.push("#224 route cancellation requires at least five pushState and five replaceState samples");
  requireEqual(routeLatency.methodSampleCounts?.pushState, methodCounts.pushState, "#224 reported pushState sample count", failures);
  requireEqual(routeLatency.methodSampleCounts?.replaceState, methodCounts.replaceState, "#224 reported replaceState sample count", failures);
  if (!routeSummary || routeDurations.length !== routeLatency.sampleCount || routeDurations.length < 10) failures.push("#224 route cancellation requires at least 10 finite duration samples matching sampleCount");
  else {
    requireEqual(routeLatency.p50Ms, routeSummary.p50Ms, "#224 route cancellation p50", failures);
    requireEqual(routeLatency.p95Ms, routeSummary.p95Ms, "#224 route cancellation p95", failures);
    requireEqual(routeLatency.maxMs, routeSummary.maxMs, "#224 route cancellation maximum", failures);
  }
  requireEqual(routeLatency.baselineMetric, baseline?.metric, "#224 route cancellation baseline metric", failures);
  requireEqual(routeLatency.baselineInterpretation, "conservative-stop-latency-ceiling", "#224 route cancellation baseline interpretation", failures);
  requireEqual(routeLatency.baselineP95Ms, baselineResult.p95Ms, "#224 route cancellation baseline p95", failures);
  requireEqual(routeLatency.derivedCeilingMs, baselineResult.derivedCeilingMs, "#224 route cancellation derived ceiling", failures);
  requireEqual(routeLatency.ceilingPassed, true, "#224 route cancellation ceiling result", failures);
  if (isFiniteNumber(routeLatency.p95Ms) && isFiniteNumber(routeLatency.derivedCeilingMs) && routeLatency.p95Ms > routeLatency.derivedCeilingMs) failures.push("#224 route cancellation p95 exceeds its pinned baseline ceiling");
  if (isFiniteNumber(routeLatency.maxMs) && isFiniteNumber(routeLatency.derivedCeilingMs) && routeLatency.maxMs > routeLatency.derivedCeilingMs) failures.push("#224 route cancellation maximum exceeds its pinned baseline ceiling");
  if (!Number.isSafeInteger(report.cancelledLookupCount) || report.cancelledLookupCount < 1) failures.push("#224 cancelled lookup count is missing or zero");
  if (Number.isSafeInteger(routeLatency.sampleCount) && Number.isSafeInteger(report.cancelledLookupCount) && report.cancelledLookupCount < routeLatency.sampleCount) failures.push("#224 cancelled lookup count must cover every measured route sample");
  requireEqual(report.postCancelRangeReads, 0, "#224 post-cancel range reads", failures);
  requireEqual(report.postCancelBlockDecodes, 0, "#224 post-cancel block decode starts", failures);
  if (!Number.isSafeInteger(report.maxConcurrentLookups) || report.maxConcurrentLookups < 1 || report.maxConcurrentLookups > 3) failures.push("#224 lookup concurrency is missing or exceeds 3");
  requireEqual(report.lateStaleResultsRendered, 0, "#224 stale results rendered after selection change", failures);
  if (!Number.isSafeInteger(report.freshResultsRendered) || report.freshResultsRendered < 1) failures.push("#224 did not prove a fresh selection result was rendered");
  requireEqual(report.providerCalls, 0, "#224 Provider calls", failures);
  requireEqual(report.externalRequests, 0, "#224 external requests", failures);
  return { status: failures.length === before ? "passed" : "failed", activeRangeCancellationSamples: report.activeRangeCancellationSamples ?? null, sampleCount: latency.sampleCount ?? null, baselineEvidence: baselineResult, baselineSampleCount: latency.baselineSampleCount ?? null, baselineP95Ms: latency.baselineP95Ms ?? null, p50Ms: latency.p50Ms ?? null, p95Ms: latency.p95Ms ?? null, maxMs: latency.maxMs ?? null, derivedCeilingMs: latency.derivedCeilingMs ?? null, routeCancellationLatency: { trigger: routeLatency.trigger ?? null, clock: routeLatency.clock ?? null, sampleCount: routeLatency.sampleCount ?? null, pushStateSamples: methodCounts.pushState, replaceStateSamples: methodCounts.replaceState, endpoint: routeRecords[0]?.endpoint ?? null, baselineMetric: routeLatency.baselineMetric ?? null, baselineInterpretation: routeLatency.baselineInterpretation ?? null, p50Ms: routeLatency.p50Ms ?? null, p95Ms: routeLatency.p95Ms ?? null, maxMs: routeLatency.maxMs ?? null, derivedCeilingMs: routeLatency.derivedCeilingMs ?? null, ceilingPassed: routeLatency.ceilingPassed ?? null }, maxConcurrentLookups: report.maxConcurrentLookups ?? null, postCancelRangeReads: report.postCancelRangeReads ?? null, postCancelBlockDecodes: report.postCancelBlockDecodes ?? null, lateStaleResultsRendered: report.lateStaleResultsRendered ?? null, freshResultsRendered: report.freshResultsRendered ?? null, providerCalls: report.providerCalls ?? null, externalRequests: report.externalRequests ?? null };
}

function certifyRichLookupCancellationBaseline(baseline, actualRunnerSha256, failures) {
  const before = failures.length;
  if (!isObject(baseline) || baseline.status !== "PASS") {
    failures.push("required #224 pinned Rich lookup cancellation baseline evidence is missing or did not pass");
    return { status: "missing", mainSha: null, p95Ms: null, derivedCeilingMs: null, runnerSha256: null };
  }
  requireEqual(baseline.schemaVersion, 1, "#224 cancellation baseline schema version", failures);
  requireEqual(baseline.baselineMainSha, CANCELLATION_BASELINE.mainSha, "#224 cancellation baseline main SHA", failures);
  requireEqual(baseline.baselineLookupPath, CANCELLATION_BASELINE.lookupPath, "#224 cancellation baseline lookup path", failures);
  requireEqual(baseline.baselineLookupBlob, CANCELLATION_BASELINE.lookupBlob, "#224 cancellation baseline lookup blob", failures);
  requireEqual(baseline.baselineFixturePath, CANCELLATION_BASELINE.fixturePath, "#224 cancellation baseline fixture path", failures);
  requireEqual(baseline.baselineFixtureBlob, CANCELLATION_BASELINE.fixtureBlob, "#224 cancellation baseline fixture blob", failures);
  requireEqual(baseline.runnerPath, CANCELLATION_BASELINE.runnerPath, "#224 cancellation baseline runner path", failures);
  if (!/^[0-9a-f]{64}$/u.test(actualRunnerSha256 || "")) failures.push("#224 cancellation baseline runner source SHA-256 is missing or invalid");
  requireEqual(baseline.runnerSha256, actualRunnerSha256, "#224 cancellation baseline runner source SHA-256", failures);
  const expectedWorkload = {
    kind: CANCELLATION_BASELINE.workloadKind,
    gate: CANCELLATION_BASELINE.workloadGate,
    rangeGateDelayMs: CANCELLATION_BASELINE.rangeGateDelayMs,
    sampleCount: CANCELLATION_BASELINE.sampleCount
  };
  requireSameJson(baseline.workload, expectedWorkload, "#224 cancellation baseline workload contract", failures);
  if (baseline.metric !== "milliseconds from cancellation request to the final bounded source range read completing") failures.push("#224 cancellation baseline metric is not the pinned range-stop measurement");
  const summary = summarizeNearestRankSamples(baseline.rawSamplesMs);
  if (!summary || baseline.rawSamplesMs.length !== CANCELLATION_BASELINE.sampleCount) failures.push("#224 cancellation baseline requires 30 finite raw samples");
  else {
    requireEqual(baseline.summary?.p50Ms, summary.p50Ms, "#224 cancellation baseline p50", failures);
    requireEqual(baseline.summary?.p95Ms, summary.p95Ms, "#224 cancellation baseline p95", failures);
    requireEqual(baseline.summary?.maxMs, summary.maxMs, "#224 cancellation baseline max", failures);
    requireEqual(baseline.summary?.derivedCeilingMs, Math.ceil(summary.p95Ms * 2), "#224 cancellation baseline derived ceiling", failures);
  }
  return { status: failures.length === before ? "passed" : "failed", mainSha: baseline.baselineMainSha ?? null, lookupBlob: baseline.baselineLookupBlob ?? null, fixtureBlob: baseline.baselineFixtureBlob ?? null, runnerSha256: baseline.runnerSha256 ?? null, sampleCount: Array.isArray(baseline.rawSamplesMs) ? baseline.rawSamplesMs.length : null, p95Ms: summary?.p95Ms ?? null, derivedCeilingMs: summary ? Math.ceil(summary.p95Ms * 2) : null };
}

function summarizeNearestRankSamples(values) {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !isFiniteNumber(value) || value < 0)) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return {
    sampleCount: sorted.length,
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1)
  };
}

function certifyRichLookupCancellationUnitSuite(report, failures) {
  const before = failures.length;
  if (!isObject(report) || report.status !== "passed" || report.testFile !== "tests/rich-mdict-lookup-cancellation.test.mjs") {
    failures.push("required #224 manager/range/decode cancellation unit suite is missing or did not pass");
    return { status: isObject(report) ? "failed" : "missing" };
  }
  const observed = Array.isArray(report.passedTests) ? report.passedTests : [];
  for (const title of REQUIRED_CANCELLATION_UNIT_CASES) {
    if (observed.filter((item) => item === title).length !== 1) failures.push(`#224 unit evidence must pass exactly once: ${title}`);
  }
  return { status: failures.length === before ? "passed" : "failed", passedCaseCount: observed.length, requiredCaseCount: REQUIRED_CANCELLATION_UNIT_CASES.length };
}

function certifyBoundary(repositoryFiles, repositoryPayloads, packageFiles, failures) {
  const before = failures.length;
  const forbiddenPayload = /\.(?:mdx|mdd|zip)$/iu;
  if (!Array.isArray(repositoryFiles)) failures.push("repository file inventory is missing");
  else {
    const found = repositoryFiles.filter((path) => forbiddenPayload.test(path));
    const approvedPaths = Object.keys(ALLOWED_SYNTHETIC_REPOSITORY_FIXTURES);
    const unexpected = found.filter((path) => !Object.hasOwn(ALLOWED_SYNTHETIC_REPOSITORY_FIXTURES, path));
    if (unexpected.length) failures.push(`repository contains ${unexpected.length} unapproved raw dictionary/archive payload path(s)`);
    if (!Array.isArray(repositoryPayloads)) failures.push("repository synthetic fixture byte inventory is missing");
    for (const path of approvedPaths) {
      const expected = ALLOWED_SYNTHETIC_REPOSITORY_FIXTURES[path];
      const actual = repositoryPayloads.filter((item) => item?.path === path);
      if (actual.length !== 1) failures.push(`locked synthetic interoperability fixture must be byte-verified once: ${path}`);
      else {
        requireEqual(actual[0].bytes, expected.bytes, `locked synthetic fixture ${path} bytes`, failures);
        requireEqual(actual[0].sha256, expected.sha256, `locked synthetic fixture ${path} SHA-256`, failures);
      }
      if (found.filter((item) => item === path).length !== 1) failures.push(`locked synthetic interoperability fixture path is missing or duplicated: ${path}`);
    }
  }
  if (!Array.isArray(packageFiles) || packageFiles.length === 0) failures.push("production package inventory is missing");
  const packagePayloads = Array.isArray(packageFiles) ? packageFiles.filter((path) => forbiddenPayload.test(path)) : [];
  if (packagePayloads.length) failures.push(`production package contains ${packagePayloads.length} raw dictionary/archive payload path(s)`);
  const forbiddenPaths = Array.isArray(packageFiles) ? packageFiles.filter((path) => /^(?:tests|e2e|scripts|docs|\.github|lexicon|\.release-sources|node_modules|test-results|playwright-report)\//u.test(path)) : [];
  if (forbiddenPaths.length) failures.push(`production package contains ${forbiddenPaths.length} validation/research path(s)`);
  return { status: failures.length === before ? "passed" : "failed", repositoryUnapprovedPayloadCount: Array.isArray(repositoryFiles) ? repositoryFiles.filter((path) => forbiddenPayload.test(path) && !Object.hasOwn(ALLOWED_SYNTHETIC_REPOSITORY_FIXTURES, path)).length : null, approvedSyntheticFixtureCount: Array.isArray(repositoryPayloads) ? repositoryPayloads.length : null, packageFileCount: Array.isArray(packageFiles) ? packageFiles.length : null, packageRawPayloadCount: packagePayloads.length, packageForbiddenPathCount: forbiddenPaths.length };
}

function collectCases(report) {
  const output = [];
  const visit = (suites, inheritedFile = "") => {
    for (const suite of Array.isArray(suites) ? suites : []) {
      const file = normalizeFile(suite?.file || inheritedFile);
      for (const spec of Array.isArray(suite?.specs) ? suite.specs : []) {
        const specFile = normalizeFile(spec?.file || file);
        for (const test of Array.isArray(spec?.tests) ? spec.tests : []) {
          output.push({ file: specFile, title: String(spec?.title || test?.title || ""), expectedStatus: test?.expectedStatus, outcome: test?.status, results: Array.isArray(test?.results) ? test.results : [] });
        }
      }
      visit(suite?.suites, file);
    }
  };
  visit(report?.suites);
  return output;
}

function normalizeFile(file) {
  const normalized = String(file || "").replaceAll("\\", "/").replace(/^\.\//u, "");
  return normalized.includes("/") ? normalized : `e2e/${normalized}`;
}

function requireEqual(actual, expected, label, failures) {
  if (actual !== expected) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(path, failures, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    failures.push(`${label} is missing or invalid JSON: ${error?.message || error}`);
    return null;
  }
}

async function requireFresh(path, markerMs, failures, label) {
  try {
    const info = await stat(path);
    if (info.mtimeMs < markerMs - 1000) failures.push(`${label} predates the current certification run`);
  } catch (error) {
    failures.push(`${label} is missing: ${error?.message || error}`);
  }
}

async function listFiles(directory, base = directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(path, base));
    else if (entry.isFile()) result.push(relative(base, path).replaceAll("\\", "/"));
  }
  return result;
}

async function inspectReleasePackage() {
  const temporary = await mkdtemp(join(tmpdir(), "translateflow-ecosystem-v2-package-"));
  const destination = join(temporary, "extension");
  try {
    const built = await buildExtension({ outDir: destination, requireLexicon: true, allowExternalOutput: true });
    return { files: await listFiles(destination), totalBytes: built.totalBytes };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function getRepoFiles() {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: ROOT })
    .toString("utf8").split("\0").filter(Boolean).map((path) => path.replaceAll("\\", "/"));
}

async function getRepositoryPayloadMetadata(repositoryFiles) {
  const payloadPaths = repositoryFiles.filter((path) => /\.(?:mdx|mdd|zip)$/iu.test(path));
  const metadata = [];
  for (const path of payloadPaths) {
    const expected = ALLOWED_SYNTHETIC_REPOSITORY_FIXTURES[path];
    if (!expected) continue;
    try {
      const info = await stat(join(ROOT, path));
      if (info.size !== expected.bytes) {
        metadata.push({ path, bytes: info.size, sha256: null });
        continue;
      }
      const bytes = await readFile(join(ROOT, path));
      metadata.push({ path, bytes: bytes.byteLength, sha256: sha256(bytes) });
    } catch {
      // Missing/changed fixture is reported by the fail-closed boundary check.
    }
  }
  return metadata;
}

function parseArgs(argv) {
  const args = { evidenceDir: null, vnextReport: null, runMarker: null, baseSha: null, out: null };
  const supported = new Set(["--evidence-dir", "--vnext-report", "--run-marker", "--base-sha", "--out"]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!supported.has(key)) throw new Error(`unknown argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${key}`);
    if (key === "--evidence-dir") args.evidenceDir = resolve(value);
    else if (key === "--vnext-report") args.vnextReport = resolve(value);
    else if (key === "--run-marker") args.runMarker = resolve(value);
    else if (key === "--base-sha") args.baseSha = value;
    else if (key === "--out") args.out = resolve(value);
    index += 1;
  }
  for (const key of ["evidenceDir", "vnextReport", "runMarker", "baseSha"]) if (!args[key]) throw new Error(`--${key.replace(/[A-Z]/gu, (item) => `-${item.toLowerCase()}`)} is required`);
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const failures = [];
  const scope = await readJson(SCOPE_PATH, failures, "frozen scope manifest");
  const markerText = await readFile(args.runMarker, "utf8").catch((error) => {
    failures.push(`certification run marker is missing: ${error?.message || error}`);
    return "";
  });
  const markerMs = Number(markerText.trim());
  if (!Number.isFinite(markerMs) || markerMs <= 0) failures.push("certification run marker must contain the run start time in epoch milliseconds");
  verifyRunBaseSha(args.baseSha, failures);
  const evidencePaths = Object.fromEntries(Object.entries(EVIDENCE_FILES).map(([key, file]) => [key, join(args.evidenceDir, file)]));
  const vnextPath = args.vnextReport;
  for (const [key, path] of Object.entries({ ...evidencePaths, vnext: vnextPath })) await requireFresh(path, markerMs, failures, `current-run ${key} evidence`);
  const [vnextCertification, playwright, importReport, performanceReport, richLookupCancellation, richLookupCancellationBaseline, preferredBaseline] = await Promise.all([
    readJson(vnextPath, failures, "Dictionary Library vNext certification report"),
    readJson(evidencePaths.playwright, failures, "ecosystem Playwright report"),
    readJson(evidencePaths.import, failures, "ecosystem import report"),
    readJson(evidencePaths.performance, failures, "ecosystem performance report"),
    readJson(evidencePaths.richLookupCancellation, failures, "#224 Rich lookup cancellation report"),
    readJson(evidencePaths.richLookupCancellationBaseline, failures, "#224 pinned Rich lookup cancellation baseline"),
    readJson(PREFERRED_BASELINE_PATH, failures, "sanitized preferred lookup baseline record")
  ]);
  let richLookupCancellationRunnerSha256 = null;
  try {
    richLookupCancellationRunnerSha256 = sha256(await readFile(join(ROOT, CANCELLATION_BASELINE.runnerPath)));
  } catch (error) {
    failures.push(`#224 pinned cancellation baseline runner source is missing: ${error?.message || error}`);
  }
  const richLookupCancellationUnitSuite = runRichLookupCancellationUnitSuite(failures);
  let packageFiles = [];
  try {
    packageFiles = (await inspectReleasePackage()).files;
  } catch (error) {
    failures.push(`independent production package boundary build failed: ${error?.stack || error}`);
  }
  const repositoryFiles = getRepoFiles();
  const repositoryPayloads = await getRepositoryPayloadMetadata(repositoryFiles);
  const report = certifyDictionaryEcosystemV2({ scope, expectedBaseSha: args.baseSha, vnextCertification, playwright, importReport, performanceReport, preferredBaseline, richLookupCancellation, richLookupCancellationBaseline, richLookupCancellationRunnerSha256, richLookupCancellationUnitSuite, repositoryFiles, repositoryPayloads, packageFiles });
  report.failures.unshift(...failures);
  if (failures.length) report.status = "FAIL";
  const outputPath = args.out || join(args.evidenceDir, "dictionary-ecosystem-v2-certification.json");
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  const temporaryPath = outputPath + ".part";
  await rm(temporaryPath, { force: true });
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  await rename(temporaryPath, outputPath);
  process.stdout.write(`${JSON.stringify({ ...report, reportPath: outputPath }, null, 2)}\n`);
  if (report.status !== "PASS") process.exitCode = 1;
}

export function verifyRunBaseSha(baseSha, failures) {
  if (!/^[0-9a-f]{40}$/u.test(baseSha || "")) return;
  try {
    execFileSync("git", ["cat-file", "-e", `${baseSha}^{commit}`], { cwd: ROOT, stdio: "ignore" });
    execFileSync("git", ["merge-base", "--is-ancestor", baseSha, "HEAD"], { cwd: ROOT, stdio: "ignore" });
  } catch {
    failures.push("declared certification run base SHA is not an available ancestor of the checked-out source");
  }
}

function runRichLookupCancellationUnitSuite(failures) {
  const testFile = "tests/rich-mdict-lookup-cancellation.test.mjs";
  try {
    const output = execFileSync(process.execPath, ["--test", "--test-reporter=tap", testFile], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const passedTests = [...output.matchAll(/^ok\s+\d+\s+-\s+(.+)$/gmu)].map((match) => match[1]);
    const tests = Number(output.match(/^# tests (\d+)$/mu)?.[1] || 0);
    const pass = Number(output.match(/^# pass (\d+)$/mu)?.[1] || 0);
    const failed = Number(output.match(/^# fail (\d+)$/mu)?.[1] || 0);
    const skipped = Number(output.match(/^# skipped (\d+)$/mu)?.[1] || 0);
    const allRequiredPassed = REQUIRED_CANCELLATION_UNIT_CASES.every((title) => passedTests.filter((item) => item === title).length === 1);
    if (!allRequiredPassed || pass !== tests || failed !== 0 || skipped !== 0) failures.push("#224 manager/range/decode cancellation unit suite did not pass all required cases");
    return { status: allRequiredPassed && pass === tests && failed === 0 && skipped === 0 ? "passed" : "failed", testFile, passedTests, totalTests: tests, passedCount: pass, failedCount: failed, skippedCount: skipped };
  } catch {
    failures.push("#224 manager/range/decode cancellation unit suite could not run or failed");
    return { status: "failed", testFile, passedTests: [] };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
