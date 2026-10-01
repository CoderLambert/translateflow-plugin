import { normalizeLexicalKey } from "../../../shared/lexical.js";
import {
  STARDICT_IMPORT_ERROR,
  STARDICT_IMPORT_LIMITS,
  compareStarDictWordBytes,
  decodeStarDictUtf8,
  readStarDictUint32Be,
  requireStarDictAtMost,
  starDictBytes,
  starDictFail
} from "./stardict-contract.js";

const HTML_LIKE = /<\s*\/?\s*[a-z][^>]*>/i;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function parseStarDictIndex(input, {
  wordCount,
  dictBytes,
  limits = STARDICT_IMPORT_LIMITS
} = {}) {
  const bytes = starDictBytes(input, "IDX");
  requireStarDictAtMost(
    bytes.byteLength,
    limits.idxBytes,
    "IDX bytes"
  );
  return [...iterateStarDictIndex(bytes, { wordCount, dictBytes, limits })];
}

export async function validateStarDictIndex(input, {
  wordCount,
  dictBytes,
  limits = STARDICT_IMPORT_LIMITS,
  signal,
  yieldControl = yieldToEventLoop,
  yieldEvery = 2048
} = {}) {
  const bytes = starDictBytes(input, "IDX");
  requireStarDictAtMost(bytes.byteLength, limits.idxBytes, "IDX bytes");
  return validateEntries(iterateStarDictIndex(bytes, { wordCount, dictBytes, limits }), {
    signal, yieldControl, yieldEvery
  });
}

function* iterateStarDictIndex(bytes, { wordCount, dictBytes, limits }) {
  if (!Number.isSafeInteger(wordCount) || wordCount <= 0) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict wordCount must be a positive integer."
    );
  }
  if (!Number.isSafeInteger(dictBytes) || dictBytes < 0) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict dictionary byte size is invalid."
    );
  }

  let cursor = 0;
  let count = 0;
  let previousWordBytes = null;
  while (cursor < bytes.byteLength) {
    const end = findNul(
      bytes,
      cursor,
      limits.headwordBytes
    );
    if (end < 0) {
      starDictFail(
        STARDICT_IMPORT_ERROR.CORRUPT,
        "StarDict .idx headword is unterminated or exceeds the headword limit."
      );
    }

    const wordBytes = bytes.subarray(cursor, end);
    if (!wordBytes.byteLength) {
      starDictFail(
        STARDICT_IMPORT_ERROR.CORRUPT,
        "StarDict .idx contains an empty headword."
      );
    }
    const word = decodeStarDictUtf8(
      wordBytes,
      "IDX headword"
    );
    validateHeadword(word);

    if (
      previousWordBytes &&
      compareStarDictWordBytes(previousWordBytes, wordBytes) > 0
    ) {
      starDictFail(
        STARDICT_IMPORT_ERROR.CORRUPT,
        "StarDict .idx headwords are not StarDict-sorted."
      );
    }
    previousWordBytes = Uint8Array.from(wordBytes);

    cursor = end + 1;
    if (cursor + 8 > bytes.byteLength) {
      starDictFail(
        STARDICT_IMPORT_ERROR.CORRUPT,
        "StarDict .idx record is truncated."
      );
    }
    const offset = readStarDictUint32Be(bytes, cursor);
    const size = readStarDictUint32Be(bytes, cursor + 4);
    cursor += 8;

    if (size <= 0) {
      starDictFail(
        STARDICT_IMPORT_ERROR.CORRUPT,
        "StarDict entry size must be positive.",
        { word }
      );
    }
    requireStarDictAtMost(
      size,
      limits.entryBytes,
      "StarDict entry bytes"
    );
    if (
      offset > dictBytes ||
      size > dictBytes - offset
    ) {
      starDictFail(
        STARDICT_IMPORT_ERROR.CORRUPT,
        "StarDict .idx entry points outside the .dict file.",
        { word, offset, size, dictBytes }
      );
    }

    yield { word, offset, size };
    count += 1;
    requireStarDictAtMost(
      count,
      limits.entryCount,
      "StarDict index entries"
    );
  }

  if (count !== wordCount) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict wordcount does not match .idx entries.",
      {
        expected: wordCount,
        actual: count
      }
    );
  }
}

export function parseStarDictSynonyms(input, {
  synonymCount = 0,
  wordCount,
  limits = STARDICT_IMPORT_LIMITS
} = {}) {
  if (
    !Number.isSafeInteger(synonymCount) ||
    synonymCount < 0
  ) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict synonymCount must be a non-negative integer."
    );
  }
  requireStarDictAtMost(
    synonymCount,
    limits.synonymCount,
    "StarDict synonym count"
  );
  if (!Number.isSafeInteger(wordCount) || wordCount <= 0) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict wordCount must be a positive integer."
    );
  }

  const bytes = synonymBytes(input, synonymCount, limits);
  return [...iterateStarDictSynonyms(bytes, { synonymCount, wordCount, limits })];
}

export async function validateStarDictSynonyms(input, {
  synonymCount = 0,
  wordCount,
  limits = STARDICT_IMPORT_LIMITS,
  signal,
  yieldControl = yieldToEventLoop,
  yieldEvery = 2048
} = {}) {
  if (!Number.isSafeInteger(synonymCount) || synonymCount < 0) {
    starDictFail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict synonymCount must be a non-negative integer.");
  }
  requireStarDictAtMost(synonymCount, limits.synonymCount, "StarDict synonym count");
  if (!Number.isSafeInteger(wordCount) || wordCount <= 0) {
    starDictFail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict wordCount must be a positive integer.");
  }
  const bytes = synonymBytes(input, synonymCount, limits);
  return validateEntries(iterateStarDictSynonyms(bytes, { synonymCount, wordCount, limits }), {
    signal, yieldControl, yieldEvery
  });
}

function synonymBytes(input, synonymCount, limits) {
  if (input === undefined || input === null) {
    if (synonymCount === 0) return new Uint8Array();
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict .ifo declares synonyms but no .syn bytes were supplied."
    );
  }
  const bytes = starDictBytes(input, "SYN");
  requireStarDictAtMost(bytes.byteLength, limits.synBytes, "SYN bytes");
  if (synonymCount === 0 && bytes.byteLength !== 0) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict .syn bytes were supplied without a positive synwordcount."
    );
  }
  return bytes;
}

function* iterateStarDictSynonyms(bytes, { synonymCount, wordCount, limits }) {
  if (synonymCount === 0) return;
  let count = 0;
  let cursor = 0;
  let previousWordBytes = null;
  while (cursor < bytes.byteLength) {
    const end = findNul(
      bytes,
      cursor,
      limits.headwordBytes
    );
    if (end < 0) {
      starDictFail(
        STARDICT_IMPORT_ERROR.CORRUPT,
        "StarDict .syn headword is unterminated or exceeds the headword limit."
      );
    }

    const wordBytes = bytes.subarray(cursor, end);
    if (!wordBytes.byteLength) {
      starDictFail(
        STARDICT_IMPORT_ERROR.CORRUPT,
        "StarDict .syn contains an empty alias."
      );
    }
    const word = decodeStarDictUtf8(
      wordBytes,
      "SYN alias"
    );
    validateHeadword(word);

    if (
      previousWordBytes &&
      compareStarDictWordBytes(previousWordBytes, wordBytes) > 0
    ) {
      starDictFail(
        STARDICT_IMPORT_ERROR.CORRUPT,
        "StarDict .syn aliases are not StarDict-sorted."
      );
    }
    previousWordBytes = Uint8Array.from(wordBytes);

    cursor = end + 1;
    if (cursor + 4 > bytes.byteLength) {
      starDictFail(
        STARDICT_IMPORT_ERROR.CORRUPT,
        "StarDict .syn record is truncated."
      );
    }
    const targetIndex = readStarDictUint32Be(
      bytes,
      cursor
    );
    cursor += 4;
    if (targetIndex >= wordCount) {
      starDictFail(
        STARDICT_IMPORT_ERROR.CORRUPT,
        "StarDict .syn target index is outside the .idx word list.",
        { word, targetIndex, wordCount }
      );
    }

    yield { word, targetIndex };
    count += 1;
    requireStarDictAtMost(
      count,
      limits.synonymCount,
      "StarDict synonym entries"
    );
  }

  if (count !== synonymCount) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict synwordcount does not match .syn entries.",
      {
        expected: synonymCount,
        actual: count
      }
    );
  }
}

async function validateEntries(iterator, { signal, yieldControl, yieldEvery }) {
  if (!Number.isSafeInteger(yieldEvery) || yieldEvery < 1) {
    throw new TypeError("StarDict validation yield interval must be positive.");
  }
  let recordsProcessed = 0;
  for (;;) {
    assertNotAborted(signal);
    let yielded = 0;
    while (yielded < yieldEvery) {
      assertNotAborted(signal);
      const next = iterator.next();
      if (next.done) return recordsProcessed;
      recordsProcessed += 1;
      yielded += 1;
    }
    await yieldControl({ recordsProcessed });
    assertNotAborted(signal);
  }
}

function assertNotAborted(signal) {
  if (!signal?.aborted) return;
  throw new DOMException("StarDict inspection was cancelled.", "AbortError");
}

function yieldToEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function validateHeadword(word) {
  if (
    !word ||
    CONTROL.test(word) ||
    HTML_LIKE.test(word)
  ) {
    starDictFail(
      STARDICT_IMPORT_ERROR.UNSAFE_CONTENT,
      "Unsafe StarDict headword."
    );
  }
  if (!normalizeLexicalKey(word)) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict headword cannot be normalized."
    );
  }
}

function findNul(bytes, start, maxBytes) {
  const max = Math.min(
    bytes.byteLength,
    start + maxBytes + 1
  );
  for (let index = start; index < max; index += 1) {
    if (bytes[index] === 0) return index;
  }
  return -1;
}
