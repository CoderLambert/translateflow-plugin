import { byteLength } from "../hash.js";
import { READING_ERROR, READING_LIMITS as L, READING_SCHEMA_VERSION } from "./constants.js";

export class ReadingContractError extends Error {
  constructor(code, path) {
    super(`${code}: ${path}`);
    this.name = "ReadingContractError";
    this.code = code;
    this.path = path;
  }
}

export function fail(code, path) { throw new ReadingContractError(code, path); }
export function object(value, keys, path) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(READING_ERROR.BAD_DTO, path);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(READING_ERROR.BAD_DTO, `${path}.${key}`);
  }
  return value;
}
export function text(value, max, path, { empty = false } = {}) {
  if (typeof value !== "string" || (!empty && !value.trim()) || /[\u0000\u0008\u000b\u000c]/u.test(value)) {
    fail(READING_ERROR.BAD_DTO, path);
  }
  if (value.length > max) fail(READING_ERROR.LIMIT, path);
  return value;
}
export function id(value, path) {
  text(value, L.idChars, path);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)) fail(READING_ERROR.BAD_DTO, path);
  return value;
}
export function recordId(value, path) {
  id(value, path);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    fail(READING_ERROR.BAD_DTO, path);
  }
  return value;
}
export function digest(value, path) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) fail(READING_ERROR.BAD_DTO, path);
  return value;
}
export function integer(value, min, max, path) {
  if (!Number.isSafeInteger(value) || value < min) fail(READING_ERROR.BAD_DTO, path);
  if (value > max) fail(READING_ERROR.LIMIT, path);
  return value;
}
export function bool(value, path) {
  if (typeof value !== "boolean") fail(READING_ERROR.BAD_DTO, path);
  return value;
}
export function choice(value, values, path) {
  if (!values.includes(value)) fail(READING_ERROR.BAD_DTO, path);
  return value;
}
export function nullable(value, validator, path) {
  return value === null ? null : validator(value, path);
}
export function array(value, max, validator, path) {
  if (!Array.isArray(value)) fail(READING_ERROR.BAD_DTO, path);
  if (value.length > max) fail(READING_ERROR.LIMIT, path);
  return value.map((item, index) => validator(item, `${path}[${index}]`));
}
export function version(value, path) {
  if (value !== READING_SCHEMA_VERSION) fail(READING_ERROR.UNSUPPORTED_VERSION, path);
  return value;
}
export function jsonBytes(value, max, path) {
  let serialized;
  try { serialized = JSON.stringify(value); } catch { fail(READING_ERROR.BAD_DTO, path); }
  if (serialized === undefined) fail(READING_ERROR.BAD_DTO, path);
  const bytes = byteLength(serialized);
  if (bytes > max) fail(READING_ERROR.LIMIT, path);
  return bytes;
}
export function pageKey(value, path) {
  if (typeof value !== "string" || !/^rp1:[0-9a-f]{64}$/u.test(value)) fail(READING_ERROR.BAD_DTO, path);
  return value;
}
export function safeReturnUrl(value, path) {
  text(value, L.urlChars, path);
  let url;
  try { url = new URL(value); } catch { fail(READING_ERROR.UNSAFE_URL, path); }
  if (!/^https?:$/u.test(url.protocol) || url.username || url.password) fail(READING_ERROR.UNSAFE_URL, path);
  const sensitive = /(?:token|secret|password|passwd|auth|credential|session|signature|signed|api.?key|email|account|user.?id|code)/iu;
  if ([...url.searchParams.keys()].some((key) => sensitive.test(key)) ||
      /(?:token|secret|password|auth|session|signature|api.?key|email|account|code)[=:]/iu.test(decodeFragment(url.hash)) ||
      /(?:%40|@)/iu.test(url.pathname + url.search + url.hash)) fail(READING_ERROR.UNSAFE_URL, path);
  return value;
}
function decodeFragment(value) {
  try { return decodeURIComponent(value); } catch { fail(READING_ERROR.UNSAFE_URL, "url.fragment"); }
}
