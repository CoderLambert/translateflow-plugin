import {
  assertDeclaredCuratedDictionary,
  CURATED_IMPORTER_TYPES
} from "../../../shared/curated-dictionaries.js";
import {
  buildEcdictCuratedLocalTflex
} from "./ecdict-local-adapter.js";
import {
  responseByteChunks
} from "./ecdict-csv.js";

export async function buildCuratedDictionaryLocalTflex({
  response,
  source,
  signal,
  onProgress,
  cryptoProvider = globalThis.crypto
} = {}) {
  const declared =
    assertDeclaredCuratedDictionary(source);

  if (
    declared.importerType ===
    CURATED_IMPORTER_TYPES.ECDICT_CSV_V1
  ) {
    return buildEcdictCuratedLocalTflex({
      chunks: responseByteChunks(response, { signal }),
      source: declared,
      signal,
      onProgress,
      cryptoProvider
    });
  }

  throw new Error(
    "Curated dictionary importer is not implemented by this extension."
  );
}
