import {
  STARDICT_IMPORT_ERROR, STARDICT_IMPORT_LIMITS, StarDictImportError,
  parseStarDictIfo
} from "./importers/stardict-core.js";
import { parseStarDictIndex, parseStarDictSynonyms } from "./importers/stardict-binary.js";
import {
  inspectStarDictDictzipHeaderPrefix,
  parseStarDictDictzipHeader
} from "./importers/stardict-dictzip.js";
import { basePreflightResult, isPreflightAbort, preflightAbortError,
  preflightExtension, readPreflightBytes, readPreflightRange, readPreflightUtf8, reason,
  assertPreflightFileLimit, safeFileLabel } from "./local-dictionary-preflight-contract.js";

export async function preflightStarDictFiles({ files, sourceBytes, signal }) {
  const relevant = files.filter((file) => /\.(?:ifo|idx|dict|dict\.dz|syn)$/iu.test(file.name));
  if (!relevant.length) return null;
  const ifos = relevant.filter((file) => preflightExtension(file.name) === ".ifo");
  if (ifos.length > 1) {
    return basePreflightResult({
      family: "stardict",
      files,
      sourceBytes,
      status: "invalid",
      reason: reason("stardict.multiple_ifo")
    });
  }
  const ifo = ifos[0];
  if (!ifo) {
    return basePreflightResult({
      family: "stardict",
      files,
      sourceBytes,
      status: "partial",
      reason: reason("stardict.ifo_missing"),
      route: { importer: "stardict", requiresSemanticConfirmation: true }
    });
  }

  const stem = ifo.name.slice(0, -4).toLocaleLowerCase("en-US");
  const sameStem = relevant.filter((file) =>
    stemOfStarDict(file.name) === stem
  );
  const unassociated = files.filter((file) => !sameStem.includes(file));
  const byExt = new Map();
  for (const file of sameStem) {
    const ext = stardictExtension(file.name);
    const list = byExt.get(ext) || [];
    list.push(file);
    byExt.set(ext, list);
  }
  if ([".ifo", ".idx", ".dict", ".dict.dz", ".syn"].some((ext) => (byExt.get(ext)?.length || 0) > 1)) {
    return basePreflightResult({
      family: "stardict",
      files,
      sourceBytes,
      status: "invalid",
      reason: reason("stardict.duplicate_component")
    });
  }
  if (byExt.has(".dict") && byExt.has(".dict.dz")) {
    return basePreflightResult({
      family: "stardict",
      files,
      sourceBytes,
      status: "invalid",
      reason: reason("stardict.ambiguous_dictionary_data")
    });
  }

  try {
    assertPreflightFileLimit(ifo, STARDICT_IMPORT_LIMITS.ifoBytes, "stardict.ifo_too_large");
    const ifoText = await readPreflightUtf8(ifo, signal, STARDICT_IMPORT_LIMITS.ifoBytes);
    const metadata = parseStarDictIfo(ifoText);
    const idx = byExt.get(".idx")?.[0];
    const dict = byExt.get(".dict")?.[0];
    const dictzip = byExt.get(".dict.dz")?.[0];
    const syn = byExt.get(".syn")?.[0];
    if (!idx || (!dict && !dictzip)) {
      return basePreflightResult({
        family: "stardict",
        files,
        sourceBytes,
        status: "partial",
        displayTitle: metadata.bookname,
        entryCount: metadata.wordcount,
        reason: reason(!idx ? "stardict.idx_missing" : "stardict.dictionary_data_missing"),
        route: { importer: "stardict", requiresSemanticConfirmation: true },
        unassociatedFiles: unassociated,
        missingCompanionHints: [
          ...(!idx ? [safeFileLabel(`${ifo.name.slice(0, -4)}.idx`)] : []),
          ...(!dict && !dictzip ? [safeFileLabel(`${ifo.name.slice(0, -4)}.dict or ${ifo.name.slice(0, -4)}.dict.dz`)] : [])
        ]
      });
    }
    if (!idx.size || idx.size > STARDICT_IMPORT_LIMITS.idxBytes) {
      throw new StarDictImportError(STARDICT_IMPORT_ERROR.LIMIT, "IDX exceeds preflight limit.");
    }
    if (dict && dict.size > STARDICT_IMPORT_LIMITS.dictBytes) {
      throw new StarDictImportError(STARDICT_IMPORT_ERROR.LIMIT, "DICT exceeds preflight limit.");
    }
    if (dictzip && dictzip.size > STARDICT_IMPORT_LIMITS.dictArchiveBytes) {
      throw new StarDictImportError(STARDICT_IMPORT_ERROR.LIMIT, "DICT.DZ exceeds preflight limit.");
    }
    if (syn && syn.size > STARDICT_IMPORT_LIMITS.synBytes) {
      throw new StarDictImportError(STARDICT_IMPORT_ERROR.LIMIT, "SYN exceeds preflight limit.");
    }

    const idxBytes = await readPreflightBytes(idx, signal, STARDICT_IMPORT_LIMITS.idxBytes);
    parseStarDictIndex(idxBytes, {
      wordCount: metadata.wordcount,
      // For DICT.DZ the uncompressed size is not known without extracting it.
      // Keep offset checks within the import ceiling and defer exact checks to import.
      dictBytes: dict?.size ?? STARDICT_IMPORT_LIMITS.dictBytes
    });
    if (syn) {
      const synBytes = await readPreflightBytes(syn, signal, STARDICT_IMPORT_LIMITS.synBytes);
      parseStarDictSynonyms(synBytes, {
        synonymCount: metadata.synwordcount,
        wordCount: metadata.wordcount
      });
    } else if (metadata.synwordcount > 0) {
      return basePreflightResult({
        family: "stardict",
        files,
        sourceBytes,
        status: "partial",
        displayTitle: metadata.bookname,
        entryCount: metadata.wordcount,
        reason: reason("stardict.syn_missing"),
        route: { importer: "stardict", requiresSemanticConfirmation: true },
        unassociatedFiles: unassociated,
        missingCompanionHints: [safeFileLabel(`${ifo.name.slice(0, -4)}.syn`)]
      });
    }
    if (dictzip) {
      const fixedHeader = await readPreflightRange(dictzip, 0, Math.min(dictzip.size, 12), signal);
      const { headerBytes } = inspectStarDictDictzipHeaderPrefix(fixedHeader);
      if (headerBytes > dictzip.size) {
        throw new StarDictImportError(STARDICT_IMPORT_ERROR.CORRUPT, "DICT.DZ header exceeds the selected file.");
      }
      const header = await readPreflightRange(dictzip, 0, headerBytes, signal);
      parseStarDictDictzipHeader(header);
    }

    return basePreflightResult({
      family: "stardict",
      files,
      sourceBytes,
      status: unassociated.length ? "partial" : "supported",
      displayTitle: metadata.bookname,
      entryCount: metadata.wordcount,
      reason: unassociated.length ? reason("stardict.unassociated_files") : null,
      warnings: [reason("stardict.semantic_recipe_required")],
      route: { importer: "stardict", requiresSemanticConfirmation: true },
      unassociatedFiles: unassociated
    });
  } catch (error) {
    if (isPreflightAbort(error, signal)) throw preflightAbortError();
    const unsupported = error instanceof StarDictImportError &&
      error.code === STARDICT_IMPORT_ERROR.UNSUPPORTED;
    return basePreflightResult({
      family: "stardict",
      files,
      sourceBytes,
      status: unsupported || error?.code === STARDICT_IMPORT_ERROR.LIMIT || error?.preflightReason
        ? "unsupported" : "invalid",
      reason: reason(mapStarDictError(error)),
      route: { importer: unsupported ? "none" : "stardict", requiresSemanticConfirmation: true }
    });
  }
}

function mapStarDictError(error) {
  if (error?.preflightReason) return error.preflightReason;
  if (error instanceof StarDictImportError) {
    if (error.code === STARDICT_IMPORT_ERROR.UNSUPPORTED) return "stardict.capability_unsupported";
    if (error.code === STARDICT_IMPORT_ERROR.LIMIT) return "stardict.preflight_limit_exceeded";
    if (error.code === STARDICT_IMPORT_ERROR.UNSAFE_CONTENT) return "stardict.unsafe_content";
  }
  return "stardict.corrupt_or_malformed";
}

function stardictExtension(name) {
  const lower = name.toLocaleLowerCase("en-US");
  if (lower.endsWith(".dict.dz")) return ".dict.dz";
  return lower.slice(lower.lastIndexOf("."));
}

function stemOfStarDict(name) {
  const ext = stardictExtension(name);
  return name.slice(0, -ext.length).toLocaleLowerCase("en-US");
}
