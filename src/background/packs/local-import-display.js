const FORMAT_LABELS = Object.freeze({
  stardict: "StarDict",
  mdict: "MDict"
});

export function normalizeLocalImportDisplayMetadata(
  input,
  { now = Date.now } = {}
) {
  if (input === undefined || input === null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Local dictionary display metadata must be an object.");
  }

  const name = String(input.name || "").trim();
  if (
    !name ||
    name.length > 160 ||
    /[\u0000-\u001f\u007f]/u.test(name)
  ) {
    throw new Error("Local dictionary display name is invalid.");
  }

  const format = String(input.format || "").toLowerCase();
  if (!Object.hasOwn(FORMAT_LABELS, format)) {
    throw new Error("Local dictionary display format is unsupported.");
  }

  const importedAt = Number(now());
  if (!Number.isSafeInteger(importedAt) || importedAt <= 0) {
    throw new Error("Local dictionary import timestamp is invalid.");
  }

  return Object.freeze({
    kind: "local-import",
    name,
    format,
    formatLabel: FORMAT_LABELS[format],
    trust: "user-provided-unverified",
    importedAt
  });
}

export function publicLocalImportDisplayMetadata(value) {
  if (
    !value ||
    value.kind !== "local-import" ||
    value.trust !== "user-provided-unverified" ||
    typeof value.name !== "string" ||
    !Object.hasOwn(FORMAT_LABELS, value.format)
  ) {
    return null;
  }

  return {
    kind: "local-import",
    name: value.name,
    format: value.format,
    formatLabel: FORMAT_LABELS[value.format],
    trust: "user-provided-unverified",
    importedAt: Number(value.importedAt || 0)
  };
}
