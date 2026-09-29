import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProjectionStats,
  projectKaikkiEntry,
  projectKaikkiSource,
  validateProjectedKaikkiEntry
} from "../scripts/project-kaikki-rich.mjs";
import { deriveKaikkiSourceLock } from "../scripts/lock-kaikki-source.mjs";

const candidateUrl = new URL(
  "../lexicon/source-candidates/kaikki-enwiktionary-2026-09-25.json",
  import.meta.url
);

async function candidate() {
  return JSON.parse(await readFile(candidateUrl, "utf8"));
}

function sourceEntry({
  word = "harbor",
  langCode = "en"
} = {}) {
  return {
    word,
    lang: langCode === "en" ? "English" : "French",
    lang_code: langCode,
    pos: "noun",
    forms: [
      { form: "harbors", tags: ["plural"] },
      { form: "-", tags: ["comparative"] }
    ],
    sounds: [
      { ipa: "/ˈhɑːrbər/", tags: ["US"] },
      {
        audio: "en-us-harbor.ogg",
        mp3_url: "https://upload.wikimedia.org/example.mp3",
        tags: ["US"]
      }
    ],
    translations: [
      {
        lang_code: "cmn",
        lang: "Chinese Mandarin",
        word: "港口",
        sense: "entry-level unresolved"
      }
    ],
    senses: [
      {
        glosses: ["A sheltered area of water where ships may anchor."],
        tags: ["countable"],
        topics: ["nautical"],
        translations: [
          {
            lang_code: "cmn",
            lang: "Chinese Mandarin",
            word: "港口",
            roman: "gǎngkǒu",
            tags: ["standard"],
            topics: ["nautical"]
          },
          {
            lang_code: "yue",
            lang: "Chinese Cantonese",
            word: "港口"
          }
        ],
        examples: [{
          text: "A source example that this projection intentionally omits."
        }]
      },
      {
        glosses: ["To hold a thought secretly."],
        translations: [
          {
            lang_code: "de",
            lang: "German",
            word: "hegen"
          }
        ]
      },
      {
        glosses: ["A protected place."],
        translations: [
          {
            code: "zh",
            lang: "Chinese",
            word: "避风港"
          }
        ]
      }
    ]
  };
}

test("Kaikki projection preserves source sense boundaries and only sense-level Chinese translations", () => {
  const stats = createProjectionStats();
  const projected = projectKaikkiEntry(sourceEntry(), {
    lineNumber: 17,
    stats
  });

  assert.equal(projected.lookupKey, "harbor");
  assert.equal(projected.exactLookupKey, "harbor");
  assert.equal(projected.partOfSpeech, "noun");
  assert.deepEqual(projected.forms, [{
    form: "harbors",
    tags: ["plural"],
    romanization: ""
  }]);
  assert.deepEqual(projected.pronunciations, [{
    ipa: "/ˈhɑːrbər/",
    tags: ["US"]
  }]);
  assert.equal(projected.senses.length, 2);
  assert.equal(projected.senses[0].sourceSenseIndex, 1);
  assert.equal(projected.senses[0].sourceRef, "line:17:sense:1");
  assert.deepEqual(projected.senses[0].translations, [{
    sourceText: "港口",
    langCode: "cmn",
    language: "Chinese Mandarin",
    romanization: "gǎngkǒu",
    tags: ["standard"],
    topics: ["nautical"]
  }]);
  assert.equal(projected.senses[1].sourceSenseIndex, 3);
  assert.equal(projected.senses[1].translations[0].langCode, "zh");
  assert.equal(projected.senses[1].translations[0].sourceText, "避风港");
  assert.equal(JSON.stringify(projected).includes("example.mp3"), false);
  assert.equal(JSON.stringify(projected).includes("source example"), false);

  assert.deepEqual(stats, {
    inputEntries: 0,
    englishEntries: 1,
    projectedEntries: 1,
    projectedSenses: 2,
    projectedTranslations: 2,
    ignoredEntryLevelChineseTranslations: 1,
    skippedNonEnglishEntries: 0,
    skippedInvalidHeadwordEntries: 0,
    skippedWithoutSenseLevelChinese: 0
  });
  assert.equal(validateProjectedKaikkiEntry(projected), projected);
});

test("Kaikki projection does not promote non-English entries or unsensed Chinese translations", () => {
  const stats = createProjectionStats();

  assert.equal(projectKaikkiEntry(sourceEntry({ langCode: "fr" }), {
    lineNumber: 1,
    stats
  }), null);

  const unresolvedOnly = sourceEntry({ word: "shelter" });
  unresolvedOnly.senses = [{
    glosses: ["A place providing protection."],
    translations: [{ lang_code: "fr", word: "abri" }]
  }];
  unresolvedOnly.translations = [{ lang_code: "cmn", word: "庇护所" }];

  assert.equal(projectKaikkiEntry(unresolvedOnly, {
    lineNumber: 2,
    stats
  }), null);
  assert.equal(stats.skippedNonEnglishEntries, 1);
  assert.equal(stats.ignoredEntryLevelChineseTranslations, 1);
  assert.equal(stats.skippedWithoutSenseLevelChinese, 1);
  assert.equal(stats.projectedEntries, 0);
});

test("Kaikki projection rejects retained HTML-like or executable data", () => {
  const unsafeTranslation = sourceEntry();
  unsafeTranslation.senses[0].translations[0].word = "<img src=x onerror=alert(1)>";
  assert.throws(
    () => projectKaikkiEntry(unsafeTranslation, { lineNumber: 1 }),
    /HTML-like markup/
  );

  const unsafeGloss = sourceEntry();
  unsafeGloss.senses[0].glosses = ["javascript:alert(1)"];
  assert.throws(
    () => projectKaikkiEntry(unsafeGloss, { lineNumber: 1 }),
    /executable\/renderable scheme/
  );
});

test("real projection path verifies exact gzip bytes before parsing and is deterministic", async () => {
  const root = await mkdtemp(join(tmpdir(), "translateflow-kaikki-projection-"));
  try {
    const sourcePath = join(root, "raw-wiktextract-data.jsonl.gz");
    const lockPath = join(root, "source-lock.json");
    const outA = join(root, "projection-a.jsonl");
    const outB = join(root, "projection-b.jsonl");
    const reportPath = join(root, "projection-report.json");

    const jsonl = [
      JSON.stringify(sourceEntry()),
      JSON.stringify(sourceEntry({ langCode: "fr" })),
      JSON.stringify(sourceEntry({ word: "anchor" }))
    ].join("\n") + "\n";
    await writeFile(sourcePath, gzipSync(Buffer.from(jsonl, "utf8")));

    const lock = await deriveKaikkiSourceLock({
      candidate: await candidate(),
      sourcePath
    });
    await writeFile(lockPath, JSON.stringify(lock, null, 2) + "\n");

    const first = await projectKaikkiSource({
      sourcePath,
      sourceLockPath: lockPath,
      outPath: outA,
      reportPath
    });
    const second = await projectKaikkiSource({
      sourcePath,
      sourceLockPath: lockPath,
      outPath: outB
    });

    assert.equal(first.source.exactSourceVerifiedBeforeProjection, true);
    assert.equal(first.stats.inputEntries, 3);
    assert.equal(first.stats.englishEntries, 2);
    assert.equal(first.stats.projectedEntries, 2);
    assert.equal(first.stats.skippedNonEnglishEntries, 1);
    assert.equal(first.stats.ignoredEntryLevelChineseTranslations, 2);
    assert.equal(first.output.sha256, second.output.sha256);
    assert.equal(first.output.sizeBytes, second.output.sizeBytes);
    assert.equal(await readFile(outA, "utf8"), await readFile(outB, "utf8"));

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.output.sha256, first.output.sha256);
    assert.equal(report.fieldPolicy.entryLevelTranslationPolicy.includes("do not assign"), true);

    const changed = await readFile(sourcePath);
    changed[changed.length - 1] ^= 0x01;
    await writeFile(sourcePath, changed);

    await assert.rejects(
      projectKaikkiSource({
        sourcePath,
        sourceLockPath: lockPath,
        outPath: join(root, "projection-drift.jsonl")
      }),
      /SHA-256 mismatch/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid JSON fails with physical source line evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "translateflow-kaikki-invalid-"));
  try {
    const sourcePath = join(root, "raw-wiktextract-data.jsonl.gz");
    const lockPath = join(root, "source-lock.json");
    const jsonl = JSON.stringify(sourceEntry()) + "\n{not-json}\n";
    await writeFile(sourcePath, gzipSync(Buffer.from(jsonl, "utf8")));

    const lock = await deriveKaikkiSourceLock({
      candidate: await candidate(),
      sourcePath
    });
    await writeFile(lockPath, JSON.stringify(lock, null, 2) + "\n");

    await assert.rejects(
      projectKaikkiSource({
        sourcePath,
        sourceLockPath: lockPath,
        outPath: join(root, "projection.jsonl")
      }),
      /invalid Kaikki JSON on line 2/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
