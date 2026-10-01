#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  MDICT_IMPORT_ERROR,
  MDICT_IMPORT_LIMITS,
  MDictCursor,
  adler32,
  readMdictUint32Be,
  requireMdictAtMost
} from "../src/background/packs/importers/mdict-contract.js";
import {
  parseDictionaryAttributes as parseMdictAttributes,
  parseEncryptedFlag,
  normalizeMdictEncoding
} from "../src/background/packs/importers/mdict-metadata.js";
import {
  buildRichMdictIndex,
  decodeRichKeyBlock
} from "../src/background/packs/importers/mdict-rich-index.js";
import { RICH_MDICT_IMPORT_LIMITS } from "../src/background/packs/importers/mdict-rich-validation.js";
import { lookupRichMdict } from "../src/background/packs/importers/mdict-rich-lookup.js";
import {
  MDD_IMPORT_LIMITS,
  buildMddIndex
} from "../src/background/packs/importers/mdd-index.js";
import { decodeMdictBlock, decryptMdictKeyInfoBlock } from "../src/background/packs/importers/mdict-block-codec.js";
import {
  parseKeyBlockDescriptors,
  parseRecordBlockDescriptors,
  safeAdd
} from "../src/background/packs/importers/mdict-rich-key-codec.js";
import { parseMddKeyBlockDescriptors } from "../src/background/packs/importers/mdd-key-codec.js";
import { normalizeMddResourcePath } from "../src/background/packs/importers/mdd-resource-path.js";
import {
  MDICT_COMPATIBILITY_CAPABILITIES as CAP,
  MDICT_COMPATIBILITY_RESULT as RESULT
} from "./mdict-compatibility-capabilities.mjs";

const REPORT_SCHEMA_VERSION = 1;
const MAX_HEADER_BYTES = 256 * 1024;
const MAX_COMPANION_MDD_FILES = 16;
const MAX_TOTAL_INPUT_BYTES = 512 * 1024 * 1024;
const MAX_REPORT_LABEL_CHARS = 80;
const MAX_SAMPLE_RECORDS = 24;
const DEFAULT_SAMPLE_RECORDS = 12;
const MAX_SAMPLE_PREFIX_BYTES = 64 * 1024;
const UTF16LE = new TextDecoder("utf-16le", { fatal: true });
const SAFE_FORMATS = new Set(["HTML", "TEXT"]);
const SAFE_ENCODINGS = new Set(["UTF-8", "UTF-16"]);
const KNOWN_RESOURCE_EXTENSIONS = new Set([
  "bmp", "css", "gif", "ico", "jpeg", "jpg", "mp3", "ogg", "png", "svg", "wav", "webp"
]);

export async function inspectMdictFiles({
  mdxPath,
  mddPaths = [],
  label,
  includeHashes = false,
  sampleRecords = DEFAULT_SAMPLE_RECORDS
} = {}) {
  if (typeof mdxPath !== "string" || !mdxPath.trim()) {
    throw new TypeError("One MDX input is required.");
  }
  if (!Array.isArray(mddPaths) || mddPaths.length > MAX_COMPANION_MDD_FILES) {
    throw new Error(`At most ${MAX_COMPANION_MDD_FILES} companion MDD files can be inspected at once.`);
  }
  await assertInputSetBudget(resolve(mdxPath), mddPaths.map((path) => resolve(path)));
  const sampleLimit = boundedInteger(sampleRecords, DEFAULT_SAMPLE_RECORDS, 1, MAX_SAMPLE_RECORDS);
  const safeLabel = sanitizeLabel(label);
  const mdx = await inspectMdx(resolve(mdxPath), { includeHashes, sampleLimit });
  const mddInputs = [];
  for (const path of mddPaths) {
    mddInputs.push(await inspectMdd(resolve(path), {
      includeHashes,
      mdxPath: resolve(mdxPath)
    }));
  }
  mddInputs.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right), "en")
  );

  const missingCompanion = Boolean(mdx.featureSampling?.relativeResourcePathRecords) && mddInputs.length === 0;
  const result = mdx.parser.result === RESULT.UNSUPPORTED
    ? RESULT.UNSUPPORTED
    : (mdx.parser.result !== RESULT.SUPPORTED ||
      mddInputs.some((input) => input.parser.result !== RESULT.SUPPORTED) ||
      missingCompanion)
      ? RESULT.PARTIALLY_SUPPORTED
      : RESULT.SUPPORTED;

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    kind: "local-sanitized-mdict-compatibility-report",
    reportId: safeLabel || "local-mdict-inspection",
    ...(safeLabel ? { label: safeLabel } : {}),
    generatedBy: "scripts/inspect-mdict-compatibility.mjs",
    networkAccess: false,
    dictionaryContentExported: false,
    result,
    mdx,
    mdd: {
      count: mddInputs.length,
      files: mddInputs,
      companionAssociation: mddInputs.length ? "explicit-inputs" : "none-provided"
    }
  };
}

async function assertInputSetBudget(mdxPath, mddPaths) {
  let totalBytes = 0;
  for (const path of [mdxPath, ...mddPaths]) {
    let info;
    try { info = await stat(path); } catch { throw new Error("Input is missing or unreadable."); }
    if (!info.isFile()) throw new Error("Input must be a regular file.");
    totalBytes += info.size;
    requireMdictAtMost(totalBytes, MAX_TOTAL_INPUT_BYTES, "Combined MDX/MDD input bytes");
  }
}

async function inspectMdx(path, { includeHashes, sampleLimit }) {
  const opened = await openLocalSource(path, MDICT_IMPORT_LIMITS.fileBytes);
  try {
    const facts = await readFileFacts(path, opened.size, includeHashes, "mdx");
    const header = await readSafeHeader(opened.source, opened.size, "mdx");
    const metadata = summarizeHeader(header, "mdx");
    const structure = await inspectMdxStructure(opened.source, metadata);
    let index = null;
    let parserError = null;
    try {
      index = await buildRichMdictIndex({ source: opened.source });
    } catch (error) {
      parserError = error;
    }
    const unsupportedCapabilities = unique([
      ...metadata.unsupportedCapabilities,
      ...structure.unsupportedCapabilities,
      ...capabilitiesForParserError(parserError, "mdx")
    ]);
    const parserResult = classifyParserResult(parserError, unsupportedCapabilities);
    const featureSampling = index
      ? await sampleRichRecords(opened.source, index, sampleLimit)
      : emptyFeatureSampling(sampleLimit);
    const compatibleParser = index !== null && parserResult === RESULT.SUPPORTED;
    const blocks = structure.blocks || emptyBlockSummary();
    return {
      file: facts,
      metadata: metadata.publicMetadata,
      structure: {
        ...(Number.isSafeInteger(index?.entryCount) ? { entryCount: index.entryCount } : blocks.entryCount != null ? { entryCount: blocks.entryCount } : {}),
        ...(index ? { keyBlockCount: index.keyBlocks.length, recordBlockCount: index.recordBlocks.length } : blocks.counts),
        keyInfoCompression: structure.keyInfoCompression || "unknown",
        ...(structure.keyInfo ? { keyInfo: structure.keyInfo } : {}),
        keyBlockCompression: blocks.keyBlockCompression,
        recordBlockCompression: blocks.recordBlockCompression,
        keyBlocks: blocks.keyBlocks,
        recordBlocks: blocks.recordBlocks,
        aliasLink: {
          sampledLookups: featureSampling.sampledLookups,
          observedRecords: featureSampling.aliasLinkRecords,
          presence: featureSampling.aliasLinkRecords > 0
        },
        lookupNormalization: metadata.lookupNormalization
      },
      parser: {
        importer: "rich-mdict",
        result: parserResult,
        indexBuilt: Boolean(index),
        unsupportedCapabilities,
        ...(parserError ? { failureClass: safeFailureClass(parserError) } : {}),
        supportedCapabilities: supportedMdxCapabilities(metadata, blocks, index, structure.keyInfoCompression, featureSampling)
      },
      featureSampling,
      evidenceScope: "Deterministic record sample; all counters describe sampled record hits, not corpus-wide totals. No record text or headwords are emitted."
    };
  } finally {
    await opened.close();
  }
}

async function inspectMdd(path, { includeHashes, mdxPath }) {
  const opened = await openLocalSource(path, MDD_IMPORT_LIMITS.fileBytes);
  try {
    const facts = await readFileFacts(path, opened.size, includeHashes, "mdd");
    const header = await readSafeHeader(opened.source, opened.size, "mdd");
    const metadata = summarizeHeader(header, "mdd");
    const structure = await inspectMddStructure(opened.source, metadata);
    let index = null;
    let parserError = null;
    try {
      index = await buildMddIndex({ source: opened.source });
    } catch (error) {
      parserError = error;
    }
    const unsupportedCapabilities = unique([
      ...metadata.unsupportedCapabilities,
      ...structure.unsupportedCapabilities,
      ...capabilitiesForParserError(parserError, "mdd")
    ]);
    const parserResult = classifyParserResult(parserError, unsupportedCapabilities);
    const resourceSummary = index
      ? await summarizeMddResources(opened.source, index)
      : emptyMddResourceSummary();
    return {
      file: facts,
      namingPattern: companionNamingPattern(mdxPath, path),
      metadata: metadata.publicMetadata,
      structure: {
        ...(index ? { resourceCount: index.keyCount, keyBlockCount: index.keyBlocks.length, recordBlockCount: index.recordBlocks.length } : structure.counts),
        keyInfoCompression: structure.keyInfoCompression || "unknown",
        ...(structure.keyInfo ? { keyInfo: structure.keyInfo } : {}),
        keyBlockCompression: structure.blocks?.keyBlockCompression || emptyCompressionHistogram(),
        recordBlockCompression: structure.blocks?.recordBlockCompression || emptyCompressionHistogram(),
        maxCompressedKeyBlockBytes: structure.blocks?.maxCompressedKeyBlockBytes || 0,
        maxDecompressedKeyBlockBytes: structure.blocks?.maxDecompressedKeyBlockBytes || 0,
        maxCompressedRecordBlockBytes: structure.blocks?.maxCompressedRecordBlockBytes || 0,
        maxDecompressedRecordBlockBytes: structure.blocks?.maxDecompressedRecordBlockBytes || 0,
        ...resourceSummary
      },
      parser: {
        importer: "mdd-resource",
        result: parserResult,
        indexBuilt: Boolean(index),
        unsupportedCapabilities,
        ...(parserError ? { failureClass: safeFailureClass(parserError) } : {}),
        supportedCapabilities: supportedMddCapabilities(metadata, structure.blocks, index)
      },
      evidenceScope: "Resource paths and aggregate sizes only; no resource bytes, paths, or file names are emitted."
    };
  } finally {
    await opened.close();
  }
}

async function openLocalSource(path, maxBytes) {
  let info;
  try {
    info = await stat(path);
  } catch {
    throw new Error("Input is missing or unreadable.");
  }
  if (!info.isFile()) throw new Error("Input must be a regular file.");
  requireMdictAtMost(info.size, maxBytes, "MDict input bytes");
  const handle = await open(path, "r");
  return {
    size: info.size,
    source: {
      size: info.size,
      async read(offset, length) {
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > info.size) {
          throw new Error("Inspector requested an invalid file range.");
        }
        const bytes = Buffer.alloc(length);
        let readBytes = 0;
        while (readBytes < length) {
          const result = await handle.read(bytes, readBytes, length - readBytes, offset + readBytes);
          if (!result.bytesRead) throw new Error("Input ended before the requested bounded range.");
          readBytes += result.bytesRead;
        }
        return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      }
    },
    close: () => handle.close()
  };
}

async function readFileFacts(path, size, includeHashes, kind) {
  const extension = extname(basename(path)).toLowerCase();
  if (extension !== `.${kind}`) throw new Error(`Expected a .${kind.toUpperCase()} input.`);
  return {
    kind,
    bytes: size,
    ...(includeHashes ? { sha256: await hashFile(path) } : {})
  };
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function readSafeHeader(source, sourceSize, kind) {
  if (sourceSize < 12) throw new Error("Input is too small to contain an MDict header.");
  const prefix = await source.read(0, 4);
  const headerBytes = readMdictUint32Be(prefix, 0);
  requireMdictAtMost(headerBytes, MAX_HEADER_BYTES, "MDict header bytes");
  if (headerBytes < 4 || headerBytes % 2 || headerBytes + 8 > sourceSize) {
    throw new Error("MDict header length is invalid.");
  }
  const encoded = await source.read(0, headerBytes + 8);
  const headerPayload = encoded.subarray(4, 4 + headerBytes);
  const checksum = encoded[4 + headerBytes] |
    (encoded[5 + headerBytes] << 8) |
    (encoded[6 + headerBytes] << 16) |
    (encoded[7 + headerBytes] << 24);
  if (adler32(headerPayload) !== (checksum >>> 0)) throw new Error("MDict header checksum is invalid.");
  let text;
  try {
    text = UTF16LE.decode(headerPayload).replace(/\u0000+$/gu, "").trim();
  } catch {
    throw new Error("MDict header text is invalid.");
  }
  const attributes = parseMdictAttributes(text, kind === "mdd" ? "Library_Data" : "Dictionary");
  return { kind, attributes, headerBytes, payload: headerPayload };
}

function summarizeHeader(header, kind) {
  const attributes = header.attributes;
  const generatedByEngineVersion = safeVersion(attributes.GeneratedByEngineVersion);
  const requiredEngineVersion = safeVersion(attributes.RequiredEngineVersion || "2.0");
  const rawFormat = String(attributes.Format || "").trim().toUpperCase();
  const format = kind === "mdd" ? (rawFormat ? "OTHER" : "RESOURCE_LIBRARY") : SAFE_FORMATS.has(rawFormat) ? rawFormat : "OTHER";
  const rawEncoding = String(attributes.Encoding || "").trim().toUpperCase().replaceAll("_", "-");
  const encoding = normalizeEncodingName(rawEncoding);
  const encrypted = parseEncryptedSafely(attributes.Encrypted);
  const compact = safeYesNo(attributes.Compact);
  const compat = safeYesNo(attributes.Compat);
  const styleSheet = String(attributes.StyleSheet || "");
  const styleSheetBytes = Buffer.byteLength(styleSheet, "utf8");
  const styleSheetLines = styleSheet ? styleSheet.replace(/\r\n?/gu, "\n").split("\n") : [];
  const observedStyleSheetRuleCount = Math.floor(styleSheetLines.length / 3);
  const styleSheetRuleCount = Math.min(4096, observedStyleSheetRuleCount);
  const unsupportedCapabilities = [];
  if (generatedByEngineVersion !== "2.0") {
    unsupportedCapabilities.push(kind === "mdd" ? CAP.mdd.engineV2 : CAP.mdx.engineV2);
  }
  if (!isRequiredVersionSupported(requiredEngineVersion)) {
    unsupportedCapabilities.push(kind === "mdd" ? CAP.mdd.requiredEngineVersion : CAP.mdx.requiredEngineVersion);
  }
  if (kind === "mdx") {
    if (!SAFE_ENCODINGS.has(encoding)) unsupportedCapabilities.push(encodingCapability(rawEncoding));
    if (!SAFE_FORMATS.has(rawFormat)) unsupportedCapabilities.push(CAP.mdx.recordFormatOther);
    if (encrypted === 1) unsupportedCapabilities.push(CAP.mdx.passwordProtected);
    if (encrypted === 3) unsupportedCapabilities.push(CAP.mdx.recordEncryption);
    if (encrypted !== 0 && encrypted !== 2 && encrypted !== 1 && encrypted !== 3) unsupportedCapabilities.push(CAP.mdx.compressionUnknown);
  } else {
    if (encrypted === 1) unsupportedCapabilities.push(CAP.mdd.passwordProtected);
    if (encrypted === 3) unsupportedCapabilities.push(CAP.mdd.recordEncryption);
    if (rawFormat) unsupportedCapabilities.push(CAP.mdd.resourceFormatOther);
  }
  let parserEncoding = null;
  if (kind === "mdx" && SAFE_ENCODINGS.has(encoding)) {
    try { parserEncoding = normalizeMdictEncoding(attributes.Encoding); } catch { parserEncoding = null; }
  }
  return {
    attributes,
    parserEncoding,
    encrypted,
    unsupportedCapabilities: unique(unsupportedCapabilities),
    lookupNormalization: kind === "mdx" ? {
      keyCaseSensitive: safeYesNo(attributes.KeyCaseSensitive, false) === "yes",
      stripKey: safeYesNo(attributes.StripKey, false) === "yes",
      normalization: "NFKC; case fold when KeyCaseSensitive=No; strip Unicode punctuation/space when StripKey=Yes"
    } : undefined,
    publicMetadata: {
      generatedByEngineVersion,
      requiredEngineVersion,
      ...(kind === "mdx" ? { encoding, format } : { encoding: "UTF-16LE" }),
      encrypted,
      compact,
      compat,
      ...(kind === "mdx" ? {
        styleSheet: {
          present: styleSheet.trim().length > 0,
          byteLength: Math.min(styleSheetBytes, 64 * 1024),
          byteLengthOverBound: styleSheetBytes > 64 * 1024,
          ruleCount: styleSheetRuleCount,
          ruleCountTruncated: observedStyleSheetRuleCount > styleSheetRuleCount,
          withinRuntimeRuleLimit: observedStyleSheetRuleCount <= 255 && styleSheetBytes <= 64 * 1024
        }
      } : {})
    }
  };
}

async function inspectMdxStructure(source, metadata) {
  const unsupportedCapabilities = [];
  try {
    const headerLength = readMdictUint32Be(await source.read(0, 4), 0);
    const preambleOffset = headerLength + 8;
    const preambleBytes = await source.read(preambleOffset, 44);
    const preamble = new MDictCursor(preambleBytes.subarray(0, 40));
    const keyBlockCount = preamble.readSafeUint64Be("MDX key block count");
    const entryCount = preamble.readSafeUint64Be("MDX entry count");
    const keyInfoDecompressedBytes = preamble.readSafeUint64Be("MDX key-info bytes");
    const keyInfoCompressedBytes = preamble.readSafeUint64Be("MDX compressed key-info bytes");
    const keyBlocksBytes = preamble.readSafeUint64Be("MDX key blocks bytes");
    requireMdictAtMost(keyBlockCount, RICH_MDICT_IMPORT_LIMITS.blockCount, "MDX key block count");
    requireMdictAtMost(entryCount, RICH_MDICT_IMPORT_LIMITS.entryCount, "MDX entry count");
    requireMdictAtMost(keyInfoDecompressedBytes, RICH_MDICT_IMPORT_LIMITS.keyIndexBytes, "MDX key-info bytes");
    requireMdictAtMost(keyInfoCompressedBytes, RICH_MDICT_IMPORT_LIMITS.blockCompressedBytes, "MDX compressed key-info bytes");
    const keyInfoOffset = preambleOffset + 44;
    const rawKeyInfo = await source.read(keyInfoOffset, keyInfoCompressedBytes);
    const keyInfoCompression = compressionName(rawKeyInfo);
    if (keyInfoCompression !== "zlib") unsupportedCapabilities.push(CAP.mdx.keyInfoCompressionZlib);
    if (keyInfoCompression === "lzo") unsupportedCapabilities.push(CAP.mdx.compressionLzo);
    else if (keyInfoCompression === "unknown") unsupportedCapabilities.push(CAP.mdx.compressionUnknown);
    let keyInfoDecoded = null;
    if (metadata.parserEncoding && [0, 2].includes(metadata.encrypted)) {
      const keyInfoForDecode = metadata.encrypted === 2 ? decryptMdictKeyInfoBlock(rawKeyInfo) : rawKeyInfo;
      keyInfoDecoded = await decodeMdictBlock({
        input: keyInfoForDecode,
        expectedBytes: keyInfoDecompressedBytes,
        limits: RICH_MDICT_IMPORT_LIMITS,
        label: "MDX key info"
      });
    }
    let keyBlocks = [];
    let recordBlocks = [];
    let counts = { entryCount, keyBlockCount };
    if (keyInfoDecoded) {
      keyBlocks = parseKeyBlockDescriptors(
        keyInfoDecoded.bytes,
        keyBlockCount,
        entryCount,
        metadata.parserEncoding,
        keyInfoOffset + keyInfoCompressedBytes,
        RICH_MDICT_IMPORT_LIMITS
      );
      if (keyBlocks.reduce((sum, block) => safeAdd(sum, block.compressedBytes, "MDX key blocks bytes"), 0) !== keyBlocksBytes) {
        throw new Error("MDX key-block byte total is inconsistent.");
      }
      for (const block of keyBlocks) await noteCompression(source, block, "mdx", unsupportedCapabilities, "keyBlock");
      const recordSectionOffset = keyBlocks.at(-1).dataOffset + keyBlocks.at(-1).compressedBytes;
      const recordHeader = new MDictCursor(await source.read(recordSectionOffset, 32));
      const recordBlockCount = recordHeader.readSafeUint64Be("MDX record block count");
      const recordEntryCount = recordHeader.readSafeUint64Be("MDX record entry count");
      const recordIndexBytes = recordHeader.readSafeUint64Be("MDX record index bytes");
      const recordBlocksBytes = recordHeader.readSafeUint64Be("MDX record blocks bytes");
      requireMdictAtMost(recordBlockCount, RICH_MDICT_IMPORT_LIMITS.blockCount, "MDX record block count");
      if (recordEntryCount !== entryCount || recordIndexBytes !== recordBlockCount * 16) throw new Error("MDX record section counts are inconsistent.");
      const descriptorBytes = await source.read(recordSectionOffset + 32, recordBlockCount * 16);
      recordBlocks = parseRecordBlockDescriptors(descriptorBytes, recordBlockCount, recordSectionOffset + 32 + recordBlockCount * 16, RICH_MDICT_IMPORT_LIMITS);
      if (recordBlocks.reduce((sum, block) => safeAdd(sum, block.compressedBytes, "MDX record blocks bytes"), 0) !== recordBlocksBytes) throw new Error("MDX record block byte total is inconsistent.");
      for (const block of recordBlocks) await noteCompression(source, block, "mdx", unsupportedCapabilities, "recordBlock");
      counts = { entryCount, keyBlockCount, recordBlockCount };
    }
    return {
      keyInfoCompression,
      keyInfo: {
        compression: keyInfoCompression,
        compressedBytes: keyInfoCompressedBytes,
        decompressedBytes: keyInfoDecompressedBytes,
        encrypted: metadata.encrypted === 2
      },
      blocks: {
        counts,
        entryCount,
        keyBlockCompression: compressionHistogram(keyBlocks),
        recordBlockCompression: compressionHistogram(recordBlocks),
        keyBlocks: blockSizeSummary(keyBlocks),
        recordBlocks: blockSizeSummary(recordBlocks)
      },
      unsupportedCapabilities: unique(unsupportedCapabilities)
    };
  } catch (error) {
    unsupportedCapabilities.push(...capabilitiesForParserError(error, "mdx"));
    return { keyInfoCompression: "unknown", blocks: null, unsupportedCapabilities: unique(unsupportedCapabilities) };
  }
}

async function inspectMddStructure(source, metadata) {
  const unsupportedCapabilities = [];
  try {
    const headerLength = readMdictUint32Be(await source.read(0, 4), 0);
    const preambleOffset = headerLength + 8;
    const preambleBytes = await source.read(preambleOffset, 44);
    const preamble = new MDictCursor(preambleBytes.subarray(0, 40));
    const keyBlockCount = preamble.readSafeUint64Be("MDD key block count");
    const resourceCount = preamble.readSafeUint64Be("MDD resource count");
    const keyInfoDecompressedBytes = preamble.readSafeUint64Be("MDD key-info bytes");
    const keyInfoCompressedBytes = preamble.readSafeUint64Be("MDD compressed key-info bytes");
    const keyBlocksBytes = preamble.readSafeUint64Be("MDD key blocks bytes");
    requireMdictAtMost(keyBlockCount, MDD_IMPORT_LIMITS.blockCount, "MDD key block count");
    requireMdictAtMost(resourceCount, MDD_IMPORT_LIMITS.entryCount, "MDD resource count");
    requireMdictAtMost(keyInfoDecompressedBytes, MDD_IMPORT_LIMITS.keyIndexBytes, "MDD key-info bytes");
    requireMdictAtMost(keyInfoCompressedBytes, MDD_IMPORT_LIMITS.blockCompressedBytes, "MDD compressed key-info bytes");
    const keyInfoOffset = preambleOffset + 44;
    const rawKeyInfo = await source.read(keyInfoOffset, keyInfoCompressedBytes);
    const keyInfoCompression = compressionName(rawKeyInfo);
    if (keyInfoCompression === "lzo") unsupportedCapabilities.push(CAP.mdd.compressionLzo);
    else if (keyInfoCompression === "unknown") unsupportedCapabilities.push(CAP.mdd.compressionUnknown);
    let keyInfoDecoded = null;
    if ([0, 2].includes(metadata.encrypted)) {
      const keyInfoForDecode = metadata.encrypted === 2 ? decryptMdictKeyInfoBlock(rawKeyInfo) : rawKeyInfo;
      keyInfoDecoded = await decodeMdictBlock({
        input: keyInfoForDecode,
        expectedBytes: keyInfoDecompressedBytes,
        limits: MDD_IMPORT_LIMITS,
        label: "MDD key info"
      });
    }
    let keyBlocks = [];
    let recordBlocks = [];
    let counts = { resourceCount, keyBlockCount };
    if (keyInfoDecoded) {
      keyBlocks = parseMddKeyBlockDescriptors(
        keyInfoDecoded.bytes,
        keyBlockCount,
        resourceCount,
        keyInfoOffset + keyInfoCompressedBytes,
        MDD_IMPORT_LIMITS
      );
      if (keyBlocks.reduce((sum, block) => safeAdd(sum, block.compressedBytes, "MDD key blocks bytes"), 0) !== keyBlocksBytes) throw new Error("MDD key-block byte total is inconsistent.");
      for (const block of keyBlocks) await noteCompression(source, block, "mdd", unsupportedCapabilities, "keyBlock");
      const recordSectionOffset = keyBlocks.at(-1).dataOffset + keyBlocks.at(-1).compressedBytes;
      const recordHeader = new MDictCursor(await source.read(recordSectionOffset, 32));
      const recordBlockCount = recordHeader.readSafeUint64Be("MDD record block count");
      const recordEntryCount = recordHeader.readSafeUint64Be("MDD record entry count");
      const recordIndexBytes = recordHeader.readSafeUint64Be("MDD record index bytes");
      const recordBlocksBytes = recordHeader.readSafeUint64Be("MDD record blocks bytes");
      requireMdictAtMost(recordBlockCount, MDD_IMPORT_LIMITS.blockCount, "MDD record block count");
      if (recordEntryCount !== resourceCount || recordIndexBytes !== recordBlockCount * 16) throw new Error("MDD record section counts are inconsistent.");
      const descriptorBytes = await source.read(recordSectionOffset + 32, recordBlockCount * 16);
      recordBlocks = parseRecordBlockDescriptors(descriptorBytes, recordBlockCount, recordSectionOffset + 32 + recordBlockCount * 16, MDD_IMPORT_LIMITS);
      if (recordBlocks.reduce((sum, block) => safeAdd(sum, block.compressedBytes, "MDD record blocks bytes"), 0) !== recordBlocksBytes) throw new Error("MDD record block byte total is inconsistent.");
      for (const block of recordBlocks) await noteCompression(source, block, "mdd", unsupportedCapabilities, "recordBlock");
      counts = { resourceCount, keyBlockCount, recordBlockCount };
    }
    const blocks = {
      counts,
      keyBlockCompression: compressionHistogram(keyBlocks),
      recordBlockCompression: compressionHistogram(recordBlocks),
      maxCompressedKeyBlockBytes: max(keyBlocks.map((block) => block.compressedBytes)),
      maxDecompressedKeyBlockBytes: max(keyBlocks.map((block) => block.decompressedBytes)),
      maxCompressedRecordBlockBytes: max(recordBlocks.map((block) => block.compressedBytes)),
      maxDecompressedRecordBlockBytes: max(recordBlocks.map((block) => block.decompressedBytes))
    };
    return {
      keyInfoCompression,
      keyInfo: {
        compression: keyInfoCompression,
        compressedBytes: keyInfoCompressedBytes,
        decompressedBytes: keyInfoDecompressedBytes,
        encrypted: metadata.encrypted === 2
      },
      blocks,
      counts,
      unsupportedCapabilities: unique(unsupportedCapabilities)
    };
  } catch (error) {
    unsupportedCapabilities.push(...capabilitiesForParserError(error, "mdd"));
    if (error?.code === MDICT_IMPORT_ERROR.UNSAFE_CONTENT) unsupportedCapabilities.push(CAP.mdd.resourcePathNormalization);
    return { keyInfoCompression: "unknown", blocks: null, counts: null, unsupportedCapabilities: unique(unsupportedCapabilities) };
  }
}

async function noteCompression(source, block, kind, unsupported, blockKind) {
  const type = compressionName(await source.read(block.dataOffset, Math.min(4, block.compressedBytes)));
  if (type === "lzo") unsupported.push(kind === "mdd" ? CAP.mdd.compressionLzo : CAP.mdx.compressionLzo);
  if (type === "unknown") unsupported.push(kind === "mdd" ? CAP.mdd.compressionUnknown : CAP.mdx.compressionUnknown);
  block[`${blockKind}Type`] = type;
}

function compressionName(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  if (bytes.byteLength < 4) return "unknown";
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0) return "none";
  if (bytes[0] === 1 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0) return "lzo";
  if (bytes[0] === 2 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0) return "zlib";
  return "unknown";
}

function compressionHistogram(blocks) {
  const output = emptyCompressionHistogram();
  for (const block of blocks) output[block.keyBlockType || block.recordBlockType || "unknown"] += 1;
  return output;
}

function emptyCompressionHistogram() {
  return { none: 0, zlib: 0, lzo: 0, unknown: 0 };
}

function blockSizeSummary(blocks) {
  return {
    count: blocks.length,
    totalCompressedBytes: blocks.reduce((sum, block) => safeAdd(sum, block.compressedBytes, "compressed block bytes"), 0),
    totalDecompressedBytes: blocks.reduce((sum, block) => safeAdd(sum, block.decompressedBytes, "decompressed block bytes"), 0),
    maxCompressedBytes: max(blocks.map((block) => block.compressedBytes)),
    maxDecompressedBytes: max(blocks.map((block) => block.decompressedBytes))
  };
}

function emptyBlockSummary() {
  return {
    counts: {},
    keyBlockCompression: emptyCompressionHistogram(),
    recordBlockCompression: emptyCompressionHistogram(),
    keyBlocks: blockSizeSummary([]),
    recordBlocks: blockSizeSummary([])
  };
}

function classifyParserResult(error, unsupportedCapabilities) {
  if (!error && unsupportedCapabilities.length === 0) return RESULT.SUPPORTED;
  if (unsupportedCapabilities.length > 0) return RESULT.UNSUPPORTED;
  if ([MDICT_IMPORT_ERROR.UNSUPPORTED, MDICT_IMPORT_ERROR.CORRUPT, MDICT_IMPORT_ERROR.UNSAFE_CONTENT].includes(error?.code)) return RESULT.UNSUPPORTED;
  return RESULT.PARTIALLY_SUPPORTED;
}

function safeFailureClass(error) {
  if (error?.code === MDICT_IMPORT_ERROR.CORRUPT) return "invalid";
  if (error?.code === MDICT_IMPORT_ERROR.UNSAFE_CONTENT) return "unsafe-content-rejected";
  if (error?.code === MDICT_IMPORT_ERROR.LIMIT) return "safety-limit";
  if (error?.code === MDICT_IMPORT_ERROR.UNSUPPORTED) return "unsupported-format";
  return "inspection-error";
}

function capabilitiesForParserError(error, kind) {
  if (!error) return [];
  const mdx = kind === "mdx";
  if (error?.encoding) return [encodingCapability(error.encoding)];
  if (error?.version !== undefined) return [mdx ? CAP.mdx.engineV2 : CAP.mdd.engineV2];
  if (error?.requiredEngineVersion) return [mdx ? CAP.mdx.requiredEngineVersion : CAP.mdd.requiredEngineVersion];
  if (error?.encrypted === 1) return [mdx ? CAP.mdx.passwordProtected : CAP.mdd.passwordProtected];
  if (error?.encrypted === 3) return [mdx ? CAP.mdx.recordEncryption : CAP.mdd.recordEncryption];
  if (error?.format) return [mdx ? CAP.mdx.recordFormatOther : CAP.mdd.resourceFormatOther];
  if (error?.code === MDICT_IMPORT_ERROR.UNSAFE_CONTENT && /path/iu.test(error?.message || "")) return [CAP.mdd.resourcePathNormalization];
  if (!mdx && /UTF-16LE/iu.test(error?.message || "")) return [CAP.mdd.encodingOther];
  if (error?.code === MDICT_IMPORT_ERROR.UNSUPPORTED && /LZO/iu.test(error?.message || "")) return [mdx ? CAP.mdx.compressionLzo : CAP.mdd.compressionLzo];
  if (error?.code === MDICT_IMPORT_ERROR.UNSUPPORTED && /compression type/iu.test(error?.message || "")) return [mdx ? CAP.mdx.compressionUnknown : CAP.mdd.compressionUnknown];
  return [];
}

function supportedMdxCapabilities(metadata, blocks, index, keyInfoCompression, featureSampling) {
  const found = [];
  if (metadata.publicMetadata.generatedByEngineVersion === "2.0") found.push(CAP.mdx.engineV2);
  if (metadata.publicMetadata.encoding === "UTF-8") found.push(CAP.mdx.encodingUtf8);
  if (metadata.publicMetadata.encoding === "UTF-16") found.push(CAP.mdx.encodingUtf16le);
  if (metadata.encrypted === 2) found.push(CAP.mdx.keyInfoEncryptionV2);
  if (metadata.publicMetadata.format === "HTML") found.push(CAP.mdx.recordHtml);
  if (metadata.publicMetadata.format === "TEXT") found.push(CAP.mdx.recordText);
  if (metadata.publicMetadata.styleSheet.present) found.push(CAP.mdx.styleSheet);
  if (metadata.publicMetadata.compact === "yes") found.push(CAP.mdx.compactRecords);
  if (featureSampling.aliasLinkRecords > 0) found.push(CAP.mdx.aliasLink);
  if (keyInfoCompression === "zlib") found.push(CAP.mdx.keyInfoCompressionZlib);
  if (index) {
    if (blocks.keyBlockCompression.none + blocks.recordBlockCompression.none > 0) found.push(CAP.mdx.compressionNone);
    if (blocks.keyBlockCompression.zlib + blocks.recordBlockCompression.zlib > 0) found.push(CAP.mdx.compressionZlib);
  }
  return unique(found);
}

function observedRichCapabilities(features) {
  const found = [];
  if (Object.values(features.commonHtmlTagFamilyRecords).some((count) => count > 0)) found.push(CAP.rich.htmlStructure);
  if (features.inlineStyleRecords > 0) found.push(CAP.rich.inlineStyle);
  if (features.styleSheetReferenceRecords > 0) found.push(CAP.rich.styleSheetReference);
  if (features.compactStyleMarkerRecords > 0) found.push(CAP.rich.compactStyleMarker);
  if (features.imageReferenceRecords > 0) found.push(CAP.rich.imageReference);
  if (features.audioReferenceRecords > 0) found.push(CAP.rich.audioReference);
  if (features.localAnchorRecords > 0) found.push(CAP.rich.localAnchor);
  if (features.entryReferenceRecords > 0) found.push(CAP.rich.entryReference);
  if (features.soundReferenceRecords > 0) found.push(CAP.rich.soundReference);
  if (features.relativeResourcePathRecords > 0) found.push(CAP.rich.relativeResourcePath);
  if (features.otherUriSchemeRecords > 0) found.push(CAP.rich.otherUriScheme);
  if (features.remoteUrlRecords > 0) found.push(CAP.rich.remoteUrl);
  if (features.unusualResourceExtensionReferences > 0) found.push(CAP.rich.unusualResourceExtension);
  return unique(found);
}

function supportedMddCapabilities(metadata, blocks, index) {
  const found = [];
  if (metadata.publicMetadata.generatedByEngineVersion === "2.0") found.push(CAP.mdd.engineV2);
  if (index) found.push(CAP.mdd.encodingUtf16le);
  if (metadata.encrypted === 2) found.push(CAP.mdd.encryptionKeyInfoV2);
  if (index && blocks) {
    if (blocks.keyBlockCompression.none + blocks.recordBlockCompression.none > 0) found.push(CAP.mdd.compressionNone);
    if (blocks.keyBlockCompression.zlib + blocks.recordBlockCompression.zlib > 0) found.push(CAP.mdd.compressionZlib);
  }
  return unique(found);
}

async function sampleRichRecords(source, index, sampleLimit) {
  const sampleEntries = [];
  const blockCount = index.keyBlocks.length;
  const sampleBlocks = evenlySpacedIndices(blockCount, Math.min(sampleLimit, blockCount));
  for (const blockIndex of sampleBlocks) {
    const entries = await decodeRichKeyBlock({ source, index, blockIndex });
    if (!entries.length) continue;
    sampleEntries.push(entries[Math.floor((entries.length - 1) / 2)]);
  }
  const result = emptyFeatureSampling(sampleLimit);
  const sampledForms = new Set();
  for (const entry of sampleEntries) {
    let record;
    try {
      record = await lookupRichMdict({ source, index, text: entry.displayForm });
    } catch {
      result.unreadableSampleRecords += 1;
      continue;
    }
    if (!record?.found) {
      result.unreadableSampleRecords += 1;
      continue;
    }
    result.sampledLookups += 1;
    if (record.aliasTarget) result.aliasLinkRecords += 1;
    if (sampledForms.has(record.displayForm)) continue;
    sampledForms.add(record.displayForm);
    result.sampledRecords += 1;
    const bounded = utf8Prefix(String(record.rawRecord || ""), MAX_SAMPLE_PREFIX_BYTES);
    classifyRecordSample(bounded.text, result, bounded.truncated);
  }
  delete result.sampleLimit;
  result.samplingPlan = "center entry from evenly spaced key blocks";
  result.observedCapabilities = observedRichCapabilities(result);
  return result;
}

function emptyFeatureSampling(sampleLimit) {
  return {
    sampledRecords: 0,
    sampledLookups: 0,
    sampleLimit,
    unreadableSampleRecords: 0,
    aliasLinkRecords: 0,
    commonHtmlTagFamilyRecords: {
      structure: 0,
      formatting: 0,
      headings: 0,
      lists: 0,
      tables: 0,
      links: 0,
      media: 0
    },
    inlineStyleRecords: 0,
    styleSheetReferenceRecords: 0,
    compactStyleMarkerRecords: 0,
    imageReferenceRecords: 0,
    audioReferenceRecords: 0,
    localAnchorRecords: 0,
    entryReferenceRecords: 0,
    soundReferenceRecords: 0,
    relativeResourcePathRecords: 0,
    otherUriSchemeRecords: 0,
    otherUriSchemeKinds: { data: 0, javascript: 0, file: 0, ftp: 0, other: 0 },
    remoteUrlRecords: 0,
    unusualResourceExtensionReferences: 0,
    sampledPrefixTruncatedRecords: 0,
    observedCapabilities: []
  };
}

function classifyRecordSample(text, report, truncated) {
  const tagGroups = {
    structure: /<\s*\/?\s*(?:p|div|br|span)\b/iu,
    formatting: /<\s*\/?\s*(?:b|strong|i|em|u|sup|sub)\b/iu,
    headings: /<\s*\/?\s*h[1-6]\b/iu,
    lists: /<\s*\/?\s*(?:ul|ol|li)\b/iu,
    tables: /<\s*\/?\s*(?:table|thead|tbody|tr|th|td)\b/iu,
    links: /<\s*\/?\s*a\b/iu,
    media: /<\s*\/?\s*(?:img|audio|video|source)\b/iu
  };
  for (const [family, pattern] of Object.entries(tagGroups)) {
    if (pattern.test(text)) report.commonHtmlTagFamilyRecords[family] += 1;
  }
  if (/\bstyle\s*=/iu.test(text)) report.inlineStyleRecords += 1;
  if (/`\d+`/u.test(text)) report.compactStyleMarkerRecords += 1;
  if (/<\s*link\b[^>]*\brel\s*=\s*["']?stylesheet/iu.test(text) || /\.css(?:[?#"'])/iu.test(text) || /\burl\s*\(/iu.test(text)) report.styleSheetReferenceRecords += 1;
  if (/<\s*img\b/iu.test(text)) report.imageReferenceRecords += 1;
  if (/<\s*(?:audio|video|source)\b/iu.test(text) || /\bsound:\/\//iu.test(text)) report.audioReferenceRecords += 1;
  if (/<\s*a\b[^>]*\bhref\s*=\s*["']\s*#/iu.test(text)) report.localAnchorRecords += 1;
  if (/\bentry:\/\//iu.test(text)) report.entryReferenceRecords += 1;
  if (/\bsound:\/\//iu.test(text)) report.soundReferenceRecords += 1;
  if (/^@@@LINK=/iu.test(text)) report.aliasLinkRecords += 1;
  const uriValues = [];
  const ref = /\b(?:src|href)\s*=\s*(["'])(.*?)\1/giu;
  let match;
  while ((match = ref.exec(text)) && uriValues.length < 256) uriValues.push(match[2]);
  let relativeHit = false;
  let remoteHit = false;
  const otherSchemeHits = new Set();
  for (const value of uriValues) {
    const uriScheme = /^([a-z][a-z\d+.-]*):/iu.exec(value)?.[1]?.toLowerCase();
    if (uriScheme === "http" || uriScheme === "https") {
      remoteHit = true;
      continue;
    }
    if (uriScheme) {
      if (!["entry", "sound"].includes(uriScheme)) {
        const kind = ["data", "javascript", "file", "ftp"].includes(uriScheme) ? uriScheme : "other";
        otherSchemeHits.add(kind);
      }
      continue;
    }
    if (value.startsWith("#") || value.startsWith("//") || value.startsWith("/")) continue;
    const extension = /\.([a-z\d]{1,12})(?:[?#].*)?$/iu.exec(value)?.[1]?.toLowerCase();
    if (!extension) continue;
    relativeHit = true;
    if (!KNOWN_RESOURCE_EXTENSIONS.has(extension)) report.unusualResourceExtensionReferences += 1;
  }
  if (relativeHit) report.relativeResourcePathRecords += 1;
  if (remoteHit) report.remoteUrlRecords += 1;
  if (otherSchemeHits.size) report.otherUriSchemeRecords += 1;
  for (const kind of otherSchemeHits) report.otherUriSchemeKinds[kind] += 1;
  if (truncated) report.sampledPrefixTruncatedRecords += 1;
}

function utf8Prefix(value, maximumBytes) {
  let characterLength = 0;
  let byteLength = 0;
  for (const character of value) {
    const nextBytes = Buffer.byteLength(character, "utf8");
    if (byteLength + nextBytes > maximumBytes) break;
    byteLength += nextBytes;
    characterLength += character.length;
  }
  return { text: value.slice(0, characterLength), truncated: characterLength < value.length };
}

function evenlySpacedIndices(total, count) {
  if (total <= 0 || count <= 0) return [];
  if (count === 1) return [Math.floor((total - 1) / 2)];
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(Math.round(i * (total - 1) / (count - 1)));
  return [...new Set(out)];
}

async function summarizeMddResources(source, index) {
  const result = {
    resourceCount: index.keyCount,
    resourceExtensionHistogram: {},
    resourceTypeHistogram: { image: 0, audio: 0, stylesheet: 0, other: 0 },
    maxObservedResourceBytes: 0,
    resourcePathNormalizationChanges: 0,
    resourcePathNormalizationIssues: 0,
    unsupportedResourceForms: { unsafePath: 0, unknownExtension: 0 }
  };
  let previous = null;
  for (let blockIndex = 0; blockIndex < index.keyBlocks.length; blockIndex += 1) {
    const descriptor = index.keyBlocks[blockIndex];
    const encoded = await source.read(descriptor.dataOffset, descriptor.compressedBytes);
    const decoded = await decodeMdictBlock({
      input: encoded,
      expectedBytes: descriptor.decompressedBytes,
      limits: MDD_IMPORT_LIMITS,
      label: "MDD resource path index"
    });
    const cursor = new MDictCursor(decoded.bytes);
    for (let local = 0; local < descriptor.entryCount; local += 1) {
      const recordOffset = cursor.readSafeUint64Be("MDD resource record offset");
      const rawPath = readRawMddPath(cursor);
      let normalizedPath;
      try {
        normalizedPath = normalizeMddResourcePath(rawPath);
        if (normalizedPath !== rawPath) result.resourcePathNormalizationChanges += 1;
      } catch {
        result.resourcePathNormalizationIssues += 1;
        result.unsupportedResourceForms.unsafePath += 1;
        continue;
      }
      if (previous) {
        const size = Math.max(0, recordOffset - previous.recordOffset);
        accountMddResource(previous.path, size, result);
      }
      previous = { path: normalizedPath, recordOffset };
    }
    if (cursor.remaining !== 0) throw new Error("MDD path block has trailing bytes.");
  }
  if (previous) accountMddResource(previous.path, Math.max(0, index.totalRecordBytes - previous.recordOffset), result);
  result.unsupportedResourceForms.unknownExtension = result.resourceExtensionHistogram.other || 0;
  return result;
}

function readRawMddPath(cursor) {
  const start = cursor.offset;
  let end = -1;
  for (let offset = start; offset + 2 <= cursor.bytes.byteLength && offset - start <= 8192; offset += 2) {
    if (cursor.bytes[offset] === 0 && cursor.bytes[offset + 1] === 0) { end = offset; break; }
  }
  if (end < 0 || end === start) throw new Error("MDD resource path is invalid.");
  let path;
  try { path = UTF16LE.decode(cursor.read(end - start, "MDD resource path")); }
  catch { throw new Error("MDD resource path encoding is invalid."); }
  cursor.read(2, "MDD resource path terminator");
  return path;
}

function accountMddResource(path, size, result) {
  result.maxObservedResourceBytes = Math.max(result.maxObservedResourceBytes, size);
  const extension = /\.([a-z\d]{1,12})$/iu.exec(path)?.[1]?.toLowerCase() || "other";
  const bucket = KNOWN_RESOURCE_EXTENSIONS.has(extension) ? extension : "other";
  result.resourceExtensionHistogram[bucket] = (result.resourceExtensionHistogram[bucket] || 0) + 1;
  if (bucket === "png" || bucket === "jpg" || bucket === "jpeg" || bucket === "gif" || bucket === "bmp" || bucket === "webp" || bucket === "ico" || bucket === "svg") result.resourceTypeHistogram.image += 1;
  else if (["mp3", "ogg", "wav"].includes(bucket)) result.resourceTypeHistogram.audio += 1;
  else if (bucket === "css") result.resourceTypeHistogram.stylesheet += 1;
  else result.resourceTypeHistogram.other += 1;
}

function emptyMddResourceSummary() {
  return {
    resourceCount: 0,
    resourceExtensionHistogram: {},
    resourceTypeHistogram: { image: 0, audio: 0, stylesheet: 0, other: 0 },
    maxObservedResourceBytes: 0,
    resourcePathNormalizationChanges: 0,
    resourcePathNormalizationIssues: 0,
    unsupportedResourceForms: { unsafePath: 0, unknownExtension: 0 }
  };
}

function companionNamingPattern(mdxPath, mddPath) {
  const mdxStem = basename(mdxPath, extname(mdxPath)).toLowerCase();
  const mddStem = basename(mddPath, extname(mddPath)).toLowerCase();
  if (mddStem === mdxStem) return "matching-stem";
  const escaped = mdxStem.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  if (new RegExp(`^${escaped}(?:[._-]?\\d+)$`, "u").test(mddStem)) return "numbered-companion";
  return "explicit-other-stem";
}

function parseEncryptedSafely(value) {
  try { return parseEncryptedFlag(value); } catch { return -1; }
}

function safeYesNo(value, fallback = "no") {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return fallback;
  if (["yes", "true", "1"].includes(text)) return "yes";
  if (["no", "false", "0"].includes(text)) return "no";
  return "other";
}

function safeVersion(value) {
  const text = String(value || "").trim();
  return text && text.length <= 32 && /^(?:0|[1-9]\d*)(?:\.\d+){0,2}$/u.test(text) ? text : "unrecognized";
}

function isRequiredVersionSupported(value) {
  if (value === "unrecognized") return false;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 2;
}

function normalizeEncodingName(raw) {
  if (["UTF8", "UTF-8"].includes(raw)) return "UTF-8";
  if (["UTF16", "UTF-16", "UTF-16LE"].includes(raw)) return "UTF-16";
  if (["GBK", "CP936", "GB2312"].includes(raw)) return "GBK";
  if (["BIG5", "BIG-5"].includes(raw)) return "BIG5";
  if (raw === "GB18030") return "GB18030";
  return "OTHER";
}

function encodingCapability(raw) {
  if (/^(?:GBK|CP936|GB2312)$/u.test(String(raw).toUpperCase())) return CAP.mdx.encodingGbk;
  if (/^BIG-?5$/u.test(String(raw).toUpperCase())) return CAP.mdx.encodingBig5;
  if (/^GB18030$/u.test(String(raw).toUpperCase())) return CAP.mdx.encodingGb18030;
  return CAP.mdx.encodingOther;
}

function sanitizeLabel(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\\/\u0000-\u001f\u007f]/gu, " ")
    .replace(/[^\p{L}\p{N} ._-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_REPORT_LABEL_CHARS);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function unique(values) { return [...new Set(values.filter(Boolean))].sort(); }
function max(values) { return values.length ? Math.max(...values) : 0; }

function showHelp() {
  return [
    "Usage: npm run inspect:mdict -- <dictionary.mdx> [companion.mdd ...] [options]",
    "",
    "Options:",
    "  --label <text>       Sanitized local report label (max 80 characters)",
    "  --output <path>      Write JSON to an explicitly chosen local path",
    "  --hash               Include local SHA-256 values (omitted by default)",
    "  --no-hash            Explicitly omit local SHA-256 values",
    "  --samples <1-24>     Maximum deterministic record samples (default 12)",
    "  --help               Show this help",
    "",
    "Inspection is capped at 16 companion MDD files and 512 MiB combined input. The report never includes definitions, examples, resource bytes, paths, or full file names."
  ].join("\n");
}

export async function runCli(args = process.argv.slice(2)) {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(showHelp() + "\n");
    return 0;
  }
  const positional = [];
  let label;
  let outputPath;
  let includeHashes = false;
  let sampleRecords = DEFAULT_SAMPLE_RECORDS;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--label" || arg === "--output" || arg === "--samples") {
      const value = args[++index];
      if (!value) throw new Error(`Missing value for ${arg}.`);
      if (arg === "--label") label = value;
      else if (arg === "--output") outputPath = value;
      else sampleRecords = boundedInteger(value, DEFAULT_SAMPLE_RECORDS, 1, MAX_SAMPLE_RECORDS);
    } else if (arg === "--hash") includeHashes = true;
    else if (arg === "--no-hash") includeHashes = false;
    else if (arg.startsWith("-")) throw new Error("Unknown inspector option.");
    else positional.push(arg);
  }
  if (!positional.length) throw new Error("An MDX input is required.");
  const [mdxPath, ...mddPaths] = positional;
  const report = await inspectMdictFiles({ mdxPath, mddPaths, label, includeHashes, sampleRecords });
  const serialized = JSON.stringify(report, null, 2) + "\n";
  if (outputPath) {
    await assertOutputDoesNotOverwriteInputs(outputPath, [mdxPath, ...mddPaths]);
    await writeFile(resolve(outputPath), serialized, { encoding: "utf8" });
  }
  else process.stdout.write(serialized);
  return 0;
}

async function assertOutputDoesNotOverwriteInputs(outputPath, inputPaths) {
  const resolvedOutput = resolve(outputPath);
  const inputFiles = await Promise.all(inputPaths.map(async (path) => {
    const resolvedInput = resolve(path);
    let info;
    try {
      info = await stat(resolvedInput, { bigint: true });
    } catch {
      throw new Error("Output cannot be checked against an unreadable input.");
    }
    let canonicalPath;
    try {
      canonicalPath = await realpath(resolvedInput);
    } catch {
      throw new Error("Output cannot be checked against an unreadable input.");
    }
    return { canonicalPath, device: info.dev, inode: info.ino };
  }));

  let outputInfo = null;
  try {
    outputInfo = await stat(resolvedOutput, { bigint: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw new Error("Output path is not writable.");
  }

  let canonicalOutput;
  try {
    canonicalOutput = outputInfo
      ? await realpath(resolvedOutput)
      : resolve(await realpath(dirname(resolvedOutput)), basename(resolvedOutput));
  } catch {
    throw new Error("Output path is not writable.");
  }

  if (inputFiles.some((input) =>
    canonicalOutput === input.canonicalPath ||
    (outputInfo && outputInfo.dev === input.device && outputInfo.ino === input.inode)
  )) {
    throw new Error("Output must be distinct from every MDX/MDD input.");
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    process.exitCode = await runCli();
  } catch (error) {
    process.stderr.write(`MDict inspection failed: ${sanitizeCliError(error)}\n`);
    process.exitCode = 1;
  }
}

function sanitizeCliError(error) {
  const message = String(error?.message || "Inspection failed.");
  if (/expected a \.mdx|expected a \.mdd|missing value|unknown inspector|input|required|output|safety limit|exceeds/iu.test(message)) {
    return message.replace(/[^\p{L}\p{N} .,:;_()-]/gu, "").slice(0, 180);
  }
  return "input is invalid, unreadable, unsupported, or exceeds a safety bound";
}
