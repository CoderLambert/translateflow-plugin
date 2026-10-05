import test from "node:test";
import assert from "node:assert/strict";
import {
  MDICT_IMPORT_ERROR,
  MDictImportError
} from "../src/background/packs/importers/mdict-contract.js";
import {
  buildRichMdictIndex,
  lookupRichMdict
} from "../src/background/packs/importers/mdict-rich.js";
import { ripemd128 } from "../src/background/packs/importers/mdict-ripemd128.js";
import { validateRichMdictIndex } from "../src/background/packs/importers/mdict-rich-validation.js";
import { toSafeRichMdictPlainText } from "../src/background/packs/importers/mdict-rich-record-text.js";
import { makeRichMdx } from "./helpers/rich-mdict-fixture.mjs";

test("RIPEMD-128 key-info primitive matches published test vectors", () => {
  assert.equal(
    Buffer.from(ripemd128(new Uint8Array())).toString("hex"),
    "cdf26213a150dc3ecb610f18f6b38b46"
  );
  assert.equal(
    Buffer.from(ripemd128(new TextEncoder().encode("abc"))).toString("hex"),
    "c14a12199c66e4ba84636b0f69144c77"
  );
});

test("Encrypted=2 Compact/Compat MDX builds an index and returns readable safe text", async () => {
  const bytes = makeRichMdx([
    ["alpha-beta", "<p>`1`alpha-beta`2` &amp; <b>first</b></p></br><br>Second line"],
    ["run", "<p>`1`run`2`</p><br>跑, 赛跑"]
  ], {
    encrypted: 2,
    compact: "Yes",
    compat: "Yes",
    styleSheet: "1\n<b>\n</b>\n2\n</br>\n\n"
  });
  const source = createTrackedSource(bytes);
  const index = await buildRichMdictIndex({ source });
  const readRequestsBeforeLookup = source.requests.length;
  let metrics;

  const result = await lookupRichMdict({
    source,
    index,
    text: "alpha beta",
    onMetrics(value) { metrics = value; }
  });

  assert.equal(index.header.encrypted, 2);
  assert.equal(index.header.compact, "Yes");
  assert.equal(index.header.compat, "Yes");
  assert.deepEqual(index.header.styleSheetRules.map((rule) => rule.id), [1, 2]);
  assert.equal(result.found, true);
  assert.equal(result.displayForm, "alpha-beta");
  assert.match(result.rawRecord, /<b>first<\/b>/u);
  assert.match(result.safeTextFallback, /alpha-beta & first/u);
  assert.match(result.safeTextFallback, /Second line/u);
  assert.doesNotMatch(result.safeTextFallback, /`[12]`|<\/?(?:p|b|br)>/u);
  assert.ok(metrics.sourceRangeReads > 0);
  assert.ok(metrics.sourceBytesRead < bytes.byteLength);
  assert.ok(metrics.totalDecompressedBytes <= 32 * 1024 * 1024);
  assert.ok(source.requests.length > readRequestsBeforeLookup);
  assert.ok(source.requests.every(({ offset, length }) => offset + length <= bytes.byteLength));
});

test("StripKey permits an empty normalized descriptor but never an empty stored headword", async () => {
  const bytes = makeRichMdx([
    ["%", "<p>punctuation-only headword</p>"],
    ["alpha", "<p>ordinary headword</p>"]
  ]);
  const source = createTrackedSource(bytes);
  const index = await buildRichMdictIndex({ source });

  assert.equal(index.keyBlocks[0].firstKey, "");
  assert.equal(index.keyBlocks[0].lookupMinKey, "");
  const result = await lookupRichMdict({ source, index, text: "alpha" });
  assert.equal(result.found, true);
  assert.match(result.rawRecord, /ordinary headword/u);

  await assert.rejects(
    buildRichMdictIndex({
      source: createTrackedSource(makeRichMdx([["", "<p>empty stored headword</p>"]]))
    }),
    (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.UNSAFE_CONTENT
  );
});

test("StripKey accepts a final raw key whose normalized value is empty", async () => {
  const bytes = makeRichMdx([
    ["alpha", "<p>ordinary headword</p>"],
    ["。", "<p>punctuation-only headword</p>"]
  ]);
  const source = createTrackedSource(bytes);
  const index = await buildRichMdictIndex({ source });
  const block = index.keyBlocks[0];

  assert.equal(block.firstKey, "alpha");
  assert.equal(block.lastKey, "");
  assert.equal(block.lookupMinKey, "");
  assert.equal(block.lookupMaxKey, "alpha");
  const result = await lookupRichMdict({ source, index, text: "alpha" });
  assert.equal(result.found, true);
  assert.match(result.rawRecord, /ordinary headword/u);
});

test("StripKey normalized endpoints must match the complete actual endpoint pair", async () => {
  const bytes = makeRichMdx([
    ["%", "<p>punctuation-only headword</p>"],
    ["alpha", "<p>ordinary headword</p>"]
  ], {
    keyBlockDescriptorOverrides: [{ firstKey: "wrong-boundary" }]
  });

  await assert.rejects(
    buildRichMdictIndex({ source: createTrackedSource(bytes) }),
    (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.CORRUPT
  );
});

test("UTF-16 record bytes and decoded UTF-8 bytes remain distinct within their limits", async () => {
  const record = `<div>${"漢".repeat(400_000)}<span>TAIL_SENTINEL</span></div>`;
  const bytes = makeRichMdx([["utf16fixture", record]], { encoding: "UTF-16" });
  const source = createTrackedSource(bytes);
  const index = await buildRichMdictIndex({ source });
  const result = await lookupRichMdict({ source, index, text: "utf16fixture" });

  assert.equal(index.header.encoding, "UTF-16");
  assert.equal(result.found, true);
  assert.ok(result.sourceRecordBytes <= 1024 * 1024);
  assert.ok(result.sourceRecordBytes > 800_000);
  assert.equal(result.decodedTextBytes, new TextEncoder().encode(record).byteLength);
  assert.ok(result.decodedTextBytes > 1024 * 1024);
  assert.ok(result.decodedTextBytes < 2 * 1024 * 1024);
  assert.ok(result.rawRecord.endsWith("</div>"));
  assert.match(result.rawRecord, /TAIL_SENTINEL<\/span><\/div>$/u);
});

test("corrupt Encrypted=2 key-info bytes fail as a bounded MDict corruption", async () => {
  const bytes = Buffer.from(makeRichMdx([["alpha", "definition"]], { encrypted: 2 }));
  const headerLength = bytes.readUInt32BE(0);
  const keyPreambleOffset = headerLength + 8;
  const keyInfoLength = Number(bytes.readBigUInt64BE(keyPreambleOffset + 24));
  const keyInfoOffset = keyPreambleOffset + 44;
  bytes[keyInfoOffset + 4] ^= 0xff;

  await assert.rejects(
    buildRichMdictIndex({ source: createTrackedSource(bytes) }),
    (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.CORRUPT
  );
  assert.ok(keyInfoLength > 8);
});

test("unsupported RequiredEngineVersion values fail closed", async () => {
  for (const requiredEngineVersion of ["2.1", "not-a-version"]) {
    await assert.rejects(
      buildRichMdictIndex({
        source: createTrackedSource(makeRichMdx([["alpha", "definition"]], {
          requiredEngineVersion
        }))
      }),
      (error) => error?.code === MDICT_IMPORT_ERROR.UNSUPPORTED
    );
  }
});

test("rich index validation rejects negative and cross-block decreasing record offsets", async () => {
  const bytes = makeRichMdx([
    ["alpha", "first"],
    ["beta", "second"]
  ], { encrypted: 2, keyBlockEntryCounts: [1, 1] });
  const index = await buildRichMdictIndex({ source: createTrackedSource(bytes) });

  const negative = structuredClone(index);
  negative.keyBlocks[0].firstRecordOffset = -1;
  assert.throws(
    () => validateRichMdictIndex(negative, { sourceSize: bytes.byteLength }),
    (error) => error?.code === MDICT_IMPORT_ERROR.CORRUPT
  );

  const decreasing = structuredClone(index);
  decreasing.keyBlocks[0].firstRecordOffset = 3;
  decreasing.keyBlocks[0].lastRecordOffset = 4;
  decreasing.keyBlocks[1].firstRecordOffset = 2;
  decreasing.keyBlocks[1].lastRecordOffset = 5;
  assert.throws(
    () => validateRichMdictIndex(decreasing, { sourceSize: bytes.byteLength }),
    (error) => error?.code === MDICT_IMPORT_ERROR.CORRUPT
  );
});

test("plain-text fallback strips markup with a linear scan over hostile angle delimiters", () => {
  const unmatchedDelimiters = "<".repeat(20_000);
  assert.equal(
    toSafeRichMdictPlainText(unmatchedDelimiters, { styleSheetRules: [] }),
    unmatchedDelimiters
  );
});

function createTrackedSource(input) {
  const bytes = Buffer.from(input);
  const requests = [];
  return {
    size: bytes.byteLength,
    requests,
    async read(offset, length) {
      requests.push({ offset, length });
      return new Uint8Array(bytes.subarray(offset, offset + length));
    }
  };
}
