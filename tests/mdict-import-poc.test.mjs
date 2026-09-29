import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deflateSync } from "node:zlib";
import {
  MDICT_IMPORT_ERROR,
  MDICT_POC_LIMITS,
  MDictImportError,
  adler32,
  projectMdictPoc,
  projectMdictV2PlainText,
  sanitizeMdictRecord
} from "../scripts/project-mdict-import.mjs";

test("MDict v2 POC projects deterministic UTF-8 zlib blocks as semantic-neutral source facts", async () => {
  const fixture = makeMdx([
    ["hello", "你好"],
    ["run", "跑；运行"]
  ]);

  const result = await projectMdictV2PlainText({
    mdxBytes: fixture,
    sourceId: "fixture-mdict",
    sourceVersion: "v1"
  });

  assert.deepEqual(result.dictionary, {
    title: "Safe Fixture",
    generatedByEngineVersion: "2.0",
    requiredEngineVersion: "2.0",
    encoding: "UTF-8",
    format: "Text",
    entryCount: 2
  });
  assert.deepEqual(result.entries, [
    {
      lookupKey: "hello",
      exactLookupKey: "hello",
      displayForm: "hello",
      plainText: "你好",
      sourceRef: { sourceId: "fixture-mdict", recordId: "entry:1" }
    },
    {
      lookupKey: "run",
      exactLookupKey: "run",
      displayForm: "run",
      plainText: "跑；运行",
      sourceRef: { sourceId: "fixture-mdict", recordId: "entry:2" }
    }
  ]);
  assert.equal(result.policy.semanticStatus, "unclassified-plain-text");
  assert.equal(result.policy.runtimeStatus, "build-test-only");
  assert.equal(result.policy.htmlRendering, "rejected");
  assert.equal(result.policy.mddResources, "not-loaded");
  assert.deepEqual(result.blocks.keyCompression, ["zlib"]);
  assert.deepEqual(result.blocks.recordCompression, ["zlib"]);
  assert.ok(result.unsupportedFeatures.includes(".mdd resources"));
});

test("MDict v2 POC accepts UTF-16 text with uncompressed key and record blocks", async () => {
  const fixture = makeMdx([
    ["alpha", "第一"],
    ["词条", "第二"]
  ], {
    encoding: "UTF-16",
    keyIndexCompression: "none",
    keyBlockCompression: "none",
    recordCompression: "none"
  });

  const result = await projectMdictV2PlainText({ mdxBytes: fixture });
  assert.equal(result.dictionary.encoding, "UTF-16");
  assert.deepEqual(result.entries.map((entry) => entry.displayForm), ["alpha", "词条"]);
  assert.deepEqual(result.entries.map((entry) => entry.plainText), ["第一", "第二"]);
  assert.deepEqual(result.blocks.keyCompression, ["none"]);
  assert.deepEqual(result.blocks.recordCompression, ["none"]);
});

test("MDict v2 POC rejects encrypted dictionaries, LZO blocks and presentation transforms", async () => {
  await assertRejectCode(
    () => projectMdictV2PlainText({
      mdxBytes: makeMdx([["alpha", "definition"]], { encrypted: "2" })
    }),
    MDICT_IMPORT_ERROR.UNSUPPORTED
  );
  await assertRejectCode(
    () => projectMdictV2PlainText({
      mdxBytes: makeMdx([["alpha", "definition"]], { keyBlockCompression: "lzo" })
    }),
    MDICT_IMPORT_ERROR.UNSUPPORTED
  );
  await assertRejectCode(
    () => projectMdictV2PlainText({
      mdxBytes: makeMdx([["alpha", "definition"]], { compact: "Yes" })
    }),
    MDICT_IMPORT_ERROR.UNSUPPORTED
  );
});

test("MDict v2 POC rejects renderable records, redirects and unsafe control content", async () => {
  await assertRejectCode(
    () => projectMdictV2PlainText({
      mdxBytes: makeMdx([["alpha", "<b>definition</b>"]])
    }),
    MDICT_IMPORT_ERROR.UNSAFE_CONTENT
  );
  await assertRejectCode(
    () => projectMdictV2PlainText({
      mdxBytes: makeMdx([["alpha", "@@@LINK=beta"]])
    }),
    MDICT_IMPORT_ERROR.UNSUPPORTED
  );
  assertCode(
    () => sanitizeMdictRecord("safe\u0001unsafe", "alpha"),
    MDICT_IMPORT_ERROR.UNSAFE_CONTENT
  );
});

test("MDict v2 POC rejects corrupt checksums, invalid record offsets and bounded inflate expansion", async () => {
  const corruptHeader = Buffer.from(makeMdx([["alpha", "definition"]]));
  corruptHeader[12] ^= 0x01;
  await assertRejectCode(
    () => projectMdictV2PlainText({ mdxBytes: corruptHeader }),
    MDICT_IMPORT_ERROR.CORRUPT
  );

  await assertRejectCode(
    () => projectMdictV2PlainText({
      mdxBytes: makeMdx([
        ["alpha", "first"],
        ["beta", "second"]
      ], {
        recordOffsets: [0, 9999]
      })
    }),
    MDICT_IMPORT_ERROR.CORRUPT
  );

  await assertRejectCode(
    () => projectMdictV2PlainText({
      mdxBytes: makeMdx([["alpha", "definition"]], {
        keyBlockDeclaredDecompressedBytes: 8
      })
    }),
    MDICT_IMPORT_ERROR.LIMIT
  );
});

test("MDict v2 POC fails closed on unsupported version/encoding and malformed key metadata", async () => {
  await assertRejectCode(
    () => projectMdictV2PlainText({
      mdxBytes: makeMdx([["alpha", "definition"]], { generatedVersion: "3.0" })
    }),
    MDICT_IMPORT_ERROR.UNSUPPORTED
  );
  await assertRejectCode(
    () => projectMdictV2PlainText({
      mdxBytes: makeMdx([["alpha", "definition"]], { encoding: "GBK" })
    }),
    MDICT_IMPORT_ERROR.UNSUPPORTED
  );

  const mismatch = makeMdx([["alpha", "definition"]], {
    keyIndexEntryCount: 2
  });
  await assertRejectCode(
    () => projectMdictV2PlainText({ mdxBytes: mismatch }),
    MDICT_IMPORT_ERROR.CORRUPT
  );
});

test("MDict file POC writes deterministic JSONL/report and keeps import fixtures outside runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "translateflow-mdict-"));
  try {
    const mdx = join(root, "fixture.mdx");
    const outA = join(root, "a.jsonl");
    const reportA = join(root, "a-report.json");
    const outB = join(root, "b.jsonl");
    const reportB = join(root, "b-report.json");
    await writeFile(mdx, makeMdx([
      ["hello", "你好"],
      ["persistent", "持久的"]
    ]));

    await projectMdictPoc({
      mdxPath: mdx,
      outPath: outA,
      reportPath: reportA,
      sourceId: "fixture-mdict",
      sourceVersion: "v1"
    });
    await projectMdictPoc({
      mdxPath: mdx,
      outPath: outB,
      reportPath: reportB,
      sourceId: "fixture-mdict",
      sourceVersion: "v1"
    });

    assert.equal(await readFile(outA, "utf8"), await readFile(outB, "utf8"));
    assert.equal(await readFile(reportA, "utf8"), await readFile(reportB, "utf8"));
    const report = JSON.parse(await readFile(reportA, "utf8"));
    assert.equal(report.format, "mdict-poc-report");
    assert.equal(report.output.entries, 2);
    assert.equal(report.policy.runtimeStatus, "build-test-only");
    assert.equal(report.policy.tflexMapping, "not-yet-approved");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function makeMdx(entries, {
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
  if (!entries.length) throw new Error("MDict fixture requires entries");

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
  if (offsets.length !== entries.length) throw new Error("recordOffsets length mismatch");

  const keyRawParts = [];
  for (let index = 0; index < entries.length; index += 1) {
    keyRawParts.push(
      u64be(offsets[index]),
      codec.encode(entries[index][0]),
      Buffer.alloc(codec.unitBytes)
    );
  }
  const keyBlockRaw = Buffer.concat(keyRawParts);
  const keyBlock = wrapBlock(keyBlockRaw, keyBlockCompression);
  const keyBlockExpected = keyBlockDeclaredDecompressedBytes ?? keyBlockRaw.byteLength;

  const firstKey = entries[0][0];
  const lastKey = entries[entries.length - 1][0];
  const firstKeyBytes = codec.encode(firstKey);
  const lastKeyBytes = codec.encode(lastKey);
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
  const keyIndexBlock = wrapBlock(keyIndexRaw, keyIndexCompression);

  const keyPreamble = Buffer.concat([
    u64be(1),
    u64be(entries.length),
    u64be(keyIndexRaw.byteLength),
    u64be(keyIndexBlock.byteLength),
    u64be(keyBlock.byteLength)
  ]);

  const recordRaw = Buffer.concat(recordParts);
  const recordBlock = wrapBlock(recordRaw, recordCompression);
  const recordHeader = Buffer.concat([
    u64be(1),
    u64be(entries.length),
    u64be(16),
    u64be(recordBlock.byteLength),
    u64be(recordBlock.byteLength),
    u64be(recordRaw.byteLength)
  ]);

  const headerText = [
    '<Dictionary',
    ' GeneratedByEngineVersion="' + generatedVersion + '"',
    ' RequiredEngineVersion="2.0"',
    ' Encrypted="' + encrypted + '"',
    ' Encoding="' + encoding + '"',
    ' Format="Text"',
    ' Compact="' + compact + '"',
    ' Compat="No"',
    ' KeyCaseSensitive="No"',
    ' Description="Safe fixture"',
    ' Title="Safe Fixture"',
    ' StyleSheet="' + styleSheet + '"',
    '/>\r\n\u0000'
  ].join("");
  const headerBytes = Buffer.from(headerText, "utf16le");

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
  if (encoding === "UTF-8") {
    return {
      unitBytes: 1,
      encode(value) {
        return Buffer.from(String(value), "utf8");
      }
    };
  }
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

function assertCode(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof MDictImportError && error.code === code
  );
}

async function assertRejectCode(fn, code) {
  await assert.rejects(
    fn,
    (error) => error instanceof MDictImportError && error.code === code
  );
}
