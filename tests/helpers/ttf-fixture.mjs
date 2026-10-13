// Original synthetic rectangle glyphs, assembled from the OpenType TrueType
// table layout. No source font or third-party glyph data is copied.
// Reference: https://learn.microsoft.com/en-us/typography/opentype/spec/otff
export function makeTinyTrueType({ advance = 300, weight = 400, italic = false } = {}) {
  const tables = new Map();
  const table = (tag, size) => { const bytes = Buffer.alloc(size); tables.set(tag, bytes); return bytes; };
  const head = table('head', 54);
  head.writeUInt32BE(0x10000, 0); head.writeUInt32BE(0x10000, 4); head.writeUInt32BE(0x5f0f3cf5, 12);
  head.writeUInt16BE(3, 16); head.writeUInt16BE(1000, 18); head.writeInt16BE(advance, 40); head.writeInt16BE(700, 42);
  head.writeUInt16BE((weight === 700 ? 1 : 0) | (italic ? 2 : 0), 44); head.writeUInt16BE(8, 46); head.writeInt16BE(2, 48);
  const hhea = table('hhea', 36); hhea.writeUInt32BE(0x10000, 0); hhea.writeInt16BE(800, 4); hhea.writeInt16BE(-200, 6);
  hhea.writeUInt16BE(advance, 10); hhea.writeInt16BE(advance, 16); hhea.writeInt16BE(1, 18); hhea.writeUInt16BE(2, 34);
  const maxp = table('maxp', 32); maxp.writeUInt32BE(0x10000, 0); maxp.writeUInt16BE(2, 4); maxp.writeUInt16BE(4, 6); maxp.writeUInt16BE(1, 8); maxp.writeUInt16BE(2, 14);
  const hmtx = table('hmtx', 8); hmtx.writeUInt16BE(advance, 0); hmtx.writeUInt16BE(advance, 4);
  const glyf = table('glyf', 36); glyf.writeInt16BE(1, 0); glyf.writeInt16BE(advance, 6); glyf.writeInt16BE(700, 8); glyf.writeUInt16BE(3, 10);
  glyf.fill(1, 14, 18);
  [0, advance, 0, -advance].forEach((value, index) => glyf.writeInt16BE(value, 18 + index * 2));
  [0, 0, 700, 0].forEach((value, index) => glyf.writeInt16BE(value, 26 + index * 2));
  const loca = table('loca', 6); loca.writeUInt16BE(18, 4);
  const cmap = table('cmap', 44); cmap.writeUInt16BE(1, 2); cmap.writeUInt16BE(3, 4); cmap.writeUInt16BE(1, 6); cmap.writeUInt32BE(12, 8);
  cmap.writeUInt16BE(4, 12); cmap.writeUInt16BE(32, 14); cmap.writeUInt16BE(4, 18); cmap.writeUInt16BE(4, 20); cmap.writeUInt16BE(1, 22);
  cmap.writeUInt16BE(65, 26); cmap.writeUInt16BE(0xffff, 28); cmap.writeUInt16BE(65, 32); cmap.writeUInt16BE(0xffff, 34); cmap.writeInt16BE(-64, 36); cmap.writeUInt16BE(1, 38);
  const os2 = table('OS/2', 78); os2.writeInt16BE(advance, 2); os2.writeUInt16BE(weight, 4); os2.writeUInt16BE(5, 6); os2.writeUInt32BE(1, 42);
  os2.write('TFIX', 58); os2.writeUInt16BE((italic ? 1 : 0) | (weight === 700 ? 32 : 64), 62); os2.writeUInt16BE(65, 64); os2.writeUInt16BE(65, 66);
  os2.writeInt16BE(800, 68); os2.writeInt16BE(-200, 70); os2.writeUInt16BE(800, 74); os2.writeUInt16BE(200, 76);
  const post = table('post', 32); post.writeUInt32BE(0x30000, 0); post.writeInt16BE(-75, 8); post.writeInt16BE(50, 10);
  const names = [[1, 'TranslateFlow Synthetic'], [2, 'Regular'], [3, `TF-${advance}`], [4, 'TranslateFlow Synthetic'], [5, 'Version 1.0'], [6, `TFSynthetic${advance}`]];
  const strings = names.map(([, value]) => Buffer.from(value.split('').flatMap((char) => [0, char.charCodeAt(0)])));
  const name = table('name', 6 + names.length * 12 + strings.reduce((sum, bytes) => sum + bytes.length, 0));
  name.writeUInt16BE(names.length, 2); name.writeUInt16BE(6 + names.length * 12, 4);
  let stringOffset = 0;
  names.forEach(([id], index) => { const at = 6 + index * 12; name.writeUInt16BE(3, at); name.writeUInt16BE(1, at + 2); name.writeUInt16BE(0x409, at + 4); name.writeUInt16BE(id, at + 6); name.writeUInt16BE(strings[index].length, at + 8); name.writeUInt16BE(stringOffset, at + 10); strings[index].copy(name, 6 + names.length * 12 + stringOffset); stringOffset += strings[index].length; });
  const entries = [...tables].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  let offset = 12 + entries.length * 16;
  const output = Buffer.alloc(offset + entries.reduce((sum, [, bytes]) => sum + Math.ceil(bytes.length / 4) * 4, 0));
  output.writeUInt32BE(0x10000, 0); output.writeUInt16BE(entries.length, 4);
  const power = 2 ** Math.floor(Math.log2(entries.length)); output.writeUInt16BE(power * 16, 6); output.writeUInt16BE(Math.log2(power), 8); output.writeUInt16BE(entries.length * 16 - power * 16, 10);
  let headOffset;
  entries.forEach(([tag, bytes], index) => { const at = 12 + index * 16; output.write(tag, at); output.writeUInt32BE(checksum(bytes), at + 4); output.writeUInt32BE(offset, at + 8); output.writeUInt32BE(bytes.length, at + 12); bytes.copy(output, offset); if (tag === 'head') headOffset = offset; offset += Math.ceil(bytes.length / 4) * 4; });
  output.writeUInt32BE((0xb1b0afba - checksum(output)) >>> 0, headOffset + 8);
  return output;
}
function checksum(bytes) { let total = 0; for (let at = 0; at < bytes.length; at += 4) { let word = 0; for (let index = 0; index < 4; index += 1) word = (word * 256 + (bytes[at + index] || 0)) >>> 0; total = (total + word) >>> 0; } return total; }
