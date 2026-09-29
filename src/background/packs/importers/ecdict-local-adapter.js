import {
  LOCAL_IMPORT_SEMANTIC_PROFILE
} from "../local-import.js";
import {
  buildLocalIndexedTflex
} from "./tflex-local-builder.js";
import {
  projectEcdictCuratedCsv
} from "./ecdict-csv.js";

export async function buildEcdictCuratedLocalTflex({
  chunks,
  source,
  signal,
  onProgress,
  cryptoProvider = globalThis.crypto
} = {}) {
  const projection = await projectEcdictCuratedCsv({
    chunks,
    source,
    signal,
    onProgress
  });
  assertActive(signal);

  const built = await buildLocalIndexedTflex({
    packId: source.output.packId,
    packVersion: source.output.packVersion,
    semanticProfile: LOCAL_IMPORT_SEMANTIC_PROFILE,
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    records: projection.records,
    sources: [{
      id: source.output.sourceId,
      version: source.output.sourceVersion,
      provenance: [
        "Curated upstream direct download from ECDICT",
        `revision ${source.upstreamRevision}`,
        `git blob ${source.upstreamBlobSha1}`,
        `source bytes ${projection.stats.inputBytes}`,
        `deterministic retained rows ${projection.stats.retainedRows}`
      ].join("; "),
      semanticProfile: LOCAL_IMPORT_SEMANTIC_PROFILE,
      license: {
        name:
          "Untrusted local projection; upstream repository declares MIT. " +
          "TranslateFlow does not relicense third-party dictionary content."
      }
    }],
    sourceEntryCount: projection.stats.sourceRows,
    sourceAliasCount: 0,
    signal,
    cryptoProvider
  });
  assertActive(signal);

  return {
    ...built,
    projection
  };
}

function assertActive(signal) {
  if (!signal?.aborted) return;
  throw new DOMException(
    "ECDICT curated dictionary install cancelled.",
    "AbortError"
  );
}
