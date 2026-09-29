import test from "node:test";
import assert from "node:assert/strict";
import {
  INTEGRATED_LEXICAL_BASELINE_V1,
  certifyIntegratedLexicalQuality
} from "../scripts/certify-integrated-lexical-quality.mjs";

function passingReports() {
  const baseline = INTEGRATED_LEXICAL_BASELINE_V1;
  return {
    qualityReport: {
      schemaVersion: 1,
      benchmarkVersion: baseline.benchmarkVersion,
      sourceRevision: baseline.sourceRevision,
      structuralFailures: [],
      releasePacks: [
        {
          packId: "core-semantic-en-zh",
          sources: [
            { id: "chinese-open-wordnet" },
            { id: "pwn-3.0" },
            { id: "pwn-3.0-sense-index" }
          ]
        },
        {
          packId: "technical-wikidata-en-zh",
          sources: [{ id: "wikidata" }]
        }
      ],
      cases: baseline.requiredCaseIds.map((id) => ({ id })),
      metrics: {
        exactHitRate: baseline.floors.exactHitRate,
        normalizedHitRate: baseline.floors.normalizedHitRate,
        lemmaMorphologyRecoveryRate: baseline.floors.lemmaMorphologyRecoveryRate,
        inflectionHitRate: baseline.floors.inflectionHitRate,
        phraseContextRecoveryRate: baseline.floors.phraseContextRecoveryRate,
        combinedHit: { rate: baseline.floors.combinedHitRate },
        top1CorrectRate: baseline.floors.top1CorrectRate,
        wrongSenseTop1Count: baseline.ceilings.wrongSenseTop1Count,
        trueNoHitRate: 1,
        contrastiveSafeTopRate: 1,
        contrastiveFailureCaseIds: []
      },
      performance: {
        coldReads: { reads: 6, bytes: 555984 },
        warmReadDelta: { reads: 0, bytes: 0 }
      },
      cache: {
        bytes: 2_100_000,
        maxBytes: 4_194_304
      }
    },
    bootstrapReport: {
      schemaVersion: 1,
      structuralFailures: [],
      profiles: [{
        id: "full",
        usageSamples: {
          commonWords: { hitRate: baseline.floors.commonWordHitRate },
          ordinaryBrowsing: { hitRate: baseline.floors.ordinaryBrowsingHitRate }
        }
      }]
    },
    footprintReport: {
      schemaVersion: 1,
      structuralFailures: [],
      packageBoundary: {
        allowlistAudited: true,
        validationAssetsIncluded: false
      },
      bundledPolicy: {
        rawLexiconBudgetBytes: 37_000_000,
        zipDeflateProxyBudgetBytes: 4_000_000,
        richDictionaryPolicy: "high-coverage dictionaries remain downloadable/imported"
      },
      rawBytes: {
        lexical: 36_830_492,
        otherLexical: 0
      },
      zipDeflateProxy: {
        lexicalBytes: 3_906_909
      },
      coldLookup: {
        warmReadDelta: { reads: 0, bytes: 0 },
        decodedCacheBytes: 2_100_111,
        decodedCacheBudgetBytes: 4_194_304
      }
    }
  };
}

test("integrated lexical certification accepts the audited cleaned baseline", () => {
  const reports = passingReports();
  const result = certifyIntegratedLexicalQuality(reports);

  assert.deepEqual(result.failures, []);
  assert.equal(result.baseline.commit, INTEGRATED_LEXICAL_BASELINE_V1.baselineCommit);
  assert.equal(
    result.observed.scenarioCount,
    INTEGRATED_LEXICAL_BASELINE_V1.requiredCaseIds.length
  );
  assert.equal(result.observed.trueNoHitRate, 1);
  assert.equal(result.observed.contrastiveSafeTopRate, 1);
});

test("integrated lexical certification fails closed on safety or required-scenario regression", () => {
  const reports = passingReports();
  reports.qualityReport.metrics.trueNoHitRate = 0.75;
  reports.qualityReport.metrics.contrastiveSafeTopRate = 0.9;
  reports.qualityReport.metrics.contrastiveFailureCaseIds = ["contrastive-state-government"];
  reports.qualityReport.cases = reports.qualityReport.cases.slice(1);

  const result = certifyIntegratedLexicalQuality(reports);
  assert.ok(result.failures.some((item) => item.includes("required lexical certification scenarios missing")));
  assert.ok(result.failures.some((item) => item.includes("true no-hit rate regression")));
  assert.ok(result.failures.some((item) => item.includes("contrastive safe-top rate regression")));
  assert.ok(result.failures.some((item) => item.includes("contrastive safety failures")));
});

test("integrated lexical certification freezes cleaned coverage floors without demanding hidden vocabulary", () => {
  const reports = passingReports();
  reports.qualityReport.metrics.combinedHit.rate -= 0.01;
  reports.qualityReport.metrics.inflectionHitRate -= 0.01;
  reports.qualityReport.metrics.wrongSenseTop1Count += 1;
  reports.bootstrapReport.profiles[0].usageSamples.commonWords.hitRate -= 0.01;
  reports.bootstrapReport.profiles[0].usageSamples.ordinaryBrowsing.hitRate -= 0.01;

  const result = certifyIntegratedLexicalQuality(reports);
  assert.ok(result.failures.some((item) => item.includes("combined expected-hit rate regression")));
  assert.ok(result.failures.some((item) => item.includes("inflection hit rate regression")));
  assert.ok(result.failures.some((item) => item.includes("wrong-sense top-1 count regression")));
  assert.ok(result.failures.some((item) => item.includes("source-derived common-word hit rate regression")));
  assert.ok(result.failures.some((item) => item.includes("ordinary-browsing hit rate regression")));
});

test("integrated lexical certification rejects bundled provenance and package-boundary drift", () => {
  const reports = passingReports();
  reports.qualityReport.releasePacks[1].sources.push({
    id: "translateflow-reviewed-technical-terms"
  });
  reports.footprintReport.packageBoundary.validationAssetsIncluded = true;
  reports.footprintReport.rawBytes.otherLexical = 100;
  reports.footprintReport.rawBytes.lexical = 37_000_001;
  reports.footprintReport.zipDeflateProxy.lexicalBytes = 4_000_001;
  reports.footprintReport.coldLookup.warmReadDelta.bytes = 1;
  reports.footprintReport.coldLookup.decodedCacheBytes = 4_194_305;

  const result = certifyIntegratedLexicalQuality(reports);
  assert.ok(result.failures.some((item) => item.includes("bundled Technical source provenance drift")));
  assert.ok(result.failures.some((item) => item.includes("project-authored reviewed terminology")));
  assert.ok(result.failures.some((item) => item.includes("validation/source/build assets")));
  assert.ok(result.failures.some((item) => item.includes("unexpected bundled lexical pack category")));
  assert.ok(result.failures.some((item) => item.includes("bundled lexical raw bytes regression")));
  assert.ok(result.failures.some((item) => item.includes("ZIP/deflate proxy bytes regression")));
  assert.ok(result.failures.some((item) => item.includes("footprint warm reread bytes regression")));
  assert.ok(result.failures.some((item) => item.includes("footprint decoded cache exceeds configured budget")));
});
