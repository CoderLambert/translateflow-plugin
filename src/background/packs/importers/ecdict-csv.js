import {
  normalizeLexicalExactKey,
  normalizeLexicalKey
} from "../../../shared/lexical.js";
import {
  CURATED_IMPORTER_TYPES,
  CURATED_RECIPE_SCHEMA_VERSION
} from "../../../shared/curated-dictionaries.js";
import {
  assertSafeLocalDataText
} from "../local-import-integrity.js";
import {
  parseCsvChunks
} from "./ecdict-csv-stream.js";

export {
  responseByteChunks
} from "./ecdict-csv-stream.js";

export const ECDICT_COLUMNS = Object.freeze([
  "word",
  "phonetic",
  "definition",
  "translation",
  "pos",
  "collins",
  "oxford",
  "tag",
  "bnc",
  "frq",
  "exchange",
  "detail",
  "audio"
]);

const ENGLISH_HEADWORD =
  /^[A-Za-z][A-Za-z0-9 '\u2019.,&()\/+-]*$/u;
const encoder = new TextEncoder();

export async function projectEcdictCuratedCsv({
  chunks,
  source,
  signal,
  onProgress = () => {}
} = {}) {
  validateSource(source);
  if (!chunks?.[Symbol.asyncIterator]) {
    throw new Error("ECDICT source must be an async byte stream.");
  }

  const selector = createTopSelector(source.selection.maxRecords);
  const stats = {
    inputBytes: 0,
    sourceRows: 0,
    translatedRows: 0,
    eligibleRows: 0,
    skippedOversize: 0,
    skippedUnsafe: 0
  };
  let sawHeader = false;
  let nextProgressBytes = 8 * 1024 * 1024;

  await parseCsvChunks(chunks, {
    signal,
    onChunk(bytes) {
      stats.inputBytes += bytes.byteLength;
      if (stats.inputBytes > source.selection.maxSourceBytes) {
        throw new Error(
          "ECDICT download exceeds the configured source-size limit."
        );
      }
      if (stats.inputBytes >= nextProgressBytes) {
        onProgress({
          phase: "download",
          inputBytes: stats.inputBytes,
          expectedBytes: source.downloadBytes
        });
        nextProgressBytes += 8 * 1024 * 1024;
      }
    },
    onRow(fields, csvRowNumber) {
      if (!sawHeader) {
        assertHeader(fields);
        sawHeader = true;
        return;
      }

      stats.sourceRows += 1;
      const candidate = projectCandidate(
        fields,
        csvRowNumber,
        source,
        stats
      );
      if (!candidate) return;
      stats.eligibleRows += 1;
      selector.add(candidate);
    }
  });

  if (!sawHeader) {
    throw new Error("ECDICT CSV header is missing.");
  }
  if (
    source.downloadBytes &&
    stats.inputBytes !== source.downloadBytes
  ) {
    throw new Error(
      `ECDICT source size mismatch: expected ${source.downloadBytes}, got ${stats.inputBytes}.`
    );
  }

  const selected = selector.values().sort(compareCandidate);
  const records = groupCandidates(selected, source);
  if (!records.length) {
    throw new Error("ECDICT curated projection produced no records.");
  }

  return {
    records,
    stats: {
      ...stats,
      retainedRows: selected.length,
      retainedRecords: records.length
    }
  };
}

function assertHeader(fields) {
  const normalized = fields.map((field, index) =>
    index === 0
      ? String(field).replace(/^\ufeff/u, "")
      : String(field)
  );
  if (
    normalized.length !== ECDICT_COLUMNS.length ||
    normalized.some(
      (field, index) => field !== ECDICT_COLUMNS[index]
    )
  ) {
    throw new Error("ECDICT CSV schema does not match the locked recipe.");
  }
}

function projectCandidate(
  fields,
  csvRowNumber,
  source,
  stats
) {
  if (fields.length !== ECDICT_COLUMNS.length) {
    throw new Error(
      `ECDICT CSV row ${csvRowNumber} has ${fields.length} fields; expected ${ECDICT_COLUMNS.length}.`
    );
  }

  const word = normalizeText(fields[0]);
  const translation = normalizeText(fields[3]);
  if (!translation) return null;
  stats.translatedRows += 1;

  if (
    !word ||
    word.length > source.selection.maxHeadwordChars ||
    !ENGLISH_HEADWORD.test(word) ||
    translation.length > source.selection.maxTranslationChars ||
    encoder.encode(translation).byteLength > 64 * 1024
  ) {
    stats.skippedOversize += 1;
    return null;
  }

  const lookupKey = normalizeLexicalKey(word);
  const exact = normalizeLexicalExactKey(word);
  if (!lookupKey || !exact) return null;

  try {
    assertSafeLocalDataText(translation, "translation");
  } catch {
    stats.skippedUnsafe += 1;
    return null;
  }

  const collins = positiveInteger(fields[5]);
  const oxford = positiveInteger(fields[6]) === 1;
  const tag = normalizeText(fields[7]);
  const bnc = positiveInteger(fields[8]);
  const frq = positiveInteger(fields[9]);
  const rank = sourceRank({
    bnc,
    frq,
    collins,
    oxford,
    hasTag: Boolean(tag)
  });
  if (!Number.isFinite(rank)) return null;

  return {
    word,
    lookupKey,
    exact,
    translation,
    csvRowNumber,
    rank,
    frequency: Math.min(
      bnc || Number.MAX_SAFE_INTEGER,
      frq || Number.MAX_SAFE_INTEGER
    ),
    sourceRef: {
      sourceId: source.output.sourceId,
      sourceVersion: source.output.sourceVersion,
      recordId: String(csvRowNumber)
    }
  };
}

function sourceRank({
  bnc,
  frq,
  collins,
  oxford,
  hasTag
}) {
  let rank = Math.min(
    bnc || Number.POSITIVE_INFINITY,
    frq || Number.POSITIVE_INFINITY
  );
  if (oxford) rank = Math.min(rank, 12_000);
  if (collins >= 4) rank = Math.min(rank, 15_000);
  else if (collins >= 3) rank = Math.min(rank, 25_000);
  if (hasTag) rank = Math.min(rank, 30_000);
  return rank;
}

function groupCandidates(candidates, source) {
  const grouped = new Map();

  for (const candidate of candidates) {
    let record = grouped.get(candidate.lookupKey);
    if (!record) {
      record = {
        lookupKey: candidate.lookupKey,
        exactLookupKeys: new Set(),
        displayForm: candidate.word,
        kind: "lexical",
        aliases: [],
        senses: []
      };
      grouped.set(candidate.lookupKey, record);
    }
    record.exactLookupKeys.add(candidate.exact);
    record.senses.push({
      id: `ecdict:${candidate.csvRowNumber}`,
      translations: [candidate.translation],
      domains: [],
      sourceRefs: [{ ...candidate.sourceRef }]
    });
  }

  return [...grouped.values()]
    .map((record) => ({
      ...record,
      exactLookupKeys: [...record.exactLookupKeys].sort(compareText),
      senses: record.senses
    }))
    .sort((left, right) =>
      compareText(left.lookupKey, right.lookupKey)
    );
}

function createTopSelector(limit) {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error("ECDICT retained-record limit is invalid.");
  }
  const heap = [];

  function add(candidate) {
    if (heap.length < limit) {
      heap.push(candidate);
      siftUp(heap, heap.length - 1);
      return;
    }
    if (compareCandidate(candidate, heap[0]) >= 0) return;
    heap[0] = candidate;
    siftDown(heap, 0);
  }

  return Object.freeze({
    add,
    values() {
      return [...heap];
    }
  });
}

function siftUp(heap, index) {
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (compareCandidate(heap[parent], heap[index]) >= 0) return;
    [heap[parent], heap[index]] = [heap[index], heap[parent]];
    index = parent;
  }
}

function siftDown(heap, index) {
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let worst = index;
    if (
      left < heap.length &&
      compareCandidate(heap[left], heap[worst]) > 0
    ) {
      worst = left;
    }
    if (
      right < heap.length &&
      compareCandidate(heap[right], heap[worst]) > 0
    ) {
      worst = right;
    }
    if (worst === index) return;
    [heap[index], heap[worst]] = [heap[worst], heap[index]];
    index = worst;
  }
}

function compareCandidate(left, right) {
  return (
    left.rank - right.rank ||
    left.frequency - right.frequency ||
    compareText(left.lookupKey, right.lookupKey) ||
    left.csvRowNumber - right.csvRowNumber
  );
}

function positiveInteger(value) {
  const number = Number.parseInt(String(value || "").trim(), 10);
  return Number.isSafeInteger(number) && number > 0
    ? number
    : 0;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r\n?/gu, "\n")
    .trim();
}

function validateSource(source) {
  if (
    !source ||
    source.schemaVersion !==
      CURATED_RECIPE_SCHEMA_VERSION ||
    source.trustClass !== "curated-upstream" ||
    source.importerType !==
      CURATED_IMPORTER_TYPES.ECDICT_CSV_V1 ||
    source.sourceFormat !== "ECDICT CSV" ||
    !source.output?.packId ||
    !source.output?.sourceId ||
    !Number.isSafeInteger(source.downloadBytes) ||
    source.downloadBytes <= 0 ||
    !Number.isSafeInteger(source.selection?.maxRecords) ||
    source.selection.maxRecords <= 0
  ) {
    throw new Error("ECDICT curated source configuration is invalid.");
  }
}

function assertActive(signal) {
  if (!signal?.aborted) return;
  throw new DOMException(
    "ECDICT curated dictionary install cancelled.",
    "AbortError"
  );
}

function compareText(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  return a < b ? -1 : a > b ? 1 : 0;
}
