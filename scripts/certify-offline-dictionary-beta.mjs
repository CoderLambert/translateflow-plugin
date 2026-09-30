#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const OFFLINE_DICTIONARY_BETA_E2E_CASES = Object.freeze([
  ["e2e/curated-ecdict-product.spec.mjs", "visible Settings install activates the locked upstream pack for Selection without Provider calls"],
  ["e2e/curated-ecdict-product.spec.mjs", "denied exact upstream permission stops before Worker download or import commit"],
  ["e2e/stardict-import-product.spec.mjs", "Settings import reaches Selection without Provider and uninstall removes lookup"],
  ["e2e/mdict-import-product.spec.mjs", "Settings MDX import activates Selection with zero Provider calls and remains uninstallable"],
  ["e2e/settings-ia.spec.mjs", "dictionary library separates trust classes and stays usable at narrow width"],
  ["e2e/dark-mode.spec.mjs", "Settings dark mode keeps navigation and primary action contrast"],
  ["e2e/ui-redesign.spec.mjs", "Settings keeps active navigation, bounded desktop content and a usable narrow layout"],
  ["e2e/ui-redesign.spec.mjs", "reduced-motion preference removes nonessential Quick Control transitions"],
  ["e2e/release-lexicon.spec.mjs", "production extension resolves the built Core and Technical packs without Provider calls"],
  ["e2e/translateflow.spec.mjs", "single-word lexical no-hit is neutral and provider-free until an explicit action"],
  ["e2e/selection-release-gate.spec.mjs", "technical Core/Technical competition stays local, attributable and Provider-free"],
  ["e2e/selection-release-gate.spec.mjs", "unknown multi-word phrase falls back to ordinary translation without lexical concatenation"],
  ["e2e/selection-release-gate.spec.mjs", "Selection remains readable in dark reduced-motion mode without page overflow"],
  ["e2e/selection-release-gate.spec.mjs", "long lexical card remains inside the viewport at every selection edge"],
  ["e2e/selection-release-gate.spec.mjs", "new Selection supersedes in-flight AI detail and outside click dismisses the current card"]
]);

const PRODUCT_E2E_FILES = Object.freeze([
  "e2e/curated-ecdict-product.spec.mjs",
  "e2e/stardict-import-product.spec.mjs",
  "e2e/mdict-import-product.spec.mjs"
]);

const AUTOMATIC_FALLBACK_POLICY =
  "local lexical certification does not add or authorize automatic Provider/AI fallback";
const RICH_DICTIONARY_POLICY = "high-coverage dictionaries remain downloadable/imported";

export function certifyOfflineDictionaryBeta({
  e2eReport,
  lexicalReport,
  footprintReport
} = {}) {
  const failures = [];
  const e2eCases = collectE2eCases(e2eReport, failures);
  const requiredResults = [];

  for (const [file, title] of OFFLINE_DICTIONARY_BETA_E2E_CASES) {
    const matches = e2eCases.filter((item) => item.file === file && item.title === title);
    if (matches.length !== 1) {
      failures.push(
        `required Chromium evidence must occur once: ${file} :: ${title} (found ${matches.length})`
      );
      requiredResults.push({ file, title, status: "missing" });
      continue;
    }
    const result = matches[0];
    const status = certifyPassedPlaywrightCase(result, failures);
    requiredResults.push({ file, title, status });
  }

  const productEvidence = [];
  for (const file of PRODUCT_E2E_FILES) {
    const cases = e2eCases.filter((item) => item.file === file);
    if (!cases.length) {
      failures.push(`product E2E report contains no executed specs for ${file}`);
      productEvidence.push({ file, testCount: 0, status: "missing" });
      continue;
    }
    const statuses = cases.map((item) => certifyPassedPlaywrightCase(item, failures));
    productEvidence.push({
      file,
      testCount: cases.length,
      status: statuses.every((status) => status === "passed") ? "passed" : "failed",
      tests: cases.map((item, index) => ({ title: item.title, status: statuses[index] }))
    });
  }

  const lexicalEvidence = certifyLexicalReport(lexicalReport, failures);
  const packageEvidence = certifyFootprintReport(footprintReport, failures);

  return {
    schemaVersion: 1,
    report: "offline-dictionary-library-beta-certification",
    status: failures.length ? "FAIL" : "PASS",
    scope: {
      ecdict: "curated-upstream",
      stardict: "user-imported-unverified",
      mdict: "user-imported-unverified-strict-mdx-v2",
      officialPacks: "none-claimed",
      automaticProviderOrAiFallback: false,
      newDictionarySources: false,
      parserOrStorageExpansion: false
    },
    evidence: {
      chromium: {
        report: "Playwright JSON reporter execution results",
        requiredCases: requiredResults,
        productFiles: productEvidence,
        stats: e2eReport?.stats || null
      },
      integratedLexical: lexicalEvidence,
      productionPackage: packageEvidence,
      unitSecurity: {
        requiredWorkflowPredecessor: "npm run validate",
        evidenceFiles: [
          "tests/dictionary-pack-manager.test.mjs",
          "tests/opfs-import-quarantine.test.mjs",
          "tests/curated-dictionary-recipes.test.mjs",
          "tests/ecdict-curated.test.mjs",
          "tests/stardict-import-controller.test.mjs",
          "tests/stardict-import-worker.test.mjs",
          "tests/stardict-import-poc.test.mjs",
          "tests/stardict-browser-dictzip.test.mjs",
          "tests/tflex-stardict-import.test.mjs",
          "tests/local-tflex-import.test.mjs",
          "tests/mdict-browser-import.test.mjs",
          "tests/mdict-import-poc.test.mjs",
          "tests/mdict-import-controller.test.mjs",
          "tests/tflex-mdict-import.test.mjs",
          "tests/integrated-lexical-certification.test.mjs",
          "tests/release-gate.test.mjs",
          "tests/release-lexicon-contract.test.mjs",
          "tests/ui-release-gate.test.mjs"
        ],
        status: "required-workflow-predecessor"
      }
    },
    failures
  };
}

function collectE2eCases(report, failures) {
  if (!isObject(report) || !Array.isArray(report.suites)) {
    failures.push("Playwright JSON execution report is missing suites");
    return [];
  }
  if (!isObject(report.stats) ||
      !["expected", "skipped", "unexpected", "flaky"].every((key) => Number.isSafeInteger(report.stats[key]))) {
    failures.push("Playwright JSON execution report is missing its execution outcome counts");
  } else if (report.stats.unexpected > 0) {
    failures.push(`Chromium E2E report contains ${report.stats.unexpected} unexpected test outcome(s)`);
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

function certifyPassedPlaywrightCase(test, failures) {
  if (test.expectedStatus !== "passed") {
    failures.push(`${test.file} :: ${test.title} has expected status ${String(test.expectedStatus)}`);
    return "failed";
  }
  if (test.outcome !== "expected") {
    failures.push(`${test.file} :: ${test.title} outcome is ${String(test.outcome)}, expected passed`);
    return test.outcome === "skipped" ? "skipped" : "failed";
  }
  if (!test.results.length || test.results.some((result) => result?.status !== "passed")) {
    failures.push(`${test.file} :: ${test.title} has a missing, skipped, failed, or retried attempt`);
    return "failed";
  }
  return "passed";
}

function certifyLexicalReport(report, failures) {
  if (!isObject(report) || report.schemaVersion !== 1 || report.report !== "integrated-selection-lexical-quality") {
    failures.push("integrated lexical certification report is missing or has an unsupported identity/schema");
    return { status: "missing" };
  }
  const failureCountBefore = failures.length;
  if (!Array.isArray(report.failures) || report.failures.length) {
    failures.push("integrated lexical certification contains failures or no failure list");
  }
  if (report.policy?.ai !== AUTOMATIC_FALLBACK_POLICY) {
    failures.push("integrated lexical policy no longer states that automatic Provider/AI fallback is unauthorized");
  }
  return {
    status: failures.length === failureCountBefore ? "passed" : "failed",
    observed: report.observed || null,
    failures: report.failures || []
  };
}

function certifyFootprintReport(report, failures) {
  if (!isObject(report) || report.schemaVersion !== 1 || report.report !== "production-extension-footprint-cost") {
    failures.push("production extension footprint report is missing or has an unsupported identity/schema");
    return { status: "missing" };
  }
  const failureCountBefore = failures.length;
  if (!Array.isArray(report.structuralFailures) || report.structuralFailures.length) {
    failures.push("production package audit contains structural failures or no failure list");
  }
  if (report.productionBehaviorChanged !== false) {
    failures.push("footprint evidence does not certify production-behavior-neutral measurement");
  }
  if (report.packageBoundary?.builder !== "scripts/build-extension.mjs" ||
      report.packageBoundary?.allowlistAudited !== true ||
      report.packageBoundary?.validationAssetsIncluded !== false) {
    failures.push("production package allowlist/data boundary is not certified");
  }

  const rawBudget = report.bundledPolicy?.rawLexiconBudgetBytes;
  const zipBudget = report.bundledPolicy?.zipDeflateProxyBudgetBytes;
  if (rawBudget !== 37_000_000 || zipBudget !== 4_000_000) {
    failures.push("bundled-size policy is missing or differs from the audited 37,000,000 B / 4,000,000 B ceilings");
  }
  if (report.bundledPolicy?.richDictionaryPolicy !== RICH_DICTIONARY_POLICY) {
    failures.push("bundled-size policy no longer keeps high-coverage dictionaries downloadable/imported");
  }
  requireAtMost(report.rawBytes?.lexical, rawBudget, "bundled lexical raw bytes", failures);
  requireEqual(report.rawBytes?.otherLexical, 0, "unexpected bundled lexical categories", failures);
  requireAtMost(report.zipDeflateProxy?.lexicalBytes, zipBudget, "bundled lexical ZIP/DEFLATE proxy bytes", failures);

  const files = report.files?.largest;
  if (!Number.isSafeInteger(report.files?.count) || report.files.count <= 0 || !Array.isArray(files)) {
    failures.push("production footprint report lacks its package file inventory summary");
  }

  return {
    status: failures.length === failureCountBefore ? "passed" : "failed",
    packageBoundary: report.packageBoundary,
    bundledPolicy: report.bundledPolicy,
    rawBytes: report.rawBytes,
    zipDeflateProxy: report.zipDeflateProxy,
    fileCount: report.files?.count,
    largestFiles: files || []
  };
}

function requireEqual(actual, expected, label, failures) {
  if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${String(actual)}`);
}

function requireAtMost(actual, maximum, label, failures) {
  if (typeof actual !== "number" || !Number.isFinite(actual) || actual > maximum) {
    failures.push(`${label}: expected <= ${String(maximum)}, got ${String(actual)}`);
  }
}

function normalizeFile(file) {
  const normalized = String(file || "").replaceAll("\\", "/").replace(/^\.\//, "");
  return normalized.includes("/") ? normalized : `e2e/${normalized}`;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(
        "usage: certify-offline-dictionary-beta.mjs " +
        "--e2e PATH --lexical PATH --footprint PATH [--out PATH]"
      );
    }
    result[key.slice(2)] = value;
    index += 1;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const key of ["e2e", "lexical", "footprint"]) {
    if (!args[key]) throw new Error(`--${key} is required`);
  }
  const [e2eReport, lexicalReport, footprintReport] = await Promise.all([
    readJson(args.e2e),
    readJson(args.lexical),
    readJson(args.footprint)
  ]);
  const report = certifyOfflineDictionaryBeta({ e2eReport, lexicalReport, footprintReport });
  const output = JSON.stringify(report, null, 2) + "\n";
  if (args.out) await writeFile(resolve(args.out), output);
  process.stdout.write(output);
  if (report.status !== "PASS") process.exitCode = 1;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
