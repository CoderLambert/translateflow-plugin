import {
  MDICT_IMPORT_ERROR,
  MDictImportError
} from "./importers/mdict-contract.js";
import { buildRichMdictIndex } from "./importers/mdict-rich.js";
import { buildMddIndex } from "./importers/mdd.js";
import {
  RICH_MDD_MAX_COMPANIONS,
  RICH_MDD_MAX_SOURCE_BYTES,
  RICH_MDD_MAX_SIDECAR_FILE_BYTES,
  classifyMddSidecarPath,
  validateMddCompanions
} from "./rich-mdd-contract.js";
import { normalizeMddResourcePath } from "./importers/mdd-resource-path.js";
import { makeBoundedFileIdentityHint } from "./local-dictionary-preflight-identity.js";
import { SHIPPED_CAPABILITIES, basePreflightResult, blobRangeSource,
  escapePreflightRegExp, isPreflightAbort, normalizePreflightLanguage,
  preflightAbortError, preflightExtension, reason, safeFileLabel,
  assertPreflightFileLimit, uniqueCapabilities } from "./local-dictionary-preflight-contract.js";

const MDX_EXT = ".mdx";
const MDD_EXT = ".mdd";

export async function preflightMdxFiles({
  files,
  mdxFile,
  sourceBytes,
  signal,
  semanticConfirmation,
  sourceLanguage,
  targetLanguage
}) {
  const baseName = mdxFile.name.slice(0, -MDX_EXT.length);
  const companionPattern = new RegExp(
    `^${escapePreflightRegExp(baseName)}(?:\\.([1-9][0-9]?))?\\.mdd$`,
    "iu"
  );
  const mddFiles = files.filter((file) => preflightExtension(file.name) === MDD_EXT);
  const companions = [];
  const unassociated = [];
  const sidecarCandidates = [];
  for (const file of mddFiles) {
    if (companionPattern.test(file.name)) companions.push(file);
    else unassociated.push(file);
  }
  for (const file of files) {
    if (file === mdxFile || mddFiles.includes(file)) continue;
    const path = selectedSidecarPath(file);
    let type = null;
    try { if (path) type = classifyMddSidecarPath(path); } catch { /* invalid path remains unassociated */ }
    if (!type) {
      unassociated.push(file);
      continue;
    }
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > RICH_MDD_MAX_SIDECAR_FILE_BYTES ||
        (type.kind === "stylesheet" && file.size > 64 * 1024)) {
      return basePreflightResult({
        family: "mdict-rich", files, sourceBytes, status: "invalid",
        reason: reason("mdd.sidecar_too_large")
      });
    }
    sidecarCandidates.push({ file, path, ...type });
  }

  let orderedCompanions = [];
  if (companions.length) {
    if (companions.length > RICH_MDD_MAX_COMPANIONS) {
      return basePreflightResult({
        family: "mdict-rich",
        files,
        sourceBytes,
        status: "invalid",
        reason: reason("mdd.too_many_companions")
      });
    }
    try {
      orderedCompanions = validateMddCompanions(
        companions.map((file) => file.name),
        mdxFile.name
      ).map(({ fileName }) => companions.find((file) => file.name === fileName));
    } catch (error) {
      return basePreflightResult({
        family: "mdict-rich",
        files,
        sourceBytes,
        status: "invalid",
        reason: reason(mapMddAssociationError(error))
      });
    }
  }
  const associatedSidecars = sidecarCandidates
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(({ file, path, kind, mime }) => ({
      fileName: safeFileLabel(file.name), path, sourceBytes: file.size, kind, mime
    }));
  if (!orderedCompanions.length && associatedSidecars.length) {
    for (const file of sidecarCandidates.map((item) => item.file)) unassociated.push(file);
    associatedSidecars.length = 0;
  }
  if (associatedSidecars.length > 32 || associatedSidecars.reduce((sum, item) => sum + item.sourceBytes, 0) > 64 * 1024 * 1024) {
    return basePreflightResult({
      family: "mdict-rich", files, sourceBytes, status: "invalid",
      reason: reason("mdd.sidecar_package_too_large"), associatedMdd: [], associatedSidecars,
      unassociatedFiles: unassociated
    });
  }
  const unassociatedFiles = unassociated;

  let index;
  try {
    assertPreflightFileLimit(mdxFile, 128 * 1024 * 1024, "mdx.file_too_large");
    index = await buildRichMdictIndex({
      source: blobRangeSource(mdxFile, signal),
      signal
    });
  } catch (error) {
    if (isPreflightAbort(error, signal)) throw preflightAbortError();
    return mdxFailureResult({ files, sourceBytes, error, mdxFile });
  }

  const capabilities = mdxCapabilities(index);
  const unsupportedCapabilities = capabilities.present.filter(
    (value) => !SHIPPED_CAPABILITIES.has(value)
  );
  const associatedMdd = [];
  for (const companion of orderedCompanions) {
    try {
      assertPreflightFileLimit(companion, RICH_MDD_MAX_SOURCE_BYTES, "mdd.file_too_large");
      const mddIndex = await buildMddIndex({
        source: blobRangeSource(companion, signal),
        signal
      });
      associatedMdd.push({
        fileName: safeFileLabel(companion.name),
        sourceBytes: companion.size,
        entryCount: mddIndex.keyCount,
        capabilities: mddCapabilities(mddIndex)
      });
    } catch (error) {
      if (isPreflightAbort(error, signal)) throw preflightAbortError();
      if ((error instanceof MDictImportError &&
          [MDICT_IMPORT_ERROR.UNSUPPORTED, MDICT_IMPORT_ERROR.LIMIT].includes(error.code)) ||
          error?.preflightReason) {
        return basePreflightResult({
          family: "mdict-rich",
          files,
          sourceBytes,
          status: "partial",
          displayTitle: index.header.title,
          entryCount: index.entryCount,
          capabilities: capabilities.present,
          requiredCapabilities: capabilities.required,
          unsupportedCapabilities: [
            ...unsupportedCapabilities,
            ...mddUnsupportedCapability(error)
          ],
          reason: reason(mapMddError(error), inferMddCapability(error)),
          route: { importer: "rich-mdict", requiresSemanticConfirmation: false },
          associatedMdd,
          associatedSidecars,
          unassociatedFiles
        });
      }
      return basePreflightResult({
        family: "mdict-rich",
        files,
        sourceBytes,
        status: "invalid",
        displayTitle: index.header.title,
        entryCount: index.entryCount,
        capabilities: capabilities.present,
        requiredCapabilities: capabilities.required,
        reason: reason(mapMddError(error)),
        route: { importer: "none", requiresSemanticConfirmation: false },
        associatedMdd,
        associatedSidecars,
        unassociatedFiles
      });
    }
  }

  const hasAssociatedMdd = associatedMdd.length > 0;
  const wantsStructured = semanticConfirmation === true;
  const languageDirectionValid = normalizePreflightLanguage(sourceLanguage) === "en" &&
    normalizePreflightLanguage(targetLanguage) === "zh-cn";
  const structuredRequirements = index.header.format.toUpperCase() === "TEXT" &&
    index.header.encrypted === 0 &&
    !index.header.styleSheet.trim() &&
    !/^yes$/iu.test(index.header.compact) &&
    !/^yes$/iu.test(index.header.compat) &&
    !hasAssociatedMdd;
  const structuredReady = wantsStructured && languageDirectionValid && structuredRequirements;
  const route = structuredReady
    ? { importer: "structured-mdict", requiresSemanticConfirmation: false }
    : { importer: "rich-mdict", requiresSemanticConfirmation: false };
  const warnings = [];
  let status = "supported";
  let preflightReason;
  if (wantsStructured && !structuredReady) {
    status = "partial";
    preflightReason = !languageDirectionValid
      ? reason("mdx.structured_language_direction_unsupported")
      : hasAssociatedMdd
        ? reason("mdx.structured_mdd_not_supported")
        : reason("mdx.structured_profile_unsupported");
  } else if (!wantsStructured && index.header.format.toUpperCase() === "TEXT") {
    warnings.push(reason("mdx.structured_semantics_not_confirmed"));
  }
  if (unassociatedFiles.length) {
    status = status === "supported" ? "partial" : status;
    warnings.push(reason("mdd.unassociated_files"));
  }
  if (unsupportedCapabilities.length) {
    status = "partial";
    preflightReason ||= reason("mdx.capability_not_shipped", unsupportedCapabilities[0]);
  }

  const mdxIdentityHint = await makeBoundedFileIdentityHint(
    mdxFile,
    index.recordBlocksOffset,
    signal
  );

  return basePreflightResult({
    family: structuredReady ? "mdict-structured" : "mdict-rich",
    files,
    sourceBytes,
    status,
    displayTitle: index.header.title,
    entryCount: index.entryCount,
    capabilities: capabilities.present,
    requiredCapabilities: capabilities.required,
    unsupportedCapabilities,
    reason: preflightReason,
    warnings,
    route,
    associatedMdd,
    associatedSidecars,
    unassociatedFiles,
    identity: { hints: mdxIdentityHint ? [mdxIdentityHint] : [] }
  });
}

function selectedSidecarPath(file) {
  const relative = String(file?.webkitRelativePath || "");
  if (!relative) return normalizeMddResourcePath(String(file?.name || ""));
  const segments = relative.replaceAll("\\", "/").split("/");
  // A directory picker reports the chosen root folder as the first segment.
  return normalizeMddResourcePath(segments.length > 1 ? segments.slice(1).join("/") : segments[0]);
}

function mdxFailureResult({ files, sourceBytes, error, mdxFile }) {
  const unsupported = error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.UNSUPPORTED;
  const limited = (error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.LIMIT) ||
    Boolean(error?.preflightReason);
  const capability = inferMdxCapability(error);
  return basePreflightResult({
    family: "mdict-rich",
    files,
    sourceBytes,
    status: unsupported || limited ? "unsupported" : "invalid",
    reason: reason(mapMdxError(error), capability),
    unsupportedCapabilities: capability ? [capability] : [],
    route: { importer: "none", requiresSemanticConfirmation: false },
    identity: { displayTitle: safeFileLabel(mdxFile.name.replace(/\.mdx$/iu, "")) }
  });
}

function mdxCapabilities(index) {
  const header = index.header;
  const present = ["mdx.engine.v2"];
  const encoding = header.encoding === "UTF-8" ? "mdx.encoding.utf8" : "mdx.encoding.utf16le";
  present.push(encoding, "mdx.key-info.compression-zlib");
  if (header.encrypted === 2) present.push("mdx.encryption.key-info-v2");
  present.push(header.format.toUpperCase() === "HTML" ? "mdx.record.html" : "mdx.record.text");
  if (header.styleSheet.trim()) present.push("mdx.style-sheet");
  if (/^yes$/iu.test(header.compact) || /^yes$/iu.test(header.compat)) present.push("mdx.compact-records");
  return {
    present: uniqueCapabilities(present),
    required: uniqueCapabilities(["mdx.engine.v2", encoding, "mdx.key-info.compression-zlib"])
  };
}

function mddCapabilities(index) {
  const present = ["mdd.engine.v2"];
  present.push(index.keyInfoCompression === "zlib" ? "mdd.compression.zlib" : "mdd.compression.none");
  if (index.header.encrypted === 2) present.push("mdd.encryption.key-info-v2");
  return uniqueCapabilities(present);
}

function inferMdxCapability(error) {
  if (!(error instanceof MDictImportError)) return null;
  const detail = error.details || error;
  if (Array.isArray(detail.type) && detail.type[0] === 1) return "mdx.compression.lzo";
  if (/LZO/iu.test(error.message)) return "mdx.compression.lzo";
  if (Array.isArray(detail.type)) return "mdx.compression.unknown";
  if (detail.version || /engine v2\.0/iu.test(error.message)) return "mdx.engine.v2";
  if (/encoding/iu.test(error.message) || detail.encoding) return encodingCapability("mdx", detail.encoding);
  if (detail.encrypted === 1) return "mdx.encryption.password-protected";
  if (detail.encrypted === 3) return "mdx.encryption.record";
  if (detail.requiredEngineVersion) return "mdx.required-engine-version";
  if (detail.format) return "mdx.record-format.other";
  return null;
}

function inferMddCapability(error) {
  const detail = error?.details || error || {};
  if (Array.isArray(detail.type) && detail.type[0] === 1) return "mdd.compression.lzo";
  if (/LZO/iu.test(error?.message || "")) return "mdd.compression.lzo";
  if (Array.isArray(detail.type)) return "mdd.compression.unknown";
  if (detail.version || /MDD v2\.0/iu.test(error?.message || "")) return "mdd.engine.v2";
  if (detail.encrypted === 1) return "mdd.encryption.password-protected";
  if (detail.encrypted === 3) return "mdd.encryption.record";
  if (detail.requiredEngineVersion) return "mdd.required-engine-version";
  if (detail.encoding) return encodingCapability("mdd", detail.encoding);
  return null;
}

function mdxUnsupportedCapability(error) {
  const capability = inferMdxCapability(error);
  return capability ? [capability] : [];
}

function mddUnsupportedCapability(error) {
  const capability = inferMddCapability(error);
  return capability ? [capability] : [];
}

function encodingCapability(prefix, encoding) {
  const value = String(encoding || "").trim().toLowerCase().replaceAll("-", "");
  if (value === "utf8") return `${prefix}.encoding.utf8`;
  if (value === "utf16" || value === "utf16le") return `${prefix}.encoding.utf16le`;
  if (value === "gbk" || value === "gb2312" || value === "cp936") return `${prefix}.encoding.gbk`;
  if (value === "big5") return `${prefix}.encoding.big5`;
  if (value === "gb18030") return `${prefix}.encoding.gb18030`;
  return `${prefix}.encoding.other`;
}

function mapMdxError(error) {
  if (error?.preflightReason) return error.preflightReason;
  if (error instanceof MDictImportError) {
    if (error.code === MDICT_IMPORT_ERROR.CORRUPT) return "mdx.corrupt_or_malformed";
    if (error.code === MDICT_IMPORT_ERROR.LIMIT) return "mdx.preflight_limit_exceeded";
    if (error.code === MDICT_IMPORT_ERROR.UNSAFE_CONTENT) return "mdx.unsafe_content";
    if (inferMdxCapability(error)) return "mdx.capability_unsupported";
  }
  return "mdx.preflight_failed";
}

function mapMddError(error) {
  if (error?.preflightReason) return error.preflightReason;
  if (error instanceof MDictImportError) {
    if (error.code === MDICT_IMPORT_ERROR.CORRUPT) return "mdd.corrupt_or_malformed";
    if (error.code === MDICT_IMPORT_ERROR.LIMIT) return "mdd.preflight_limit_exceeded";
    if (error.code === MDICT_IMPORT_ERROR.UNSUPPORTED) return "mdd.capability_unsupported";
  }
  return "mdd.preflight_failed";
}

function mapMddAssociationError(error) {
  return /consecutive/iu.test(error?.message || "")
    ? "mdd.numbering_not_consecutive"
    : "mdd.companion_names_ambiguous_or_invalid";
}
