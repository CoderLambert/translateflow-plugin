export function normalizeOriginList(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.length > 8) {
    throw catalogError("CATALOG_ORIGIN", `${label} is invalid.`);
  }
  const origins = value.map((item) => {
    let url;
    try { url = new URL(String(item)); } catch { throw catalogError("CATALOG_ORIGIN", `${label} contains an invalid origin.`); }
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash || item !== url.origin) {
      throw catalogError("CATALOG_ORIGIN", `${label} must contain exact HTTPS origins only.`);
    }
    return url.origin;
  });
  if (new Set(origins).size !== origins.length) throw catalogError("CATALOG_ORIGIN", `${label} contains duplicate origins.`);
  return origins;
}

export function requireExactKeys(value, keys, label) {
  requireObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw catalogError("CATALOG_SCHEMA", `Dictionary ${label} fields are invalid.`);
  }
}

export function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw catalogError("CATALOG_SCHEMA", `Dictionary ${label} must be an object.`);
  }
}

export function requireIdentifier(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9](?:[a-z0-9._-]{0,118}[a-z0-9])?$/u.test(value)) {
    throw catalogError("CATALOG_SCHEMA", `Dictionary ${label} is invalid.`);
  }
}

export function requireText(value, maximum, label) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum ||
      /[\u0000-\u001f\u007f]/u.test(value)) {
    throw catalogError("CATALOG_SCHEMA", `Dictionary ${label} is invalid.`);
  }
}

export function requireNullableText(value, maximum, label) {
  if (value === null) return;
  requireText(value, maximum, label);
}

export function requireHttpsUrl(value, label) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw catalogError("CATALOG_SCHEMA", `Dictionary ${label} is invalid.`); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw catalogError("CATALOG_SCHEMA", `Dictionary ${label} must use HTTPS.`);
  }
  return url;
}

export function requireLanguageCode(value, label) {
  if (typeof value !== "string" || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(value)) {
    throw catalogError("CATALOG_SCHEMA", `Dictionary ${label} code is invalid.`);
  }
}

export function requireDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
      Number.isNaN(Date.parse(value + "T00:00:00Z")) || new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value) {
    throw catalogError("CATALOG_SCHEMA", `Dictionary ${label} is invalid.`);
  }
}

export function requireNullableDate(value, label) {
  if (value !== null) requireDate(value, label);
}

export function validateTextList(value, maximumCount, maximumText, label) {
  if (!Array.isArray(value) || value.length > maximumCount) throw catalogError("CATALOG_SCHEMA", `Dictionary ${label} are invalid.`);
  value.forEach((item) => requireText(item, maximumText, label));
}

export function sameJsonValue(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((item, index) => sameJsonValue(item, right[index]));
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
    key === rightKeys[index] && sameJsonValue(left[key], right[key]));
}

export function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function catalogError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
