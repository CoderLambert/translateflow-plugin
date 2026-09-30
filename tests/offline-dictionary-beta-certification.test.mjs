import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFLINE_DICTIONARY_BETA_E2E_CASES,
  certifyOfflineDictionaryBeta
} from "../scripts/certify-offline-dictionary-beta.mjs";

function passingReports() {
  const files = new Map();
  for (const [file, title] of OFFLINE_DICTIONARY_BETA_E2E_CASES) {
    if (!files.has(file)) files.set(file, []);
    files.get(file).push({
      title,
      file: file.split("/").at(-1),
      ok: true,
      tests: [{
        expectedStatus: "passed",
        status: "expected",
        results: [{ status: "passed", retry: 0 }]
      }]
    });
  }
  return {
    e2eReport: {
      suites: [...files].map(([file, specs]) => ({
        file: file.split("/").at(-1),
        title: file.split("/").at(-1),
        specs: specs.map((spec) => ({ ...spec, file: file.split("/").at(-1) }))
      })),
      stats: { expected: OFFLINE_DICTIONARY_BETA_E2E_CASES.length, skipped: 0, unexpected: 0, flaky: 0 }
    },
    lexicalReport: {
      schemaVersion: 1,
      report: "integrated-selection-lexical-quality",
      failures: [],
      observed: { scenarioCount: 77 },
      policy: {
        ai: "local lexical certification does not add or authorize automatic Provider/AI fallback"
      }
    },
    footprintReport: {
      schemaVersion: 1,
      report: "production-extension-footprint-cost",
      productionBehaviorChanged: false,
      packageBoundary: {
        builder: "scripts/build-extension.mjs",
        allowlistAudited: true,
        validationAssetsIncluded: false
      },
      bundledPolicy: {
        rawLexiconBudgetBytes: 37_000_000,
        zipDeflateProxyBudgetBytes: 4_000_000,
        richDictionaryPolicy: "high-coverage dictionaries remain downloadable/imported"
      },
      rawBytes: { lexical: 36_830_492, otherLexical: 0 },
      zipDeflateProxy: { lexicalBytes: 3_906_909, otherLexicalBytes: 22 },
      files: { count: 80, largest: [{ path: "assets/lexicon/core/index.tfx", bytes: 123 }] },
      structuralFailures: []
    }
  };
}

test("integrated Beta certification accepts real, passed product and release evidence", () => {
  const report = certifyOfflineDictionaryBeta(passingReports());
  assert.equal(report.status, "PASS");
  assert.equal(report.scope.officialPacks, "none-claimed");
  assert.equal(report.evidence.chromium.requiredCases.length, OFFLINE_DICTIONARY_BETA_E2E_CASES.length);
  assert.ok(report.evidence.chromium.productFiles.every((entry) => entry.status === "passed"));
  assert.equal(report.evidence.productionPackage.bundledPolicy.rawLexiconBudgetBytes, 37_000_000);
});

test("integrated Beta certification fails closed when a required product test is skipped", () => {
  const reports = passingReports();
  const required = OFFLINE_DICTIONARY_BETA_E2E_CASES.find(([, title]) => title.includes("permission stops"));
  const spec = reports.e2eReport.suites
    .flatMap((suite) => suite.specs)
    .find((item) => item.file === required[0].split("/").at(-1) && item.title === required[1]);
  spec.tests[0] = { expectedStatus: "passed", status: "skipped", results: [] };

  const report = certifyOfflineDictionaryBeta(reports);
  assert.equal(report.status, "FAIL");
  assert.ok(report.failures.some((failure) => failure.includes("permission stops")));
});

test("integrated Beta certification rejects missing Official-state evidence and policy drift", () => {
  const reports = passingReports();
  reports.e2eReport.suites = reports.e2eReport.suites.filter(
    (suite) => suite.file !== "release-lexicon.spec.mjs"
  );
  reports.lexicalReport.policy.ai = "automatic Provider fallback enabled";
  reports.footprintReport.bundledPolicy.rawLexiconBudgetBytes = 38_000_000;
  reports.footprintReport.rawBytes.otherLexical = 1;

  const report = certifyOfflineDictionaryBeta(reports);
  assert.equal(report.status, "FAIL");
  assert.ok(report.failures.some((failure) => failure.includes("release-lexicon.spec.mjs")));
  assert.equal(report.evidence.integratedLexical.status, "failed");
  assert.ok(report.failures.some((failure) => failure.includes("37,000,000 B / 4,000,000 B")));
  assert.ok(report.failures.some((failure) => failure.includes("unexpected bundled lexical categories")));
  assert.equal(report.evidence.productionPackage.status, "failed");
});

test("integrated Beta certification rejects retried product tests and an uncertified package boundary", () => {
  const reports = passingReports();
  const product = reports.e2eReport.suites.find((suite) => suite.file === "mdict-import-product.spec.mjs");
  product.specs[0].tests[0] = {
    expectedStatus: "passed",
    status: "flaky",
    results: [{ status: "failed", retry: 0 }, { status: "passed", retry: 1 }]
  };
  reports.footprintReport.packageBoundary.validationAssetsIncluded = true;

  const report = certifyOfflineDictionaryBeta(reports);
  assert.equal(report.status, "FAIL");
  assert.ok(report.failures.some((failure) => failure.includes("outcome is flaky")));
  assert.ok(report.failures.some((failure) => failure.includes("package allowlist/data boundary")));
});
