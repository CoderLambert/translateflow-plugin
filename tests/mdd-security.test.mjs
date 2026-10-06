import test from "node:test";
import assert from "node:assert/strict";
import { buildMddIndex, lookupMddResource, normalizeMddResourcePath, MDD_IMPORT_LIMITS } from "../src/background/packs/importers/mdd.js";
import { classifyMddResource } from "../src/background/packs/importers/mdd-resource-policy.js";
import { classifyMddSidecarPath } from "../src/background/packs/rich-mdd-contract.js";
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

test("bounded AVIF image items and Ogg Opus resources receive browser MIME types", async () => {
  const avif = makeAvif();
  const opus = makeOggOpus();
  assert.deepEqual(classifyMddResource("graphics/sample.avif", avif, MDD_IMPORT_LIMITS), {
    mime: "image/avif", kind: "image", dimensions: { width: 640, height: 480 }
  });
  assert.deepEqual(classifyMddResource("audio/sample.opus", opus, MDD_IMPORT_LIMITS), {
    mime: "audio/ogg", kind: "audio"
  });
  assert.deepEqual(classifyMddSidecarPath("graphics/sample.avif"), { kind: "image", mime: "image/avif" });
  assert.deepEqual(classifyMddSidecarPath("audio/sample.opus"), { kind: "audio", mime: "audio/ogg" });
  assert.throws(
    () => classifyMddResource("graphics/sample.png", avif, MDD_IMPORT_LIMITS),
    (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.UNSAFE_CONTENT
  );

  const source = trackedSource(makeMdd([
    ["\\graphics\\sample.avif", avif],
    ["\\kanji_alive_audio\\sample.opus", opus]
  ], { recordCompression: "none" }));
  const index = await buildMddIndex({ source });
  const image = await lookupMddResource({ source, index, path: "graphics/sample.avif" });
  const audio = await lookupMddResource({ source, index, path: "kanji_alive_audio/sample.opus" });
  assert.equal(image.mime, "image/avif");
  assert.deepEqual(image.dimensions, { width: 640, height: 480 });
  assert.equal(audio.mime, "audio/ogg");
});

test("AVIF parser rejects truncated, ambiguous, oversized encoded dimensions, sequence, and grid metadata", () => {
  const valid = makeAvif();
  const truncated = valid.slice(0, valid.length - 1);
  const duplicateSpatialExtents = makeAvif({ duplicateSpatialExtents: true });
  const oversized = makeAvif({ width: 16_385, height: 1 });
  const encodedBomb = makeAvif({ width: 32, height: 32, encodedWidth: 16_385, encodedHeight: 1 });
  const sequence = makeAvif({ compatibleBrands: ["avif", "mif1", "miaf", "avis"] });
  const grid = makeAvif({ itemType: "grid" });
  const unknownEssential = makeAvif({ unknownEssentialProperty: true });

  for (const bytes of [truncated, duplicateSpatialExtents]) {
    assert.throws(
      () => classifyMddResource("sample.avif", bytes, MDD_IMPORT_LIMITS),
      (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.UNSAFE_CONTENT
    );
  }
  for (const bytes of [oversized, encodedBomb]) {
    assert.throws(
      () => classifyMddResource("sample.avif", bytes, MDD_IMPORT_LIMITS),
      (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.LIMIT
    );
  }
  for (const bytes of [sequence, grid, unknownEssential]) {
    assert.throws(
      () => classifyMddResource("sample.avif", bytes, MDD_IMPORT_LIMITS),
      (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.UNSUPPORTED
    );
  }
});

test("Opus extension requires a complete first BOS page with a bounded mono or stereo OpusHead", () => {
  const valid = makeOggOpus();
  const missingBos = valid.slice();
  missingBos[5] = 0;
  const truncated = valid.slice(0, valid.length - 1);
  const badVersion = valid.slice();
  badVersion[36] = 2;
  const tooManyChannels = valid.slice();
  tooManyChannels[37] = 3;
  const mapped = valid.slice();
  mapped[46] = 1;

  for (const bytes of [missingBos, truncated, badVersion, tooManyChannels, mapped]) {
    assert.throws(
      () => classifyMddResource("audio/sample.opus", bytes, MDD_IMPORT_LIMITS),
      (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.UNSAFE_CONTENT
    );
  }
  const ordinaryOgg = makeOggPage(Uint8Array.of(1, 2, 3));
  assert.throws(
    () => classifyMddResource("audio/sample.opus", ordinaryOgg, MDD_IMPORT_LIMITS),
    (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.UNSAFE_CONTENT
  );
  assert.deepEqual(classifyMddResource("audio/sample.ogg", ordinaryOgg, MDD_IMPORT_LIMITS), { mime: "audio/ogg", kind: "audio" });
});


test("in-flight MDD resource lookup aborts the active range read", async () => {
  const { mdd } = await readMddInteropFixture();
  const index = await buildMddIndex({ source: trackedSource(mdd) });
  let startedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  const source = {
    size: mdd.byteLength,
    async read(_offset, _length, signal) {
      startedResolve();
      await new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
      return new Uint8Array();
    }
  };
  const controller = new AbortController();
  const lookup = lookupMddResource({
    source,
    index,
    path: "interop/sample.png",
    signal: controller.signal
  });
  await started;
  controller.abort();
  await assert.rejects(lookup, (error) => error?.name === "AbortError");
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

function makeAvif({ width = 640, height = 480, encodedWidth = width, encodedHeight = height, itemType = "av01",
  compatibleBrands = ["avif", "mif1", "miaf"], duplicateSpatialExtents = false, unknownEssentialProperty = false } = {}) {
  const ftyp = makeBox("ftyp", concatBytes(
    asciiBytes("avif"), be32(0), ...compatibleBrands.map(asciiBytes)
  ));
  const colr = makeBox("colr", concatBytes(asciiBytes("nclx"), Uint8Array.of(0, 1, 0, 13, 0, 6, 0x80)));
  const av1c = makeBox("av1C", Uint8Array.of(0x81, 0x04, 0x0c, 0));
  const ispe = makeBox("ispe", concatBytes(fullBox(0, new Uint8Array()), be32(width), be32(height)));
  const pixi = makeBox("pixi", concatBytes(fullBox(0, new Uint8Array()), Uint8Array.of(3, 8, 8, 8)));
  const properties = [colr, av1c, ispe, ...(duplicateSpatialExtents ? [ispe] : []), pixi];
  const associations = [1, 0x82, 3, ...(duplicateSpatialExtents ? [4, 5] : [4])];
  if (unknownEssentialProperty) {
    properties.push(makeBox("zzzz", Uint8Array.of(0)));
    associations.push(0x80 | properties.length);
  }
  const ipma = makeBox("ipma", concatBytes(
    fullBox(0, new Uint8Array()), be32(1), be16(1), Uint8Array.of(associations.length), Uint8Array.from(associations)
  ));
  const iprp = makeBox("iprp", concatBytes(
    makeBox("ipco", concatBytes(...properties)), ipma
  ));
  const hdlr = makeBox("hdlr", concatBytes(
    fullBox(0, new Uint8Array()), be32(0), asciiBytes("pict"), new Uint8Array(12), Uint8Array.of(0)
  ));
  const pitm = makeBox("pitm", concatBytes(fullBox(0, new Uint8Array()), be16(1)));
  const infe = makeBox("infe", concatBytes(
    fullBox(2, new Uint8Array()), be16(1), be16(0), asciiBytes(itemType), Uint8Array.of(0)
  ));
  const iinf = makeBox("iinf", concatBytes(fullBox(0, new Uint8Array()), be16(1), infe));
  const makeIloc = (baseOffset) => makeBox("iloc", concatBytes(
    fullBox(0, new Uint8Array()), Uint8Array.of(0x44, 0x40), be16(1), be16(1), be16(0),
    be32(baseOffset), be16(1), be32(0), be32(1)
  ));
  const imageData = makeAv1SequenceHeaderObu(encodedWidth, encodedHeight);
  const makeMeta = (baseOffset) => makeBox("meta", concatBytes(
    fullBox(0, new Uint8Array()), hdlr, pitm, makeIloc(baseOffset), iinf, iprp
  ));
  let meta = makeMeta(0);
  const mdatPayloadOffset = ftyp.length + meta.length + 8;
  meta = makeMeta(mdatPayloadOffset);
  return concatBytes(ftyp, meta, makeBox("mdat", imageData));
}

function makeAv1SequenceHeaderObu(width, height) {
  const widthBits = Math.max(1, Math.ceil(Math.log2(width)));
  const heightBits = Math.max(1, Math.ceil(Math.log2(height)));
  const bits = [];
  appendBits(bits, 0, 3);
  appendBits(bits, 1, 1);
  appendBits(bits, 1, 1);
  appendBits(bits, 0, 5);
  appendBits(bits, widthBits - 1, 4);
  appendBits(bits, heightBits - 1, 4);
  appendBits(bits, width - 1, widthBits);
  appendBits(bits, height - 1, heightBits);
  while (bits.length % 8) bits.push(0);
  const payload = new Uint8Array(bits.length / 8);
  for (let index = 0; index < bits.length; index += 1) {
    payload[Math.floor(index / 8)] |= bits[index] << (7 - (index % 8));
  }
  return concatBytes(Uint8Array.of(0x0a, payload.length), payload);
}

function appendBits(target, value, count) {
  for (let index = count - 1; index >= 0; index -= 1) {
    target.push(Math.floor(value / (2 ** index)) & 1);
  }
}

function makeOggOpus() {
  const opusHead = new Uint8Array(19);
  opusHead.set(asciiBytes("OpusHead"));
  opusHead[8] = 1;
  opusHead[9] = 1;
  opusHead[10] = 0;
  opusHead[11] = 0;
  opusHead[12] = 0x80;
  opusHead[13] = 0xbb;
  return makeOggPage(opusHead);
}

function makeOggPage(payload) {
  const page = new Uint8Array(28 + payload.length);
  page.set(asciiBytes("OggS"));
  page[4] = 0;
  page[5] = 0x02;
  page[26] = 1;
  page[27] = payload.length;
  page.set(payload, 28);
  return page;
}

function makeBox(type, payload) {
  return concatBytes(be32(8 + payload.length), asciiBytes(type), payload);
}

function fullBox(version, payload) {
  return concatBytes(Uint8Array.of(version, 0, 0, 0), payload);
}

function asciiBytes(value) {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function be16(value) {
  return Uint8Array.of((value >>> 8) & 0xff, value & 0xff);
}

function be32(value) {
  return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function concatBytes(...items) {
  const length = items.reduce((total, item) => total + item.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const item of items) {
    result.set(item, offset);
    offset += item.length;
  }
  return result;
}
