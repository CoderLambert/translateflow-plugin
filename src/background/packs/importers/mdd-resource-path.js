import {
  MDICT_IMPORT_ERROR,
  mdictFail
} from "./mdict-contract.js";

const ENCODED_SEPARATOR_OR_CONTROL = /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/iu;
const CONTROL = /[\u0000-\u001F\u007F]/u;

/** Canonicalize an MDD virtual path without changing its spelling or case. */
export function normalizeMddResourcePath(value) {
  if (typeof value !== "string" || !value || value.length > 4096) {
    unsafePath("MDD resource path is invalid.");
  }
  if (ENCODED_SEPARATOR_OR_CONTROL.test(value)) {
    unsafePath("MDD resource path is unsafe or ambiguous.");
  }

  let path;
  try {
    path = decodeURIComponent(value);
  } catch {
    unsafePath("MDD resource path contains malformed percent encoding.");
  }
  if (
    CONTROL.test(path) ||
    path.includes("%") ||
    path.includes(":") ||
    path.includes("?") ||
    path.includes("#") ||
    /^[a-z][a-z\d+.-]*:/iu.test(path) ||
    /^[a-z]:/iu.test(path) ||
    /^[\\/]{2}/u.test(path) ||
    path.startsWith("\\/") ||
    path.startsWith("/\\")
  ) {
    unsafePath("MDD resource path is unsafe or ambiguous.");
  }

  if (path.startsWith("/") || path.startsWith("\\")) {
    path = path.slice(1);
  }
  path = path.replaceAll("\\", "/");
  if (/^[a-z][a-z\d+.-]*:/iu.test(path) || /^[a-z]:/iu.test(path)) {
    unsafePath("MDD resource path cannot name a URI or drive.");
  }
  const segments = path.split("/");
  if (
    !path ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    unsafePath("MDD resource path contains an invalid segment.");
  }
  return path;
}

/** Match the Unicode code-point ordering used by the independent MDD writer. */
export function compareMddResourcePaths(left, right) {
  let leftOffset = 0;
  let rightOffset = 0;
  while (leftOffset < left.length && rightOffset < right.length) {
    const leftPoint = left.codePointAt(leftOffset);
    const rightPoint = right.codePointAt(rightOffset);
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
    leftOffset += leftPoint > 0xffff ? 2 : 1;
    rightOffset += rightPoint > 0xffff ? 2 : 1;
  }
  if (leftOffset === left.length && rightOffset === right.length) return 0;
  return leftOffset === left.length ? -1 : 1;
}

function unsafePath(message) {
  mdictFail(MDICT_IMPORT_ERROR.UNSAFE_CONTENT, message);
}
