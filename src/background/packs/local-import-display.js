import {
  migrateLegacyCuratedDisplayMetadata,
  validateInstalledCatalogMetadata
} from "../../shared/dictionary-catalog-v2.js";

const FORMAT_LABELS = Object.freeze({
  stardict: "StarDict",
  mdict: "MDict",
  "ecdict-csv": "ECDICT CSV"
});

export function normalizeLocalImportDisplayMetadata(
  input,
  { now = Date.now } = {}
) {
  if (input === undefined || input === null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Local dictionary display metadata must be an object.");
  }

  const name = safeText(
    input.name,
    160,
    "Local dictionary display name"
  );
  const format = String(input.format || "").toLowerCase();
  if (!Object.hasOwn(FORMAT_LABELS, format)) {
    throw new Error("Local dictionary display format is unsupported.");
  }

  const importedAt = Number(now());
  if (!Number.isSafeInteger(importedAt) || importedAt <= 0) {
    throw new Error("Local dictionary import timestamp is invalid.");
  }

  if (input.kind === "curated-upstream") {
    if (format !== "ecdict-csv") {
      throw new Error("Curated dictionary display format is unsupported.");
    }
    const catalog = input.catalog === undefined
      ? migrateLegacyCuratedDisplayMetadata({ kind: input.kind, format })
      : validateInstalledCatalogMetadata(input.catalog);
    if (!catalog || catalog.entryId !== "ecdict-en-zh-curated") {
      throw new Error("Curated dictionary catalog metadata is not extension-declared.");
    }
    return Object.freeze({
      kind: "curated-upstream",
      name,
      format,
      formatLabel: FORMAT_LABELS[format],
      trust: "upstream-community",
      sourceLabel: safeText(
        input.sourceLabel,
        160,
        "Curated dictionary source label"
      ),
      sourceVersion: safeText(
        input.sourceVersion,
        120,
        "Curated dictionary source version"
      ),
      licenseLabel: safeText(
        input.licenseLabel,
        200,
        "Curated dictionary license label"
      ),
      catalog,
      importedAt
    });
  }

  if (format === "ecdict-csv") {
    throw new Error("ECDICT display metadata must be curated-upstream.");
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

export function publicLocalImportDisplayMetadata(value, { installedVersion } = {}) {
  if (
    !value ||
    typeof value.name !== "string" ||
    !Object.hasOwn(FORMAT_LABELS, value.format)
  ) {
    return null;
  }

  if (
    value.kind === "curated-upstream" &&
    value.trust === "upstream-community" &&
    typeof value.sourceLabel === "string" &&
    typeof value.sourceVersion === "string" &&
    typeof value.licenseLabel === "string" &&
    value.format === "ecdict-csv"
  ) {
    let catalog;
    try {
      catalog = value.catalog
        ? validateInstalledCatalogMetadata(value.catalog)
        : migrateLegacyCuratedDisplayMetadata(value, { installedVersion });
    } catch {
      return null;
    }
    if (!catalog || catalog.entryId !== "ecdict-en-zh-curated") return null;
    return {
      kind: "curated-upstream",
      name: value.name,
      format: value.format,
      formatLabel: FORMAT_LABELS[value.format],
      trust: "upstream-community",
      sourceLabel: value.sourceLabel,
      sourceVersion: value.sourceVersion,
      licenseLabel: value.licenseLabel,
      catalog,
      importedAt: Number(value.importedAt || 0)
    };
  }

  if (
    value.kind !== "local-import" ||
    value.trust !== "user-provided-unverified" ||
    value.format === "ecdict-csv"
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

function safeText(value, maxChars, label) {
  const text = String(value || "").trim();
  if (
    !text ||
    text.length > maxChars ||
    /[\u0000-\u001f\u007f]/u.test(text)
  ) {
    throw new Error(label + " is invalid.");
  }
  return text;
}
