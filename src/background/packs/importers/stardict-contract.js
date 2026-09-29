export const STARDICT_IMPORT_LIMITS = Object.freeze({
  ifoBytes: 64 * 1024,
  idxBytes: 64 * 1024 * 1024,
  synBytes: 32 * 1024 * 1024,
  dictArchiveBytes: 128 * 1024 * 1024,
  dictBytes: 128 * 1024 * 1024,
  entryBytes: 512 * 1024,
  entryCount: 1_000_000,
  synonymCount: 1_000_000,
  headwordBytes: 1024
});

export const STARDICT_IMPORT_ERROR = Object.freeze({
  CORRUPT: "STARDICT_CORRUPT",
  LIMIT: "STARDICT_LIMIT",
  UNSUPPORTED: "STARDICT_UNSUPPORTED",
  UNSAFE_CONTENT: "STARDICT_UNSAFE_CONTENT"
});

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const UTF8_ENCODER = new TextEncoder();

export class StarDictImportError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "StarDictImportError";
    this.code = code;
    Object.assign(this, details);
  }
}

export function starDictFail(code, message, details) {
  throw new StarDictImportError(code, message, details);
}

export function starDictBytes(value, label) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength
    );
  }
  starDictFail(
    STARDICT_IMPORT_ERROR.CORRUPT,
    label + " must be bytes."
  );
}

export function decodeStarDictUtf8(bytes, label) {
  try {
    return UTF8.decode(bytes);
  } catch (cause) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      label + " is not valid UTF-8.",
      { cause }
    );
  }
}

export function starDictUtf8Bytes(value) {
  return UTF8_ENCODER.encode(String(value)).byteLength;
}

export function requireStarDictAtMost(
  actual,
  maximum,
  label
) {
  if (
    !Number.isSafeInteger(actual) ||
    actual < 0 ||
    !Number.isSafeInteger(maximum) ||
    actual > maximum
  ) {
    starDictFail(
      STARDICT_IMPORT_ERROR.LIMIT,
      label + " exceeds the POC safety limit.",
      { actual, maximum }
    );
  }
}

export function readStarDictUint16Le(bytes, offset) {
  if (
    offset < 0 ||
    offset + 2 > bytes.byteLength
  ) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict little-endian uint16 is truncated."
    );
  }
  return bytes[offset] + bytes[offset + 1] * 0x100;
}

export function readStarDictUint32Be(bytes, offset) {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  ) >>> 0;
}

export function compareStarDictWordBytes(left, right) {
  const folded = compareAsciiCaseInsensitiveBytes(left, right);
  if (folded !== 0) return folded;
  return compareBytes(left, right);
}

function compareAsciiCaseInsensitiveBytes(left, right) {
  const length = Math.min(
    left.byteLength,
    right.byteLength
  );
  for (let index = 0; index < length; index += 1) {
    const a = foldAsciiByte(left[index]);
    const b = foldAsciiByte(right[index]);
    if (a !== b) return a < b ? -1 : 1;
  }
  return compareLengths(left, right);
}

function compareBytes(left, right) {
  const length = Math.min(
    left.byteLength,
    right.byteLength
  );
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] < right[index] ? -1 : 1;
    }
  }
  return compareLengths(left, right);
}

function compareLengths(left, right) {
  if (left.byteLength === right.byteLength) return 0;
  return left.byteLength < right.byteLength ? -1 : 1;
}

function foldAsciiByte(value) {
  return value >= 0x41 && value <= 0x5a
    ? value + 0x20
    : value;
}
