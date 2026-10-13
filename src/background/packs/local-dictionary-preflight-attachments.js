import { buildMddIndex } from "./importers/mdd.js";
import { RICH_MDD_MAX_COMPANIONS, RICH_MDD_MAX_SOURCE_BYTES, RICH_MDD_MAX_SIDECAR_FILE_BYTES,
  classifyMddSidecarPath, validateMddCompanions } from "./rich-mdd-contract.js";
import { normalizeMddResourcePath } from "./importers/mdd-resource-path.js";
import { normalizePreflightFiles, hasDuplicateFileNames, LOCAL_DICTIONARY_PREFLIGHT_LIMITS,
  basePreflightResult, blobRangeSource, preflightExtension, safeFileLabel, reason,
  escapePreflightRegExp, assertPreflightFileLimit, assertPreflightActive } from "./local-dictionary-preflight-contract.js";
const MDD_EXT = ".mdd";

export function classifyRichAttachments(files, mdxFileName) {
  const baseName = mdxFileName.replace(/\.mdx$/iu, "");
  const companionPattern = new RegExp(
    `^${escapePreflightRegExp(baseName)}(?:\\.([1-9][0-9]?))?\\.mdd$`,
    "iu"
  );
  const mddFiles = files.filter((file) => preflightExtension(file.name) === MDD_EXT);
  const companions = [];
  const unassociated = [];
  const sidecarCandidates = [];
  const ignoredFiles = [];
  for (const file of mddFiles) {
    if (companionPattern.test(file.name)) companions.push(file);
    else unassociated.push(file);
  }
  for (const file of files) {
    if (/\.mdx$/iu.test(file.name) || mddFiles.includes(file)) continue;
    if (preflightExtension(file.name) === ".js") {
      ignoredFiles.push({ fileName: safeFileLabel(file.name), size: file.size, reason: "script_not_executed" });
      continue;
    }
    let path;
    let type = null;
    try { path = selectedSidecarPath(file); if (path) type = classifyMddSidecarPath(path); } catch { /* invalid path remains unassociated */ }
    if (!type) {
      unassociated.push(file);
      continue;
    }
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > RICH_MDD_MAX_SIDECAR_FILE_BYTES ||
        (type.kind === "stylesheet" && file.size > 64 * 1024)) {
      throw attachmentError("mdd.sidecar_too_large");
    }
    sidecarCandidates.push({ file, path, ...type });
  }

  let orderedCompanions = [];
  if (companions.length) {
    if (companions.length > RICH_MDD_MAX_COMPANIONS) {
      throw attachmentError("mdd.too_many_companions");
    }
    try {
      orderedCompanions = validateMddCompanions(
        companions.map((file) => file.name),
        mdxFileName
      ).map(({ fileName }) => companions.find((file) => file.name === fileName));
    } catch (error) {
      throw attachmentError(mapMddAssociationError(error));
    }
  }
  const seen = new Set();
  for (const item of sidecarCandidates) {
    const key = item.path.toLocaleLowerCase("en-US");
    if (seen.has(key)) throw attachmentError("file_set.duplicate_name");
    seen.add(key);
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
    throw attachmentError("mdd.sidecar_package_too_large");
  }
  const unassociatedFiles = unassociated;

  return { orderedCompanions, associatedSidecars, unassociatedFiles, ignoredFiles };
}

function selectedSidecarPath(file) {
  const relative = String(file?.webkitRelativePath || "");
  if (!relative) return normalizeMddResourcePath(String(file?.name || ""));
  const segments = relative.replaceAll("\\", "/").split("/");
  // A directory picker reports the chosen root folder as the first segment.
  return normalizeMddResourcePath(segments.length > 1 ? segments.slice(1).join("/") : segments[0]);
}

function mapMddAssociationError(error) {
  return /consecutive/iu.test(error?.message || "")
    ? "mdd.numbering_not_consecutive"
    : "mdd.companion_names_ambiguous_or_invalid";
}
function attachmentError(code) { const error = new Error(code); error.preflightReason = code; return error; }

export async function preflightRichAttachments({ files, mdxFileName, signal } = {}) {
  assertPreflightActive(signal);
  const selected = normalizePreflightFiles(files);
  const sourceBytes = selected.reduce((sum, file) => sum + file.size, 0);
  const result = (status, code, extra = {}) => basePreflightResult({ family: "mdict-rich", files: selected,
    sourceBytes, status, reason: code ? reason(code) : null, route: { importer: "none" }, ...extra });
  if (sourceBytes > LOCAL_DICTIONARY_PREFLIGHT_LIMITS.totalBytes) return result("invalid", "file_set.limit_exceeded");
  if (hasDuplicateFileNames(selected)) return result("invalid", "file_set.duplicate_name");
  if (selected.some(file => /\.mdx$/iu.test(file.name))) return result("invalid", "mdd.attachment_only");
  let associations;
  try { associations = classifyRichAttachments(selected, mdxFileName); }
  catch (error) { return result("invalid", error.preflightReason || "mdd.companion_names_ambiguous_or_invalid"); }
  const { orderedCompanions, ...metadata } = associations;
  if (!orderedCompanions.length || metadata.unassociatedFiles.length) return result("invalid", "mdd.unassociated_files", metadata);
  const associatedMdd = [];
  for (const file of orderedCompanions) {
    assertPreflightActive(signal);
    try {
      assertPreflightFileLimit(file, RICH_MDD_MAX_SOURCE_BYTES, "mdd.file_too_large");
      const index = await buildMddIndex({ source: blobRangeSource(file, signal), signal });
      associatedMdd.push({ fileName: safeFileLabel(file.name), sourceBytes: file.size, entryCount: index.keyCount });
    } catch (error) {
      assertPreflightActive(signal);
      return result("invalid", error.preflightReason || "mdd.corrupt_or_malformed", metadata);
    }
  }
  return result("supported", null, { ...metadata, associatedMdd });
}
