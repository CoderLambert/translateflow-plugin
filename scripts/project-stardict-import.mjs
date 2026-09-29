#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { open, stat, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { createGunzip } from "node:zlib";
import {
  normalizeExactLookupKey,
  normalizeLookupKey,
  stableStringify
} from "./build-tflex-core.mjs";

export const STARDICT_POC_LIMITS = Object.freeze({
  ifoBytes: 64 * 1024,
  idxBytes: 64 * 1024 * 1024,
  synBytes: 32 * 1024 * 1024,
  dictArchiveBytes: 128 * 1024 * 1024,
  dictBytes: 128 * 1024 * 1024,
  entryBytes: 512 * 1024,
  entryCount: 1_000_000,
  synonymCount: 1_000_000,
  headwordBytes: 1024
});

export const STARDICT_IMPORT_ERROR = Object.freeze({
  CORRUPT: "STARDICT_CORRUPT",
  LIMIT: "STARDICT_LIMIT",
  UNSUPPORTED: "STARDICT_UNSUPPORTED",
  UNSAFE_CONTENT: "STARDICT_UNSAFE_CONTENT"
});

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const IFO_HEADER = "StarDict's dict ifo file";
const SUPPORTED_VERSIONS = new Set(["2.4.2", "3.0.0"]);
const HTML_LIKE = /<\s*\/?\s*[a-z][^>]*>/i;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export class StarDictImportError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "StarDictImportError";
    this.code = code;
    Object.assign(this, details);
  }
}

export async function projectStarDictPoc({
  ifoPath,
  idxPath,
  dictPath,
  synPath,
  outPath,
  reportPath,
  sourceId = "user-stardict",
  sourceVersion = "local-import",
  limits = STARDICT_POC_LIMITS
} = {}) {
  const paths = {
    ifo: requiredPath(ifoPath, "ifoPath"),
    idx: requiredPath(idxPath, "idxPath"),
    dict: requiredPath(dictPath, "dictPath"),
    syn: optionalPath(synPath)
  };
  const [ifoSize, idxSize, synSize] = await Promise.all([
    checkedFileSize(paths.ifo, limits.ifoBytes, "IFO"),
    checkedFileSize(paths.idx, limits.idxBytes, "IDX"),
    paths.syn ? checkedFileSize(paths.syn, limits.synBytes, "SYN") : Promise.resolve(0)
  ]);
  const [ifoBytes, idxBytes, dictionaryFile, synBytes] = await Promise.all([
    readFile(paths.ifo),
    readFile(paths.idx),
    readStarDictDictionaryFile(paths.dict, { limits }),
    paths.syn ? readFile(paths.syn) : Promise.resolve(undefined)
  ]);
  const dictBytes = dictionaryFile.bytes;

  const ifoText = decodeUtf8(ifoBytes, "IFO");
  const result = projectStarDictPlainText({
    ifoText,
    idxBytes,
    dictBytes,
    synBytes,
    sourceId,
    sourceVersion,
    limits
  });

  const output = result.entries.map((entry) => stableStringify(entry)).join("\n") + "\n";
  const report = {
    schemaVersion: 1,
    format: "stardict-poc-report",
    sourceId,
    sourceVersion,
    input: {
      ifoBytes: ifoSize,
      idxBytes: idxSize,
      dictFileBytes: dictionaryFile.inputBytes,
      dictBytes: dictBytes.byteLength,
      dictCompression: dictionaryFile.compression,
      dictzip: dictionaryFile.dictzip,
      synBytes: synSize
    },
    dictionary: result.dictionary,
    output: {
      entries: result.entries.length,
      bytes: Buffer.byteLength(output)
    },
    policy: result.policy,
    unsupportedFeatures: result.unsupportedFeatures
  };

  if (outPath) await writeFile(resolve(outPath), output, "utf8");
  if (reportPath) await writeFile(resolve(reportPath), JSON.stringify(report, null, 2) + "\n", "utf8");
  return { ...result, report, output };
}

export async function readStarDictDictionaryFile(path, {
  limits = STARDICT_POC_LIMITS
} = {}) {
  const selected = requiredPath(path, "dictPath");
  if (!/\.dict\.dz$/i.test(selected)) {
    await checkedFileSize(selected, limits.dictBytes, "DICT");
    const bytes = await readFile(resolve(selected));
    requireAtMost(bytes.byteLength, limits.dictBytes, "DICT bytes");
    return {
      bytes,
      inputBytes: bytes.byteLength,
      compression: "none",
      dictzip: null
    };
  }

  const inputBytes = await checkedFileSize(
    selected,
    limits.dictArchiveBytes,
    "DICT.DZ"
  );
  const headerBytes = await readDictzipHeaderPrefix(selected, inputBytes);
  const dictzip = parseStarDictDictzipHeader(headerBytes);
  const bytes = await gunzipBounded(selected, limits.dictBytes, inputBytes);
  return {
    bytes,
    inputBytes,
    compression: "dictzip",
    dictzip
  };
}

export function parseStarDictDictzipHeader(input) {
  const bytes = toBytes(input, "DICT.DZ header");
  if (bytes.byteLength < 12) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .dict.dz gzip header is truncated.");
  }
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .dict.dz is not a DEFLATE gzip stream.");
  }
  const flags = bytes[3];
  if ((flags & 0xe0) !== 0) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .dict.dz uses reserved gzip flags.");
  }
  if ((flags & 0x04) === 0) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .dict.dz is missing the gzip extra field.");
  }

  const extraLength = readUint16Le(bytes, 10);
  const extraEnd = 12 + extraLength;
  if (extraLength < 4 || bytes.byteLength < extraEnd) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .dict.dz gzip extra field is truncated.");
  }

  let cursor = 12;
  let randomAccess = null;
  while (cursor < extraEnd) {
    if (cursor + 4 > extraEnd) {
      fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .dict.dz extra subfield header is truncated.");
    }
    const id1 = bytes[cursor];
    const id2 = bytes[cursor + 1];
    const length = readUint16Le(bytes, cursor + 2);
    cursor += 4;
    if (cursor + length > extraEnd) {
      fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .dict.dz extra subfield is truncated.");
    }
    if (id1 === 0x52 && id2 === 0x41) {
      if (randomAccess) {
        fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .dict.dz contains duplicate RA metadata.");
      }
      randomAccess = bytes.subarray(cursor, cursor + length);
    }
    cursor += length;
  }
  if (cursor !== extraEnd || !randomAccess) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .dict.dz is missing dictzip RA metadata.");
  }
  if (randomAccess.byteLength < 8) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .dict.dz RA metadata is truncated.");
  }

  const version = readUint16Le(randomAccess, 0);
  const chunkLength = readUint16Le(randomAccess, 2);
  const chunkCount = readUint16Le(randomAccess, 4);
  if (version !== 1) {
    fail(STARDICT_IMPORT_ERROR.UNSUPPORTED, "Unsupported StarDict dictzip RA format version.", {
      version
    });
  }
  if (!chunkLength || !chunkCount) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .dict.dz RA metadata contains zero-valued required fields.");
  }
  const expectedBytes = 6 + chunkCount * 2;
  if (randomAccess.byteLength !== expectedBytes) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .dict.dz RA chunk table length is inconsistent.", {
      expected: expectedBytes,
      actual: randomAccess.byteLength
    });
  }

  let compressedChunkBytes = 0;
  for (let index = 0; index < chunkCount; index += 1) {
    const size = readUint16Le(randomAccess, 6 + index * 2);
    if (!size) {
      fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .dict.dz RA metadata contains an empty compressed chunk.");
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

async function readDictzipHeaderPrefix(path, fileBytes) {
  const handle = await open(resolve(path), "r");
  try {
    const fixed = Buffer.alloc(Math.min(fileBytes, 12));
    const first = await handle.read(fixed, 0, fixed.byteLength, 0);
    if (first.bytesRead < 12) return fixed.subarray(0, first.bytesRead);
    const extraLength = readUint16Le(fixed, 10);
    const headerBytes = 12 + extraLength;
    if (headerBytes > fileBytes) {
      fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .dict.dz declared extra header exceeds the file.");
    }
    const header = Buffer.alloc(headerBytes);
    const read = await handle.read(header, 0, headerBytes, 0);
    if (read.bytesRead !== headerBytes) {
      fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .dict.dz gzip header is truncated.");
    }
    return header;
  } finally {
    await handle.close();
  }
}

async function gunzipBounded(path, maximumBytes, inputBytes) {
  const source = createReadStream(resolve(path), {
    start: 0,
    end: Math.max(0, inputBytes - 1)
  });
  const gunzip = createGunzip();
  source.pipe(gunzip);
  const chunks = [];
  let total = 0;

  try {
    for await (const chunk of gunzip) {
      total += chunk.byteLength;
      if (total > maximumBytes) {
        source.destroy();
        gunzip.destroy();
        fail(STARDICT_IMPORT_ERROR.LIMIT, "DICT decompressed bytes exceeds the POC safety limit.", {
          actual: total,
          maximum: maximumBytes
        });
      }
      chunks.push(Buffer.from(chunk));
    }
  } catch (cause) {
    source.destroy();
    gunzip.destroy();
    if (cause instanceof StarDictImportError) throw cause;
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .dict.dz decompression failed.", { cause });
  }
  return Buffer.concat(chunks, total);
}

export function projectStarDictPlainText({
  ifoText,
  idxBytes,
  dictBytes,
  synBytes,
  sourceId = "user-stardict",
  sourceVersion = "local-import",
  limits = STARDICT_POC_LIMITS
} = {}) {
  requireSafeSourceId(sourceId);
  requireText(sourceVersion, "sourceVersion");
  const dictionary = parseStarDictIfo(ifoText, limits);
  const idx = toBytes(idxBytes, "IDX");
  const dict = toBytes(dictBytes, "DICT");
  requireAtMost(idx.byteLength, limits.idxBytes, "IDX bytes");
  requireAtMost(dict.byteLength, limits.dictBytes, "DICT bytes");

  if (dictionary.idxfilesize !== idx.byteLength) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict idxfilesize does not match the selected .idx bytes.", {
      expected: dictionary.idxfilesize,
      actual: idx.byteLength
    });
  }

  const index = parseStarDictIndex(idx, {
    wordCount: dictionary.wordcount,
    dictBytes: dict.byteLength,
    limits
  });
  const aliases = parseStarDictSynonyms(synBytes, {
    synonymCount: dictionary.synwordcount,
    wordCount: dictionary.wordcount,
    limits
  });
  const aliasesByTarget = new Map();
  for (const alias of aliases) {
    const list = aliasesByTarget.get(alias.targetIndex) || [];
    list.push(alias.word);
    aliasesByTarget.set(alias.targetIndex, list);
  }

  const entries = index.map((item, indexPosition) => {
    const payload = dict.subarray(item.offset, item.offset + item.size);
    const plainText = sanitizePlainText(decodeUtf8(payload, "dictionary entry"), limits, item.word);
    const entryAliases = aliasesByTarget.get(indexPosition) || [];
    return {
      lookupKey: normalizeLookupKey(item.word),
      exactLookupKey: normalizeExactLookupKey(item.word),
      displayForm: item.word,
      plainText,
      ...(entryAliases.length ? { aliases: [...entryAliases] } : {}),
      sourceRef: {
        sourceId,
        recordId: "idx:" + (indexPosition + 1)
      }
    };
  });

  return {
    dictionary: {
      bookname: dictionary.bookname,
      version: dictionary.version,
      wordcount: dictionary.wordcount,
      idxfilesize: dictionary.idxfilesize,
      synwordcount: dictionary.synwordcount,
      sametypesequence: dictionary.sametypesequence
    },
    entries,
    policy: {
      semanticStatus: "unclassified-plain-text",
      runtimeStatus: "build-test-only",
      contentMode: "text-only",
      richMarkup: "rejected",
      networkResources: "never-rendered",
      tflexMapping: "not-yet-approved"
    },
    unsupportedFeatures: [
      "64-bit index offsets",
      "rich StarDict field types",
      "embedded/renderable markup",
      "resource bundles"
    ]
  };
}

export function parseStarDictIfo(input, limits = STARDICT_POC_LIMITS) {
  const source = String(input || "");
  requireAtMost(Buffer.byteLength(source), limits.ifoBytes, "IFO bytes");
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  if (lines.shift() !== IFO_HEADER) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .ifo header is missing or invalid.");
  }

  const fields = Object.create(null);
  for (const raw of lines) {
    if (!raw) continue;
    const equal = raw.indexOf("=");
    if (equal <= 0) fail(STARDICT_IMPORT_ERROR.CORRUPT, "Malformed StarDict .ifo field.");
    const key = raw.slice(0, equal).trim();
    const value = raw.slice(equal + 1);
    if (!/^[a-z][a-z0-9_]*$/i.test(key) || Object.hasOwn(fields, key)) {
      fail(STARDICT_IMPORT_ERROR.CORRUPT, "Duplicate or invalid StarDict .ifo key.", { key });
    }
    fields[key] = value;
  }

  if (!SUPPORTED_VERSIONS.has(fields.version)) {
    fail(STARDICT_IMPORT_ERROR.UNSUPPORTED, "Unsupported StarDict format version.", {
      version: fields.version || null
    });
  }
  requireText(fields.bookname, "StarDict bookname");
  const wordcount = positiveInteger(fields.wordcount, "StarDict wordcount");
  const idxfilesize = positiveInteger(fields.idxfilesize, "StarDict idxfilesize");
  requireAtMost(wordcount, limits.entryCount, "StarDict wordcount");
  requireAtMost(idxfilesize, limits.idxBytes, "StarDict idxfilesize");

  if (fields.idxoffsetbits !== undefined && fields.idxoffsetbits !== "32") {
    fail(STARDICT_IMPORT_ERROR.UNSUPPORTED, "64-bit StarDict index offsets are not supported by this POC.");
  }
  const synwordcount = fields.synwordcount === undefined
    ? 0
    : nonNegativeInteger(fields.synwordcount, "StarDict synwordcount");
  requireAtMost(synwordcount, limits.synonymCount, "StarDict synwordcount");
  if (fields.sametypesequence !== "m") {
    fail(STARDICT_IMPORT_ERROR.UNSUPPORTED, "Only UTF-8 plain-text StarDict sametypesequence=m is supported.", {
      sametypesequence: fields.sametypesequence || null
    });
  }

  return {
    version: fields.version,
    bookname: fields.bookname,
    wordcount,
    idxfilesize,
    synwordcount,
    sametypesequence: fields.sametypesequence
  };
}

export function parseStarDictIndex(input, {
  wordCount,
  dictBytes,
  limits = STARDICT_POC_LIMITS
} = {}) {
  const bytes = toBytes(input, "IDX");
  requireAtMost(bytes.byteLength, limits.idxBytes, "IDX bytes");
  if (!Number.isSafeInteger(wordCount) || wordCount <= 0) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict wordCount must be a positive integer.");
  }
  if (!Number.isSafeInteger(dictBytes) || dictBytes < 0) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict dictionary byte size is invalid.");
  }

  const result = [];
  let cursor = 0;
  let previousWordBytes = null;
  while (cursor < bytes.byteLength) {
    const end = findNul(bytes, cursor, limits.headwordBytes);
    if (end < 0) {
      fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .idx headword is unterminated or exceeds the headword limit.");
    }
    const wordBytes = bytes.subarray(cursor, end);
    if (!wordBytes.byteLength) fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .idx contains an empty headword.");
    const word = decodeUtf8(wordBytes, "IDX headword");
    validateHeadword(word);

    if (previousWordBytes && compareStarDictWordBytes(previousWordBytes, wordBytes) > 0) {
      fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .idx headwords are not StarDict-sorted.");
    }
    previousWordBytes = Uint8Array.from(wordBytes);

    cursor = end + 1;
    if (cursor + 8 > bytes.byteLength) {
      fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .idx record is truncated.");
    }
    const offset = readUint32Be(bytes, cursor);
    const size = readUint32Be(bytes, cursor + 4);
    cursor += 8;

    if (size <= 0) fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict entry size must be positive.", { word });
    requireAtMost(size, limits.entryBytes, "StarDict entry bytes");
    if (offset > dictBytes || size > dictBytes - offset) {
      fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .idx entry points outside the .dict file.", {
        word, offset, size, dictBytes
      });
    }

    result.push({ word, offset, size });
    requireAtMost(result.length, limits.entryCount, "StarDict index entries");
  }

  if (result.length !== wordCount) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict wordcount does not match .idx entries.", {
      expected: wordCount,
      actual: result.length
    });
  }
  return result;
}

export function parseStarDictSynonyms(input, {
  synonymCount = 0,
  wordCount,
  limits = STARDICT_POC_LIMITS
} = {}) {
  if (!Number.isSafeInteger(synonymCount) || synonymCount < 0) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict synonymCount must be a non-negative integer.");
  }
  requireAtMost(synonymCount, limits.synonymCount, "StarDict synonym count");
  if (!Number.isSafeInteger(wordCount) || wordCount <= 0) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict wordCount must be a positive integer.");
  }

  if (input === undefined || input === null) {
    if (synonymCount === 0) return [];
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .ifo declares synonyms but no .syn bytes were supplied.");
  }

  const bytes = toBytes(input, "SYN");
  requireAtMost(bytes.byteLength, limits.synBytes, "SYN bytes");
  if (synonymCount === 0) {
    if (bytes.byteLength === 0) return [];
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .syn bytes were supplied without a positive synwordcount.");
  }

  const result = [];
  let cursor = 0;
  let previousWordBytes = null;
  while (cursor < bytes.byteLength) {
    const end = findNul(bytes, cursor, limits.headwordBytes);
    if (end < 0) {
      fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .syn headword is unterminated or exceeds the headword limit.");
    }
    const wordBytes = bytes.subarray(cursor, end);
    if (!wordBytes.byteLength) fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .syn contains an empty alias.");
    const word = decodeUtf8(wordBytes, "SYN alias");
    validateHeadword(word);

    if (previousWordBytes && compareStarDictWordBytes(previousWordBytes, wordBytes) > 0) {
      fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .syn aliases are not StarDict-sorted.");
    }
    previousWordBytes = Uint8Array.from(wordBytes);

    cursor = end + 1;
    if (cursor + 4 > bytes.byteLength) {
      fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .syn record is truncated.");
    }
    const targetIndex = readUint32Be(bytes, cursor);
    cursor += 4;
    if (targetIndex >= wordCount) {
      fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict .syn target index is outside the .idx word list.", {
        word, targetIndex, wordCount
      });
    }

    result.push({ word, targetIndex });
    requireAtMost(result.length, limits.synonymCount, "StarDict synonym entries");
  }

  if (result.length !== synonymCount) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict synwordcount does not match .syn entries.", {
      expected: synonymCount,
      actual: result.length
    });
  }
  return result;
}

export function sanitizePlainText(value, limits = STARDICT_POC_LIMITS, headword = "") {
  const text = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!text) fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict entry is empty.", { headword });
  if (CONTROL.test(text)) {
    fail(STARDICT_IMPORT_ERROR.UNSAFE_CONTENT, "StarDict entry contains unsafe control characters.", { headword });
  }
  if (HTML_LIKE.test(text)) {
    fail(STARDICT_IMPORT_ERROR.UNSAFE_CONTENT, "Renderable markup is rejected by the StarDict POC.", { headword });
  }
  requireAtMost(Buffer.byteLength(text), limits.entryBytes, "StarDict sanitized entry bytes");
  return text;
}

function validateHeadword(word) {
  if (!word || CONTROL.test(word) || HTML_LIKE.test(word)) {
    fail(STARDICT_IMPORT_ERROR.UNSAFE_CONTENT, "Unsafe StarDict headword.");
  }
  if (!normalizeLookupKey(word)) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict headword cannot be normalized.");
  }
}

function findNul(bytes, start, maxBytes) {
  const max = Math.min(bytes.byteLength, start + maxBytes + 1);
  for (let index = start; index < max; index += 1) {
    if (bytes[index] === 0) return index;
  }
  return -1;
}

function compareStarDictWordBytes(left, right) {
  const folded = compareAsciiCaseInsensitiveBytes(left, right);
  if (folded !== 0) return folded;
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function compareAsciiCaseInsensitiveBytes(left, right) {
  const length = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    const a = foldAsciiByte(left[index]);
    const b = foldAsciiByte(right[index]);
    if (a !== b) return a < b ? -1 : 1;
  }
  if (left.byteLength === right.byteLength) return 0;
  return left.byteLength < right.byteLength ? -1 : 1;
}

function foldAsciiByte(value) {
  return value >= 0x41 && value <= 0x5a ? value + 0x20 : value;
}

function readUint16Le(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.byteLength) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "StarDict little-endian uint16 is truncated.");
  }
  return bytes[offset] + bytes[offset + 1] * 0x100;
}

function readUint32Be(bytes, offset) {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  ) >>> 0;
}

function decodeUtf8(bytes, label) {
  try {
    return UTF8.decode(bytes);
  } catch (cause) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, label + " is not valid UTF-8.", { cause });
  }
}

function toBytes(value, label) {
  if (value instanceof Uint8Array) return value;
  if (Buffer.isBuffer(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  fail(STARDICT_IMPORT_ERROR.CORRUPT, label + " must be bytes.");
}

async function checkedFileSize(path, maximum, label) {
  const info = await stat(resolve(path));
  if (!info.isFile()) fail(STARDICT_IMPORT_ERROR.CORRUPT, label + " path is not a file.");
  requireAtMost(info.size, maximum, label + " bytes");
  return info.size;
}

function requiredPath(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(label + " is required");
  return text;
}

function optionalPath(value) {
  const text = String(value || "").trim();
  return text || "";
}

function requireSafeSourceId(value) {
  const text = String(value || "");
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/i.test(text)) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, "sourceId is invalid.");
  }
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, label + " is required.");
  }
  return value;
}

function positiveInteger(value, label) {
  if (!/^\d+$/.test(String(value || ""))) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, label + " must be a positive integer.");
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, label + " must be a positive safe integer.");
  }
  return number;
}

function nonNegativeInteger(value, label) {
  if (!/^\d+$/.test(String(value ?? ""))) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, label + " must be a non-negative integer.");
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    fail(STARDICT_IMPORT_ERROR.CORRUPT, label + " must be a non-negative safe integer.");
  }
  return number;
}

function requireAtMost(actual, maximum, label) {
  if (!Number.isSafeInteger(actual) || actual < 0 || !Number.isSafeInteger(maximum) || actual > maximum) {
    fail(STARDICT_IMPORT_ERROR.LIMIT, label + " exceeds the POC safety limit.", {
      actual, maximum
    });
  }
}

function fail(code, message, details) {
  throw new StarDictImportError(code, message, details);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(
        "usage: project-stardict-import.mjs --ifo PATH --idx PATH --dict PATH " +
        "[--syn PATH] --out PATH --report PATH [--source-id ID] [--source-version VERSION]"
      );
    }
    result[key.slice(2)] = value;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const key of ["ifo", "idx", "dict", "out", "report"]) {
    if (!args[key]) throw new Error("--" + key + " is required");
  }
  const result = await projectStarDictPoc({
    ifoPath: args.ifo,
    idxPath: args.idx,
    dictPath: args.dict,
    synPath: args.syn,
    outPath: args.out,
    reportPath: args.report,
    sourceId: args["source-id"] || "user-stardict",
    sourceVersion: args["source-version"] || "local-import"
  });
  process.stdout.write(JSON.stringify(result.report, null, 2) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
