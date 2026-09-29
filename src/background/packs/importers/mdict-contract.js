import {
  normalizeLexicalKey
} from "../../../shared/lexical.js";

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

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const UTF16LE = new TextDecoder("utf-16le", { fatal: true });
const UTF8_ENCODER = new TextEncoder();
const CONTROL =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const HTML_LIKE = /<\s*\/?\s*[a-z][^>]*>/iu;
const MDX_LINK = /^@@@LINK=/iu;

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

export function parseMdictHeader(
  input,
  limits = MDICT_IMPORT_LIMITS
) {
  const cursor =
    input instanceof MDictCursor ? input : new MDictCursor(input);
  const headerBytesLength =
    cursor.readUint32Be("MDict header bytes");
  requireMdictAtMost(
    headerBytesLength,
    limits.headerBytes,
    "MDict header bytes"
  );
  if (
    headerBytesLength < 4 ||
    headerBytesLength % 2 !== 0
  ) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict UTF-16LE header byte length is invalid."
    );
  }

  const headerBytes =
    cursor.read(headerBytesLength, "MDict header");
  const expectedChecksum =
    cursor.readUint32Le("MDict header checksum");
  if (adler32(headerBytes) !== expectedChecksum) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict header checksum mismatch."
    );
  }

  const headerText =
    decodeUtf16Le(headerBytes, "MDict header")
      .replace(/\u0000+$/gu, "")
      .trim();
  const attributes = parseDictionaryAttributes(headerText);
  const generatedByEngineVersion =
    attributes.GeneratedByEngineVersion || "";
  if (generatedByEngineVersion !== "2.0") {
    mdictFail(
      MDICT_IMPORT_ERROR.UNSUPPORTED,
      "Only MDict MDX v2.0 is supported.",
      { version: generatedByEngineVersion || null }
    );
  }

  const encrypted = parseEncryptedFlag(attributes.Encrypted);
  if (encrypted !== 0) {
    mdictFail(
      MDICT_IMPORT_ERROR.UNSUPPORTED,
      "Encrypted MDict dictionaries are not supported.",
      { encrypted }
    );
  }

  const encoding = normalizeMdictEncoding(attributes.Encoding);
  if (
    String(attributes.Compact || "No").toLowerCase() === "yes" ||
    String(attributes.Compat || "No").toLowerCase() === "yes" ||
    String(attributes.StyleSheet || "").trim()
  ) {
    mdictFail(
      MDICT_IMPORT_ERROR.UNSUPPORTED,
      "MDict Compact/StyleSheet presentation transforms are not supported."
    );
  }

  return {
    generatedByEngineVersion,
    requiredEngineVersion:
      attributes.RequiredEngineVersion || "",
    title: cleanMetadataText(attributes.Title || ""),
    format: cleanMetadataText(attributes.Format || ""),
    encoding,
    encrypted,
    attributes
  };
}

export function sanitizeMdictRecord(
  value,
  headword = "",
  limits = MDICT_IMPORT_LIMITS
) {
  const text = String(value || "")
    .replace(/\r\n?/gu, "\n")
    .trim();
  if (!text) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict record is empty.",
      { headword }
    );
  }
  if (CONTROL.test(text)) {
    mdictFail(
      MDICT_IMPORT_ERROR.UNSAFE_CONTENT,
      "MDict record contains unsafe control characters.",
      { headword }
    );
  }
  if (HTML_LIKE.test(text)) {
    mdictFail(
      MDICT_IMPORT_ERROR.UNSAFE_CONTENT,
      "Renderable markup is rejected by the MDict importer.",
      { headword }
    );
  }
  if (MDX_LINK.test(text)) {
    mdictFail(
      MDICT_IMPORT_ERROR.UNSUPPORTED,
      "MDict @@@LINK redirects are not supported.",
      { headword }
    );
  }
  requireMdictAtMost(
    UTF8_ENCODER.encode(text).byteLength,
    limits.entryBytes,
    "MDict sanitized record bytes"
  );
  return text;
}

export function validateMdictHeadword(value) {
  const text = String(value || "");
  if (
    !text ||
    CONTROL.test(text) ||
    HTML_LIKE.test(text)
  ) {
    mdictFail(
      MDICT_IMPORT_ERROR.UNSAFE_CONTENT,
      "Unsafe MDict headword."
    );
  }
  if (!normalizeLexicalKey(text)) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict headword cannot be normalized."
    );
  }
}

export function decodeMdictText(bytes, encoding, label) {
  try {
    return encoding.decoder.decode(bytes);
  } catch (cause) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      label + " is not valid " + encoding.name + ".",
      { cause }
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

function parseDictionaryAttributes(text) {
  const match =
    /^<Dictionary\b([\s\S]*?)\/>\s*$/iu.exec(String(text || ""));
  if (!match) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict header must contain one self-closing Dictionary tag."
    );
  }
  const source = match[1];
  const attributes = Object.create(null);
  let offset = 0;
  while (offset < source.length) {
    while (
      offset < source.length &&
      /\s/u.test(source[offset])
    ) {
      offset += 1;
    }
    if (offset >= source.length) break;
    const fragment = source.slice(offset);
    const attribute =
      /^([A-Za-z][A-Za-z0-9_]*)="([^"]*)"/u.exec(fragment);
    if (!attribute) {
      mdictFail(
        MDICT_IMPORT_ERROR.CORRUPT,
        "Malformed MDict header attribute."
      );
    }
    const key = attribute[1];
    if (Object.hasOwn(attributes, key)) {
      mdictFail(
        MDICT_IMPORT_ERROR.CORRUPT,
        "Duplicate MDict header attribute.",
        { key }
      );
    }
    attributes[key] = decodeXmlEntities(attribute[2]);
    offset += attribute[0].length;
  }
  return attributes;
}

function decodeXmlEntities(value) {
  return String(value).replace(
    /&(quot|apos|lt|gt|amp|#\d+|#x[0-9a-f]+);/giu,
    (_full, token) => {
      const lower = token.toLowerCase();
      if (lower === "quot") return '"';
      if (lower === "apos") return "'";
      if (lower === "lt") return "<";
      if (lower === "gt") return ">";
      if (lower === "amp") return "&";
      const codePoint = lower.startsWith("#x")
        ? Number.parseInt(lower.slice(2), 16)
        : Number.parseInt(lower.slice(1), 10);
      if (
        !Number.isSafeInteger(codePoint) ||
        codePoint < 0 ||
        codePoint > 0x10ffff
      ) {
        mdictFail(
          MDICT_IMPORT_ERROR.CORRUPT,
          "Invalid XML character entity in MDict header."
        );
      }
      return String.fromCodePoint(codePoint);
    }
  );
}

function normalizeMdictEncoding(value) {
  const text = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/_/gu, "-");
  if (text === "UTF8" || text === "UTF-8") {
    return {
      name: "UTF-8",
      decoder: UTF8,
      unitBytes: 1
    };
  }
  if (
    text === "UTF16" ||
    text === "UTF-16" ||
    text === "UTF-16LE"
  ) {
    return {
      name: "UTF-16",
      decoder: UTF16LE,
      unitBytes: 2
    };
  }
  mdictFail(
    MDICT_IMPORT_ERROR.UNSUPPORTED,
    "Unsupported MDict text encoding.",
    { encoding: value || null }
  );
}

function parseEncryptedFlag(value) {
  const text = String(value ?? "0").trim();
  if (!text || /^no$/iu.test(text)) return 0;
  if (/^yes$/iu.test(text)) return 1;
  if (!/^\d+$/u.test(text)) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "Invalid MDict Encrypted header value."
    );
  }
  const number = Number(text);
  if (
    !Number.isSafeInteger(number) ||
    number < 0 ||
    number > 3
  ) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "Invalid MDict Encrypted header value."
    );
  }
  return number;
}

function decodeUtf16Le(bytes, label) {
  try {
    return UTF16LE.decode(bytes);
  } catch (cause) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      label + " is not valid UTF-16LE.",
      { cause }
    );
  }
}

function cleanMetadataText(value) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/gu, " ")
    .trim()
    .slice(0, 4096);
}
