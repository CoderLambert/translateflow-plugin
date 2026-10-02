import { readFile } from "node:fs/promises";
import { deflateSync, inflateSync } from "node:zlib";
import { adler32 } from "../../src/background/packs/importers/mdict-contract.js";

export function readBoundaryFixture(name = "writer-utf8.mdx") {
  return readFile(new URL(`../fixtures/mdx-boundaries/${name}`, import.meta.url));
}

// Header-only variants: the independent writer has no StripKey/case/format
// options. Keep its raw key/record sections byte-for-byte intact.
export function withMdxHeaderAttributes(input, attributes) {
  const bytes = Buffer.from(input);
  const oldLength = bytes.readUInt32BE(0);
  let text = bytes.subarray(4, oldLength + 4).toString("utf16le");
  for (const [name, value] of Object.entries(attributes)) {
    const pattern = new RegExp(`${name}="[^"]*"`, "u");
    text = pattern.test(text) ? text.replace(pattern, `${name}="${value}"`)
      : text.replace("<Dictionary ", `<Dictionary ${name}="${value}" `);
  }
  const header = Buffer.from(text, "utf16le");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32LE(adler32(header));
  return Buffer.concat([length, header, checksum, bytes.subarray(oldLength + 8)]);
}

// Re-checksum a descriptor mutation so tests reach boundary validation rather
// than failing earlier at compression/checksum. Only unencrypted fixtures.
export function withFirstBoundary(input, first, last) {
  const bytes = Buffer.from(input);
  const headerLength = bytes.readUInt32BE(0);
  const utf16 = bytes.subarray(4, headerLength + 4).toString("utf16le").includes('Encoding="UTF-16"');
  const unit = utf16 ? 2 : 1;
  const start = headerLength + 8;
  const preamble = Buffer.from(bytes.subarray(start, start + 40));
  const infoLength = Number(preamble.readBigUInt64BE(24));
  const infoStart = start + 44;
  const raw = inflateSync(bytes.subarray(infoStart + 8, infoStart + infoLength));
  let offset = 8;
  offset += 2 + (raw.readUInt16BE(offset) + 1) * unit;
  offset += 2 + (raw.readUInt16BE(offset) + 1) * unit;
  const sized = (value) => {
    const key = Buffer.from(value, utf16 ? "utf16le" : "utf8");
    const size = Buffer.alloc(2);
    size.writeUInt16BE(key.length / unit);
    return Buffer.concat([size, key, Buffer.alloc(unit)]);
  };
  const changed = Buffer.concat([raw.subarray(0, 8), sized(first), sized(last), raw.subarray(offset)]);
  const blockHeader = Buffer.alloc(8);
  blockHeader[0] = 2;
  blockHeader.writeUInt32BE(adler32(changed), 4);
  const info = Buffer.concat([blockHeader, deflateSync(changed)]);
  preamble.writeBigUInt64BE(BigInt(changed.length), 16);
  preamble.writeBigUInt64BE(BigInt(info.length), 24);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(adler32(preamble));
  return Buffer.concat([bytes.subarray(0, start), preamble, checksum, info,
    bytes.subarray(infoStart + infoLength)]);
}
