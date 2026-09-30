import test from "node:test";
import assert from "node:assert/strict";
import { buildMddIndex, lookupMddResource, normalizeMddResourcePath } from "../src/background/packs/importers/mdd.js";
import { MDICT_IMPORT_ERROR, MDictImportError } from "../src/background/packs/importers/mdict-contract.js";
import { makeMdd, readMddInteropFixture } from "./helpers/mdd-fixture.mjs";

test("MDD paths preserve case and canonicalize one virtual-root separator", () => {
  assert.equal(normalizeMddResourcePath("\\interop\\sample.png"), "interop/sample.png");
  assert.equal(normalizeMddResourcePath("/Names/Ä.png"), "Names/Ä.png");
  assert.equal(normalizeMddResourcePath("folder%20name/item.png"), "folder name/item.png");

  for (const path of [
    "../secret.png",
    "folder/../secret.png",
    "./sample.png",
    "folder/./sample.png",
    "//server/share.png",
    "\\\\server\\share.png",
    "C:\\secret.png",
    "\\C:\\secret.png",
    "file:///interop/sample.png",
    "https://example.test/a.png",
    "folder//sample.png",
    "folder/",
    "%2e%2e/secret.png",
    "%252e%252e/secret.png",
    "folder%2fsecret.png",
    "folder%5csecret.png",
    "%3a/etc/passwd",
    "bad%2f%00name.png",
    "broken%encoding.png",
    "bad\u0000path.png"
  ]) {
    assert.throws(
      () => normalizeMddResourcePath(path),
      (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.UNSAFE_CONTENT,
      path
    );
  }
});

test("unsafe and duplicate canonical keys are rejected during bounded indexing", async () => {
  const pixel = Uint8Array.from([1, 2, 3]);
  for (const entries of [
    [["\\..\\escape.png", pixel]],
    [["/interop/same.png", pixel], ["\\interop\\same.png", pixel]]
  ]) {
    await assert.rejects(
      buildMddIndex({ source: trackedSource(makeMdd(entries, { recordCompression: "none" })) }),
      (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.UNSAFE_CONTENT
    );
  }
});

test("out-of-stream, decreasing, oversized, and corrupt binary ranges fail closed", async () => {
  const { mdd } = await readMddInteropFixture();
  const index = await buildMddIndex({ source: trackedSource(mdd) });
  const png = await lookupMddResource({ source: trackedSource(mdd), index, path: "interop/sample.png" });
  const entries = [["\\interop\\one.png", png.bytes], ["\\interop\\two.png", png.bytes]];

  for (const recordOffsets of [[1, 0], [999_999, 999_999]]) {
    await assert.rejects(
      buildMddIndex({ source: trackedSource(makeMdd(entries, { recordOffsets })) }),
      (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.CORRUPT
    );
  }

  const oversized = Buffer.from(makeMdd([["\\interop\\one.png", png.bytes]], { recordCompression: "none" }));
  const cleanIndex = await buildMddIndex({ source: trackedSource(oversized) });
  oversized.writeBigUInt64BE(BigInt(4 * 1024 * 1024 + 1), cleanIndex.recordBlocksOffset - 8);
  await assert.rejects(
    buildMddIndex({ source: trackedSource(oversized) }),
    (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.LIMIT
  );

  const corrupt = Buffer.from(mdd);
  corrupt[index.recordBlocks[0].dataOffset + 8] ^= 0xff;
  await assert.rejects(
    lookupMddResource({ source: trackedSource(corrupt), index, path: "interop/fixture.css" }),
    (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.CORRUPT
  );
});

test("SVG, HTML, unknown payloads, malformed images, and image bombs stay unavailable", async () => {
  for (const [path, payload] of [
    ["\\interop\\active.svg", new TextEncoder().encode("<svg onload='alert(1)'></svg>")],
    ["\\interop\\active.html", new TextEncoder().encode("<script>alert(1)</script>")],
    ["\\interop\\unknown.bin", Uint8Array.from([1, 2, 3, 4])],
    ["\\interop\\bad.png", Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])]
  ]) {
    const source = trackedSource(makeMdd([[path, payload]], { recordCompression: "none" }));
    const index = await buildMddIndex({ source });
    await assert.rejects(
      lookupMddResource({ source, index, path }),
      (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.UNSAFE_CONTENT
    );
  }

  const { mdd } = await readMddInteropFixture();
  const fixtureIndex = await buildMddIndex({ source: trackedSource(mdd) });
  const png = await lookupMddResource({ source: trackedSource(mdd), index: fixtureIndex, path: "interop/sample.png" });
  const bomb = Buffer.from(png.bytes);
  bomb.writeUInt32BE(20_000, 16);
  const source = trackedSource(makeMdd([["\\interop\\large.png", bomb]], { recordCompression: "none" }));
  const index = await buildMddIndex({ source });
  await assert.rejects(
    lookupMddResource({ source, index, path: "interop/large.png" }),
    (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.LIMIT
  );
});

function trackedSource(input) {
  const bytes = Buffer.from(input);
  return {
    size: bytes.byteLength,
    async read(offset, length) {
      return new Uint8Array(bytes.subarray(offset, offset + length));
    }
  };
}
