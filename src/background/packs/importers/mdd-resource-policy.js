import {
  MDICT_IMPORT_ERROR,
  mdictFail,
  requireMdictAtMost
} from "./mdict-contract.js";
import { readMddAvifDimensions } from "./mdd-avif-policy.js";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const IMAGE_PIXEL_LIMIT = 16_777_216;
const IMAGE_SIDE_LIMIT = 16_384;
const CSS_BYTE_LIMIT = 64 * 1024;
const UTF8 = new TextDecoder("utf-8", { fatal: true });

export function classifyMddResource(path, input, limits) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  requireMdictAtMost(bytes.byteLength, limits.resourceBytes, "MDD resource bytes");
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (extension === "css") return classifyCss(bytes);
  if (["png", "jpg", "jpeg", "gif", "webp", "avif"].includes(extension)) {
    return classifyImage(extension, bytes, limits);
  }
  if (["mp3", "ogg", "opus", "wav"].includes(extension)) {
    return classifyAudio(extension, bytes, limits);
  }
  mdictFail(MDICT_IMPORT_ERROR.UNSAFE_CONTENT, "MDD resource type is not allowed.", { path });
}

function classifyCss(bytes) {
  requireMdictAtMost(bytes.byteLength, CSS_BYTE_LIMIT, "MDD CSS bytes");
  let text;
  try {
    text = UTF8.decode(bytes);
  } catch (cause) {
    mdictFail(MDICT_IMPORT_ERROR.UNSAFE_CONTENT, "MDD CSS is not valid UTF-8.", { cause });
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)) {
    mdictFail(MDICT_IMPORT_ERROR.UNSAFE_CONTENT, "MDD CSS contains control characters.");
  }
  return { mime: "text/css", kind: "stylesheet" };
}

function classifyImage(extension, bytes, limits) {
  let result;
  if (extension === "png" && hasPngSignature(bytes)) result = pngDimensions(bytes);
  else if (["jpg", "jpeg"].includes(extension) && isJpeg(bytes)) result = jpegDimensions(bytes);
  else if (extension === "gif" && isGif(bytes)) result = gifDimensions(bytes);
  else if (extension === "webp" && isWebp(bytes)) result = webpDimensions(bytes);
  else if (extension === "avif") result = readMddAvifDimensions(bytes);
  if (!result) {
    mdictFail(MDICT_IMPORT_ERROR.UNSAFE_CONTENT, "MDD image format does not match its path or is malformed.");
  }
  checkDimensions(result.width, result.height);
  requireMdictAtMost(bytes.byteLength, limits.resourceBytes, "MDD image bytes");
  return { mime: result.mime, kind: "image", dimensions: { width: result.width, height: result.height } };
}

function hasPngSignature(bytes) {
  return bytes.length >= 8 && PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function pngDimensions(bytes) {
  if (bytes.length < 33 || readU32BE(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== "IHDR") return null;
  const width = readU32BE(bytes, 16);
  const height = readU32BE(bytes, 20);
  const depth = bytes[24];
  const colorType = bytes[25];
  const validDepths = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16]
  };
  if (
    !width ||
    !height ||
    !validDepths[colorType]?.includes(depth) ||
    bytes[26] !== 0 ||
    bytes[27] !== 0 ||
    bytes[28] > 1
  ) return null;
  let offset = 8;
  let sawHeader = false;
  let sawData = false;
  let sawEnd = false;
  let chunks = 0;
  while (offset + 12 <= bytes.length && chunks < 65_536) {
    const length = readU32BE(bytes, offset);
    const next = offset + 12 + length;
    if (next > bytes.length || next < offset) return null;
    const type = ascii(bytes, offset + 4, 4);
    if (chunks === 0 && type !== "IHDR") return null;
    if (type === "IHDR") {
      if (sawHeader || length !== 13) return null;
      sawHeader = true;
    } else if (["acTL", "fcTL", "fdAT"].includes(type)) {
      return null;
    } else if (type === "IDAT") {
      sawData ||= length > 0;
    } else if (type === "IEND") {
      if (length !== 0 || !sawData || next !== bytes.length) return null;
      sawEnd = true;
      break;
    }
    offset = next;
    chunks += 1;
  }
  return sawHeader && sawData && sawEnd ? { mime: "image/png", width, height } : null;
}

function isJpeg(bytes) {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function jpegDimensions(bytes) {
  let offset = 2;
  let dimensions = null;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9) return null;
    if (marker === 0xda) {
      if (offset + 2 > bytes.length) return null;
      const scanLength = readU16BE(bytes, offset);
      if (scanLength < 2 || offset + scanLength > bytes.length) return null;
      return dimensions && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
        ? dimensions
        : null;
    }
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) return null;
    const length = readU16BE(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7 || dimensions) return null;
      dimensions = { mime: "image/jpeg", height: readU16BE(bytes, offset + 3), width: readU16BE(bytes, offset + 5) };
    }
    offset += length;
  }
  return null;
}

function isGif(bytes) {
  return bytes.length >= 13 && ["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6));
}

function gifDimensions(bytes) {
  const width = readU16LE(bytes, 6);
  const height = readU16LE(bytes, 8);
  let offset = 13;
  const packed = bytes[10];
  if (packed & 0x80) offset += 3 * (1 << ((packed & 7) + 1));
  let frames = 0;
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) {
      if (offset !== bytes.length || frames !== 1) return null;
      return { mime: "image/gif", width, height };
    }
    if (marker === 0x21) {
      if (offset >= bytes.length) return null;
      offset += 1;
      offset = skipGifSubBlocks(bytes, offset);
    } else if (marker === 0x2c) {
      frames += 1;
      if (frames > 1 || offset + 9 > bytes.length) return null;
      const left = readU16LE(bytes, offset);
      const top = readU16LE(bytes, offset + 2);
      const frameWidth = readU16LE(bytes, offset + 4);
      const frameHeight = readU16LE(bytes, offset + 6);
      const localPacked = bytes[offset + 8];
      offset += 9;
      if (localPacked & 0x80) offset += 3 * (1 << ((localPacked & 7) + 1));
      if (offset >= bytes.length) return null;
      const lzwMinimumCodeSize = bytes[offset++];
      if (lzwMinimumCodeSize < 2 || lzwMinimumCodeSize > 8) return null;
      offset = skipGifSubBlocks(bytes, offset);
      if (
        !frameWidth ||
        !frameHeight ||
        left + frameWidth > width ||
        top + frameHeight > height
      ) return null;
    } else {
      return null;
    }
    if (offset < 0 || offset > bytes.length) return null;
  }
  return null;
}

function skipGifSubBlocks(bytes, offset) {
  let count = 0;
  while (offset < bytes.length && count++ < 65_536) {
    const size = bytes[offset++];
    if (size === 0) return offset;
    offset += size;
    if (offset > bytes.length) return -1;
  }
  return -1;
}

function isWebp(bytes) {
  return bytes.length >= 16 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
}

function webpDimensions(bytes) {
  if (readU32LE(bytes, 4) + 8 !== bytes.length) return null;
  let offset = 12;
  let dimensions = null;
  let extendedDimensions = null;
  let sawImageData = false;
  let chunks = 0;
  while (offset + 8 <= bytes.length && chunks++ < 65_536) {
    const type = ascii(bytes, offset, 4);
    const size = readU32LE(bytes, offset + 4);
    const data = offset + 8;
    const end = data + size;
    if (end > bytes.length) return null;
    if (type === "ANIM" || type === "ANMF") return null;
    if (type === "VP8X") {
      if (extendedDimensions || size < 10 || bytes[data] & 0x02) return null;
      extendedDimensions = {
        mime: "image/webp",
        width: 1 + readU24LE(bytes, data + 4),
        height: 1 + readU24LE(bytes, data + 7)
      };
    } else if (type === "VP8 ") {
      if (sawImageData || size < 10 || (bytes[data] & 1) !== 0 || bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) return null;
      const imageDimensions = {
        mime: "image/webp",
        width: readU16LE(bytes, data + 6) & 0x3fff,
        height: readU16LE(bytes, data + 8) & 0x3fff
      };
      if (extendedDimensions && !sameDimensions(extendedDimensions, imageDimensions)) return null;
      dimensions = extendedDimensions || imageDimensions;
      sawImageData = true;
    } else if (type === "VP8L") {
      if (sawImageData || size < 5 || bytes[data] !== 0x2f) return null;
      const imageDimensions = {
        mime: "image/webp",
        width: 1 + (((bytes[data + 2] & 0x3f) << 8) | bytes[data + 1]),
        height: 1 + (((bytes[data + 4] & 0x0f) << 10) | (bytes[data + 3] << 2) | ((bytes[data + 2] & 0xc0) >> 6))
      };
      if (extendedDimensions && !sameDimensions(extendedDimensions, imageDimensions)) return null;
      dimensions = extendedDimensions || imageDimensions;
      sawImageData = true;
    }
    offset = end + (size & 1);
  }
  return offset === bytes.length && sawImageData ? dimensions : null;
}

function sameDimensions(left, right) {
  return left.width === right.width && left.height === right.height;
}

function classifyAudio(extension, bytes, limits) {
  let mime = null;
  if (extension === "wav" && isWav(bytes)) mime = "audio/wav";
  if (extension === "mp3" && isMp3(bytes)) mime = "audio/mpeg";
  if (extension === "ogg" && isOgg(bytes)) mime = "audio/ogg";
  if (extension === "opus" && isOggOpus(bytes)) mime = "audio/ogg";
  if (!mime) mdictFail(MDICT_IMPORT_ERROR.UNSAFE_CONTENT, "MDD audio format does not match its path or is malformed.");
  requireMdictAtMost(bytes.byteLength, limits.resourceBytes, "MDD audio bytes");
  return { mime, kind: "audio" };
}

function isWav(bytes) {
  if (bytes.length < 44 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE" || readU32LE(bytes, 4) + 8 !== bytes.length) return false;
  let offset = 12;
  let hasFormat = false;
  let hasData = false;
  let chunks = 0;
  while (offset + 8 <= bytes.length && chunks++ < 65_536) {
    const type = ascii(bytes, offset, 4);
    const size = readU32LE(bytes, offset + 4);
    const data = offset + 8;
    const end = data + size;
    if (end > bytes.length) return false;
    if (type === "fmt ") {
      if (size < 16) return false;
      const format = readU16LE(bytes, data);
      const channels = readU16LE(bytes, data + 2);
      const sampleRate = readU32LE(bytes, data + 4);
      const blockAlign = readU16LE(bytes, data + 12);
      if (![1, 3, 0xfffe].includes(format) || !channels || !sampleRate || !blockAlign) return false;
      hasFormat = true;
    } else if (type === "data" && size > 0) {
      hasData = true;
    }
    offset = end + (size & 1);
  }
  return offset === bytes.length && hasFormat && hasData;
}

function isMp3(bytes) {
  let offset = 0;
  if (bytes.length >= 10 && ascii(bytes, 0, 3) === "ID3") {
    if (bytes[3] === 0xff || bytes[4] === 0xff) return false;
    const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
    offset = 10 + size + ((bytes[5] & 0x10) ? 10 : 0);
  }
  if (offset + 4 > bytes.length) return false;
  const second = bytes[offset + 1];
  const third = bytes[offset + 2];
  return bytes[offset] === 0xff && (second & 0xe0) === 0xe0 &&
    ((second >> 3) & 3) !== 1 && ((second >> 1) & 3) !== 0 &&
    (third >> 4) !== 15 && ((third >> 2) & 3) !== 3;
}

function isOgg(bytes) {
  if (bytes.length < 28 || ascii(bytes, 0, 4) !== "OggS" || bytes[4] !== 0) return false;
  const segmentCount = bytes[26];
  if (27 + segmentCount > bytes.length) return false;
  let payloadBytes = 0;
  for (let index = 0; index < segmentCount; index += 1) payloadBytes += bytes[27 + index];
  return payloadBytes > 0 && 27 + segmentCount + payloadBytes <= bytes.length;
}

function isOggOpus(bytes) {
  if (bytes.length < 47 || ascii(bytes, 0, 4) !== "OggS" || bytes[4] !== 0) return false;
  const flags = bytes[5];
  if ((flags & 0x02) === 0 || (flags & 0x01) !== 0 || (flags & 0xf8) !== 0) return false;
  const segmentCount = bytes[26];
  if (segmentCount !== 1 || 27 + segmentCount > bytes.length || bytes[27] !== 19) return false;
  const payloadOffset = 28;
  if (payloadOffset + 19 > bytes.length || ascii(bytes, payloadOffset, 8) !== "OpusHead") return false;
  return bytes[payloadOffset + 8] === 1 &&
    [1, 2].includes(bytes[payloadOffset + 9]) &&
    bytes[payloadOffset + 18] === 0;
}

function checkDimensions(width, height) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > IMAGE_SIDE_LIMIT ||
    height > IMAGE_SIDE_LIMIT ||
    width * height > IMAGE_PIXEL_LIMIT
  ) {
    mdictFail(MDICT_IMPORT_ERROR.LIMIT, "MDD image dimensions exceed the rendering safety limit.", { width, height });
  }
}

function ascii(bytes, offset, length) {
  let value = "";
  for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[offset + index] || 0);
  return value;
}

function readU16BE(bytes, offset) { return bytes[offset] * 256 + bytes[offset + 1]; }
function readU16LE(bytes, offset) { return bytes[offset] + bytes[offset + 1] * 256; }
function readU24LE(bytes, offset) { return bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65_536; }
function readU32BE(bytes, offset) { return (bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 256 + bytes[offset + 3]) >>> 0; }
function readU32LE(bytes, offset) { return (bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65_536 + bytes[offset + 3] * 0x1000000) >>> 0; }
