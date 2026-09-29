import { deflateSync } from "node:zlib";
import {
  adler32
} from "../../src/background/packs/importers/mdict-contract.js";

export function makeMdx(entries, {
  encoding = "UTF-8",
  generatedVersion = "2.0",
  encrypted = "0",
  compact = "No",
  styleSheet = "",
  keyIndexCompression = "zlib",
  keyBlockCompression = "zlib",
  recordCompression = "zlib",
  recordOffsets,
  keyIndexEntryCount,
  keyBlockDeclaredDecompressedBytes
} = {}) {
  if (!entries.length) {
    throw new Error("MDict fixture requires entries");
  }
  const codec = fixtureCodec(encoding);

  const recordParts = [];
  const naturalOffsets = [];
  let recordOffset = 0;
  for (const [, definition] of entries) {
    naturalOffsets.push(recordOffset);
    const record = Buffer.concat([
      codec.encode(definition),
      Buffer.alloc(codec.unitBytes)
    ]);
    recordParts.push(record);
    recordOffset += record.byteLength;
  }
  const offsets = recordOffsets || naturalOffsets;

  const keyRawParts = [];
  for (let index = 0; index < entries.length; index += 1) {
    keyRawParts.push(
      u64be(offsets[index]),
      codec.encode(entries[index][0]),
      Buffer.alloc(codec.unitBytes)
    );
  }
  const keyBlockRaw = Buffer.concat(keyRawParts);
  const keyBlock = wrapBlock(
    keyBlockRaw,
    keyBlockCompression
  );
  const keyBlockExpected =
    keyBlockDeclaredDecompressedBytes ??
    keyBlockRaw.byteLength;

  const firstKeyBytes = codec.encode(entries[0][0]);
  const lastKeyBytes =
    codec.encode(entries.at(-1)[0]);
  const keyIndexRaw = Buffer.concat([
    u64be(keyIndexEntryCount ?? entries.length),
    u16be(firstKeyBytes.byteLength / codec.unitBytes),
    firstKeyBytes,
    Buffer.alloc(codec.unitBytes),
    u16be(lastKeyBytes.byteLength / codec.unitBytes),
    lastKeyBytes,
    Buffer.alloc(codec.unitBytes),
    u64be(keyBlock.byteLength),
    u64be(keyBlockExpected)
  ]);
  const keyIndexBlock =
    wrapBlock(keyIndexRaw, keyIndexCompression);

  const keyPreamble = Buffer.concat([
    u64be(1),
    u64be(entries.length),
    u64be(keyIndexRaw.byteLength),
    u64be(keyIndexBlock.byteLength),
    u64be(keyBlock.byteLength)
  ]);

  const recordRaw = Buffer.concat(recordParts);
  const recordBlock =
    wrapBlock(recordRaw, recordCompression);
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
    ' GeneratedByEngineVersion="' + generatedVersion + '"',
    ' RequiredEngineVersion="2.0"',
    ' Encrypted="' + encrypted + '"',
    ' Encoding="' + encoding + '"',
    ' Format="Text"',
    ' Compact="' + compact + '"',
    ' Compat="No"',
    ' KeyCaseSensitive="No"',
    ' Description="Safe fixture"',
    ' Title="Issue 167 MDict"',
    ' StyleSheet="' + styleSheet + '"',
    "/>\r\n\u0000"
  ].join("");
  const headerBytes = Buffer.from(
    headerText,
    "utf16le"
  );

  return Buffer.concat([
    u32be(headerBytes.byteLength),
    headerBytes,
    u32le(adler32(headerBytes)),
    keyPreamble,
    u32be(adler32(keyPreamble)),
    keyIndexBlock,
    keyBlock,
    recordHeader,
    recordBlock
  ]);
}

function fixtureCodec(encoding) {
  if (encoding === "UTF-16") {
    return {
      unitBytes: 2,
      encode(value) {
        return Buffer.from(String(value), "utf16le");
      }
    };
  }
  return {
    unitBytes: 1,
    encode(value) {
      return Buffer.from(String(value), "utf8");
    }
  };
}

function wrapBlock(rawInput, compression) {
  const raw = Buffer.from(rawInput);
  const header = Buffer.alloc(8);
  let payload;
  if (compression === "none") {
    payload = raw;
  } else if (compression === "zlib") {
    header[0] = 2;
    payload = deflateSync(raw);
  } else if (compression === "lzo") {
    header[0] = 1;
    payload = raw;
  } else {
    throw new Error("unsupported fixture compression");
  }
  header.writeUInt32BE(adler32(raw), 4);
  return Buffer.concat([header, payload]);
}

function u16be(value) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16BE(value, 0);
  return bytes;
}

function u32be(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value >>> 0, 0);
  return bytes;
}

function u32le(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value >>> 0, 0);
  return bytes;
}

function u64be(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value), 0);
  return bytes;
}
