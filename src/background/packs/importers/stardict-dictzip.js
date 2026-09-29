import {
  STARDICT_IMPORT_ERROR,
  readStarDictUint16Le,
  starDictBytes,
  starDictFail
} from "./stardict-contract.js";

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
