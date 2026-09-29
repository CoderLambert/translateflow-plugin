export const CURATED_DICTIONARY_IDS = Object.freeze({
  ECDICT_EN_ZH: "ecdict-en-zh-curated"
});

const ECDICT_COMMIT =
  "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b";

export const CURATED_DICTIONARIES = Object.freeze([
  Object.freeze({
    id: CURATED_DICTIONARY_IDS.ECDICT_EN_ZH,
    label: "ECDICT 高频英汉",
    description:
      "从 ECDICT 固定上游版本直接下载，在本机筛选高频/核心词条并转换为离线词典。",
    trustClass: "curated-upstream",
    publisher: "ECDICT / skywind3000",
    upstreamRepository: "https://github.com/skywind3000/ECDICT",
    upstreamRevision: ECDICT_COMMIT,
    upstreamBlobSha1: "c4ade63ea08cf39d9c3475e96929036d64d94c94",
    sourceLicenseLabel: "MIT（上游仓库）；词条内容来源需按上游说明理解",
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
  })
]);

export function getCuratedDictionary(id) {
  const normalized = String(id || "").trim();
  return CURATED_DICTIONARIES.find(
    (source) => source.id === normalized
  ) || null;
}
