import { deflateSync } from "node:zlib";
import { adler32 } from "../../src/background/packs/importers/mdict-contract.js";
import { ripemd128 } from "../../src/background/packs/importers/mdict-ripemd128.js";

const KEY_INFO_SALT = Uint8Array.of(0x95, 0x36, 0, 0);

/** Build a small MDX v2 corpus, including an actually encrypted key-info block. */
export function makeRichMdx(entries, {
  title = "Rich MDX Fixture",
  encrypted = 0,
  requiredEngineVersion = "2.0",
  compact = "No",
  compat = "No",
  format = "Html",
  encoding = "UTF-8",
  keyBlockEntryCounts = [entries?.length || 0],
  keyBlockDescriptorOverrides = [],
  styleSheet = "1\n<b>\n</b>"
} = {}) {
  if (!Array.isArray(entries) || !entries.length) {
    throw new Error("Rich MDict fixture requires entries.");
  }

  const textEncoding = String(encoding).toUpperCase() === "UTF-16" ? "utf16le" : "utf8";
  const terminator = textEncoding === "utf16le" ? Buffer.from([0, 0]) : Buffer.from([0]);
  const recordParts = [];
  const offsets = [];
  let recordOffset = 0;
  for (const [, record] of entries) {
    offsets.push(recordOffset);
    const bytes = Buffer.concat([Buffer.from(record, textEncoding), terminator]);
    recordParts.push(bytes);
    recordOffset += bytes.byteLength;
  }

  if (
    !Array.isArray(keyBlockEntryCounts) ||
    keyBlockEntryCounts.some((count) => !Number.isInteger(count) || count <= 0) ||
    keyBlockEntryCounts.reduce((sum, count) => sum + count, 0) !== entries.length
  ) {
    throw new Error("Rich MDict fixture key-block entry counts are invalid.");
  }
  let entryOffset = 0;
  const keyBlocks = [];
  const keyDescriptors = [];
  for (const [blockIndex, blockEntryCount] of keyBlockEntryCounts.entries()) {
    const blockEntries = entries.slice(entryOffset, entryOffset + blockEntryCount);
    const descriptorOverride = keyBlockDescriptorOverrides[blockIndex] || {};
    const keyRaw = Buffer.concat(blockEntries.map(([key], localIndex) => Buffer.concat([
      u64be(offsets[entryOffset + localIndex]), Buffer.from(key, textEncoding), terminator
    ])));
    const keyBlock = wrapBlock(keyRaw);
    keyBlocks.push(keyBlock);
    keyDescriptors.push(Buffer.concat([
      u64be(blockEntryCount),
      sizedKey(Buffer.from(descriptorOverride.firstKey ?? fixtureLookupKey(blockEntries[0][0]), textEncoding), textEncoding === "utf16le" ? 2 : 1),
      sizedKey(Buffer.from(descriptorOverride.lastKey ?? fixtureLookupKey(blockEntries.at(-1)[0]), textEncoding), textEncoding === "utf16le" ? 2 : 1),
      u64be(keyBlock.byteLength),
      u64be(keyRaw.byteLength)
    ]));
    entryOffset += blockEntryCount;
  }
  const keyBlocksBytes = keyBlocks.reduce((sum, block) => sum + block.byteLength, 0);
  const keyInfoRaw = Buffer.concat(keyDescriptors);
  const keyInfoPlain = wrapBlock(keyInfoRaw);
  const keyInfo = encrypted === 2
    ? encryptKeyInfoBlock(keyInfoPlain)
    : keyInfoPlain;
  const keyPreamble = Buffer.concat([
    u64be(keyBlocks.length),
    u64be(entries.length),
    u64be(keyInfoRaw.byteLength),
    u64be(keyInfo.byteLength),
    u64be(keyBlocksBytes)
  ]);

  const recordRaw = Buffer.concat(recordParts);
  const recordBlock = wrapBlock(recordRaw);
  const recordHeader = Buffer.concat([
    u64be(1),
    u64be(entries.length),
    u64be(16),
    u64be(recordBlock.byteLength),
    u64be(recordBlock.byteLength),
    u64be(recordRaw.byteLength)
  ]);

  const headerText = [
    "<Dictionary",
    ' GeneratedByEngineVersion="2.0"',
    ` RequiredEngineVersion="${escapeAttribute(requiredEngineVersion)}"`,
    ` Encrypted="${encrypted}"`,
    ` Encoding="${textEncoding === "utf16le" ? "UTF-16" : "UTF-8"}"`,
    ` Format="${escapeAttribute(format)}"`,
    ` Compact="${compact}"`,
    ` Compat="${compat}"`,
    ' KeyCaseSensitive="No"',
    ' StripKey="Yes"',
    ` Description="${escapeAttribute("Bounded security fixture")}"`,
    ` Title="${escapeAttribute(title)}"`,
    ` StyleSheet="${escapeAttribute(styleSheet)}"`,
    "/>\r\n\u0000"
  ].join("");
  const header = Buffer.from(headerText, "utf16le");
  const lengthPrefix = Buffer.alloc(4);
  lengthPrefix.writeUInt32BE(header.byteLength);
  const headerChecksum = Buffer.alloc(4);
  headerChecksum.writeUInt32LE(adler32(header));
  const keyPreambleChecksum = u32be(adler32(keyPreamble));

  return Buffer.concat([
    lengthPrefix,
    header,
    headerChecksum,
    keyPreamble,
    keyPreambleChecksum,
    keyInfo,
    ...keyBlocks,
    recordHeader,
    recordBlock
  ]);
}

function encryptKeyInfoBlock(plainInput) {
  const plain = Buffer.from(plainInput);
  const output = Buffer.from(plain);
  const material = new Uint8Array(8);
  material.set(plain.subarray(4, 8));
  material.set(KEY_INFO_SALT, 4);
  const key = ripemd128(material);
  let previous = 0x36;
  for (let index = 8; index < plain.byteLength; index += 1) {
    const value = plain[index] ^ previous ^ ((index - 8) & 0xff) ^ key[(index - 8) % key.length];
    const cipher = ((value >>> 4) | (value << 4)) & 0xff;
    output[index] = cipher;
    previous = cipher;
  }
  return output;
}

function wrapBlock(rawInput) {
  const raw = Buffer.from(rawInput);
  const header = Buffer.alloc(8);
  header[0] = 2;
  header.writeUInt32BE(adler32(raw), 4);
  return Buffer.concat([header, deflateSync(raw)]);
}

function sizedKey(bytes, unitBytes = 1) {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.byteLength / unitBytes);
  return Buffer.concat([length, bytes, Buffer.alloc(unitBytes)]);
}

function u64be(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value));
  return bytes;
}

function u32be(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value >>> 0);
  return bytes;
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function fixtureLookupKey(value) {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, "");
}
