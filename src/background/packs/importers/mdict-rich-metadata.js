import {
  parseDictionaryAttributes,
  parseEncryptedFlag,
  normalizeMdictEncoding
} from "./mdict-metadata.js";
import {
  MDICT_IMPORT_ERROR,
  MDICT_IMPORT_LIMITS,
  MDictCursor,
  adler32,
  mdictFail,
  requireMdictAtMost
} from "./mdict-contract.js";

const UTF16LE = new TextDecoder("utf-16le", { fatal: true });
const UTF8 = new TextEncoder();

export function parseRichMdictHeader(
  input,
  limits = MDICT_IMPORT_LIMITS
) {
  const cursor = input instanceof MDictCursor
    ? input
    : new MDictCursor(input);
  const byteLength = cursor.readUint32Be("MDict header bytes");
  requireMdictAtMost(byteLength, limits.headerBytes, "MDict header bytes");
  if (byteLength < 4 || byteLength % 2 !== 0) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict UTF-16LE header byte length is invalid."
    );
  }

  const bytes = cursor.read(byteLength, "MDict header");
  const headerChecksum = cursor.readUint32Le("MDict header checksum");
  if (adler32(bytes) !== headerChecksum) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict header checksum mismatch."
    );
  }

  let headerText;
  try {
    headerText = UTF16LE.decode(bytes);
  } catch (cause) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict header is not valid UTF-16LE.", { cause });
  }
  const attributes = parseDictionaryAttributes(
    headerText.replace(/\u0000+$/gu, "").trim()
  );
  const generatedByEngineVersion =
    attributes.GeneratedByEngineVersion || "";
  if (generatedByEngineVersion !== "2.0") {
    mdictFail(
      MDICT_IMPORT_ERROR.UNSUPPORTED,
      "Only MDict MDX v2.0 is supported.",
      { version: generatedByEngineVersion || null }
    );
  }
  const requiredEngineVersion =
    String(attributes.RequiredEngineVersion || "").trim();
  if (!isSupportedRequiredEngineVersion(requiredEngineVersion)) {
    mdictFail(
      MDICT_IMPORT_ERROR.UNSUPPORTED,
      "MDict requires a newer engine version.",
      { requiredEngineVersion }
    );
  }
  const format = String(attributes.Format || "");
  if (!/^(?:html|text)$/iu.test(format)) {
    mdictFail(
      MDICT_IMPORT_ERROR.UNSUPPORTED,
      "Unsupported MDict record format.",
      { format }
    );
  }

  const encrypted = parseEncryptedFlag(attributes.Encrypted);
  if (encrypted !== 0 && encrypted !== 2) {
    mdictFail(
      MDICT_IMPORT_ERROR.UNSUPPORTED,
      "Only the MDX v2 key-info encryption mode is supported.",
      { encrypted }
    );
  }

  const styleSheet = String(attributes.StyleSheet || "");
  requireMdictAtMost(
    UTF8.encode(styleSheet).byteLength,
    Math.min(limits.headerBytes, 64 * 1024),
    "MDict StyleSheet metadata bytes"
  );
  return {
    generatedByEngineVersion,
    requiredEngineVersion: requiredEngineVersion || "2.0",
    title: cleanText(attributes.Title || ""),
    format: cleanText(format),
    encoding: normalizeMdictEncoding(attributes.Encoding),
    encrypted,
    keyCaseSensitive: yesNo(attributes.KeyCaseSensitive, false),
    stripKey: yesNo(attributes.StripKey, false),
    compact: cleanText(attributes.Compact || "No"),
    compat: cleanText(attributes.Compat || "No"),
    styleSheet,
    styleSheetRules: parseStyleSheet(styleSheet),
    headerChecksum,
    attributes
  };
}

export function normalizeRichMdictLookupKey(value, header) {
  let key = String(value).normalize("NFKC");
  if (!header.keyCaseSensitive) key = key.toLowerCase();
  if (header.stripKey) key = key.replace(/[\p{P}\p{Z}\s]/gu, "");
  return key;
}

function isSupportedRequiredEngineVersion(value) {
  if (!value) return true;
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) return false;
  const version = Number(value);
  return Number.isFinite(version) && version > 0 && version <= 2;
}

function parseStyleSheet(value) {
  const text = String(value || "");
  if (!text.trim()) return [];
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  while (
    lines.at(-1) === "" &&
    (lines.length - 1) % 3 !== 2
  ) lines.pop();
  if (lines.length % 3 !== 0 || lines.length / 3 > 255) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict StyleSheet metadata is malformed."
    );
  }
  const rules = [];
  const seen = new Set();
  for (let index = 0; index < lines.length; index += 3) {
    const id = Number(lines[index]);
    if (!Number.isInteger(id) || id < 1 || id > 255 || seen.has(id)) {
      mdictFail(
        MDICT_IMPORT_ERROR.CORRUPT,
        "MDict StyleSheet rule identifier is invalid."
      );
    }
    seen.add(id);
    rules.push({ id, begin: lines[index + 1], end: lines[index + 2] });
  }
  return rules;
}

function yesNo(value, defaultValue) {
  if (value == null || value === "") return defaultValue;
  if (/^yes$/iu.test(String(value))) return true;
  if (/^no$/iu.test(String(value))) return false;
  mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict key option is invalid.");
}

function cleanText(value) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/gu, " ")
    .trim()
    .slice(0, 4096);
}
