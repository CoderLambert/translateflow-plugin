import { mdictBytes } from "./mdict-contract.js";

const R = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
  3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12,
  1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2
];
const RR = [
  5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12,
  6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2,
  15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13,
  8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14
];
const S = [
  11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8,
  7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
  11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5,
  11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12
];
const SS = [
  8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6,
  9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
  9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5,
  15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8
];
const KL = [0, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc];
const KR = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0];

export function ripemd128(input) {
  const bytes = mdictBytes(input, "RIPEMD-128 input");
  const paddedLength = Math.ceil((bytes.byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.byteLength] = 0x80;
  new DataView(padded.buffer).setBigUint64(
    paddedLength - 8,
    BigInt(bytes.byteLength) * 8n,
    true
  );

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  const words = new Uint32Array(16);

  for (let offset = 0; offset < padded.byteLength; offset += 64) {
    const view = new DataView(
      padded.buffer,
      padded.byteOffset + offset,
      64
    );
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(index * 4, true);
    }

    let al = h0;
    let bl = h1;
    let cl = h2;
    let dl = h3;
    let ar = h0;
    let br = h1;
    let cr = h2;
    let dr = h3;
    for (let index = 0; index < 64; index += 1) {
      const round = index >>> 4;
      const left = rotateLeft(
        (al + functionLeft(round, bl, cl, dl) + words[R[index]] + KL[round]) >>> 0,
        S[index]
      );
      al = dl;
      dl = cl;
      cl = bl;
      bl = left;

      const rightRound = 3 - round;
      const right = rotateLeft(
        (ar + functionLeft(rightRound, br, cr, dr) + words[RR[index]] + KR[round]) >>> 0,
        SS[index]
      );
      ar = dr;
      dr = cr;
      cr = br;
      br = right;
    }

    const temp = (h1 + cl + dr) >>> 0;
    h1 = (h2 + dl + ar) >>> 0;
    h2 = (h3 + al + br) >>> 0;
    h3 = (h0 + bl + cr) >>> 0;
    h0 = temp;
  }

  const digest = new Uint8Array(16);
  const output = new DataView(digest.buffer);
  output.setUint32(0, h0, true);
  output.setUint32(4, h1, true);
  output.setUint32(8, h2, true);
  output.setUint32(12, h3, true);
  return digest;
}

function functionLeft(round, x, y, z) {
  if (round === 0) return x ^ y ^ z;
  if (round === 1) return (x & y) | (~x & z);
  if (round === 2) return (x | ~y) ^ z;
  return (x & z) | (y & ~z);
}

function rotateLeft(value, bits) {
  return (value << bits) | (value >>> (32 - bits));
}
