#!/usr/bin/env node
import { stat, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { createInflate } from "node:zlib";
import {
  normalizeExactLookupKey,
  normalizeLookupKey,
  stableStringify
} from "./build-tflex-core.mjs";

export const MDICT_POC_LIMITS = Object.freeze({
  fileBytes: 128 * 1024 * 1024,
  headerBytes: 256 * 1024,
  keyIndexBytes: 16 * 1024 * 1024,
  blockCompressedBytes: 32 * 1024 * 1024,
  blockDecompressedBytes: 32 * 1024 * 1024,
  totalRecordBytes: 128 * 1024 * 1024,
  entryBytes: 512 * 1024,
  entryCount: 1_000_000,
  blockCount: 65_536,
  headwordBytes: 1024
});

export const MDICT_IMPORT_ERROR = Object.freeze({
  CORRUPT: "MDICT_CORRUPT",
  LIMIT: "MDICT_LIMIT",
  UNSUPPORTED: "MDICT_UNSUPPORTED",
  UNSAFE_CONTENT: "MDICT_UNSAFE_CONTENT"
});

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const UTF16LE = new TextDecoder("utf-16le", { fatal: true });
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const HTML_LIKE = /<\s*\/?\s*[a-z][^>]*>/i;
const MDX_LINK = /^@@@LINK=/i;

export class MDictImportError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "MDictImportError";
    this.code = code;
    Object.assign(this, details);
  }
}

export async function projectMdictPoc({
  mdxPath,
  outPath,
  reportPath,
  sourceId = "user-mdict",
  sourceVersion = "local-import",
  limits = MDICT_POC_LIMITS
} = {}) {
  const path = requiredPath(mdxPath, "mdxPath");
  if (!/\.mdx$/i.test(path)) {
    fail(MDICT_IMPORT_ERROR.UNSUPPORTED, "MDict POC accepts .mdx dictionary files only.");
  }
  const inputBytes = await checkedFileSize(path, limits.fileBytes, "MDX");
  const bytes = await readFile(resolve(path));
  requireAtMost(bytes.byteLength, limits.fileBytes, "MDX bytes");
  requireSafeSourceId(sourceId);
  requireText(sourceVersion, "sourceVersion");

  const result = await projectMdictV2PlainText({
    mdxBytes: bytes,
    sourceId,
    sourceVersion,
    limits
  });
  const output = result.entries.map((entry) => stableStringify(entry)).join("\n") + "\n";
  const report = {
    schemaVersion: 1,
    format: "mdict-poc-report",
    sourceId,
    sourceVersion,
    input: {
      fileBytes: inputBytes
    },
    dictionary: result.dictionary,
    blocks: result.blocks,
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

export async function projectMdictV2PlainText({
  mdxBytes,
  sourceId = "user-mdict",
  sourceVersion = "local-import",
  limits = MDICT_POC_LIMITS
} = {}) {
  requireSafeSourceId(sourceId);
  requireText(sourceVersion, "sourceVersion");
  const file = toBytes(mdxBytes, "MDX");
  requireAtMost(file.byteLength, limits.fileBytes, "MDX bytes");
  const cursor = new ByteCursor(file);

  const header = parseMdictHeader(cursor, limits);
  const preambleBytes = cursor.read(40, "MDict keyword section preamble");
  const preambleChecksum = cursor.readUint32Be("MDict keyword preamble checksum");
  if (adler32(preambleBytes) !== preambleChecksum) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, "MDict keyword section preamble checksum mismatch.");
  }

  const preamble = new ByteCursor(preambleBytes);
  const numKeyBlocks = preamble.readSafeUint64Be("MDict key block count");
  const numEntries = preamble.readSafeUint64Be("MDict entry count");
  const keyIndexDecompressedBytes = preamble.readSafeUint64Be("MDict key index decompressed bytes");
  const keyIndexCompressedBytes = preamble.readSafeUint64Be("MDict key index compressed bytes");
  const keyBlocksBytes = preamble.readSafeUint64Be("MDict key blocks bytes");
  requireAtMost(numKeyBlocks, limits.blockCount, "MDict key block count");
  requireAtMost(numEntries, limits.entryCount, "MDict entry count");
  requireAtMost(keyIndexDecompressedBytes, limits.keyIndexBytes, "MDict key index decompressed bytes");
  requireAtMost(keyIndexCompressedBytes, limits.blockCompressedBytes, "MDict key index compressed bytes");
  requireAtMost(keyBlocksBytes, limits.fileBytes, "MDict key blocks bytes");
  if (!numKeyBlocks || !numEntries || preamble.remaining !== 0) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, "MDict keyword section preamble is invalid.");
  }

  const keyIndexCompressed = cursor.read(keyIndexCompressedBytes, "MDict key index");
  const keyIndexDecoded = await decodeMdictBlock(
    keyIndexCompressed,
    keyIndexDecompressedBytes,
    limits,
    "MDict key index"
  );
  const keyBlockDescriptors = parseKeyBlockIndex(
    keyIndexDecoded.bytes,
    numKeyBlocks,
    numEntries,
    header.encoding,
    limits
  );
  const keyBlocksCompressedTotal = keyBlockDescriptors.reduce((sum, item) => sum + item.compressedBytes, 0);
  if (keyBlocksCompressedTotal !== keyBlocksBytes) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, "MDict key block size total does not match the keyword preamble.");
  }

  const keys = [];
  const keyCompression = new Set([keyIndexDecoded.compression]);
  let previousRecordOffset = -1;
  for (let blockIndex = 0; blockIndex < keyBlockDescriptors.length; blockIndex += 1) {
    const descriptor = keyBlockDescriptors[blockIndex];
    const compressed = cursor.read(descriptor.compressedBytes, "MDict key block");
    const decoded = await decodeMdictBlock(
      compressed,
      descriptor.decompressedBytes,
      limits,
      "MDict key block"
    );
    keyCompression.add(decoded.compression);
    const blockKeys = splitKeyBlock(
      decoded.bytes,
      descriptor.entryCount,
      header.encoding,
      limits
    );
    if (!blockKeys.length ||
        blockKeys[0].displayForm !== descriptor.firstKey ||
        blockKeys[blockKeys.length - 1].displayForm !== descriptor.lastKey) {
      fail(MDICT_IMPORT_ERROR.CORRUPT, "MDict key block boundary does not match its index.");
    }
    for (const item of blockKeys) {
      if (item.recordOffset < previousRecordOffset) {
        fail(MDICT_IMPORT_ERROR.CORRUPT, "MDict record offsets are not monotonic.");
      }
      previousRecordOffset = item.recordOffset;
      keys.push(item);
    }
  }
  if (keys.length !== numEntries) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, "MDict parsed key count does not match the declared entry count.", {
      expected: numEntries,
      actual: keys.length
    });
  }

  const numRecordBlocks = cursor.readSafeUint64Be("MDict record block count");
  const recordEntryCount = cursor.readSafeUint64Be("MDict record entry count");
  const recordIndexBytes = cursor.readSafeUint64Be("MDict record index bytes");
  const recordBlocksBytes = cursor.readSafeUint64Be("MDict record blocks bytes");
  requireAtMost(numRecordBlocks, limits.blockCount, "MDict record block count");
  requireAtMost(recordBlocksBytes, limits.fileBytes, "MDict record blocks bytes");
  if (!numRecordBlocks || recordEntryCount !== numEntries || recordIndexBytes !== numRecordBlocks * 16) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, "MDict record section header is inconsistent.");
  }

  const recordDescriptors = [];
  let declaredRecordCompressedTotal = 0;
  let declaredRecordDecompressedTotal = 0;
  for (let index = 0; index < numRecordBlocks; index += 1) {
    const compressedBytes = cursor.readSafeUint64Be("MDict record block compressed bytes");
    const decompressedBytes = cursor.readSafeUint64Be("MDict record block decompressed bytes");
    requireAtMost(compressedBytes, limits.blockCompressedBytes, "MDict record block compressed bytes");
    requireAtMost(decompressedBytes, limits.blockDecompressedBytes, "MDict record block decompressed bytes");
    if (compressedBytes < 8 || !decompressedBytes) {
      fail(MDICT_IMPORT_ERROR.CORRUPT, "MDict record block sizes are invalid.");
    }
    declaredRecordCompressedTotal += compressedBytes;
    declaredRecordDecompressedTotal += decompressedBytes;
    requireAtMost(declaredRecordDecompressedTotal, limits.totalRecordBytes, "MDict total record bytes");
    recordDescriptors.push({ compressedBytes, decompressedBytes });
  }
  if (declaredRecordCompressedTotal !== recordBlocksBytes) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, "MDict record block size total does not match the record header.");
  }

  const recordChunks = [];
  const recordCompression = new Set();
  let actualRecordBytes = 0;
  for (const descriptor of recordDescriptors) {
    const compressed = cursor.read(descriptor.compressedBytes, "MDict record block");
    const decoded = await decodeMdictBlock(
      compressed,
      descriptor.decompressedBytes,
      limits,
      "MDict record block"
    );
    recordCompression.add(decoded.compression);
    actualRecordBytes += decoded.bytes.byteLength;
    requireAtMost(actualRecordBytes, limits.totalRecordBytes, "MDict total record bytes");
    recordChunks.push(Buffer.from(decoded.bytes));
  }
  if (cursor.remaining !== 0) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, "MDict file contains unexpected trailing bytes.");
  }
  const recordBytes = Buffer.concat(recordChunks, actualRecordBytes);

  const entries = keys.map((item, index) => {
    const start = item.recordOffset;
    const end = index + 1 < keys.length ? keys[index + 1].recordOffset : recordBytes.byteLength;
    if (start < 0 || start > end || end > recordBytes.byteLength) {
      fail(MDICT_IMPORT_ERROR.CORRUPT, "MDict key points outside the decompressed record stream.", {
        headword: item.displayForm,
        start,
        end,
        recordBytes: recordBytes.byteLength
      });
    }
    requireAtMost(end - start, limits.entryBytes, "MDict record bytes");
    const plainText = sanitizeMdictRecord(
      decodeMdictRecord(recordBytes.subarray(start, end), header.encoding),
      item.displayForm,
      limits
    );
    return {
      lookupKey: normalizeLookupKey(item.displayForm),
      exactLookupKey: normalizeExactLookupKey(item.displayForm),
      displayForm: item.displayForm,
      plainText,
      sourceRef: {
        sourceId,
        recordId: "entry:" + (index + 1)
      }
    };
  });

  return {
    dictionary: {
      title: header.title,
      generatedByEngineVersion: header.generatedByEngineVersion,
      requiredEngineVersion: header.requiredEngineVersion,
      encoding: header.encoding.name,
      format: header.format,
      entryCount: numEntries
    },
    entries,
    blocks: {
      keyBlocks: numKeyBlocks,
      recordBlocks: numRecordBlocks,
      keyCompression: [...keyCompression].sort(),
      recordCompression: [...recordCompression].sort(),
      decompressedRecordBytes: recordBytes.byteLength
    },
    policy: {
      semanticStatus: "unclassified-plain-text",
      runtimeStatus: "build-test-only",
      contentMode: "text-only",
      htmlRendering: "rejected",
      compactStyles: "rejected",
      mddResources: "not-loaded",
      networkResources: "never-rendered",
      tflexMapping: "not-yet-approved"
    },
    unsupportedFeatures: [
      "MDX 1.x and 3.x",
      "encrypted MDX",
      "LZO-compressed blocks",
      "GBK/Big5 text encodings",
      "Compact/StyleSheet presentation transforms",
      "HTML/renderable record markup",
      "MDX @@@LINK redirects",
      ".mdd resources"
    ]
  };
}

export function parseMdictHeader(input, limits = MDICT_POC_LIMITS) {
  const cursor = input instanceof ByteCursor ? input : new ByteCursor(input);
  const headerBytesLength = cursor.readUint32Be("MDict header bytes");
  requireAtMost(headerBytesLength, limits.headerBytes, "MDict header bytes");
  if (headerBytesLength < 4 || headerBytesLength % 2 !== 0) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, "MDict UTF-16LE header byte length is invalid.");
  }
  const headerBytes = cursor.read(headerBytesLength, "MDict header");
  const expectedChecksum = cursor.readUint32Le("MDict header checksum");
  if (adler32(headerBytes) !== expectedChecksum) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, "MDict header checksum mismatch.");
  }

  const headerText = decodeUtf16Le(headerBytes, "MDict header")
    .replace(/\u0000+$/g, "")
    .trim();
  const attributes = parseDictionaryAttributes(headerText);
  const generatedByEngineVersion = attributes.GeneratedByEngineVersion || "";
  if (generatedByEngineVersion !== "2.0") {
    fail(MDICT_IMPORT_ERROR.UNSUPPORTED, "Only MDict MDX v2.0 is supported by this POC.", {
      version: generatedByEngineVersion || null
    });
  }

  const encrypted = parseEncryptedFlag(attributes.Encrypted);
  if (encrypted !== 0) {
    fail(MDICT_IMPORT_ERROR.UNSUPPORTED, "Encrypted MDict dictionaries are not supported by this POC.", {
      encrypted
    });
  }
  const encoding = normalizeMdictEncoding(attributes.Encoding);
  if (String(attributes.Compact || "No").toLowerCase() === "yes" ||
      String(attributes.Compat || "No").toLowerCase() === "yes" ||
      String(attributes.StyleSheet || "").trim()) {
    fail(MDICT_IMPORT_ERROR.UNSUPPORTED, "MDict Compact/StyleSheet presentation transforms are not supported.");
  }

  return {
    generatedByEngineVersion,
    requiredEngineVersion: attributes.RequiredEngineVersion || "",
    title: cleanMetadataText(attributes.Title || ""),
    format: cleanMetadataText(attributes.Format || ""),
    encoding,
    encrypted,
    attributes
  };
}

function parseKeyBlockIndex(input, blockCount, entryCount, encoding, limits) {
  const cursor = new ByteCursor(input);
  const descriptors = [];
  let countedEntries = 0;
  for (let index = 0; index < blockCount; index += 1) {
    const blockEntries = cursor.readSafeUint64Be("MDict key index entry count");
    requireAtMost(blockEntries, limits.entryCount, "MDict key index entry count");
    if (!blockEntries) fail(MDICT_IMPORT_ERROR.CORRUPT, "MDict key block declares zero entries.");
    const firstKey = readSizedKey(cursor, encoding, limits, "MDict first key");
    const lastKey = readSizedKey(cursor, encoding, limits, "MDict last key");
    const compressedBytes = cursor.readSafeUint64Be("MDict key block compressed bytes");
    const decompressedBytes = cursor.readSafeUint64Be("MDict key block decompressed bytes");
    requireAtMost(compressedBytes, limits.blockCompressedBytes, "MDict key block compressed bytes");
    requireAtMost(decompressedBytes, limits.blockDecompressedBytes, "MDict key block decompressed bytes");
    if (compressedBytes < 8 || !decompressedBytes) {
      fail(MDICT_IMPORT_ERROR.CORRUPT, "MDict key block sizes are invalid.");
    }
    countedEntries += blockEntries;
    requireAtMost(countedEntries, limits.entryCount, "MDict key index total entries");
    descriptors.push({
      entryCount: blockEntries,
      firstKey,
      lastKey,
      compressedBytes,
      decompressedBytes
    });
  }
  if (cursor.remaining !== 0 || countedEntries !== entryCount) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, "MDict key index size/count is inconsistent.");
  }
  return descriptors;
}

function splitKeyBlock(input, entryCount, encoding, limits) {
  const cursor = new ByteCursor(input);
  const result = [];
  for (let index = 0; index < entryCount; index += 1) {
    const recordOffset = cursor.readSafeUint64Be("MDict record offset");
    const displayForm = readNullTerminatedText(cursor, encoding, limits.headwordBytes, "MDict headword");
    validateHeadword(displayForm);
    result.push({ recordOffset, displayForm });
  }
  if (cursor.remaining !== 0) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, "MDict key block has trailing bytes.");
  }
  return result;
}

async function decodeMdictBlock(input, expectedBytes, limits, label) {
  const block = toBytes(input, label);
  requireAtMost(block.byteLength, limits.blockCompressedBytes, label + " compressed bytes");
  requireAtMost(expectedBytes, limits.blockDecompressedBytes, label + " decompressed bytes");
  if (block.byteLength < 8) fail(MDICT_IMPORT_ERROR.CORRUPT, label + " is truncated.");

  const type = block.subarray(0, 4);
  const expectedChecksum = readUint32BeAt(block, 4);
  const payload = block.subarray(8);
  let bytes;
  let compression;
  if (type[0] === 0 && type[1] === 0 && type[2] === 0 && type[3] === 0) {
    bytes = payload;
    compression = "none";
  } else if (type[0] === 1 && type[1] === 0 && type[2] === 0 && type[3] === 0) {
    fail(MDICT_IMPORT_ERROR.UNSUPPORTED, "LZO-compressed MDict blocks are not supported.", { label });
  } else if (type[0] === 2 && type[1] === 0 && type[2] === 0 && type[3] === 0) {
    bytes = await inflateBounded(payload, Math.min(expectedBytes, limits.blockDecompressedBytes), label);
    compression = "zlib";
  } else {
    fail(MDICT_IMPORT_ERROR.UNSUPPORTED, "Unknown MDict block compression type.", {
      label,
      type: [...type]
    });
  }

  if (bytes.byteLength !== expectedBytes) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, label + " decompressed size mismatch.", {
      expected: expectedBytes,
      actual: bytes.byteLength
    });
  }
  if (adler32(bytes) !== expectedChecksum) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, label + " Adler32 checksum mismatch.");
  }
  return { bytes, compression };
}

async function inflateBounded(input, maximumBytes, label) {
  const source = Readable.from([Buffer.from(input)]);
  const inflate = createInflate();
  source.pipe(inflate);
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of inflate) {
      total += chunk.byteLength;
      if (total > maximumBytes) {
        source.destroy();
        inflate.destroy();
        fail(MDICT_IMPORT_ERROR.LIMIT, label + " decompressed bytes exceeds the POC safety limit.", {
          actual: total,
          maximum: maximumBytes
        });
      }
      chunks.push(Buffer.from(chunk));
    }
  } catch (cause) {
    source.destroy();
    inflate.destroy();
    if (cause instanceof MDictImportError) throw cause;
    fail(MDICT_IMPORT_ERROR.CORRUPT, label + " zlib decompression failed.", { cause });
  }
  return Buffer.concat(chunks, total);
}

function readSizedKey(cursor, encoding, limits, label) {
  const units = cursor.readUint16Be(label + " length");
  const byteLength = units * encoding.unitBytes;
  requireAtMost(byteLength, limits.headwordBytes, label + " bytes");
  const raw = cursor.read(byteLength, label);
  const terminator = cursor.read(encoding.unitBytes, label + " terminator");
  if (![...terminator].every((value) => value === 0)) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, label + " is missing its null terminator.");
  }
  const text = decodeMdictText(raw, encoding, label);
  validateHeadword(text);
  return text;
}

function readNullTerminatedText(cursor, encoding, maximumBytes, label) {
  const start = cursor.offset;
  let end = -1;
  if (encoding.unitBytes === 1) {
    const max = Math.min(cursor.bytes.byteLength, start + maximumBytes + 1);
    for (let index = start; index < max; index += 1) {
      if (cursor.bytes[index] === 0) {
        end = index;
        break;
      }
    }
  } else {
    const max = Math.min(cursor.bytes.byteLength - 1, start + maximumBytes + 2);
    for (let index = start; index < max; index += 2) {
      if (cursor.bytes[index] === 0 && cursor.bytes[index + 1] === 0) {
        end = index;
        break;
      }
    }
  }
  if (end < 0) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, label + " is unterminated or exceeds the byte limit.");
  }
  const raw = cursor.read(end - start, label);
  const terminator = cursor.read(encoding.unitBytes, label + " terminator");
  if (![...terminator].every((value) => value === 0)) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, label + " terminator is malformed.");
  }
  return decodeMdictText(raw, encoding, label);
}

function decodeMdictRecord(input, encoding) {
  let bytes = toBytes(input, "MDict record");
  while (bytes.byteLength >= encoding.unitBytes) {
    const tail = bytes.subarray(bytes.byteLength - encoding.unitBytes);
    if (![...tail].every((value) => value === 0)) break;
    bytes = bytes.subarray(0, bytes.byteLength - encoding.unitBytes);
  }
  return decodeMdictText(bytes, encoding, "MDict record");
}

export function sanitizeMdictRecord(value, headword = "", limits = MDICT_POC_LIMITS) {
  const text = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!text) fail(MDICT_IMPORT_ERROR.CORRUPT, "MDict record is empty.", { headword });
  if (CONTROL.test(text)) {
    fail(MDICT_IMPORT_ERROR.UNSAFE_CONTENT, "MDict record contains unsafe control characters.", { headword });
  }
  if (HTML_LIKE.test(text)) {
    fail(MDICT_IMPORT_ERROR.UNSAFE_CONTENT, "Renderable markup is rejected by the MDict POC.", { headword });
  }
  if (MDX_LINK.test(text)) {
    fail(MDICT_IMPORT_ERROR.UNSUPPORTED, "MDict @@@LINK redirects are not supported by this POC.", { headword });
  }
  requireAtMost(Buffer.byteLength(text), limits.entryBytes, "MDict sanitized record bytes");
  return text;
}

function validateHeadword(value) {
  const text = String(value || "");
  if (!text || CONTROL.test(text) || HTML_LIKE.test(text)) {
    fail(MDICT_IMPORT_ERROR.UNSAFE_CONTENT, "Unsafe MDict headword.");
  }
  if (!normalizeLookupKey(text)) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, "MDict headword cannot be normalized.");
  }
}

function parseDictionaryAttributes(text) {
  const match = /^<Dictionary\b([\s\S]*?)\/>\s*$/i.exec(String(text || ""));
  if (!match) fail(MDICT_IMPORT_ERROR.CORRUPT, "MDict header must contain one self-closing Dictionary tag.");
  const source = match[1];
  const attributes = Object.create(null);
  let offset = 0;
  while (offset < source.length) {
    while (offset < source.length && /\s/.test(source[offset])) offset += 1;
    if (offset >= source.length) break;
    const fragment = source.slice(offset);
    const attribute = /^([A-Za-z][A-Za-z0-9_]*)="([^"]*)"/.exec(fragment);
    if (!attribute) fail(MDICT_IMPORT_ERROR.CORRUPT, "Malformed MDict header attribute.");
    const key = attribute[1];
    if (Object.hasOwn(attributes, key)) {
      fail(MDICT_IMPORT_ERROR.CORRUPT, "Duplicate MDict header attribute.", { key });
    }
    attributes[key] = decodeXmlEntities(attribute[2]);
    offset += attribute[0].length;
  }
  return attributes;
}

function decodeXmlEntities(value) {
  return String(value).replace(
    /&(quot|apos|lt|gt|amp|#\d+|#x[0-9a-f]+);/gi,
    (full, token) => {
      const lower = token.toLowerCase();
      if (lower === "quot") return '"';
      if (lower === "apos") return "'";
      if (lower === "lt") return "<";
      if (lower === "gt") return ">";
      if (lower === "amp") return "&";
      const codePoint = lower.startsWith("#x")
        ? Number.parseInt(lower.slice(2), 16)
        : Number.parseInt(lower.slice(1), 10);
      if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        fail(MDICT_IMPORT_ERROR.CORRUPT, "Invalid XML character entity in MDict header.");
      }
      return String.fromCodePoint(codePoint);
    }
  );
}

function normalizeMdictEncoding(value) {
  const text = String(value || "").trim().toUpperCase().replace(/_/g, "-");
  if (text === "UTF8" || text === "UTF-8") {
    return { name: "UTF-8", decoder: UTF8, unitBytes: 1 };
  }
  if (text === "UTF16" || text === "UTF-16" || text === "UTF-16LE") {
    return { name: "UTF-16", decoder: UTF16LE, unitBytes: 2 };
  }
  fail(MDICT_IMPORT_ERROR.UNSUPPORTED, "Unsupported MDict text encoding.", { encoding: value || null });
}

function parseEncryptedFlag(value) {
  const text = String(value ?? "0").trim();
  if (!text || /^no$/i.test(text)) return 0;
  if (/^yes$/i.test(text)) return 1;
  if (!/^\d+$/.test(text)) fail(MDICT_IMPORT_ERROR.CORRUPT, "Invalid MDict Encrypted header value.");
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < 0 || number > 3) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, "Invalid MDict Encrypted header value.");
  }
  return number;
}

function decodeMdictText(bytes, encoding, label) {
  try {
    return encoding.decoder.decode(bytes);
  } catch (cause) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, label + " is not valid " + encoding.name + ".", { cause });
  }
}

function decodeUtf16Le(bytes, label) {
  try {
    return UTF16LE.decode(bytes);
  } catch (cause) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, label + " is not valid UTF-16LE.", { cause });
  }
}

function cleanMetadataText(value) {
  const text = String(value || "").replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  return text.slice(0, 4096);
}

export function adler32(input) {
  const bytes = toBytes(input, "Adler32 input");
  const MOD = 65521;
  let a = 1;
  let b = 0;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    a += bytes[index];
    b += a;
    if ((index & 0x0fff) === 0x0fff) {
      a %= MOD;
      b %= MOD;
    }
  }
  a %= MOD;
  b %= MOD;
  return (((b << 16) | a) >>> 0);
}

class ByteCursor {
  constructor(input) {
    this.bytes = toBytes(input, "MDict bytes");
    this.offset = 0;
  }

  get remaining() {
    return this.bytes.byteLength - this.offset;
  }

  read(length, label) {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) {
      fail(MDICT_IMPORT_ERROR.CORRUPT, (label || "MDict read") + " exceeds the available bytes.", {
        offset: this.offset,
        requested: length,
        remaining: this.remaining
      });
    }
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readUint16Be(label) {
    const bytes = this.read(2, label);
    return bytes[0] * 0x100 + bytes[1];
  }

  readUint32Be(label) {
    return readUint32BeAt(this.read(4, label), 0);
  }

  readUint32Le(label) {
    const bytes = this.read(4, label);
    return (
      bytes[0] +
      bytes[1] * 0x100 +
      bytes[2] * 0x10000 +
      bytes[3] * 0x1000000
    ) >>> 0;
  }

  readSafeUint64Be(label) {
    const bytes = this.read(8, label);
    const high = readUint32BeAt(bytes, 0);
    const low = readUint32BeAt(bytes, 4);
    const value = high * 0x100000000 + low;
    if (!Number.isSafeInteger(value)) {
      fail(MDICT_IMPORT_ERROR.LIMIT, label + " exceeds JavaScript safe integer range.");
    }
    return value;
  }
}

function readUint32BeAt(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, "MDict uint32 is truncated.");
  }
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  ) >>> 0;
}

function toBytes(value, label) {
  if (value instanceof Uint8Array) return value;
  if (Buffer.isBuffer(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  fail(MDICT_IMPORT_ERROR.CORRUPT, label + " must be bytes.");
}

async function checkedFileSize(path, maximum, label) {
  const info = await stat(resolve(path));
  if (!info.isFile()) fail(MDICT_IMPORT_ERROR.CORRUPT, label + " path is not a file.");
  requireAtMost(info.size, maximum, label + " bytes");
  return info.size;
}

function requireAtMost(actual, maximum, label) {
  if (!Number.isSafeInteger(actual) || actual < 0 || !Number.isSafeInteger(maximum) || actual > maximum) {
    fail(MDICT_IMPORT_ERROR.LIMIT, label + " exceeds the POC safety limit.", { actual, maximum });
  }
}

function requireSafeSourceId(value) {
  const text = String(value || "");
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/i.test(text)) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, "sourceId is invalid.");
  }
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    fail(MDICT_IMPORT_ERROR.CORRUPT, label + " is required.");
  }
}

function requiredPath(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(label + " is required");
  return text;
}

function fail(code, message, details) {
  throw new MDictImportError(code, message, details);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(
        "usage: project-mdict-import.mjs --mdx PATH --out PATH --report PATH " +
        "[--source-id ID] [--source-version VERSION]"
      );
    }
    result[key.slice(2)] = value;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const key of ["mdx", "out", "report"]) {
    if (!args[key]) throw new Error("--" + key + " is required");
  }
  const result = await projectMdictPoc({
    mdxPath: args.mdx,
    outPath: args.out,
    reportPath: args.report,
    sourceId: args["source-id"] || "user-mdict",
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
