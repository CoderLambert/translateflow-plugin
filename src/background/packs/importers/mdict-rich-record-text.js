import {
  MDICT_IMPORT_ERROR,
  MDICT_IMPORT_LIMITS,
  mdictFail,
  requireMdictAtMost
} from "./mdict-contract.js";
import {
  decodeMdictText,
  validateMdictHeadword
} from "./mdict-metadata.js";

const ENTITY = /&((?:amp|lt|gt|quot|apos|nbsp|ensp|emsp|thinsp|ldquo|rdquo|lsquo|rsquo|mdash|ndash|hellip|#\d+|#x[0-9a-f]+));/giu;
const ACTIVE_TAGS = new Set(["script", "style", "iframe", "object", "embed", "form"]);
const BREAK_TAGS = new Set(["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"]);
const ENTITY_MAP = Object.freeze({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  mdash: "—",
  ndash: "–",
  hellip: "…"
});

export function decodeRichMdictRecordText(bytes, encodingName, displayForm, limits) {
  const unitBytes = encodingName === "UTF-16" ? 2 : 1;
  let value = bytes;
  while (value.byteLength >= unitBytes) {
    const tail = value.subarray(value.byteLength - unitBytes);
    if (!tail.every((byte) => byte === 0)) break;
    value = value.subarray(0, value.byteLength - unitBytes);
  }
  if (!value.byteLength) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict record is empty.", { displayForm });
  }
  const encoding = encodingName === "UTF-8"
    ? { name: "UTF-8", decoder: new TextDecoder("utf-8", { fatal: true }) }
    : { name: "UTF-16", decoder: new TextDecoder("utf-16le", { fatal: true }) };
  const text = decodeMdictText(value, encoding, "MDict record");
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)) {
    mdictFail(MDICT_IMPORT_ERROR.UNSAFE_CONTENT, "MDict record contains unsafe control characters.", { displayForm });
  }
  requireMdictAtMost(
    new TextEncoder().encode(text).byteLength,
    limits.expandedTextBytes || limits.entryBytes,
    "MDict decoded record text bytes"
  );
  return text.trim();
}

export function validateRichMdictAliasTarget(target, limits) {
  if (!target || /[\u0000-\u001F\u007F]/u.test(target)) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict alias target is invalid.");
  }
  requireMdictAtMost(new TextEncoder().encode(target).byteLength, limits.headwordBytes, "MDict alias target bytes");
  validateMdictHeadword(target);
}

export function toSafeRichMdictPlainText(value, header, maximumBytes = MDICT_IMPORT_LIMITS.entryBytes) {
  const markerIds = header?.styleSheetRules?.map((rule) => rule.id) || [];
  const markerPattern = markerIds.length
    ? new RegExp("`(?:" + markerIds.join("|") + ")`", "gu")
    : null;
  const withoutKnownMarkers = markerPattern
    ? String(value).replace(markerPattern, "")
    : String(value);
  const text = stripMarkupLinearly(withoutKnownMarkers)
    .replace(ENTITY, decodeEntity)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, " ");
  return clipUtf8Bytes(text
    .split("\n")
    .map((line) => line.replace(/[\t \u00a0]+/gu, " ").trim())
    .filter(Boolean)
    .join("\n"), maximumBytes);
}

function clipUtf8Bytes(value, maximumBytes) {
  let bytes = 0;
  let end = 0;
  const text = String(value);
  while (end < text.length) {
    const code = text.codePointAt(end);
    const size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes + size > maximumBytes) break;
    bytes += size;
    end += code > 0xffff ? 2 : 1;
  }
  return text.slice(0, end);
}

function stripMarkupLinearly(value) {
  const source = String(value);
  let output = "";
  let activeTag = "";
  for (let offset = 0; offset < source.length;) {
    if (activeTag) {
      if (source[offset] === "<") {
        const token = scanTag(source, offset);
        if (token) {
          if (token.closing && token.name === activeTag) activeTag = "";
          offset = token.end + 1;
          continue;
        }
      }
      offset += 1;
      continue;
    }
    if (source[offset] !== "<") {
      output += source[offset];
      offset += 1;
      continue;
    }
    if (source.startsWith("<!--", offset)) {
      offset = skipComment(source, offset + 4);
      continue;
    }
    const token = scanTag(source, offset);
    if (!token) {
      output += "<";
      offset += 1;
      continue;
    }
    if (!token.closing && ACTIVE_TAGS.has(token.name)) {
      activeTag = token.name;
    } else if (
      token.name === "br" ||
      (token.closing && BREAK_TAGS.has(token.name))
    ) {
      output += "\n";
    } else {
      output += " ";
    }
    offset = token.end + 1;
  }
  return output;
}

function scanTag(source, start) {
  const next = source[start + 1];
  if (!next || !(next === "/" || next === "!" || /[a-z]/iu.test(next))) return null;
  let end = start + 1;
  while (end < source.length) {
    if (source[end] === ">") break;
    if (source[end] === "<") return null;
    end += 1;
  }
  if (end >= source.length) return null;

  let cursor = start + 1;
  while (/\s/u.test(source[cursor] || "")) cursor += 1;
  let closing = false;
  if (source[cursor] === "/") {
    closing = true;
    cursor += 1;
    while (/\s/u.test(source[cursor] || "")) cursor += 1;
  }
  const nameStart = cursor;
  while (/[a-z0-9-]/iu.test(source[cursor] || "")) cursor += 1;
  if (cursor === nameStart) return { end, name: "", closing };
  return {
    end,
    name: source.slice(nameStart, cursor).toLowerCase(),
    closing
  };
}

function skipComment(source, offset) {
  while (offset < source.length) {
    if (
      source[offset] === "-" &&
      source[offset + 1] === "-" &&
      source[offset + 2] === ">"
    ) return offset + 3;
    offset += 1;
  }
  return source.length;
}

function decodeEntity(full, token) {
  const lower = token.toLowerCase();
  if (Object.hasOwn(ENTITY_MAP, lower)) return ENTITY_MAP[lower];
  const hex = lower.startsWith("#x");
  const numeric = Number.parseInt(lower.slice(hex ? 2 : 1), hex ? 16 : 10);
  if (
    !Number.isInteger(numeric) ||
    numeric <= 0 ||
    numeric > 0x10ffff ||
    (numeric >= 0xd800 && numeric <= 0xdfff)
  ) return "�";
  return String.fromCodePoint(numeric);
}
