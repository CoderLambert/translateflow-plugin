import {
  MDICT_IMPORT_ERROR,
  MDICT_IMPORT_LIMITS,
  MDictCursor,
  adler32,
  mdictFail,
  requireMdictAtMost
} from "./mdict-contract.js";
import {
  parseDictionaryAttributes,
  parseEncryptedFlag
} from "./mdict-metadata.js";

const UTF16LE = new TextDecoder("utf-16le", { fatal: true });

export function parseMddHeader(input, limits = MDICT_IMPORT_LIMITS) {
  const cursor = input instanceof MDictCursor ? input : new MDictCursor(input);
  const byteLength = cursor.readUint32Be("MDD header bytes");
  requireMdictAtMost(byteLength, limits.headerBytes, "MDD header bytes");
  if (byteLength < 4 || byteLength % 2 !== 0) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD UTF-16LE header byte length is invalid.");
  }
  const bytes = cursor.read(byteLength, "MDD header");
  const checksum = cursor.readUint32Le("MDD header checksum");
  if (adler32(bytes) !== checksum) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD header checksum mismatch.");
  }

  let text;
  try {
    text = UTF16LE.decode(bytes).replace(/\u0000+$/gu, "").trim();
  } catch (cause) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD header is not valid UTF-16LE.", { cause });
  }
  const attributes = parseDictionaryAttributes(text, "Library_Data");
  const generatedByEngineVersion = String(attributes.GeneratedByEngineVersion || "");
  if (generatedByEngineVersion !== "2.0") {
    mdictFail(MDICT_IMPORT_ERROR.UNSUPPORTED, "Only MDD v2.0 is supported.", {
      version: generatedByEngineVersion || null
    });
  }
  const requiredEngineVersion = String(attributes.RequiredEngineVersion || "2.0");
  if (!supportedRequiredVersion(requiredEngineVersion)) {
    mdictFail(MDICT_IMPORT_ERROR.UNSUPPORTED, "MDD requires a newer engine version.", {
      requiredEngineVersion
    });
  }
  if (String(attributes.Format || "") !== "") {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD Format metadata must be empty.");
  }
  const encrypted = parseEncryptedFlag(attributes.Encrypted);
  if (encrypted !== 0 && encrypted !== 2) {
    mdictFail(MDICT_IMPORT_ERROR.UNSUPPORTED, "Password-protected MDD resources are unsupported.", {
      encrypted
    });
  }
  const keyCaseSensitive = parseMddYesNo(attributes.KeyCaseSensitive, false);
  return {
    generatedByEngineVersion,
    requiredEngineVersion,
    encrypted,
    keyCaseSensitive,
    title: cleanText(attributes.Title || ""),
    attributes
  };
}

function parseMddYesNo(value, defaultValue) {
  if (value == null || value === "") return defaultValue;
  if (/^yes$/iu.test(String(value))) return true;
  if (/^no$/iu.test(String(value))) return false;
  mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD key option is invalid.");
}

function supportedRequiredVersion(value) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) return false;
  const version = Number(value);
  return Number.isFinite(version) && version > 0 && version <= 2;
}

function cleanText(value) {
  return String(value)
    .replace(/[\u0000-\u001F\u007F]/gu, " ")
    .trim()
    .slice(0, 4096);
}
