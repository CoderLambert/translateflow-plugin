import {
  LOCAL_DICTIONARY_PREFLIGHT_LIMITS, LOCAL_DICTIONARY_PREFLIGHT_STATUS,
  assertPreflightActive, basePreflightResult, hasDuplicateFileNames,
  normalizePreflightFiles, preflightExtension, reason
} from "./local-dictionary-preflight-contract.js";
import { preflightMdxFiles } from "./local-dictionary-preflight-mdx.js";
import { preflightStarDictFiles } from "./local-dictionary-preflight-stardict.js";
import { preflightTflexFiles } from "./local-dictionary-preflight-tflex.js";

export { LOCAL_DICTIONARY_PREFLIGHT_STATUS } from "./local-dictionary-preflight-contract.js";

export async function preflightLocalDictionaryFiles({
  files, signal, semanticConfirmation = false, sourceLanguage, targetLanguage
} = {}) {
  assertPreflightActive(signal);
  const selected = normalizePreflightFiles(files);
  const sourceBytes = selected.reduce((sum, file) => sum + file.size, 0);
  if (sourceBytes > LOCAL_DICTIONARY_PREFLIGHT_LIMITS.totalBytes) {
    return basePreflightResult({ family: "unknown", files: selected, sourceBytes,
      status: "unsupported", reason: reason("file_set.limit_exceeded") });
  }
  if (hasDuplicateFileNames(selected)) {
    return basePreflightResult({ family: "unknown", files: selected, sourceBytes,
      status: "invalid", reason: reason("file_set.duplicate_name") });
  }

  const mdxFiles = selected.filter((file) => preflightExtension(file.name) === ".mdx");
  if (mdxFiles.length) {
    if (mdxFiles.length !== 1) {
      return basePreflightResult({ family: "unknown", files: selected, sourceBytes,
        status: "invalid", reason: reason("mdx.multiple_dictionaries") });
    }
    return preflightMdxFiles({ files: selected, mdxFile: mdxFiles[0], sourceBytes,
      signal, semanticConfirmation, sourceLanguage, targetLanguage });
  }

  const mdxCompanions = selected.filter((file) => preflightExtension(file.name) === ".mdd");
  if (mdxCompanions.length) {
    return basePreflightResult({ family: "mdict-rich", files: selected, sourceBytes,
      status: "unsupported", reason: reason("mdd.mdx_required") });
  }

  const starDict = await preflightStarDictFiles({ files: selected, sourceBytes, signal });
  if (starDict) return starDict;
  const tflex = await preflightTflexFiles({ files: selected, sourceBytes, signal });
  if (tflex) return tflex;
  return basePreflightResult({ family: "unknown", files: selected, sourceBytes,
    status: "unsupported", reason: reason("file_set.unrecognized") });
}
