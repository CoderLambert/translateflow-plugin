import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";

const fixtureDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/mdd-interop"
);

/** Load the independently generated, pinned writemdict positive fixture. */
export async function readMddInteropFixture() {
  const [mdx, mdd] = await Promise.all([
    readFile(resolve(fixtureDirectory, "interop.mdx")),
    readFile(resolve(fixtureDirectory, "interop.mdd"))
  ]);
  return { mdx, mdd };
}

/**
 * Build a small v2 MDD for parser edge cases. Positive interoperability tests
 * must use readMddInteropFixture(); this helper is a local adversarial-fixture
 * builder, not independent-format evidence.
 */
export function makeMdd(entries, {
  title = "MDD Security Fixture",
  keyInfoCompression = "zlib",
  keyCompression = "zlib",
  recordCompression = "zlib",
  recordOffsets,
  recordBlockBytes
} = {}) {
  if (!Array.isArray(entries) || !entries.length) {
    throw new TypeError("MDD fixture requires at least one resource.");
  }
  const normalized = entries.map(([key, input]) => {
    if (typeof key !== "string" || !key) {
      throw new TypeError("MDD fixture resource key must be non-empty text.");
    }
    if (!(input instanceof Uint8Array)) {
      throw new TypeError("MDD fixture resource data must be bytes.");
    }
    return [key, Buffer.from(input)];
  }).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);

  const recordParts = [];
  const keyParts = [];
  const descriptors = [];
  let recordOffset = 0;
  for (const [index, [key, resource]] of normalized.entries()) {
    const offset = recordOffsetOverride(recordOffsets, index, key, recordOffset);
    const keyBytes = Buffer.from(key, "utf16le");
    keyParts.push(u64be(offset), keyBytes, Buffer.from([0, 0]));
    recordParts.push(resource);
    recordOffset += resource.byteLength;
  }
  const keyData = Buffer.concat(keyParts);
  const keyBlock = wrapBlock(keyData, keyCompression);
  const firstKey = normalized[0][0];
  const lastKey = normalized.at(-1)[0];
  descriptors.push(
    u64be(normalized.length),
    sizedKey(firstKey),
    sizedKey(lastKey),
    u64be(keyBlock.byteLength),
    u64be(keyData.byteLength)
  );
  const keyIndex = Buffer.concat(descriptors);
  const compressedKeyIndex = wrapBlock(keyIndex, keyInfoCompression);
  const keyPreamble = Buffer.concat([
    u64be(1),
    u64be(normalized.length),
    u64be(keyIndex.byteLength),
    u64be(compressedKeyIndex.byteLength),
    u64be(keyBlock.byteLength)
  ]);

  const recordData = Buffer.concat(recordParts);
  const recordChunks = splitRecordData(recordData, recordBlockBytes);
  const recordBlocks = recordChunks.map((chunk) => wrapBlock(chunk, recordCompression));
  const recordBlocksBytes = recordBlocks.reduce((sum, block) => sum + block.byteLength, 0);
  const recordHeader = Buffer.concat([
    u64be(recordBlocks.length),
    u64be(normalized.length),
    u64be(recordBlocks.length * 16),
    u64be(recordBlocksBytes)
  ]);
  const recordIndex = Buffer.concat(recordBlocks.flatMap((block, index) => [
    u64be(block.byteLength),
    u64be(recordChunks[index].byteLength)
  ]));
  const mddHeader = Buffer.from([
    "<Library_Data",
    ' GeneratedByEngineVersion="2.0"',
    ' RequiredEngineVersion="2.0"',
    ' Encrypted="0"',
    ' Format=""',
    ' CreationDate="2026-09-30"',
    ' Compact="No"',
    ' Compat="No"',
    ' KeyCaseSensitive="No"',
    ' Description="Adversarial fixture only"',
    ` Title="${escapeAttribute(title)}"`,
    ' DataSourceFormat="106"',
    ' StyleSheet=""',
    ' RegisterBy=""',
    ' RegCode=""/>\r\n\u0000'
  ].join(""), "utf16le");
  const headerPrefix = Buffer.alloc(4);
  headerPrefix.writeUInt32BE(mddHeader.byteLength);

  return Buffer.concat([
    headerPrefix,
    mddHeader,
    u32le(adler32(mddHeader)),
    keyPreamble,
    u32be(adler32(keyPreamble)),
    compressedKeyIndex,
    keyBlock,
    recordHeader,
    recordIndex,
    ...recordBlocks
  ]);
}

function splitRecordData(input, boundaries) {
  const data = Buffer.from(input);
  if (boundaries === undefined) return [data];
  if (!Array.isArray(boundaries)) {
    throw new TypeError("MDD fixture recordBlockBytes must be an array of split offsets.");
  }
  const offsets = [...boundaries];
  if (offsets.some((value, index) =>
    !Number.isSafeInteger(value) || value <= (offsets[index - 1] || 0) || value >= data.byteLength
  )) {
    throw new TypeError("MDD fixture recordBlockBytes offsets must increase inside the raw record stream.");
  }
  const starts = [0, ...offsets];
  const ends = [...offsets, data.byteLength];
  return starts.map((start, index) => data.subarray(start, ends[index]));
}

function wrapBlock(input, compression) {
  const raw = Buffer.from(input);
  const prefix = Buffer.alloc(8);
  prefix.writeUInt32BE(adler32(raw), 4);
  if (compression === "zlib") {
    prefix[0] = 2;
    return Buffer.concat([prefix, deflateSync(raw)]);
  }
  if (compression === "none") {
    return Buffer.concat([prefix, raw]);
  }
  throw new TypeError("MDD fixture compression must be 'none' or 'zlib'.");
}

function recordOffsetOverride(overrides, index, key, fallback) {
  if (overrides === undefined) return fallback;
  if (Array.isArray(overrides)) {
    if (!Number.isSafeInteger(overrides[index])) {
      throw new TypeError("MDD fixture recordOffsets must contain a safe integer per entry.");
    }
    return overrides[index];
  }
  if (overrides instanceof Map && overrides.has(key)) {
    const value = overrides.get(key);
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("MDD fixture record offset must be a safe integer.");
    }
    return value;
  }
  return fallback;
}

function sizedKey(value) {
  const key = Buffer.from(value, "utf16le");
  const units = Buffer.alloc(2);
  units.writeUInt16BE(key.byteLength / 2);
  return Buffer.concat([units, key, Buffer.from([0, 0])]);
}

function u64be(value) {
  const result = Buffer.alloc(8);
  result.writeBigUInt64BE(BigInt(value));
  return result;
}

function u32be(value) {
  const result = Buffer.alloc(4);
  result.writeUInt32BE(value >>> 0);
  return result;
}

function u32le(value) {
  const result = Buffer.alloc(4);
  result.writeUInt32LE(value >>> 0);
  return result;
}

function adler32(input) {
  const modulus = 65521;
  let a = 1;
  let b = 0;
  for (const value of input) {
    a = (a + value) % modulus;
    b = (b + a) % modulus;
  }
  return ((b << 16) | a) >>> 0;
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
