import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProjectionStats,
  projectKaikkiEntry,
  validateProjectedKaikkiEntry
} from "../scripts/project-kaikki-rich.mjs";
import { stableStringify } from "../scripts/build-tflex-core.mjs";
import {
  auditWiktextractProjectionCompatibility
} from "../scripts/audit-wiktextract-projection-compatibility.mjs";

const sourceLockUrl = new URL(
  "../lexicon/source-locks/wikimedia-enwiktionary-2026-09-01.json",
  import.meta.url
);

function pinnedWordData() {
  // Mirrors English WordData/TranslationData/SenseData from pinned Wiktextract
  // 1a05e46f9efbccda6a2b2f8e21b30a9c0c46513a:
  // translations are top-level WordData rows with optional free-text `sense`;
  // SenseData has glosses and tags, but no translation array or stable join id.
  return {
    word: "projection-fixture-entry",
    lang: "English",
    lang_code: "en",
    pos: "noun",
    translations: [
      {
        lang_code: "cmn",
        lang: "Chinese Mandarin",
        word: "projection-fixture-translation-a",
        sense: "first free-text sense label"
      },
      {
        lang_code: "zh",
        lang: "Chinese",
        word: "projection-fixture-translation-b"
      }
    ],
    senses: [
      { glosses: ["fixture definition one"], tags: ["countable"] },
      { glosses: ["fixture definition two"] }
    ]
  };
}

test("pinned Wiktextract top-level translations are counted and skipped without guessed sense joins", () => {
  const stats = createProjectionStats();
  const entry = pinnedWordData();

  assert.ok(entry.translations.every((translation) => typeof translation.sense === "string" || !("sense" in translation)));
  assert.ok(entry.senses.every((sense) => !("translations" in sense)));
  assert.equal(projectKaikkiEntry(entry, { lineNumber: 41, stats }), null);
  assert.deepEqual(stats, {
    inputEntries: 0,
    englishEntries: 1,
    projectedEntries: 0,
    projectedSenses: 0,
    projectedTranslations: 0,
    ignoredEntryLevelChineseTranslations: 2,
    skippedNonEnglishEntries: 0,
    skippedInvalidHeadwordEntries: 0,
    skippedWithoutSenseLevelChinese: 1
  });
});

test("current v1 projection is deterministic and retains only allowlisted nested sense data", () => {
  const source = {
    word: "projection-fixture-word",
    lang_code: "en",
    pos: "noun",
    forms: [
      { form: "z-form", tags: ["plural", "rare"] },
      { form: "a-form", tags: ["plural"] },
      { form: "a-form", tags: ["plural"] }
    ],
    sounds: [
      { ipa: "/z/", tags: ["UK"] },
      { ipa: "/a/", tags: ["US"] }
    ],
    translations: [
      { lang_code: "cmn", word: "entry-level fixture only", sense: "unjoined" }
    ],
    senses: [
      { glosses: ["definition without a Chinese source translation"] },
      {
        glosses: ["fixture definition with source-bound translation"],
        tags: ["figurative", "common"],
        topics: ["example-topic"],
        translations: [
          { lang_code: "cmn", word: "fixture 乙", roman: "yi", tags: ["second"] },
          { lang_code: "cmn", word: "fixture 甲", roman: "jia", tags: ["first"] },
          { lang_code: "cmn", word: "fixture 甲", roman: "jia", tags: ["first"] }
        ],
        examples: [{ text: "not retained" }]
      }
    ],
    examples: [{ text: "not retained" }],
    etymology_text: "not retained"
  };

  const first = projectKaikkiEntry(structuredClone(source), { lineNumber: 12 });
  const second = projectKaikkiEntry(structuredClone(source), { lineNumber: 12 });

  assert.ok(first);
  assert.equal(stableStringify(first), stableStringify(second));
  assert.deepEqual(first.forms.map((form) => form.form), ["a-form", "z-form"]);
  assert.deepEqual(first.pronunciations.map((sound) => sound.ipa), ["/a/", "/z/"]);
  assert.deepEqual(first.senses.map((sense) => sense.sourceSenseIndex), [2]);
  assert.deepEqual(first.senses.map((sense) => sense.sourceRef), ["line:12:sense:2"]);
  assert.deepEqual(first.senses[0].translations.map((translation) => translation.sourceText), [
    "fixture 乙", "fixture 甲"
  ].sort());
  assert.equal(JSON.stringify(first).includes("entry-level fixture"), false);
  assert.equal(JSON.stringify(first).includes("not retained"), false);
  assert.equal(validateProjectedKaikkiEntry(first), first);
});

test("provenance keeps original source sense positions when untranslated senses are skipped", () => {
  const source = {
    word: "projection-provenance-fixture",
    lang_code: "en",
    senses: [
      { glosses: ["first definition without Chinese"] },
      {
        glosses: ["second definition with Chinese"],
        translations: [{ lang_code: "cmn", word: "fixture translation two" }]
      },
      { glosses: ["third definition without Chinese"] },
      {
        glosses: ["fourth definition with Chinese"],
        translations: [{ lang_code: "zh", word: "fixture translation four" }]
      }
    ]
  };

  const projected = projectKaikkiEntry(source, { lineNumber: 87 });

  assert.deepEqual(projected.senses.map((sense) => sense.sourceSenseIndex), [2, 4]);
  assert.deepEqual(projected.senses.map((sense) => sense.sourceRef), [
    "line:87:sense:2", "line:87:sense:4"
  ]);
  assert.deepEqual(projected.senses.map((sense) => sense.glosses[0]), [
    "second definition with Chinese", "fourth definition with Chinese"
  ]);
});

test("malformed current-contract translation structures are rejected explicitly", () => {
  const nonArray = pinnedWordData();
  nonArray.senses = [{ glosses: ["fixture"], translations: { lang_code: "cmn", word: "fixture" } }];
  assert.throws(
    () => projectKaikkiEntry(nonArray, { lineNumber: 1 }),
    /sense translations.*must be an array/
  );

  const badItem = pinnedWordData();
  badItem.senses = [{ glosses: ["fixture"], translations: [null] }];
  assert.throws(
    () => projectKaikkiEntry(badItem, { lineNumber: 2 }),
    /sense translations.*item must be an object/
  );

  const badSense = pinnedWordData();
  badSense.senses = [null];
  assert.throws(
    () => projectKaikkiEntry(badSense, { lineNumber: 3 }),
    /Kaikki sense must be an object/
  );
});

test("hostile retained source strings fail closed rather than being sanitized", () => {
  for (const [field, value, expected] of [
    ["word", "<img src=x onerror=alert(1)>", /HTML-like markup/],
    ["gloss", "javascript:alert(1)", /executable\/renderable scheme/],
    ["translation", "<script>run()</script>", /HTML-like markup/]
  ]) {
    const source = {
      word: "projection-hostile-fixture",
      lang_code: "en",
      senses: [{
        glosses: ["safe fixture gloss"],
        translations: [{ lang_code: "cmn", word: "safe fixture translation" }]
      }]
    };
    if (field === "word") source.word = value;
    if (field === "gloss") source.senses[0].glosses = [value];
    if (field === "translation") source.senses[0].translations[0].word = value;
    assert.throws(() => projectKaikkiEntry(source, { lineNumber: 9 }), expected, field);
  }
});

test("full-source compatibility audit validates evidence before parsing and reports empty current-v1 output", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "translateflow-wiktextract-compat-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, "full-en.jsonl");
  const evidencePath = join(directory, "full-en-evidence.json");
  const lock = JSON.parse(await readFile(sourceLockUrl, "utf8"));
  const validationEntry = pinnedWordData();
  validationEntry.word = "state";
  const inputText = JSON.stringify(validationEntry) + "\n";
  await writeFile(inputPath, inputText, "utf8");
  await writeFile(evidencePath, JSON.stringify(extractionEvidence(lock, inputText)));

  const report = await auditWiktextractProjectionCompatibility({
    inputPath,
    evidencePath,
    sourceLockPath: sourceLockUrl.pathname
  });

  assert.equal(report.kind, "wiktextract-rich-projection-compatibility-dry-run");
  assert.equal(report.productQualityClaim, false);
  assert.ok(Buffer.byteLength(JSON.stringify(report, null, 2) + "\n", "utf8") <= 8192);
  assert.deepEqual(report.sourceShape, {
    inputEnglish: 1,
    englishEntriesWithEntryTranslations: 1,
    entryTranslationRows: 2,
    entryZhCmnRows: 2,
    entryZhCmnRowsWithSenseLabel: 1,
    entryZhCmnRowsWithoutSenseLabel: 1,
    nestedSenseTranslationRows: 0,
    englishEntriesWithNestedTranslations: 0,
    definitionSenseCount: 2,
    definitionSensesWithZhCmnTranslations: 0
  });
  assert.equal(report.currentV1ProjectionDryRun.projectedEntries, 0);
  assert.equal(report.currentV1ProjectionDryRun.projectedSenses, 0);
  assert.equal(report.currentV1ProjectionDryRun.projectedTranslations, 0);
  assert.equal(report.currentV1ProjectionDryRun.skippedWithoutSenseLevelChinese, 1);
  assert.equal(report.currentV1ProjectionDryRun.outputBytes, 0);
  assert.equal(
    report.currentV1ProjectionDryRun.outputSha256,
    createHash("sha256").update(Buffer.alloc(0)).digest("hex")
  );
  const stateValidation = report.requiredHeadwordValidationOnly.words.find(
    (item) => item.word === "state"
  );
  assert.deepEqual(stateValidation, {
    word: "state",
    sourceEnglishEntries: 1,
    entryZhCmnRows: 2,
    nestedZhCmnRows: 0,
    currentV1ProjectedEntries: 0,
    currentV1ProjectedSenses: 0,
    currentV1ProjectedTranslations: 0
  });
  assert.equal(JSON.stringify(report).includes("projection-fixture-translation-a"), false);
});

test("full-source dry run preserves partial extractor status and page-failure counts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "translateflow-wiktextract-partial-evidence-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, "full-en.jsonl");
  const evidencePath = join(directory, "full-en-evidence.json");
  const lock = JSON.parse(await readFile(sourceLockUrl, "utf8"));
  const inputText = JSON.stringify(pinnedWordData()) + "\n";
  await writeFile(inputPath, inputText, "utf8");
  await writeFile(evidencePath, JSON.stringify(extractionEvidence(lock, inputText, {
    pageHandlerExceptionRecords: 3
  })));

  const report = await auditWiktextractProjectionCompatibility({
    inputPath,
    evidencePath,
    sourceLockPath: sourceLockUrl.pathname
  });

  assert.equal(report.kind, "wiktextract-rich-projection-compatibility-dry-run");
  assert.equal(report.productQualityClaim, false);
  assert.deepEqual(report.extractionEvidenceStatus, {
    status: "completed-with-page-failures",
    pageHandlerExceptionRecords: 3,
    pageHandlerExceptionLogMarkers: 0,
    pageHandlerExceptionEventsLowerBound: 3,
    diagnosticArrays: {
      errors: { records: 3, mayBeTruncated: false },
      warnings: { records: 0, mayBeTruncated: false },
      debugs: { records: 0, mayBeTruncated: false },
      notes: { records: 0, mayBeTruncated: false },
      wiki_notices: { records: 0, mayBeTruncated: false }
    }
  });
  assert.equal(report.input.englishRecords, 1);
  assert.equal(report.input.missingLanguageCodeRecords, 0);
});

test("full-source dry run rejects page-handler failures mislabeled as complete", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "translateflow-wiktextract-failure-status-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, "full-en.jsonl");
  const evidencePath = join(directory, "full-en-evidence.json");
  const lock = JSON.parse(await readFile(sourceLockUrl, "utf8"));
  const inputText = JSON.stringify(pinnedWordData()) + "\n";
  const evidence = extractionEvidence(lock, inputText, { pageHandlerExceptionRecords: 1 });
  evidence.extractionStatus = "completed-without-observed-page-handler-failures";
  await writeFile(inputPath, inputText, "utf8");
  await writeFile(evidencePath, JSON.stringify(evidence));

  await assert.rejects(
    auditWiktextractProjectionCompatibility({
      inputPath,
      evidencePath,
      sourceLockPath: sourceLockUrl.pathname
    }),
    /extraction status does not match page failure diagnostics/
  );
});

test("full-source compatibility audit counts malformed and hostile rows and continues", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "translateflow-wiktextract-failures-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, "full-en.jsonl");
  const evidencePath = join(directory, "full-en-evidence.json");
  const lock = JSON.parse(await readFile(sourceLockUrl, "utf8"));
  const hostile = {
    word: "projection-hostile-fixture",
    lang_code: "en",
    senses: [{
      glosses: ["safe fixture gloss"],
      translations: [{ lang_code: "cmn", word: "<script>unsafe()</script>" }]
    }]
  };
  const inputText = [
    JSON.stringify(pinnedWordData()),
    JSON.stringify(hostile),
    "{malformed-json",
    JSON.stringify(pinnedWordData())
  ].join("\n") + "\n";
  await writeFile(inputPath, inputText, "utf8");
  await writeFile(evidencePath, JSON.stringify(extractionEvidence(lock, inputText)));

  const report = await auditWiktextractProjectionCompatibility({
    inputPath,
    evidencePath,
    sourceLockPath: sourceLockUrl.pathname
  });

  assert.equal(report.sourceShape.inputEnglish, 3);
  assert.equal(report.currentV1ProjectionDryRun.skippedWithoutSenseLevelChinese, 2);
  assert.equal(report.currentV1ProjectionDryRun.failures.malformedJsonRows, 1);
  assert.equal(report.currentV1ProjectionDryRun.failures.hostileProjectionFailures, 1);
  assert.equal(report.currentV1ProjectionDryRun.failures.malformedProjectionFailures, 0);
  assert.equal(report.currentV1ProjectionDryRun.projectedEntries, 0);
  assert.equal(report.currentV1ProjectionDryRun.outputBytes, 0);
});

test("full-source compatibility audit rejects JSONL byte drift before parsing any row", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "translateflow-wiktextract-evidence-drift-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, "full-en.jsonl");
  const evidencePath = join(directory, "full-en-evidence.json");
  const lock = JSON.parse(await readFile(sourceLockUrl, "utf8"));
  const inputText = "{malformed-json\n";
  const evidence = extractionEvidence(lock, inputText);
  evidence.extraction.outputSha256 = "0".repeat(64);
  await writeFile(inputPath, inputText, "utf8");
  await writeFile(evidencePath, JSON.stringify(evidence));

  await assert.rejects(
    auditWiktextractProjectionCompatibility({
      inputPath,
      evidencePath,
      sourceLockPath: sourceLockUrl.pathname
    }),
    /SHA-256 does not match extraction evidence/
  );
});

test("full-source compatibility audit rejects source, revision, and byte evidence before parsing", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "translateflow-wiktextract-identity-drift-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, "full-en.jsonl");
  const evidencePath = join(directory, "full-en-evidence.json");
  const lock = JSON.parse(await readFile(sourceLockUrl, "utf8"));
  const inputText = "{malformed-json\n";
  const baseline = extractionEvidence(lock, inputText);
  await writeFile(inputPath, inputText, "utf8");

  const cases = [
    ["source", (evidence) => { evidence.source.sha256 = "0".repeat(64); }, /source does not match Wikimedia lock/],
    ["revision", (evidence) => { evidence.extractor.wiktextractCommit = "0".repeat(40); }, /revisions are incompatible/],
    ["bytes", (evidence) => { evidence.extraction.outputBytes += 1; }, /byte size does not match extraction evidence/]
  ];
  for (const [name, mutate, expected] of cases) {
    const evidence = structuredClone(baseline);
    mutate(evidence);
    await writeFile(evidencePath, JSON.stringify(evidence));
    await assert.rejects(
      auditWiktextractProjectionCompatibility({
        inputPath,
        evidencePath,
        sourceLockPath: sourceLockUrl.pathname
      }),
      (error) => {
        assert.match(error.message, expected, name);
        assert.doesNotMatch(error.message, /malformed|JSONL record/u, name);
        return true;
      }
    );
  }
});

function extractionEvidence(lock, inputText, {
  pageHandlerExceptionRecords = 0,
  pageHandlerExceptionLogMarkers = 0
} = {}) {
  const input = Buffer.from(inputText, "utf8");
  const lines = inputText.split(/\r?\n/u).filter((line) => line.trim());
  const rows = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {
      // A few identity-before-parse tests intentionally provide malformed JSON.
    }
  }
  const langCodeRecordCounts = {
    // Keep synthetic evidence structurally valid for tests that verify the
    // source/hash/revision gates run before malformed JSON is inspected.
    en: Math.max(1, rows.filter((row) => row.lang_code === "en").length),
    missing: rows.filter((row) => !("lang_code" in row)).length,
    other: rows.filter((row) => "lang_code" in row && row.lang_code !== "en").length
  };
  return {
    schemaVersion: 1,
    source: {
      sourceId: lock.sourceId,
      sha256: lock.artifact.sha256,
      sizeBytes: lock.artifact.sizeBytes
    },
    extractor: {
      wiktextractCommit: lock.extractor.wiktextractCommit,
      wikitextprocessorCommit: lock.extractor.wikitextprocessorCommit
    },
    parserDb: {
      bytes: 123456,
      namespacePageCounts: { main: 10, template: 3, module: 2 }
    },
    extraction: {
      languageCode: "en",
      translations: true,
      pronunciations: true,
      outputSha256: createHash("sha256").update(input).digest("hex"),
      outputBytes: input.byteLength,
      recordCount: lines.length,
      langCodeRecordCounts
    },
    extractionStatus: pageHandlerExceptionRecords > 0 || pageHandlerExceptionLogMarkers > 0
      ? "completed-with-page-failures"
      : "completed-without-observed-page-handler-failures",
    diagnostics: {
      pageHandlerExceptionRecords,
      pageHandlerExceptionLogMarkers,
      pageHandlerExceptionEventsLowerBound: Math.max(
        pageHandlerExceptionRecords,
        pageHandlerExceptionLogMarkers
      ),
      arrays: Object.fromEntries(
        ["errors", "warnings", "debugs", "notes", "wiki_notices"].map((name) => [
          name,
          {
            records: name === "errors" ? pageHandlerExceptionRecords : 0,
            mayBeTruncated: false
          }
        ])
      )
    }
  };
}
