import { importLocalDictionaryTflex } from "../api.js";
import {
  STARDICT_IMPORT_LIMITS
} from "./stardict-core.js";
import {
  buildStarDictPlainLocalTflex
} from "./stardict-local-adapter.js";

export async function importStarDictPlainDictionary({
  ifoBytes,
  idxBytes,
  dictBytes,
  synBytes,
  recipe,
  requestId,
  limits = STARDICT_IMPORT_LIMITS,
  cryptoProvider = globalThis.crypto,
  importTflex = importLocalDictionaryTflex
} = {}) {
  if (typeof importTflex !== "function") {
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
  const result = await importTflex({
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
