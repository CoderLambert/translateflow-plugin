const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP64_EXTRA_FIELD = 0x0001;
const MAX_ZIP_COMMENT_BYTES = 65_535;

const CRC32_TABLE = makeCrc32Table();

export function parseSingleRootMdxZipLayout(input, {
  expectedNameBytesHex,
  expectedBytes,
  maxExpandedBytes,
  maxFileBytes,
  maxCompressionRatio
} = {}) {
  const bytes = zipToBytes(input);
  const expectedNameBytes = fromHex(expectedNameBytesHex);
  validateExpectedName(expectedNameBytes);
  requirePositiveInteger(expectedBytes, "expected MDX bytes");
  requirePositiveInteger(maxExpandedBytes, "expanded ZIP byte limit");
  requirePositiveInteger(maxFileBytes, "ZIP member byte limit");
  if (!Number.isFinite(maxCompressionRatio) || maxCompressionRatio < 1) {
    throw zipError("ECDICT_ZIP_LIMIT", "ZIP compression ratio limit is invalid.");
  }

  if (bytes.byteLength < 22 || readUint32LE(bytes, 0) !== ZIP_LOCAL_SIGNATURE) {
    throw zipError("ECDICT_ZIP_CORRUPT", "ECDICT ZIP local header is missing or has a preamble.");
  }
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const diskNumber = readUint16LE(bytes, eocdOffset + 4);
  const centralDisk = readUint16LE(bytes, eocdOffset + 6);
  const entriesOnDisk = readUint16LE(bytes, eocdOffset + 8);
  const entryCount = readUint16LE(bytes, eocdOffset + 10);
  const centralBytes = readUint32LE(bytes, eocdOffset + 12);
  const centralOffset = readUint32LE(bytes, eocdOffset + 16);
  const commentBytes = readUint16LE(bytes, eocdOffset + 20);
  if (
    commentBytes > MAX_ZIP_COMMENT_BYTES ||
    eocdOffset + 22 + commentBytes !== bytes.byteLength ||
    diskNumber !== 0 || centralDisk !== 0 ||
    entriesOnDisk !== 1 || entryCount !== 1 ||
    entriesOnDisk === 0xffff || entryCount === 0xffff ||
    centralBytes === 0xffffffff || centralOffset === 0xffffffff ||
    centralOffset + centralBytes !== eocdOffset ||
    centralOffset <= 0 || centralOffset > eocdOffset
  ) {
    throw zipError("ECDICT_ZIP_LAYOUT", "ECDICT ZIP must have one non-ZIP64 member in a single-disk archive.");
  }

  const centralEnd = centralOffset + centralBytes;
  if (centralOffset + 46 > centralEnd || readUint32LE(bytes, centralOffset) !== ZIP_CENTRAL_SIGNATURE) {
    throw zipError("ECDICT_ZIP_CORRUPT", "ECDICT ZIP central directory is invalid.");
  }
  const versionNeeded = readUint16LE(bytes, centralOffset + 6);
  const flags = readUint16LE(bytes, centralOffset + 8);
  const method = readUint16LE(bytes, centralOffset + 10);
  const crc = readUint32LE(bytes, centralOffset + 16);
  const compressedBytes = readUint32LE(bytes, centralOffset + 20);
  const uncompressedBytes = readUint32LE(bytes, centralOffset + 24);
  const nameLength = readUint16LE(bytes, centralOffset + 28);
  const extraLength = readUint16LE(bytes, centralOffset + 30);
  const commentLength = readUint16LE(bytes, centralOffset + 32);
  const diskStart = readUint16LE(bytes, centralOffset + 34);
  const localOffset = readUint32LE(bytes, centralOffset + 42);
  const recordEnd = centralOffset + 46 + nameLength + extraLength + commentLength;
  if (
    recordEnd !== centralEnd ||
    nameLength !== expectedNameBytes.byteLength ||
    diskStart !== 0 || localOffset !== 0 ||
    [0xffffffff, 0xffff].includes(compressedBytes) ||
    [0xffffffff, 0xffff].includes(uncompressedBytes) ||
    !bytesEqual(bytes.subarray(centralOffset + 46, centralOffset + 46 + nameLength), expectedNameBytes)
  ) {
    throw zipError("ECDICT_ZIP_LAYOUT", "ECDICT ZIP member name, location, or central directory shape is invalid.");
  }
  const centralExtraStart = centralOffset + 46 + nameLength;
  rejectZip64Extra(bytes, centralExtraStart, extraLength);
  validateFlags(flags, method, versionNeeded);
  if (method !== 0 && method !== 8) {
    throw zipError("ECDICT_ZIP_METHOD", "ECDICT ZIP uses an unsupported compression method.");
  }
  if (
    compressedBytes <= 0 || uncompressedBytes !== expectedBytes ||
    uncompressedBytes > maxExpandedBytes ||
    uncompressedBytes > maxFileBytes
  ) {
    throw zipError("ECDICT_ZIP_LIMIT", "ECDICT ZIP member exceeds a configured size limit.");
  }
  const ratio = uncompressedBytes / compressedBytes;
  if (!Number.isFinite(ratio) || ratio > maxCompressionRatio) {
    throw zipError("ECDICT_ZIP_RATIO", "ECDICT ZIP member exceeds the compression ratio limit.");
  }
  if (method === 0 && compressedBytes !== uncompressedBytes) {
    throw zipError("ECDICT_ZIP_LAYOUT", "Stored ECDICT ZIP member has inconsistent sizes.");
  }

  const local = parseLocalHeader(bytes, {
    centralOffset,
    flags,
    method,
    crc,
    compressedBytes,
    uncompressedBytes,
    expectedNameBytes
  });
  return {
    method,
    crc32: crc,
    compressedBytes,
    uncompressedBytes,
    dataOffset: local.dataOffset
  };
}

export function zipCrc32(input) {
  const bytes = zipToBytes(input);
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parseLocalHeader(bytes, central) {
  if (readUint32LE(bytes, 0) !== ZIP_LOCAL_SIGNATURE || bytes.byteLength < 30) {
    throw zipError("ECDICT_ZIP_CORRUPT", "ECDICT ZIP local header is invalid.");
  }
  const versionNeeded = readUint16LE(bytes, 4);
  const flags = readUint16LE(bytes, 6);
  const method = readUint16LE(bytes, 8);
  const crc = readUint32LE(bytes, 14);
  const compressedBytes = readUint32LE(bytes, 18);
  const uncompressedBytes = readUint32LE(bytes, 22);
  const nameLength = readUint16LE(bytes, 26);
  const extraLength = readUint16LE(bytes, 28);
  const headerEnd = 30 + nameLength + extraLength;
  if (
    headerEnd > central.centralOffset ||
    nameLength !== central.expectedNameBytes.byteLength ||
    !bytesEqual(bytes.subarray(30, 30 + nameLength), central.expectedNameBytes) ||
    flags !== central.flags || method !== central.method
  ) {
    throw zipError("ECDICT_ZIP_LAYOUT", "ECDICT ZIP local and central headers disagree.");
  }
  rejectZip64Extra(bytes, 30 + nameLength, extraLength);
  validateFlags(flags, method, versionNeeded);

  const hasDescriptor = Boolean(flags & 0x0008);
  if (!hasDescriptor && (
    crc !== central.crc ||
    compressedBytes !== central.compressedBytes ||
    uncompressedBytes !== central.uncompressedBytes
  )) {
    throw zipError("ECDICT_ZIP_LAYOUT", "ECDICT ZIP local sizes or CRC disagree with its central directory.");
  }
  if (hasDescriptor && (
    (crc !== 0 && crc !== central.crc) ||
    (compressedBytes !== 0 && compressedBytes !== central.compressedBytes) ||
    (uncompressedBytes !== 0 && uncompressedBytes !== central.uncompressedBytes)
  )) {
    throw zipError("ECDICT_ZIP_LAYOUT", "ECDICT ZIP data descriptor header fields are inconsistent.");
  }

  const dataOffset = headerEnd;
  const dataEnd = dataOffset + central.compressedBytes;
  if (dataEnd > central.centralOffset) {
    throw zipError("ECDICT_ZIP_LAYOUT", "ECDICT ZIP member data overlaps its central directory.");
  }
  let descriptorBytes = 0;
  if (hasDescriptor) {
    if (dataEnd + 12 > central.centralOffset) {
      throw zipError("ECDICT_ZIP_LAYOUT", "ECDICT ZIP data descriptor is truncated.");
    }
    const hasSignature = readUint32LE(bytes, dataEnd) === ZIP_DATA_DESCRIPTOR_SIGNATURE;
    const descriptorOffset = dataEnd + (hasSignature ? 4 : 0);
    if (
      readUint32LE(bytes, descriptorOffset) !== central.crc ||
      readUint32LE(bytes, descriptorOffset + 4) !== central.compressedBytes ||
      readUint32LE(bytes, descriptorOffset + 8) !== central.uncompressedBytes
    ) {
      throw zipError("ECDICT_ZIP_LAYOUT", "ECDICT ZIP data descriptor does not match its central directory.");
    }
    descriptorBytes = hasSignature ? 16 : 12;
  }
  if (dataEnd + descriptorBytes !== central.centralOffset) {
    throw zipError("ECDICT_ZIP_LAYOUT", "ECDICT ZIP contains hidden bytes outside its single root member.");
  }
  return { dataOffset };
}

function findEndOfCentralDirectory(bytes) {
  const minimum = Math.max(0, bytes.byteLength - 22 - MAX_ZIP_COMMENT_BYTES);
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (readUint32LE(bytes, offset) !== ZIP_EOCD_SIGNATURE) continue;
    const commentBytes = readUint16LE(bytes, offset + 20);
    if (offset + 22 + commentBytes === bytes.byteLength) return offset;
  }
  throw zipError("ECDICT_ZIP_CORRUPT", "ECDICT ZIP end-of-central-directory record is missing.");
}

function validateExpectedName(nameBytes) {
  if (
    nameBytes.length < 5 ||
    bytesContain(nameBytes, 0x2f) ||
    bytesContain(nameBytes, 0x5c) ||
    bytesContain(nameBytes, 0x00) ||
    !nameBytesHexEndsWithMdx(nameBytes)
  ) {
    throw zipError("ECDICT_ZIP_PATH", "Expected ZIP member must be one root-level .mdx filename.");
  }
}

function validateFlags(flags, method, versionNeeded) {
  const supported = method === 8 ? 0x080e : 0x0808;
  if (
    flags & ~supported ||
    flags & 0x0001 ||
    flags & 0x0040 ||
    flags & 0x2000 ||
    versionNeeded > (method === 8 ? 20 : 10)
  ) {
    throw zipError("ECDICT_ZIP_UNSUPPORTED", "ECDICT ZIP encryption or unsupported flags are not accepted.");
  }
}

function rejectZip64Extra(bytes, offset, length) {
  const end = offset + length;
  if (end > bytes.byteLength) {
    throw zipError("ECDICT_ZIP_CORRUPT", "ECDICT ZIP extra field is truncated.");
  }
  while (offset < end) {
    if (offset + 4 > end) {
      throw zipError("ECDICT_ZIP_CORRUPT", "ECDICT ZIP extra field header is truncated.");
    }
    const id = readUint16LE(bytes, offset);
    const size = readUint16LE(bytes, offset + 2);
    offset += 4;
    if (offset + size > end) {
      throw zipError("ECDICT_ZIP_CORRUPT", "ECDICT ZIP extra field length is invalid.");
    }
    if (id === ZIP64_EXTRA_FIELD) {
      throw zipError("ECDICT_ZIP_ZIP64", "ZIP64 archives and members are not supported.");
    }
    offset += size;
  }
}

function makeCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
}

function nameBytesHexEndsWithMdx(bytes) {
  const suffix = [0x2e, 0x6d, 0x64, 0x78];
  return suffix.every((value, index) => bytes[bytes.length - suffix.length + index] === value);
}

function fromHex(value) {
  const text = String(value || "");
  if (!/^(?:[a-f0-9]{2})+$/iu.test(text)) {
    throw zipError("ECDICT_ZIP_PATH", "Expected ZIP member filename bytes are invalid.");
  }
  const bytes = new Uint8Array(text.length / 2);
  for (let index = 0; index < bytes.byteLength; index += 1) {
    bytes[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesContain(bytes, value) {
  for (const byte of bytes) if (byte === value) return true;
  return false;
}

function bytesEqual(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function readUint16LE(bytes, offset) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 2 > bytes.byteLength) {
    throw zipError("ECDICT_ZIP_CORRUPT", "ECDICT ZIP uint16 field is truncated.");
  }
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes, offset) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 4 > bytes.byteLength) {
    throw zipError("ECDICT_ZIP_CORRUPT", "ECDICT ZIP uint32 field is truncated.");
  }
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

export function zipToBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw zipError("ECDICT_ZIP_INPUT", "ECDICT ZIP input must be bytes.");
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw zipError("ECDICT_ZIP_LIMIT", label + " is invalid.");
  }
}

function zipError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
