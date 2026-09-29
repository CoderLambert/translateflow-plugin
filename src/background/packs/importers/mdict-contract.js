export const MDICT_IMPORT_LIMITS = Object.freeze({
  fileBytes: 128 * 1024 * 1024,
  headerBytes: 256 * 1024,
  keyIndexBytes: 16 * 1024 * 1024,
  blockCompressedBytes: 32 * 1024 * 1024,
  blockDecompressedBytes: 32 * 1024 * 1024,
  totalRecordBytes: 128 * 1024 * 1024,
  entryBytes: 512 * 1024,
  entryCount: 1_000_000,
  blockCount: 65_536,
  headwordBytes: 1024
});

export const MDICT_IMPORT_ERROR = Object.freeze({
  CORRUPT: "MDICT_CORRUPT",
  LIMIT: "MDICT_LIMIT",
  UNSUPPORTED: "MDICT_UNSUPPORTED",
  UNSAFE_CONTENT: "MDICT_UNSAFE_CONTENT"
});

export class MDictImportError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "MDictImportError";
    this.code = code;
    Object.assign(this, details);
  }
}

export function mdictFail(code, message, details) {
  throw new MDictImportError(code, message, details);
}

export function mdictBytes(value, label = "MDict bytes") {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength
    );
  }
  mdictFail(
    MDICT_IMPORT_ERROR.CORRUPT,
    label + " must be bytes."
  );
}

export function requireMdictAtMost(actual, maximum, label) {
  if (
    !Number.isSafeInteger(actual) ||
    actual < 0 ||
    !Number.isSafeInteger(maximum) ||
    actual > maximum
  ) {
    mdictFail(
      MDICT_IMPORT_ERROR.LIMIT,
      label + " exceeds the import safety limit.",
      { actual, maximum }
    );
  }
}

export function requireMdictSafeSourceId(value) {
  const text = String(value || "");
  if (
    !/^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/iu.test(text)
  ) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "sourceId is invalid."
    );
  }
}

export function requireMdictText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      label + " is required."
    );
  }
}

export function adler32(input) {
  const bytes = mdictBytes(input, "Adler32 input");
  const MOD = 65521;
  let a = 1;
  let b = 0;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    a += bytes[index];
    b += a;
    if ((index & 0x0fff) === 0x0fff) {
      a %= MOD;
      b %= MOD;
    }
  }
  a %= MOD;
  b %= MOD;
  return (((b << 16) | a) >>> 0);
}

export class MDictCursor {
  constructor(input) {
    this.bytes = mdictBytes(input);
    this.offset = 0;
  }

  get remaining() {
    return this.bytes.byteLength - this.offset;
  }

  read(length, label) {
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > this.remaining
    ) {
      mdictFail(
        MDICT_IMPORT_ERROR.CORRUPT,
        (label || "MDict read") +
          " exceeds the available bytes.",
        {
          offset: this.offset,
          requested: length,
          remaining: this.remaining
        }
      );
    }
    const value = this.bytes.subarray(
      this.offset,
      this.offset + length
    );
    this.offset += length;
    return value;
  }

  readUint16Be(label) {
    const bytes = this.read(2, label);
    return bytes[0] * 0x100 + bytes[1];
  }

  readUint32Be(label) {
    return readMdictUint32Be(this.read(4, label), 0);
  }

  readUint32Le(label) {
    const bytes = this.read(4, label);
    return (
      bytes[0] +
      bytes[1] * 0x100 +
      bytes[2] * 0x10000 +
      bytes[3] * 0x1000000
    ) >>> 0;
  }

  readSafeUint64Be(label) {
    const bytes = this.read(8, label);
    const high = readMdictUint32Be(bytes, 0);
    const low = readMdictUint32Be(bytes, 4);
    const value = high * 0x100000000 + low;
    if (!Number.isSafeInteger(value)) {
      mdictFail(
        MDICT_IMPORT_ERROR.LIMIT,
        label + " exceeds JavaScript safe integer range."
      );
    }
    return value;
  }
}

export function readMdictUint32Be(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict uint32 is truncated."
    );
  }
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  ) >>> 0;
}
