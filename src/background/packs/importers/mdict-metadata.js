import {
  normalizeLexicalKey
} from "../../../shared/lexical.js";
import {
  MDICT_IMPORT_ERROR,
  MDICT_IMPORT_LIMITS,
  MDictCursor,
  adler32,
  mdictFail,
  requireMdictAtMost
} from "./mdict-contract.js";

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const UTF16LE = new TextDecoder("utf-16le", { fatal: true });
const UTF8_ENCODER = new TextEncoder();
const CONTROL =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const HTML_LIKE = /<\s*\/?\s*[a-z][^>]*>/iu;
const MDX_LINK = /^@@@LINK=/iu;

export function parseMdictHeader(
  input,
  limits = MDICT_IMPORT_LIMITS
) {
  const cursor =
    input instanceof MDictCursor
      ? input
      : new MDictCursor(input);
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

  const encrypted = parseEncryptedFlag(
    attributes.Encrypted
  );
  if (encrypted !== 0) {
    mdictFail(
      MDICT_IMPORT_ERROR.UNSUPPORTED,
      "Encrypted MDict dictionaries are not supported.",
      { encrypted }
    );
  }

  const encoding = normalizeMdictEncoding(
    attributes.Encoding
  );
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

// The rich lane keeps source presentation metadata for the later safe viewer.
// This parser intentionally accepts only MDX v2.0 and the unprotected record
// path. Encrypted=2 protects only the key-block index and is handled by the
// bounded rich index reader; Encrypted=1/3 would require record decryption.
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

export function parseDictionaryAttributes(text, tagName = "Dictionary") {
  if (!["Dictionary", "Library_Data"].includes(tagName)) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "Unsupported MDict header tag."
    );
  }
  const match = new RegExp(
    "^<" + tagName + "\\b([\\s\\S]*?)\\/>\\s*$",
    "iu"
  ).exec(String(text || ""));
  if (!match) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict header must contain one self-closing " + tagName + " tag."
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
      /^([A-Za-z][A-Za-z0-9_]*)="([^"]*)"/u.exec(
        fragment
      );
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

export function normalizeMdictEncoding(value) {
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

export function parseEncryptedFlag(value) {
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
