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

  const result = [];
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

    result.push({ word, offset, size });
    requireStarDictAtMost(
      result.length,
      limits.entryCount,
      "StarDict index entries"
    );
  }

  if (result.length !== wordCount) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict wordcount does not match .idx entries.",
      {
        expected: wordCount,
        actual: result.length
      }
    );
  }
  return result;
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

  if (input === undefined || input === null) {
    if (synonymCount === 0) return [];
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict .ifo declares synonyms but no .syn bytes were supplied."
    );
  }

  const bytes = starDictBytes(input, "SYN");
  requireStarDictAtMost(
    bytes.byteLength,
    limits.synBytes,
    "SYN bytes"
  );
  if (synonymCount === 0) {
    if (bytes.byteLength === 0) return [];
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict .syn bytes were supplied without a positive synwordcount."
    );
  }

  const result = [];
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

    result.push({ word, targetIndex });
    requireStarDictAtMost(
      result.length,
      limits.synonymCount,
      "StarDict synonym entries"
    );
  }

  if (result.length !== synonymCount) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict synwordcount does not match .syn entries.",
      {
        expected: synonymCount,
        actual: result.length
      }
    );
  }
  return result;
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
