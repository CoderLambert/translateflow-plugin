import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";

const fixtureDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/mdd-interop"
);
const linkedPackageFixtureDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/mdd-linked-package"
);
const distinctAudioFixtureDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/mdd-audio-526"
);

/** Load the independently generated, pinned writemdict positive fixture. */
export async function readMddInteropFixture() {
  const [mdx, mdd] = await Promise.all([
    readFile(resolve(fixtureDirectory, "interop.mdx")),
    readFile(resolve(fixtureDirectory, "interop.mdd"))
  ]);
  return { mdx, mdd };
}

/** Load the pinned independent MDD with 526 distinct audio resource paths. */
export async function readMddAudio526Fixture() {
  const [mdd, lockSource] = await Promise.all([
    readFile(resolve(distinctAudioFixtureDirectory, "audio-526.mdd")),
    readFile(resolve(distinctAudioFixtureDirectory, "corpus-lock.json"), "utf8")
  ]);
  return { mdd, lock: JSON.parse(lockSource) };
}

/** Load the independently generated six-file package used by the package lifecycle E2E. */
export async function readMddLinkedPackageFixture() {
  const names = [
    "linked-package.mdx", "linked-package.mdd", "linked-package.1.mdd",
    "fixture.css", "sample.png", "tone.wav"
  ];
  const buffers = await Promise.all(names.map((name) => readFile(resolve(linkedPackageFixtureDirectory, name))));
  return Object.fromEntries(names.map((name, index) => [name, buffers[index]]));
}

/**
 * Build a small v2 MDD for parser edge cases. Positive interoperability tests
 * must use readMddInteropFixture(); this helper is a local adversarial-fixture
 * builder, not independent-format evidence.
 */
export function makeMdd(entries, {
  title = "MDD Security Fixture",
  encrypted = 0,
  keyInfoCompression = "zlib",
  keyCompression = "zlib",
  recordCompression = "zlib",
  keyOrder = "case-sensitive",
  keyCaseSensitive = "No",
  keyBlockEntryCounts = [entries?.length || 0],
  keyBlockDescriptorOverrides = [],
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
  }).sort(([left], [right]) => compareFixtureKeys(left, right, keyOrder));

  if (
    !["case-sensitive", "case-folded"].includes(keyOrder) ||
    !Array.isArray(keyBlockEntryCounts) ||
    keyBlockEntryCounts.some((count) => !Number.isInteger(count) || count <= 0) ||
    keyBlockEntryCounts.reduce((sum, count) => sum + count, 0) !== normalized.length
  ) {
    throw new TypeError("MDD fixture key order or key block counts are invalid.");
  }

  const recordParts = [];
  const keyBlocks = [];
  const descriptors = [];
  let recordOffset = 0;
  for (const [index, [key, resource]] of normalized.entries()) {
    const offset = recordOffsetOverride(recordOffsets, index, key, recordOffset);
    recordParts.push(resource);
    normalized[index] = [key, resource, offset];
    recordOffset += resource.byteLength;
  }
  let entryOffset = 0;
  for (const [blockIndex, entryCount] of keyBlockEntryCounts.entries()) {
    const blockEntries = normalized.slice(entryOffset, entryOffset + entryCount);
    const keyData = Buffer.concat(blockEntries.map(([key, , offset]) => Buffer.concat([
      u64be(offset), Buffer.from(key, "utf16le"), Buffer.from([0, 0])
    ])));
    const keyBlock = wrapBlock(keyData, keyCompression);
    keyBlocks.push(keyBlock);
    const descriptorOverride = keyBlockDescriptorOverrides[blockIndex] || {};
    const firstKey = descriptorOverride.firstKey ?? blockEntries[0][0];
    const lastKey = descriptorOverride.lastKey ?? blockEntries.at(-1)[0];
    descriptors.push(
      u64be(blockEntries.length),
      sizedKey(firstKey),
      sizedKey(lastKey),
      u64be(keyBlock.byteLength),
      u64be(keyData.byteLength)
    );
    entryOffset += entryCount;
  }

  const keyIndex = Buffer.concat(descriptors);
  const compressedKeyIndex = wrapBlock(keyIndex, keyInfoCompression);
  const keyBlocksBytes = keyBlocks.reduce((sum, block) => sum + block.byteLength, 0);
  const keyPreamble = Buffer.concat([
    u64be(keyBlocks.length),
    u64be(normalized.length),
    u64be(keyIndex.byteLength),
    u64be(compressedKeyIndex.byteLength),
    u64be(keyBlocksBytes)
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
    ` Encrypted="${encrypted}"`,
    ' Format=""',
    ' CreationDate="2026-09-30"',
    ' Compact="No"',
    ' Compat="No"',
    keyCaseSensitive == null ? "" : ` KeyCaseSensitive="${keyCaseSensitive}"`,
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
    ...keyBlocks,
    recordHeader,
    recordIndex,
    ...recordBlocks
  ]);
}

function compareFixtureKeys(left, right, orderMode) {
  if (orderMode === "case-folded") {
    const leftFolded = left.toLowerCase();
    const rightFolded = right.toLowerCase();
    if (leftFolded < rightFolded) return -1;
    if (leftFolded > rightFolded) return 1;
  }
  return left < right ? -1 : left > right ? 1 : 0;
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
