import { MDICT_IMPORT_ERROR, mdictFail } from "./mdict-contract.js";

export function readMddAvifDimensions(bytes) {
  const topLevel = readAvifBoxes(bytes, 0, bytes.length, 16);
  if (!topLevel || topLevel[0]?.type !== "ftyp" || topLevel.filter((box) => box.type === "ftyp").length !== 1) return null;
  if (topLevel.some((box) => ["moov", "moof", "avis"].includes(box.type))) {
    unsupportedAvif("AVIF sequences and movie tracks are not supported.");
  }
  if (topLevel.some((box) => !["ftyp", "meta", "mdat", "free", "skip"].includes(box.type))) {
    unsupportedAvif("AVIF contains a top-level box outside the supported image profile.");
  }

  const brands = parseAvifFileType(topLevel[0]);
  if (!brands) return null;
  if (brands.compatible.has("avis")) unsupportedAvif("AVIF image sequences are not supported.");
  if (brands.major !== "avif" || !brands.compatible.has("avif") || !brands.compatible.has("mif1") || !brands.compatible.has("miaf")) {
    unsupportedAvif("AVIF brands are outside the supported static image profile.");
  }

  const metas = topLevel.filter((box) => box.type === "meta");
  const mdats = topLevel.filter((box) => box.type === "mdat");
  if (metas.length !== 1 || mdats.length !== 1) return null;
  const meta = metas[0];
  if (meta.end - meta.payloadStart < 4 || readAvifU32(bytes, meta.payloadStart) !== 0) return null;
  const metaBoxes = readAvifBoxes(bytes, meta.payloadStart + 4, meta.end, 16);
  if (!metaBoxes) return null;
  const requiredMetaTypes = ["hdlr", "pitm", "iloc", "iinf", "iprp"];
  if (metaBoxes.some((box) => !requiredMetaTypes.includes(box.type))) {
    unsupportedAvif("AVIF metadata contains an unsupported item or reference box.");
  }
  const hdlr = uniqueAvifBox(metaBoxes, "hdlr");
  const pitm = uniqueAvifBox(metaBoxes, "pitm");
  const iloc = uniqueAvifBox(metaBoxes, "iloc");
  const iinf = uniqueAvifBox(metaBoxes, "iinf");
  const iprp = uniqueAvifBox(metaBoxes, "iprp");
  if (!hdlr || !pitm || !iloc || !iinf || !iprp || metaBoxes.length !== requiredMetaTypes.length) return null;

  const handler = parseAvifHandler(bytes, hdlr);
  const primaryItemId = parseAvifPrimaryItem(bytes, pitm);
  const item = parseAvifItemInfo(bytes, iinf);
  if (handler !== "pict" || !primaryItemId || !item) return null;
  if (item.protectionIndex !== 0) unsupportedAvif("Protected AVIF items are not supported.");
  if (item.type !== "av01") unsupportedAvif(item.type === "grid"
    ? "AVIF grid-derived images are not supported."
    : "The AVIF primary item is not a single AV1 image.");
  if (primaryItemId !== item.id) return null;

  const itemLocation = parseAvifItemLocation(bytes, iloc, primaryItemId);
  if (!itemLocation) return null;
  const imageData = mdats[0];
  const itemEnd = itemLocation.offset + itemLocation.length;
  if (!Number.isSafeInteger(itemEnd) || itemLocation.offset < imageData.payloadStart || itemEnd > imageData.end) return null;

  const properties = parseAvifItemProperties(bytes, iprp, primaryItemId);
  if (!properties) return null;
  for (const property of properties.unknownRequired) {
    unsupportedAvif(`AVIF requires unsupported item property ${safeAvifPropertyType(property)}.`);
  }
  for (const type of ["av1C", "colr", "ispe", "pixi"]) {
    if (!properties.supported.has(type)) return null;
  }
  const dimensions = parseAvifSpatialExtents(bytes, properties.supported.get("ispe"));
  if (!dimensions) return null;
  const encodedDimensions = parseAv1SequenceMaxDimensions(bytes, itemLocation.offset, itemEnd);
  if (!encodedDimensions) return null;
  return {
    mime: "image/avif",
    width: dimensions.width,
    height: dimensions.height,
    encodedDimensions
  };
}

function parseAvifFileType(box) {
  const size = box.end - box.payloadStart;
  if (size < 8 || (size - 8) % 4 !== 0) return null;
  return parseAvifBrands(box);
}

function parseAvifBrands(box) {
  const bytes = box.bytes;
  if (!(bytes instanceof Uint8Array)) return null;
  const major = ascii(bytes, box.payloadStart, 4);
  const compatible = new Set([major]);
  for (let offset = box.payloadStart + 8; offset < box.end; offset += 4) {
    compatible.add(ascii(bytes, offset, 4));
  }
  return { major, compatible };
}

function parseAvifHandler(bytes, box) {
  const payload = box.payloadStart;
  if (box.end - payload < 25 || !isAvifFullBox(bytes, box, [0])) return "";
  if (readAvifU32(bytes, payload + 4) !== 0) return "";
  if (bytes.subarray(payload + 12, payload + 24).some((value) => value !== 0)) return "";
  if (bytes[box.end - 1] !== 0) return "";
  return ascii(bytes, payload + 8, 4);
}

function parseAvifPrimaryItem(bytes, box) {
  const version = avifFullBoxVersion(bytes, box, [0, 1]);
  if (version === null) return 0;
  const dataOffset = box.payloadStart + 4;
  const width = version === 0 ? 2 : 4;
  if (box.end - dataOffset !== width) return 0;
  return readAvifUnsigned(bytes, dataOffset, width);
}

function parseAvifItemInfo(bytes, box) {
  const version = avifFullBoxVersion(bytes, box, [0, 1]);
  if (version === null) return null;
  let cursor = box.payloadStart + 4;
  const countBytes = version === 0 ? 2 : 4;
  if (cursor + countBytes > box.end) return null;
  const count = readAvifUnsigned(bytes, cursor, countBytes);
  cursor += countBytes;
  if (count !== 1) unsupportedAvif("AVIF files with multiple item records are outside the supported profile.");
  const entries = readAvifBoxes(bytes, cursor, box.end, 4);
  if (!entries || entries.length !== 1 || entries[0].type !== "infe") return null;
  const info = entries[0];
  const infoVersion = avifFullBoxVersion(bytes, info, [2, 3]);
  if (infoVersion === null) return null;
  cursor = info.payloadStart + 4;
  const idBytes = infoVersion === 2 ? 2 : 4;
  if (cursor + idBytes + 6 > info.end) return null;
  const id = readAvifUnsigned(bytes, cursor, idBytes);
  cursor += idBytes;
  const protectionIndex = readAvifU16(bytes, cursor);
  const type = ascii(bytes, cursor + 2, 4);
  const nameOffset = cursor + 6;
  if (!id || nameOffset >= info.end || bytes[info.end - 1] !== 0 ||
      bytes.subarray(nameOffset, info.end - 1).includes(0)) return null;
  return { id, protectionIndex, type };
}

function parseAvifItemLocation(bytes, box, primaryItemId) {
  const version = avifFullBoxVersion(bytes, box, [0, 1, 2]);
  if (version === null) return null;
  let cursor = box.payloadStart + 4;
  if (cursor + 2 > box.end) return null;
  const offsetLengthSizes = bytes[cursor++];
  const offsetSize = offsetLengthSizes >> 4;
  const lengthSize = offsetLengthSizes & 0x0f;
  const baseIndexSizes = bytes[cursor++];
  const baseOffsetSize = baseIndexSizes >> 4;
  const extentIndexSize = version === 0 ? 0 : baseIndexSizes & 0x0f;
  if (version === 0 && (baseIndexSizes & 0x0f) !== 0) return null;
  if (![0, 1, 2, 4, 8].includes(offsetSize) || ![0, 1, 2, 4, 8].includes(lengthSize) ||
      ![0, 1, 2, 4, 8].includes(baseOffsetSize) || ![0, 1, 2, 4, 8].includes(extentIndexSize)) return null;
  if (cursor + (version === 2 ? 4 : 2) > box.end) return null;
  const count = readAvifUnsigned(bytes, cursor, version === 2 ? 4 : 2);
  cursor += version === 2 ? 4 : 2;
  if (count !== 1) unsupportedAvif("AVIF files with multiple item locations are outside the supported profile.");
  const idSize = version === 2 ? 4 : 2;
  if (cursor + idSize > box.end) return null;
  const id = readAvifUnsigned(bytes, cursor, idSize);
  cursor += idSize;
  let constructionMethod = 0;
  if (version !== 0) {
    if (cursor + 2 > box.end) return null;
    const method = readAvifU16(bytes, cursor);
    if (method & 0xf000) return null;
    constructionMethod = method & 0x0fff;
    cursor += 2;
  }
  if (cursor + 2 > box.end) return null;
  const dataReferenceIndex = readAvifU16(bytes, cursor);
  cursor += 2;
  const baseOffset = readAvifUnsigned(bytes, cursor, baseOffsetSize);
  if (baseOffset === null) return null;
  cursor += baseOffsetSize;
  if (cursor + 2 > box.end) return null;
  const extentCount = readAvifU16(bytes, cursor);
  cursor += 2;
  if (id !== primaryItemId) return null;
  if (constructionMethod !== 0) unsupportedAvif("AVIF item locations that reference metadata data are not supported.");
  if (dataReferenceIndex !== 0) unsupportedAvif("AVIF items with external data references are not supported.");
  if (extentCount !== 1) unsupportedAvif("AVIF items with multiple data extents are not supported.");
  let extentIndex = 0;
  if (extentIndexSize) {
    extentIndex = readAvifUnsigned(bytes, cursor, extentIndexSize);
    if (extentIndex === null) return null;
    cursor += extentIndexSize;
  }
  const extentOffset = readAvifUnsigned(bytes, cursor, offsetSize);
  if (extentOffset === null) return null;
  cursor += offsetSize;
  const extentLength = readAvifUnsigned(bytes, cursor, lengthSize);
  if (extentLength === null) return null;
  cursor += lengthSize;
  if (cursor !== box.end || extentIndex !== 0 || extentLength <= 0) return null;
  const offset = baseOffset + extentOffset;
  return Number.isSafeInteger(offset) ? { offset, length: extentLength } : null;
}

function parseAvifItemProperties(bytes, box, primaryItemId) {
  const children = readAvifBoxes(bytes, box.payloadStart, box.end, 4);
  if (!children || children.length !== 2 || children.filter((item) => item.type === "ipco").length !== 1 ||
      children.filter((item) => item.type === "ipma").length !== 1) return null;
  const propertyBoxes = readAvifBoxes(bytes, children.find((item) => item.type === "ipco").payloadStart,
    children.find((item) => item.type === "ipco").end, 64);
  if (!propertyBoxes || !propertyBoxes.length) return null;
  const associations = parseAvifPropertyAssociations(bytes, children.find((item) => item.type === "ipma"), primaryItemId, propertyBoxes.length);
  if (!associations) return null;
  const supported = new Map();
  const unknownRequired = [];
  for (const association of associations) {
    const property = propertyBoxes[association.index - 1];
    if (["av1C", "colr", "ispe", "pixi"].includes(property.type)) {
      if (supported.has(property.type)) return null;
      supported.set(property.type, property);
    } else if (association.essential) {
      unknownRequired.push(property.type);
    }
  }
  if (!supported.has("av1C") || !supported.has("colr") || !supported.has("ispe") || !supported.has("pixi")) return null;
  if (!isValidAv1Configuration(bytes, supported.get("av1C")) ||
      !isValidAvifColorProperty(bytes, supported.get("colr")) ||
      !isValidAvifPixelInformation(bytes, supported.get("pixi"))) return null;
  return { supported, unknownRequired };
}

function parseAvifPropertyAssociations(bytes, box, primaryItemId, propertyCount) {
  const version = avifFullBoxVersion(bytes, box, [0, 1]);
  if (version === null) return null;
  const flags = bytes[box.payloadStart + 1] * 0x10000 + bytes[box.payloadStart + 2] * 0x100 + bytes[box.payloadStart + 3];
  if (flags & ~1) return null;
  let cursor = box.payloadStart + 4;
  if (cursor + 4 > box.end) return null;
  const entryCount = readAvifU32(bytes, cursor);
  cursor += 4;
  if (entryCount !== 1) return null;
  const idSize = version === 0 ? 2 : 4;
  if (cursor + idSize + 1 > box.end) return null;
  const itemId = readAvifUnsigned(bytes, cursor, idSize);
  cursor += idSize;
  const associationCount = bytes[cursor++];
  if (itemId !== primaryItemId || !associationCount || associationCount > propertyCount) return null;
  const associations = [];
  const seen = new Set();
  for (let index = 0; index < associationCount; index += 1) {
    const wide = (flags & 1) !== 0;
    const raw = wide ? (cursor + 2 <= box.end ? readAvifU16(bytes, cursor) : null) : (cursor < box.end ? bytes[cursor] : null);
    if (raw === null) return null;
    cursor += wide ? 2 : 1;
    const essential = wide ? (raw & 0x8000) !== 0 : (raw & 0x80) !== 0;
    const propertyIndex = wide ? raw & 0x7fff : raw & 0x7f;
    if (!propertyIndex || propertyIndex > propertyCount || seen.has(propertyIndex)) return null;
    seen.add(propertyIndex);
    associations.push({ index: propertyIndex, essential });
  }
  return cursor === box.end ? associations : null;
}

function isValidAv1Configuration(bytes, box) {
  const length = box.end - box.payloadStart;
  if (length < 4) return false;
  const markerVersion = bytes[box.payloadStart];
  const profileAndLevel = bytes[box.payloadStart + 1];
  const tierAndDepth = bytes[box.payloadStart + 2];
  const delayAndReserved = bytes[box.payloadStart + 3];
  const level = profileAndLevel & 0x1f;
  return (markerVersion & 0x80) !== 0 && (markerVersion & 0x7f) === 1 &&
    (profileAndLevel >> 5) <= 2 && level <= 23 &&
    (level > 7 || (tierAndDepth & 0x80) === 0) &&
    (delayAndReserved & 0xe0) === 0 &&
    ((delayAndReserved & 0x10) !== 0 || (delayAndReserved & 0x0f) === 0);
}

function isValidAvifColorProperty(bytes, box) {
  const length = box.end - box.payloadStart;
  if (length !== 11 || ascii(bytes, box.payloadStart, 4) !== "nclx") return false;
  return (bytes[box.end - 1] & 1) === 0;
}

function isValidAvifPixelInformation(bytes, box) {
  const payload = box.payloadStart;
  if (box.end - payload < 5 || !isAvifFullBox(bytes, box, [0])) return false;
  const channels = bytes[payload + 4];
  if (channels < 1 || channels > 4 || box.end - (payload + 5) !== channels) return false;
  for (let index = payload + 5; index < box.end; index += 1) {
    if (!bytes[index] || bytes[index] > 16) return false;
  }
  return true;
}

function parseAvifSpatialExtents(bytes, box) {
  const payload = box.payloadStart;
  if (box.end - payload !== 12 || !isAvifFullBox(bytes, box, [0])) return null;
  return { width: readAvifU32(bytes, payload + 4), height: readAvifU32(bytes, payload + 8) };
}

function parseAv1SequenceMaxDimensions(bytes, start, end) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > bytes.length) return null;
  let offset = start;
  let sequence = null;
  let obuCount = 0;
  while (offset < end) {
    if (++obuCount > 256) return null;
    const header = bytes[offset++];
    if ((header & 0x81) !== 0) return null;
    const obuType = (header >> 3) & 0x0f;
    const extensionFlag = (header & 0x04) !== 0;
    const hasSizeField = (header & 0x02) !== 0;
    if (!hasSizeField) return null;
    if (extensionFlag) {
      if (offset >= end) return null;
      const extension = bytes[offset++];
      if ((extension & 0x07) !== 0) return null;
    }
    const size = readAv1Leb128(bytes, offset, end);
    if (!size) return null;
    offset = size.next;
    const payloadEnd = offset + size.value;
    if (!Number.isSafeInteger(payloadEnd) || payloadEnd > end) return null;
    if (obuType === 1) {
      if (sequence) return null;
      sequence = parseAv1SequenceHeaderMaxDimensions(bytes, offset, payloadEnd);
      if (!sequence) return null;
    }
    offset = payloadEnd;
  }
  return offset === end ? sequence : null;
}

function parseAv1SequenceHeaderMaxDimensions(bytes, start, end) {
  const reader = makeAv1BitReader(bytes, start, end);
  const profile = reader.read(3);
  const stillPicture = reader.read(1);
  const reducedStillPictureHeader = reader.read(1);
  if (profile === null || stillPicture === null || reducedStillPictureHeader === null || profile > 2) return null;

  let decoderModelInfoPresent = 0;
  let bufferDelayLength = 0;
  if (reducedStillPictureHeader) {
    if (!stillPicture || reader.read(5) === null) return null;
  } else {
    const timingInfoPresent = reader.read(1);
    if (timingInfoPresent === null) return null;
    if (timingInfoPresent) {
      if (reader.read(32) === null || reader.read(32) === null) return null;
      const equalPictureInterval = reader.read(1);
      if (equalPictureInterval === null || (equalPictureInterval && !skipAv1Uvlc(reader))) return null;
      decoderModelInfoPresent = reader.read(1);
      if (decoderModelInfoPresent === null) return null;
      if (decoderModelInfoPresent) {
        const bufferDelayLengthMinusOne = reader.read(5);
        if (bufferDelayLengthMinusOne === null || reader.read(32) === null ||
            reader.read(5) === null || reader.read(5) === null) return null;
        bufferDelayLength = bufferDelayLengthMinusOne + 1;
      }
    }
    const initialDisplayDelayPresent = reader.read(1);
    const operatingPointsMinusOne = reader.read(5);
    if (initialDisplayDelayPresent === null || operatingPointsMinusOne === null) return null;
    for (let index = 0; index <= operatingPointsMinusOne; index += 1) {
      if (reader.read(12) === null) return null;
      const level = reader.read(5);
      if (level === null || (level > 7 && reader.read(1) === null)) return null;
      if (decoderModelInfoPresent) {
        const present = reader.read(1);
        if (present === null) return null;
        if (present && (reader.read(bufferDelayLength) === null ||
            reader.read(bufferDelayLength) === null || reader.read(1) === null)) return null;
      }
      if (initialDisplayDelayPresent) {
        const present = reader.read(1);
        if (present === null || (present && reader.read(4) === null)) return null;
      }
    }
  }

  const widthBitsMinusOne = reader.read(4);
  const heightBitsMinusOne = reader.read(4);
  if (widthBitsMinusOne === null || heightBitsMinusOne === null) return null;
  const widthMinusOne = reader.read(widthBitsMinusOne + 1);
  const heightMinusOne = reader.read(heightBitsMinusOne + 1);
  if (widthMinusOne === null || heightMinusOne === null) return null;
  return { width: widthMinusOne + 1, height: heightMinusOne + 1 };
}

function makeAv1BitReader(bytes, start, end) {
  let bitOffset = start * 8;
  const bitEnd = end * 8;
  return {
    read(count) {
      if (!Number.isInteger(count) || count < 0 || count > 32 || bitOffset + count > bitEnd) return null;
      let value = 0;
      for (let index = 0; index < count; index += 1) {
        const byte = bytes[Math.floor(bitOffset / 8)];
        value = value * 2 + ((byte >> (7 - (bitOffset % 8))) & 1);
        bitOffset += 1;
      }
      return value;
    }
  };
}

function skipAv1Uvlc(reader) {
  for (let leadingZeros = 0; leadingZeros <= 32; leadingZeros += 1) {
    const done = reader.read(1);
    if (done === null) return false;
    if (done) return leadingZeros >= 32 || reader.read(leadingZeros) !== null;
  }
  return false;
}

function readAv1Leb128(bytes, offset, end) {
  let value = 0;
  let factor = 1;
  for (let index = 0; index < 8; index += 1) {
    if (offset >= end) return null;
    const byte = bytes[offset++];
    value += (byte & 0x7f) * factor;
    if (!Number.isSafeInteger(value) || value > 0xffffffff) return null;
    if ((byte & 0x80) === 0) return { value, next: offset };
    factor *= 128;
  }
  return null;
}

function readAvifBoxes(bytes, start, end, maximumCount) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > bytes.length) return null;
  const result = [];
  let offset = start;
  while (offset < end) {
    if (result.length >= maximumCount || offset + 8 > end) return null;
    const size = readAvifU32(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    if (size === 1) unsupportedAvif("Extended-size AVIF boxes are outside the supported bounded profile.");
    const boxSize = size === 0 ? end - offset : size;
    if (!Number.isSafeInteger(boxSize) || boxSize < 8 || offset + boxSize > end) return null;
    result.push({ type, start: offset, payloadStart: offset + 8, end: offset + boxSize, bytes });
    offset += boxSize;
  }
  return offset === end ? result : null;
}

function uniqueAvifBox(boxes, type) {
  const matches = boxes.filter((box) => box.type === type);
  return matches.length === 1 ? matches[0] : null;
}

function avifFullBoxVersion(bytes, box, allowedVersions) {
  if (box.end - box.payloadStart < 4) return null;
  const version = bytes[box.payloadStart];
  const flags = bytes[box.payloadStart + 1] * 0x10000 + bytes[box.payloadStart + 2] * 0x100 + bytes[box.payloadStart + 3];
  return allowedVersions.includes(version) && flags === 0 ? version : null;
}

function isAvifFullBox(bytes, box, allowedVersions) {
  return avifFullBoxVersion(bytes, box, allowedVersions) !== null;
}

function readAvifUnsigned(bytes, offset, size) {
  if (![0, 1, 2, 4, 8].includes(size) || offset < 0 || offset + size > bytes.length) return null;
  let value = 0;
  for (let index = 0; index < size; index += 1) {
    value = value * 256 + bytes[offset + index];
    if (!Number.isSafeInteger(value)) return null;
  }
  return value;
}

function readAvifU16(bytes, offset) { return bytes[offset] * 256 + bytes[offset + 1]; }
function readAvifU32(bytes, offset) { return (bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3]) >>> 0; }

function unsupportedAvif(message) {
  mdictFail(MDICT_IMPORT_ERROR.UNSUPPORTED, message);
}

function safeAvifPropertyType(type) {
  return /^[A-Za-z0-9 ]{4}$/u.test(type) ? type : "an unknown property";
}

function ascii(bytes, offset, length) {
  let value = "";
  for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[offset + index] || 0);
  return value;
}
