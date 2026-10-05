import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildRichMdictIndex, lookupRichMdict } from "../src/background/packs/importers/mdict-rich.js";
import { decodeRichKeyBlock, lookupSortKey } from "../src/background/packs/importers/mdict-rich-index.js";
import { preflightLocalDictionaryFiles } from "../src/background/packs/local-dictionary-preflight.js";
import { makeRichMdx } from "./helpers/rich-mdict-fixture.mjs";
import { readBoundaryFixture, withFirstBoundary } from "./helpers/mdx-boundary-fixture.mjs";

const lock = JSON.parse(await readFile(new URL("./fixtures/mdx-boundaries/corpus-lock.json", import.meta.url), "utf8"));

function source(bytes) {
  return {
    size: bytes.byteLength,
    read: async (offset, length) => new Uint8Array(bytes.subarray(offset, offset + length))
  };
}

function asFile(bytes, name = "synthetic.mdx") {
  return new File([bytes], name, { type: "application/octet-stream" });
}

test("pinned independent writer fixture bytes retain their source identity", async () => {
  for (const fixture of lock.files) {
    const bytes = await readBoundaryFixture(fixture.file);
    assert.equal(bytes.byteLength, fixture.bytes, fixture.file);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), fixture.sha256, fixture.file);
  }
  const generator = await readFile(new URL("../scripts/generate-mdx-boundary-fixtures.py", import.meta.url));
  assert.equal(createHash("sha256").update(generator).digest("hex"), lock.generatorSha256);
});

for (const fixture of lock.files) {
  test(`independent raw key boundaries pass preflight, index construction and lookup: ${fixture.file}`, async () => {
    const bytes = await readBoundaryFixture(fixture.file);
    const index = await buildRichMdictIndex({ source: source(bytes) });

    assert.equal(index.entryCount, fixture.entries.length);
    assert.equal(index.header.encoding, fixture.encoding === "utf16" ? "UTF-16" : "UTF-8");
    assert.equal(index.header.encrypted, fixture.encrypted ? 2 : 0);
    if (fixture.entries.length > 1) assert.ok(index.keyBlocks.length > 1);
    for (const [blockIndex, block] of index.keyBlocks.entries()) {
      const decoded = await decodeRichKeyBlock({ source: source(bytes), index, blockIndex });
      assert.equal(block.firstKey, decoded[0].displayForm);
      assert.equal(block.lastKey, decoded.at(-1).displayForm);
      for (const entry of decoded) {
        const key = lookupSortKey(entry.displayForm, index.header);
        assert.ok(block.lookupMinKey <= key && key <= block.lookupMaxKey);
      }
    }

    for (const key of fixture.entries) {
      const result = await lookupRichMdict({ source: source(bytes), index, text: key });
      assert.equal(result.found, true, key);
      assert.equal(result.displayForm, key);
      assert.match(result.rawRecord, /sentinel/u);
    }

    const report = await preflightLocalDictionaryFiles({ files: [asFile(bytes, fixture.file)] });
    assert.equal(report.compatibility.status, "supported");
    assert.equal(report.route.importer, "rich-mdict");
  });
}

test("legacy normalized endpoint pairs remain readable and keep lookup bounds normalized", async () => {
  const bytes = makeRichMdx([
    ["C-o", "<p>first boundary sentinel</p>"],
    ["Ｆoo", "<p>last boundary sentinel</p>"]
  ]);
  const index = await buildRichMdictIndex({ source: source(bytes) });

  assert.equal(index.keyBlocks[0].firstKey, "co");
  assert.equal(index.keyBlocks[0].lastKey, "foo");
  assert.equal(index.keyBlocks[0].lookupMinKey, "co");
  assert.equal(index.keyBlocks[0].lookupMaxKey, "foo");
  for (const key of ["C-o", "Ｆoo"]) {
    assert.equal((await lookupRichMdict({ source: source(bytes), index, text: key })).found, true);
  }
});

test("raw and normalized boundary representations must match as one complete pair", async () => {
  const original = await readBoundaryFixture("single-c.mdx");
  for (const [first, last] of [["C", "C"], ["c", "c"]]) {
    const bytes = withFirstBoundary(original, first, last);
    const index = await buildRichMdictIndex({ source: source(bytes) });
    assert.equal((await lookupRichMdict({ source: source(bytes), index, text: "C" })).found, true);
  }

  for (const [first, last] of [["C", "c"], ["c", "C"], ["Ｃ", "Ｃ"], ["wrong", "c"]]) {
    const bytes = withFirstBoundary(original, first, last);
    await assert.rejects(buildRichMdictIndex({ source: source(bytes) }), (error) =>
      error.code === "MDICT_CORRUPT" && error.check === "key-block-boundary");
    const report = await preflightLocalDictionaryFiles({ files: [asFile(bytes)] });
    assert.equal(report.compatibility.status, "invalid");
    assert.equal(report.route.importer, "none");
    assert.doesNotMatch(JSON.stringify(report), /expectedFirst|actualFirst|wrong|PRIVATE/u);
  }
});
