import test from "node:test";
import assert from "node:assert/strict";
import { buildRichMdictIndex } from "../src/background/packs/importers/mdict-rich-index.js";
import { lookupRichMdict } from "../src/background/packs/importers/mdict-rich-lookup.js";
import { makeRichMdx } from "./helpers/rich-mdict-fixture.mjs";

test("encrypted v2 key info indexes bounded ranges and returns safe plain text", async () => {
  const bytes = makeRichMdx([
    ["alpha", "<p>Alpha entry</p>"],
    ["run", "<div><b>n.</b> 跑, 赛跑<br>第二行<script>alert(1)</script><img src=\"https://attacker.invalid/x\" onerror=\"alert(2)\">&nbsp;"],
    ["state", "<p>State entry</p>"]
  ], {
    encrypted: 2,
    compact: "Yes",
    compat: "Yes",
    styleSheet: "1\n<b>\n</b>\n2\n<i>\n</i>"
  });
  const source = trackedSource(bytes);
  const index = await buildRichMdictIndex({ source });

  assert.equal(index.header.encrypted, 2);
  assert.equal(index.header.compact, "Yes");
  assert.equal(index.header.compat, "Yes");
  assert.equal(index.header.styleSheetRules.length, 2);
  assert.equal(index.entryCount, 3);
  assert.ok(source.requests.length > 0);
  assert.ok(source.requests.every(({ offset, length }) =>
    offset >= 0 && length >= 0 && offset + length <= bytes.byteLength
  ));
  assert.ok(source.requests.every(({ length }) => length < bytes.byteLength),
    "index construction must use byte ranges instead of reading the whole source");

  const result = await lookupRichMdict({ source, index, text: "RUN" });
  assert.equal(result.found, true);
  assert.equal(result.displayForm, "run");
  assert.match(result.rawRecord, /<script>alert\(1\)<\/script>/u);
  assert.match(result.safeTextFallback, /跑, 赛跑/u);
  assert.match(result.safeTextFallback, /第二行/u);
  assert.doesNotMatch(result.safeTextFallback, /alert|attacker\.invalid|onerror/u);
});

test("malformed preamble offsets and corrupt record blocks fail closed", async () => {
  const goodBytes = makeRichMdx([
    ["alpha", "<p>Alpha entry</p>"],
    ["run", "<p>Run entry</p>"]
  ], { encrypted: 2 });
  const goodIndex = await buildRichMdictIndex({ source: trackedSource(goodBytes) });

  const badPreamble = Buffer.from(goodBytes);
  const headerBytes = badPreamble.readUInt32BE(0);
  badPreamble[headerBytes + 8 + 40] ^= 0xff;
  await assert.rejects(
    buildRichMdictIndex({ source: trackedSource(badPreamble) }),
    (error) => error?.code === "MDICT_CORRUPT"
  );

  const corruptRecord = Buffer.from(goodBytes);
  corruptRecord[goodIndex.recordBlocks[0].dataOffset + 8] ^= 0xff;
  await assert.rejects(
    lookupRichMdict({
      source: trackedSource(corruptRecord),
      index: goodIndex,
      text: "run"
    }),
    (error) => error?.code === "MDICT_CORRUPT"
  );
});

test("alias loops are detected and never produce a partial record", async () => {
  const bytes = makeRichMdx([
    ["alpha", "@@@LINK=beta"],
    ["beta", "@@@LINK=alpha"]
  ], { encrypted: 2 });
  const source = trackedSource(bytes);
  const index = await buildRichMdictIndex({ source });
  await assert.rejects(
    lookupRichMdict({ source, index, text: "alpha" }),
    (error) => error?.code === "MDICT_CORRUPT" && /alias loop/iu.test(error.message)
  );
});

function trackedSource(input) {
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
