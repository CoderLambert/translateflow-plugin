import { normalizeLexicalKey } from "../../../shared/lexical.js";
import {
  STARDICT_IMPORT_ERROR,
  STARDICT_IMPORT_LIMITS,
  compareStarDictWordBytes,
  decodeStarDictUtf8,
  readStarDictUint16Le,
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

export function parseStarDictDictzipHeader(input) {
  const bytes = starDictBytes(input, "DICT.DZ header");
  if (bytes.byteLength < 12) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict .dict.dz gzip header is truncated."
    );
  }
  if (
    bytes[0] !== 0x1f ||
    bytes[1] !== 0x8b ||
    bytes[2] !== 8
  ) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict .dict.dz is not a DEFLATE gzip stream."
    );
  }

  const flags = bytes[3];
  if ((flags & 0xe0) !== 0) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict .dict.dz uses reserved gzip flags."
    );
  }
  if ((flags & 0x04) === 0) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict .dict.dz is missing the gzip extra field."
    );
  }

  const extraLength = readStarDictUint16Le(bytes, 10);
  const extraEnd = 12 + extraLength;
  if (
    extraLength < 4 ||
    bytes.byteLength < extraEnd
  ) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict .dict.dz gzip extra field is truncated."
    );
  }

  let cursor = 12;
  let randomAccess = null;
  while (cursor < extraEnd) {
    if (cursor + 4 > extraEnd) {
      starDictFail(
        STARDICT_IMPORT_ERROR.CORRUPT,
        "StarDict .dict.dz extra subfield header is truncated."
      );
    }
    const id1 = bytes[cursor];
    const id2 = bytes[cursor + 1];
    const length = readStarDictUint16Le(
      bytes,
      cursor + 2
    );
    cursor += 4;
    if (cursor + length > extraEnd) {
      starDictFail(
        STARDICT_IMPORT_ERROR.CORRUPT,
        "StarDict .dict.dz extra subfield is truncated."
      );
    }
    if (id1 === 0x52 && id2 === 0x41) {
      if (randomAccess) {
        starDictFail(
          STARDICT_IMPORT_ERROR.CORRUPT,
          "StarDict .dict.dz contains duplicate RA metadata."
        );
      }
      randomAccess = bytes.subarray(
        cursor,
        cursor + length
      );
    }
    cursor += length;
  }

  if (cursor !== extraEnd || !randomAccess) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict .dict.dz is missing dictzip RA metadata."
    );
  }
  if (randomAccess.byteLength < 8) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict .dict.dz RA metadata is truncated."
    );
  }

  const version = readStarDictUint16Le(
    randomAccess,
    0
  );
  const chunkLength = readStarDictUint16Le(
    randomAccess,
    2
  );
  const chunkCount = readStarDictUint16Le(
    randomAccess,
    4
  );
  if (version !== 1) {
    starDictFail(
      STARDICT_IMPORT_ERROR.UNSUPPORTED,
      "Unsupported StarDict dictzip RA format version.",
      { version }
    );
  }
  if (!chunkLength || !chunkCount) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict .dict.dz RA metadata contains zero-valued required fields."
    );
  }

  const expectedBytes = 6 + chunkCount * 2;
  if (randomAccess.byteLength !== expectedBytes) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict .dict.dz RA chunk table length is inconsistent.",
      {
        expected: expectedBytes,
        actual: randomAccess.byteLength
      }
    );
  }

  let compressedChunkBytes = 0;
  for (let index = 0; index < chunkCount; index += 1) {
    const size = readStarDictUint16Le(
      randomAccess,
      6 + index * 2
    );
    if (!size) {
      starDictFail(
        STARDICT_IMPORT_ERROR.CORRUPT,
        "StarDict .dict.dz RA metadata contains an empty compressed chunk."
      );
    }
    compressedChunkBytes += size;
  }

  return {
    version,
    chunkLength,
    chunkCount,
    compressedChunkBytes
  };
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
