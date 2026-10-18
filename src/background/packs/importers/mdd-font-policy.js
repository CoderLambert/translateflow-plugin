import { MDICT_IMPORT_ERROR, mdictFail } from "./mdict-contract.js";

// Bounded TrueType directory validation; the browser decoder checks table contents.
export function classifyMddTrueType(bytes) {
  const fail = () => mdictFail(MDICT_IMPORT_ERROR.UNSAFE_CONTENT, "MDD TrueType font is malformed or unsupported.");
  if (bytes.byteLength < 12) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x00010000) fail();
  const count = view.getUint16(4), directoryEnd = 12 + count * 16;
  if (!count || count > 64 || directoryEnd > bytes.byteLength) fail();
  const tables = new Map(), ranges = [];
  for (let index = 0; index < count; index += 1) {
    const at = 12 + index * 16;
    const tag = String.fromCharCode(...bytes.subarray(at, at + 4));
    const offset = view.getUint32(at + 8), length = view.getUint32(at + 12);
    if (!/^[\x20-\x7e]{4}$/u.test(tag) || tables.has(tag) || offset % 4 || offset < directoryEnd ||
        offset > bytes.byteLength || length > bytes.byteLength - offset) fail();
    tables.set(tag, { offset, length });
    if (length) ranges.push({ offset, end: offset + length });
  }
  ranges.sort((left, right) => left.offset - right.offset);
  if (ranges.some((range, index) => index && range.offset < ranges[index - 1].end)) fail();
  for (const [tag, minimum] of Object.entries({ head: 54, hhea: 36, maxp: 32, hmtx: 4, cmap: 4, loca: 4, glyf: 0, name: 6, post: 32 })) {
    if (!tables.has(tag) || tables.get(tag).length < minimum) fail();
  }
  const head = tables.get("head"), maxp = tables.get("maxp"), hhea = tables.get("hhea");
  const glyphs = view.getUint16(maxp.offset + 4), metrics = view.getUint16(hhea.offset + 34);
  const locaFormat = view.getInt16(head.offset + 50);
  if (view.getUint32(head.offset + 12) !== 0x5f0f3cf5 || view.getUint32(maxp.offset) !== 0x00010000 ||
      !glyphs || !metrics || metrics > glyphs || ![0, 1].includes(locaFormat) ||
      tables.get("loca").length < (glyphs + 1) * (locaFormat === 0 ? 2 : 4) ||
      tables.get("hmtx").length < metrics * 4 + (glyphs - metrics) * 2) fail();
  let previous = 0;
  for (let index = 0; index <= glyphs; index += 1) {
    const at = tables.get("loca").offset + index * (locaFormat === 0 ? 2 : 4);
    const offset = locaFormat === 0 ? view.getUint16(at) * 2 : view.getUint32(at);
    if (offset < previous || offset > tables.get("glyf").length) fail();
    previous = offset;
  }
  return { mime: "font/ttf", kind: "font" };
}
