export function readMddAv1SequenceMaxDimensions(bytes, start, end) {
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
    if (extensionFlag) {
      if (offset >= end) return null;
      const extension = bytes[offset++];
      if ((extension & 0x07) !== 0) return null;
    }
    let payloadEnd = end;
    if (hasSizeField) {
      const size = readAv1Leb128(bytes, offset, end);
      if (!size) return null;
      offset = size.next;
      payloadEnd = offset + size.value;
      if (!Number.isSafeInteger(payloadEnd) || payloadEnd > end) return null;
    }
    if (obuType === 1) {
      if (sequence) return null;
      sequence = parseReducedStillSequenceDimensions(bytes, offset, payloadEnd);
      if (!sequence) return null;
    }
    offset = payloadEnd;
  }
  return offset === end ? sequence : null;
}

function parseReducedStillSequenceDimensions(bytes, start, end) {
  const reader = makeAv1BitReader(bytes, start, end);
  const profile = reader.read(3);
  const stillPicture = reader.read(1);
  const reducedStillPictureHeader = reader.read(1);
  if (profile === null || stillPicture === null || reducedStillPictureHeader === null ||
      profile > 2 || stillPicture !== 1 || reducedStillPictureHeader !== 1) return null;

  // reduced_still_picture_header fixes frame_size_override_flag to 0. The
  // decoded frame dimensions therefore come directly from the sequence bounds,
  // so no Frame Header parser is needed for this intentionally narrow profile.
  if (reader.read(5) === null) return null;
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
