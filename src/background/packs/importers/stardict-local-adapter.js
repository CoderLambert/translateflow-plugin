import {
  STARDICT_IMPORT_ERROR,
  STARDICT_IMPORT_LIMITS,
  projectStarDictPlainText
} from "./stardict-core.js";
import {
  decodeStarDictUtf8,
  requireStarDictAtMost,
  starDictBytes,
  starDictFail
} from "./stardict-contract.js";
import {
  buildStarDictTflexRecords,
  makeStarDictLocalSource,
  validateStarDictImportRecipe
} from "./stardict-semantic.js";
import { buildLocalIndexedTflex } from "./tflex-local-builder.js";

export async function buildStarDictPlainLocalTflex({
  ifoBytes,
  idxBytes,
  dictBytes,
  synBytes,
  recipe,
  limits = STARDICT_IMPORT_LIMITS,
  cryptoProvider = globalThis.crypto
} = {}) {
  const normalized = normalizePlainInputs({
    ifoBytes,
    idxBytes,
    dictBytes,
    synBytes,
    limits
  });
  const checkedRecipe =
    validateStarDictImportRecipe(recipe);
  const projection = projectStarDictPlainText({
    ifoText: decodeStarDictUtf8(
      normalized.ifoBytes,
      "IFO"
    ),
    idxBytes: normalized.idxBytes,
    dictBytes: normalized.dictBytes,
    synBytes: normalized.synBytes,
    sourceId: checkedRecipe.dictionary.sourceId,
    sourceVersion:
      checkedRecipe.dictionary.sourceVersion,
    limits
  });
  return buildStarDictLocalTflexFromProjection({
    projection,
    recipe: checkedRecipe,
    cryptoProvider
  });
}

export async function buildStarDictLocalTflexFromProjection({
  projection,
  recipe,
  cryptoProvider = globalThis.crypto
} = {}) {
  const checkedRecipe =
    validateStarDictImportRecipe(recipe);
  const source = makeStarDictLocalSource(
    checkedRecipe,
    projection?.dictionary
  );
  const records = buildStarDictTflexRecords(
    projection?.entries,
    checkedRecipe
  );
  if (!records.length) {
    throw new Error(
      "StarDict TFLex import produced no records"
    );
  }

  const built = await buildLocalIndexedTflex({
    packId: checkedRecipe.packId,
    packVersion: checkedRecipe.packVersion,
    semanticProfile:
      checkedRecipe.semanticProfile,
    sourceLanguage:
      checkedRecipe.sourceLanguage,
    targetLanguage:
      checkedRecipe.targetLanguage,
    records,
    sources: [source],
    sourceEntryCount: projection.entries.length,
    sourceAliasCount: projection.entries.reduce(
      (count, entry) =>
        count +
        (Array.isArray(entry.aliases)
          ? entry.aliases.length
          : 0),
      0
    ),
    cryptoProvider
  });

  return {
    ...built,
    projection,
    recipe: checkedRecipe
  };
}

export async function importStarDictPlainDictionary({
  ifoBytes,
  idxBytes,
  dictBytes,
  synBytes,
  recipe,
  requestId,
  limits = STARDICT_IMPORT_LIMITS,
  cryptoProvider = globalThis.crypto,
  importTflex
} = {}) {
  const transaction =
    typeof importTflex === "function"
      ? importTflex
      : (await import("../api.js")).importLocalDictionaryTflex;
  if (typeof transaction !== "function") {
    throw new Error(
      "StarDict import requires a local TFLex transaction"
    );
  }
  const built = await buildStarDictPlainLocalTflex({
    ifoBytes,
    idxBytes,
    dictBytes,
    synBytes,
    recipe,
    limits,
    cryptoProvider
  });
  const result = await transaction({
    files: built.files,
    requestId
  });
  return {
    ...result,
    packId: built.manifest.packId,
    packVersion: built.manifest.packVersion,
    fingerprint: built.manifest.fingerprint,
    sourceEntryCount:
      built.manifest.sourceEntryCount,
    sourceAliasCount:
      built.manifest.sourceAliasCount
  };
}

function normalizePlainInputs({
  ifoBytes,
  idxBytes,
  dictBytes,
  synBytes,
  limits
}) {
  const ifo = starDictBytes(ifoBytes, "IFO");
  const idx = starDictBytes(idxBytes, "IDX");
  const dict = starDictBytes(dictBytes, "DICT");
  const syn =
    synBytes === undefined || synBytes === null
      ? undefined
      : starDictBytes(synBytes, "SYN");

  requireStarDictAtMost(
    ifo.byteLength,
    limits.ifoBytes,
    "IFO bytes"
  );
  requireStarDictAtMost(
    idx.byteLength,
    limits.idxBytes,
    "IDX bytes"
  );
  requireStarDictAtMost(
    dict.byteLength,
    limits.dictBytes,
    "DICT bytes"
  );
  if (syn) {
    requireStarDictAtMost(
      syn.byteLength,
      limits.synBytes,
      "SYN bytes"
    );
  }

  if (
    dict.byteLength >= 3 &&
    dict[0] === 0x1f &&
    dict[1] === 0x8b &&
    dict[2] === 8
  ) {
    starDictFail(
      STARDICT_IMPORT_ERROR.UNSUPPORTED,
      "Compressed StarDict .dict.dz must use the separate bounded browser decompression adapter."
    );
  }

  return {
    ifoBytes: new Uint8Array(ifo),
    idxBytes: new Uint8Array(idx),
    dictBytes: new Uint8Array(dict),
    ...(syn ? { synBytes: new Uint8Array(syn) } : {})
  };
}
