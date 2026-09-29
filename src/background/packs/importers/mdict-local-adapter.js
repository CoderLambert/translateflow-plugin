import {
  MDICT_IMPORT_LIMITS,
  projectMdictV2PlainText
} from "./mdict-core.js";
import {
  buildMdictTflexRecords,
  makeMdictLocalSource,
  validateMdictImportRecipe
} from "./mdict-semantic.js";
import { buildLocalIndexedTflex } from "./tflex-local-builder.js";

export async function buildMdictLocalTflex({
  mdxBytes,
  recipe,
  limits = MDICT_IMPORT_LIMITS,
  signal,
  cryptoProvider = globalThis.crypto,
  decompressionStreamFactory
} = {}) {
  assertImportActive(signal);
  const checkedRecipe =
    validateMdictImportRecipe(recipe);
  const projection = await projectMdictV2PlainText({
    mdxBytes,
    sourceId: checkedRecipe.dictionary.sourceId,
    sourceVersion:
      checkedRecipe.dictionary.sourceVersion,
    limits,
    ...(decompressionStreamFactory
      ? { decompressionStreamFactory }
      : {})
  });
  assertImportActive(signal);

  const source = await makeMdictLocalSource(
    checkedRecipe,
    projection.dictionary,
    mdxBytes,
    cryptoProvider
  );
  const records = buildMdictTflexRecords(
    projection.entries,
    checkedRecipe
  );
  assertImportActive(signal);
  if (!records.length) {
    throw new Error("MDict TFLex import produced no records");
  }

  const built = await buildLocalIndexedTflex({
    packId: checkedRecipe.packId,
    packVersion: checkedRecipe.packVersion,
    semanticProfile: checkedRecipe.semanticProfile,
    sourceLanguage: checkedRecipe.sourceLanguage,
    targetLanguage: checkedRecipe.targetLanguage,
    records,
    sources: [source],
    sourceEntryCount: projection.entries.length,
    signal,
    cryptoProvider
  });
  assertImportActive(signal);

  return {
    ...built,
    projection,
    recipe: checkedRecipe,
    metrics: {
      inputBytes: mdxBytes.byteLength,
      outputBytes: Object.values(built.files)
        .reduce((sum, bytes) => sum + bytes.byteLength, 0),
      records: built.manifest.recordCount
    }
  };
}

function assertImportActive(signal) {
  if (!signal?.aborted) return;
  throw new DOMException(
    "MDict dictionary import cancelled.",
    "AbortError"
  );
}
