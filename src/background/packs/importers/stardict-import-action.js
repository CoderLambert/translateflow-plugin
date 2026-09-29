import { importLocalDictionaryTflex } from "../api.js";
import {
  STARDICT_IMPORT_LIMITS
} from "./stardict-core.js";
import {
  buildStarDictDictzipLocalTflex,
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
  const built = await buildStarDictPlainLocalTflex({
    ifoBytes,
    idxBytes,
    dictBytes,
    synBytes,
    recipe,
    limits,
    cryptoProvider
  });
  return commitBuiltPack({
    built,
    requestId,
    importTflex
  });
}

export async function importStarDictDictzipDictionary({
  ifoBytes,
  idxBytes,
  dictzipBlob,
  synBytes,
  recipe,
  requestId,
  limits = STARDICT_IMPORT_LIMITS,
  signal,
  cryptoProvider = globalThis.crypto,
  decompressionStreamFactory,
  importTflex = importLocalDictionaryTflex
} = {}) {
  const built = await buildStarDictDictzipLocalTflex({
    ifoBytes,
    idxBytes,
    dictzipBlob,
    synBytes,
    recipe,
    limits,
    signal,
    cryptoProvider,
    ...(decompressionStreamFactory
      ? { decompressionStreamFactory }
      : {})
  });
  if (signal?.aborted) {
    throw new DOMException(
      "StarDict dictionary import cancelled.",
      "AbortError"
    );
  }
  return commitBuiltPack({
    built,
    requestId,
    importTflex
  });
}

async function commitBuiltPack({
  built,
  requestId,
  importTflex
}) {
  if (typeof importTflex !== "function") {
    throw new Error(
      "StarDict import requires a local TFLex transaction"
    );
  }
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
      built.manifest.sourceAliasCount,
    ...(built.compression
      ? { compression: built.compression }
      : {})
  };
}
