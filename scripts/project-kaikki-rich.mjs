#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { createGunzip } from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  normalizeExactLookupKey,
  normalizeLookupKey,
  stableStringify
} from "./build-tflex-core.mjs";
import {
  validateKaikkiSourceLock,
  verifyKaikkiSourceBytes
} from "./lock-kaikki-source.mjs";

export const KAIKKI_PROJECTION_SCHEMA_VERSION = 1;
export const KAIKKI_PROJECTION_VERSION = "rich-en-zh-v1";
export const KAIKKI_SOURCE_ID = "kaikki-enwiktionary-raw";

const TARGET_LANGUAGE_CODES = new Set(["cmn", "zh"]);
const MAX_RETAINED_TEXT_LENGTH = 16_384;
const MAX_RETAINED_LIST_ITEMS = 512;

export const KAIKKI_FIELD_POLICY = Object.freeze({
  retain: Object.freeze([
    "word",
    "pos",
    "forms.form",
    "forms.tags",
    "forms.roman",
    "sounds.ipa",
    "sounds.tags",
    "senses.glosses",
    "senses.tags",
    "senses.topics",
    "senses.translations.word",
    "senses.translations.lang_code",
    "senses.translations.code",
    "senses.translations.lang",
    "senses.translations.roman",
    "senses.translations.tags",
    "senses.translations.topics"
  ]),
  omit: Object.freeze([
    "entry-level translations (not sense-disambiguated)",
    "raw_glosses",
    "examples",
    "categories",
    "audio URLs/files",
    "etymology text/templates",
    "linkages",
    "remote/renderable content"
  ])
});

export async function projectKaikkiSource({
  sourcePath,
  sourceLockPath,
  outPath,
  reportPath
}) {
  const source = requiredPath(sourcePath, "sourcePath");
  const sourceLock = requiredPath(sourceLockPath, "sourceLockPath");
  const output = requiredPath(outPath, "outPath");
  const lock = validateKaikkiSourceLock(JSON.parse(await readFile(sourceLock, "utf8")));

  // The real POC path is intentionally fail-closed: exact artifact bytes are
  // verified before any JSONL content is parsed or projected.
  const verified = await verifyKaikkiSourceBytes(lock, source);
  const input = createReadStream(source).pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });
  const writer = createWriteStream(output, { encoding: "utf8", flags: "wx" });
  const outputHash = createHash("sha256");
  const stats = createProjectionStats();
  let outputBytes = 0;
  let physicalLine = 0;

  try {
    for await (const line of lines) {
      physicalLine += 1;
      if (!line.trim()) continue;
      stats.inputEntries += 1;

      let entry;
      try {
        entry = JSON.parse(line);
      } catch (error) {
        throw new Error("invalid Kaikki JSON on line " + physicalLine, { cause: error });
      }

      const projected = projectKaikkiEntry(entry, {
        lineNumber: physicalLine,
        stats
      });
      if (!projected) continue;

      const projectedLine = stableStringify(projected) + "\n";
      const bytes = Buffer.from(projectedLine, "utf8");
      outputHash.update(bytes);
      outputBytes += bytes.byteLength;
      if (!writer.write(projectedLine)) await once(writer, "drain");
    }
  } finally {
    writer.end();
    await once(writer, "close");
  }

  const report = {
    schemaVersion: KAIKKI_PROJECTION_SCHEMA_VERSION,
    projectionVersion: KAIKKI_PROJECTION_VERSION,
    source: {
      sourceId: lock.sourceId,
      dumpDate: lock.dumpDate,
      extractedAt: lock.extractedAt,
      artifactSha256: verified.sha256,
      artifactSizeBytes: verified.sizeBytes,
      exactSourceVerifiedBeforeProjection: true
    },
    target: {
      sourceLanguage: "en",
      targetLanguage: "zh-CN",
      acceptedSourceTranslationCodes: [...TARGET_LANGUAGE_CODES].sort(compareText),
      displayNormalizationApplied: false
    },
    fieldPolicy: {
      retain: [...KAIKKI_FIELD_POLICY.retain],
      omit: [...KAIKKI_FIELD_POLICY.omit],
      entryLevelTranslationPolicy:
        "count but do not assign entry-level translations to senses because Wiktextract documents them as non-disambiguated"
    },
    output: {
      format: "kaikki-rich-en-zh-projection-jsonl",
      sha256: outputHash.digest("hex"),
      sizeBytes: outputBytes
    },
    stats
  };

  if (reportPath) {
    await writeFile(resolve(reportPath), JSON.stringify(report, null, 2) + "\n", "utf8");
  }
  return report;
}

export function projectKaikkiEntry(entry, {
  lineNumber,
  stats = createProjectionStats()
} = {}) {
  if (!plainObject(entry)) throw new Error("Kaikki entry must be an object");
  if (!Number.isSafeInteger(lineNumber) || lineNumber <= 0) {
    throw new Error("Kaikki lineNumber must be a positive integer");
  }

  if (entry.lang_code !== "en") {
    stats.skippedNonEnglishEntries += 1;
    return null;
  }
  stats.englishEntries += 1;

  const headword = retainedText(entry.word, "Kaikki word", { required: true });
  const lookupKey = normalizeLookupKey(headword);
  const exactLookupKey = normalizeExactLookupKey(headword);
  if (!lookupKey || !exactLookupKey) {
    stats.skippedInvalidHeadwordEntries += 1;
    return null;
  }

  const entryLevelChinese = chineseTranslations(entry.translations, "entry translations");
  stats.ignoredEntryLevelChineseTranslations += entryLevelChinese.length;

  const sourceSenses = Array.isArray(entry.senses) ? entry.senses : [];
  if (sourceSenses.length > MAX_RETAINED_LIST_ITEMS) {
    throw new Error("Kaikki senses exceed projection safety limit on line " + lineNumber);
  }

  const senses = [];
  for (let index = 0; index < sourceSenses.length; index += 1) {
    const sourceSense = sourceSenses[index];
    if (!plainObject(sourceSense)) {
      throw new Error("Kaikki sense must be an object on line " + lineNumber);
    }
    const translations = chineseTranslations(
      sourceSense.translations,
      "sense translations on line " + lineNumber
    );
    if (!translations.length) continue;

    const sourceRef = "line:" + lineNumber + ":sense:" + (index + 1);
    senses.push({
      sourceSenseIndex: index + 1,
      sourceRef,
      partOfSpeech: optionalText(entry.pos, "Kaikki part of speech"),
      glosses: retainedTextArray(sourceSense.glosses, "Kaikki sense gloss"),
      tags: retainedTextArray(sourceSense.tags, "Kaikki sense tag"),
      topics: retainedTextArray(sourceSense.topics, "Kaikki sense topic"),
      translations
    });
    stats.projectedSenses += 1;
    stats.projectedTranslations += translations.length;
  }

  if (!senses.length) {
    stats.skippedWithoutSenseLevelChinese += 1;
    return null;
  }

  const result = {
    schemaVersion: KAIKKI_PROJECTION_SCHEMA_VERSION,
    projectionVersion: KAIKKI_PROJECTION_VERSION,
    sourceId: KAIKKI_SOURCE_ID,
    sourceRecordId: "line:" + lineNumber,
    headword,
    lookupKey,
    exactLookupKey,
    partOfSpeech: optionalText(entry.pos, "Kaikki part of speech"),
    forms: projectForms(entry.forms),
    pronunciations: projectPronunciations(entry.sounds),
    senses
  };
  validateProjectedKaikkiEntry(result);
  stats.projectedEntries += 1;
  return result;
}

export function validateProjectedKaikkiEntry(entry) {
  if (!plainObject(entry)) throw new Error("projected Kaikki entry must be an object");
  if (
    entry.schemaVersion !== KAIKKI_PROJECTION_SCHEMA_VERSION ||
    entry.projectionVersion !== KAIKKI_PROJECTION_VERSION ||
    entry.sourceId !== KAIKKI_SOURCE_ID
  ) {
    throw new Error("projected Kaikki entry metadata is incompatible");
  }
  retainedText(entry.sourceRecordId, "projected sourceRecordId", { required: true });
  retainedText(entry.headword, "projected headword", { required: true });
  if (normalizeLookupKey(entry.headword) !== entry.lookupKey) {
    throw new Error("projected Kaikki lookupKey is inconsistent");
  }
  if (normalizeExactLookupKey(entry.headword) !== entry.exactLookupKey) {
    throw new Error("projected Kaikki exactLookupKey is inconsistent");
  }
  if (!Array.isArray(entry.senses) || !entry.senses.length) {
    throw new Error("projected Kaikki entry requires translated senses");
  }
  retainedTextArray(entry.forms?.map((item) => item.form), "projected form");
  retainedTextArray(entry.pronunciations?.map((item) => item.ipa), "projected pronunciation");

  for (const sense of entry.senses) {
    if (!plainObject(sense) || !Number.isSafeInteger(sense.sourceSenseIndex) || sense.sourceSenseIndex <= 0) {
      throw new Error("projected Kaikki sense index is invalid");
    }
    retainedText(sense.sourceRef, "projected sense sourceRef", { required: true });
    retainedTextArray(sense.glosses, "projected sense gloss");
    retainedTextArray(sense.tags, "projected sense tag");
    retainedTextArray(sense.topics, "projected sense topic");
    if (!Array.isArray(sense.translations) || !sense.translations.length) {
      throw new Error("projected Kaikki sense requires Chinese translations");
    }
    for (const translation of sense.translations) {
      if (!plainObject(translation) || !TARGET_LANGUAGE_CODES.has(translation.langCode)) {
        throw new Error("projected Kaikki translation language is incompatible");
      }
      retainedText(translation.sourceText, "projected translation", { required: true });
      retainedTextArray(translation.tags, "projected translation tag");
      retainedTextArray(translation.topics, "projected translation topic");
    }
  }
  return entry;
}

export function createProjectionStats() {
  return {
    inputEntries: 0,
    englishEntries: 0,
    projectedEntries: 0,
    projectedSenses: 0,
    projectedTranslations: 0,
    ignoredEntryLevelChineseTranslations: 0,
    skippedNonEnglishEntries: 0,
    skippedInvalidHeadwordEntries: 0,
    skippedWithoutSenseLevelChinese: 0
  };
}

function chineseTranslations(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(label + " must be an array");
  if (value.length > MAX_RETAINED_LIST_ITEMS) {
    throw new Error(label + " exceeds projection safety limit");
  }

  const translations = [];
  for (const item of value) {
    if (!plainObject(item)) throw new Error(label + " item must be an object");
    const langCode = optionalText(item.lang_code, label + " lang_code")
      || optionalText(item.code, label + " code");
    if (!TARGET_LANGUAGE_CODES.has(langCode)) continue;
    const sourceText = optionalText(item.word, label + " word");
    if (!sourceText) continue;

    translations.push({
      sourceText,
      langCode,
      language: optionalText(item.lang, label + " language"),
      romanization: optionalText(item.roman, label + " romanization"),
      tags: retainedTextArray(item.tags, label + " tag"),
      topics: retainedTextArray(item.topics, label + " topic")
    });
  }

  return uniqueObjects(translations, (item) => stableStringify(item))
    .sort((a, b) =>
      compareText(a.sourceText, b.sourceText) ||
      compareText(a.langCode, b.langCode) ||
      compareText(a.romanization, b.romanization)
    );
}

function projectForms(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Kaikki forms must be an array");
  if (value.length > MAX_RETAINED_LIST_ITEMS) throw new Error("Kaikki forms exceed projection safety limit");

  const forms = [];
  for (const item of value) {
    if (!plainObject(item)) throw new Error("Kaikki form must be an object");
    const form = optionalText(item.form, "Kaikki form");
    if (!form || form === "-") continue;
    forms.push({
      form,
      tags: retainedTextArray(item.tags, "Kaikki form tag"),
      romanization: optionalText(item.roman, "Kaikki form romanization")
    });
  }
  return uniqueObjects(forms, (item) => stableStringify(item))
    .sort((a, b) => compareText(a.form, b.form) || compareText(stableStringify(a), stableStringify(b)));
}

function projectPronunciations(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Kaikki sounds must be an array");
  if (value.length > MAX_RETAINED_LIST_ITEMS) throw new Error("Kaikki sounds exceed projection safety limit");

  const pronunciations = [];
  for (const item of value) {
    if (!plainObject(item)) throw new Error("Kaikki sound must be an object");
    const ipa = optionalText(item.ipa, "Kaikki IPA");
    if (!ipa) continue;
    pronunciations.push({
      ipa,
      tags: retainedTextArray(item.tags, "Kaikki sound tag")
    });
  }
  return uniqueObjects(pronunciations, (item) => stableStringify(item))
    .sort((a, b) => compareText(a.ipa, b.ipa) || compareText(stableStringify(a), stableStringify(b)));
}

function retainedTextArray(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(label + " must be an array");
  if (value.length > MAX_RETAINED_LIST_ITEMS) throw new Error(label + " exceeds projection safety limit");
  const result = value.map((item) => retainedText(item, label, { required: true }));
  return [...new Set(result)].sort(compareText);
}

function retainedText(value, label, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(label + " is required");
    return "";
  }
  if (typeof value !== "string") throw new Error(label + " must be a string");
  if (!value.trim()) {
    if (required) throw new Error(label + " must be non-empty");
    return "";
  }
  if (value.length > MAX_RETAINED_TEXT_LENGTH) {
    throw new Error(label + " exceeds projection safety limit");
  }
  assertDataOnly(value, label);
  return value;
}

function optionalText(value, label) {
  return retainedText(value, label);
}

function assertDataOnly(value, label) {
  const text = String(value);
  if (
    /<\/?[A-Za-z][^>]*>/u.test(text) ||
    /<!--|<!DOCTYPE\b|<\?/iu.test(text) ||
    /(?:javascript|data)\s*:/iu.test(text)
  ) {
    throw new Error(label + " contains HTML-like markup or executable/renderable scheme");
  }
}

function uniqueObjects(values, keyFn) {
  const map = new Map();
  for (const value of values) {
    const key = keyFn(value);
    if (!map.has(key)) map.set(key, value);
  }
  return [...map.values()];
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compareText(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  return left < right ? -1 : left > right ? 1 : 0;
}

function requiredPath(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(label + " is required");
  return resolve(value);
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(
        "usage: project-kaikki-rich.mjs --source PATH --source-lock PATH --out PATH [--report PATH]"
      );
    }
    values[key.slice(2)] = value;
  }
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await projectKaikkiSource({
    sourcePath: args.source,
    sourceLockPath: args["source-lock"],
    outPath: args.out,
    reportPath: args.report
  });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
