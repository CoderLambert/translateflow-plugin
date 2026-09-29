export const CURATED_RECIPE_SCHEMA_VERSION = 1;

export const CURATED_IMPORTER_TYPES = Object.freeze({
  ECDICT_CSV_V1: "ecdict-csv-v1"
});

export const CURATED_DICTIONARY_IDS = Object.freeze({
  ECDICT_EN_ZH: "ecdict-en-zh-curated"
});

const ECDICT_COMMIT =
  "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b";

const ECDICT_RECIPE = Object.freeze({
  schemaVersion: CURATED_RECIPE_SCHEMA_VERSION,
  id: CURATED_DICTIONARY_IDS.ECDICT_EN_ZH,
  label: "ECDICT 高频英汉",
  description:
    "从 ECDICT 固定上游版本直接下载，在本机筛选高频/核心词条并转换为离线词典。",
  trustClass: "curated-upstream",
  importerType: CURATED_IMPORTER_TYPES.ECDICT_CSV_V1,
  displayFormat: "ecdict-csv",
  publisher: "ECDICT / skywind3000",
  upstreamRepository: "https://github.com/skywind3000/ECDICT",
  upstreamRevision: ECDICT_COMMIT,
  upstreamBlobSha1:
    "c4ade63ea08cf39d9c3475e96929036d64d94c94",
  sourceLicenseLabel:
    "MIT（上游仓库）；词条内容来源需按上游说明理解",
  sourceLicenseUrl:
    `https://github.com/skywind3000/ECDICT/blob/${ECDICT_COMMIT}/LICENSE`,
  originPattern: "https://raw.githubusercontent.com/*",
  downloadUrl:
    `https://raw.githubusercontent.com/skywind3000/ECDICT/${ECDICT_COMMIT}/ecdict.csv`,
  downloadBytes: 65_933_428,
  sourceFormat: "ECDICT CSV",
  languageDirection: "en -> zh-CN",
  selection: Object.freeze({
    maxRecords: 35_000,
    maxSourceBytes: 64 * 1024 * 1024,
    maxHeadwordChars: 120,
    maxTranslationChars: 16_384
  }),
  output: Object.freeze({
    packId: "local-curated-ecdict-en-zh",
    packVersion: "2025-03-28-bc015ed2",
    sourceId: "ecdict",
    sourceVersion: ECDICT_COMMIT
  })
});

export const CURATED_DICTIONARIES = Object.freeze([
  validateCuratedDictionaryRecipe(ECDICT_RECIPE)
]);

export function getCuratedDictionary(id) {
  const normalized = String(id || "").trim();
  return CURATED_DICTIONARIES.find(
    (source) => source.id === normalized
  ) || null;
}

export function assertDeclaredCuratedDictionary(source) {
  const declared = getCuratedDictionary(source?.id);
  if (!declared || source !== declared) {
    throw new Error(
      "Curated dictionary source is not an extension-declared recipe."
    );
  }
  return declared;
}

export function validateCuratedDictionaryRecipe(source) {
  if (
    !source ||
    typeof source !== "object" ||
    Array.isArray(source) ||
    source.schemaVersion !== CURATED_RECIPE_SCHEMA_VERSION
  ) {
    throw new Error(
      "Curated dictionary recipe schemaVersion is unsupported."
    );
  }

  requireId(source.id, "recipe id");
  requireText(source.label, 160, "recipe label");
  requireText(source.description, 600, "recipe description");
  if (source.trustClass !== "curated-upstream") {
    throw new Error(
      "Curated dictionary recipe trustClass is unsupported."
    );
  }
  if (
    !Object.values(CURATED_IMPORTER_TYPES)
      .includes(source.importerType)
  ) {
    throw new Error(
      "Curated dictionary recipe importer is unsupported."
    );
  }

  requireText(source.publisher, 160, "publisher");
  requireHttpsUrl(
    source.upstreamRepository,
    "upstream repository"
  );
  requireText(
    source.upstreamRevision,
    160,
    "upstream revision"
  );
  requireText(
    source.sourceLicenseLabel,
    240,
    "source license label"
  );
  requireHttpsUrl(
    source.sourceLicenseUrl,
    "source license URL"
  );

  const origin = validateExactHttpsOriginPattern(
    source.originPattern
  );
  const download = requireHttpsUrl(
    source.downloadUrl,
    "download URL"
  );
  if (download.origin !== origin) {
    throw new Error(
      "Curated dictionary download URL must stay on its exact approved origin."
    );
  }
  requirePositiveInteger(
    source.downloadBytes,
    "download bytes"
  );

  requireText(source.sourceFormat, 120, "source format");
  requireText(
    source.languageDirection,
    80,
    "language direction"
  );
  requireText(
    source.displayFormat,
    80,
    "display format"
  );

  validateOutput(source.output);
  validateImporterOptions(source);
  return source;
}

function validateImporterOptions(source) {
  if (
    source.importerType !==
      CURATED_IMPORTER_TYPES.ECDICT_CSV_V1
  ) {
    throw new Error(
      "Curated dictionary importer has no extension-owned validator."
    );
  }
  if (
    source.sourceFormat !== "ECDICT CSV" ||
    source.displayFormat !== "ecdict-csv" ||
    source.languageDirection !== "en -> zh-CN" ||
    !/^[a-f0-9]{40}$/u.test(
      String(source.upstreamBlobSha1 || "")
    )
  ) {
    throw new Error(
      "ECDICT curated recipe metadata is invalid."
    );
  }

  const selection = source.selection;
  if (!selection || typeof selection !== "object") {
    throw new Error(
      "ECDICT curated recipe selection policy is required."
    );
  }
  for (const [key, value] of Object.entries({
    maxRecords: selection.maxRecords,
    maxSourceBytes: selection.maxSourceBytes,
    maxHeadwordChars: selection.maxHeadwordChars,
    maxTranslationChars: selection.maxTranslationChars
  })) {
    requirePositiveInteger(
      value,
      "ECDICT selection " + key
    );
  }
  if (source.downloadBytes > selection.maxSourceBytes) {
    throw new Error(
      "ECDICT locked download exceeds its source byte budget."
    );
  }
}

function validateOutput(output) {
  if (!output || typeof output !== "object") {
    throw new Error(
      "Curated dictionary output contract is required."
    );
  }
  requireId(output.packId, "output packId");
  requireId(output.sourceId, "output sourceId");
  requireText(
    output.packVersion,
    120,
    "output packVersion"
  );
  requireText(
    output.sourceVersion,
    160,
    "output sourceVersion"
  );
}

function validateExactHttpsOriginPattern(value) {
  const pattern = String(value || "");
  if (!pattern.endsWith("/*")) {
    throw new Error(
      "Curated dictionary origin pattern is invalid."
    );
  }
  let url;
  try {
    url = new URL(pattern.slice(0, -1));
  } catch {
    throw new Error(
      "Curated dictionary origin pattern is invalid."
    );
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.hostname.includes("*") ||
    pattern !== url.origin + "/*"
  ) {
    throw new Error(
      "Curated dictionary origin must be one exact HTTPS host."
    );
  }
  return url.origin;
}

function requireHttpsUrl(value, label) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error(
      "Curated dictionary " + label + " is invalid."
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "Curated dictionary " + label + " must use HTTPS."
    );
  }
  return url;
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      "Curated dictionary " + label + " is invalid."
    );
  }
}

function requireId(value, label) {
  const text = String(value || "");
  if (
    !/^[a-z0-9](?:[a-z0-9._-]{0,118}[a-z0-9])?$/u.test(
      text
    )
  ) {
    throw new Error(
      "Curated dictionary " + label + " is invalid."
    );
  }
}

function requireText(value, maxChars, label) {
  const text = String(value || "").trim();
  if (
    !text ||
    text.length > maxChars ||
    /[\u0000-\u001f\u007f]/u.test(text)
  ) {
    throw new Error(
      "Curated dictionary " + label + " is invalid."
    );
  }
}
