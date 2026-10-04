import { safeFileLabel as safePreflightFileLabel } from "../background/packs/local-dictionary-preflight-contract.js";
import { createI18n } from "../i18n/index.js";
import { catalogs } from "../i18n/catalog.js";
import { localizedMessage, renderLocalizedMessage } from "../i18n/messages.js";

const defaultI18n = createI18n({ uiLocale: "zh_CN" });
function translate(i18n, key, args = {}) {
  const api = i18n || defaultI18n;
  return Object.hasOwn(catalogs.en, key) ? api.t(key, args) : api.t("localImport.error.install");
}
function joined(values, i18n) { return values.join((i18n || defaultI18n).locale === "en" ? ", " : "、"); }

export const STATUS_LABELS = Object.freeze({
  supported: "localImport.status.supported",
  partial: "localImport.status.partial",
  unsupported: "localImport.status.unsupported",
  invalid: "localImport.status.invalid"
});
export const ROUTE_LABELS = Object.freeze({
  "rich-mdict": "localImport.route.rich-mdict",
  "structured-mdict": "localImport.route.structured-mdict",
  stardict: "localImport.route.stardict",
  tflex: "localImport.route.tflex",
  none: "localImport.route.none"
});
export const REASON_LABELS = Object.freeze(Object.fromEntries([
  "file_set.duplicate_name", "file_set.limit_exceeded", "file_set.unrecognized",
  "mdx.multiple_dictionaries", "mdx.structured_semantics_not_confirmed", "mdx.structured_language_direction_unsupported", "mdx.structured_mdd_not_supported", "mdx.structured_profile_unsupported", "mdx.capability_not_shipped", "mdx.capability_unsupported", "mdx.corrupt_or_malformed", "mdx.unsafe_content", "mdx.file_too_large", "mdx.preflight_limit_exceeded", "mdx.preflight_failed",
  "mdd.mdx_required", "mdd.too_many_companions", "mdd.companion_names_ambiguous_or_invalid", "mdd.numbering_not_consecutive", "mdd.unassociated_files", "mdd.capability_unsupported", "mdd.corrupt_or_malformed", "mdd.file_too_large", "mdd.preflight_limit_exceeded", "mdd.preflight_failed",
  "stardict.ifo_missing", "stardict.idx_missing", "stardict.dictionary_data_missing", "stardict.syn_missing", "stardict.multiple_ifo", "stardict.duplicate_component", "stardict.ambiguous_dictionary_data", "stardict.unassociated_files", "stardict.semantic_recipe_required", "stardict.capability_unsupported", "stardict.corrupt_or_malformed", "stardict.unsafe_content", "stardict.preflight_limit_exceeded",
  "tflex.duplicate_component", "tflex.manifest_missing", "tflex.manifest_invalid", "tflex.manifest_too_large", "tflex.profile_unsupported", "tflex.required_files_missing", "tflex.full_validation_deferred", "tflex.importer_verifies_hashes_and_records", "tflex.unassociated_files"
].map(code => [code, `localImport.reason.${code}`])));

const capabilityIds = [
  "mdx.engine.v2", "mdx.required-engine-version", "mdx.encoding.utf8", "mdx.encoding.utf16le", "mdx.encoding.gbk", "mdx.encoding.big5", "mdx.encoding.gb18030", "mdx.encoding.other", "mdx.encryption.key-info-v2", "mdx.encryption.password-protected", "mdx.encryption.record", "mdx.key-info.compression-zlib", "mdx.compression.none", "mdx.compression.zlib", "mdx.compression.lzo", "mdx.compression.unknown", "mdx.record.html", "mdx.record.text", "mdx.record-format.other", "mdx.style-sheet", "mdx.compact-records", "mdx.alias-link",
  "mdd.engine.v2", "mdd.required-engine-version", "mdd.encoding.utf8", "mdd.encoding.utf16le", "mdd.encoding.gbk", "mdd.encoding.big5", "mdd.encoding.gb18030", "mdd.encoding.other", "mdd.encryption.key-info-v2", "mdd.encryption.password-protected", "mdd.encryption.record", "mdd.compression.none", "mdd.compression.zlib", "mdd.compression.lzo", "mdd.compression.unknown", "mdd.resource.path-normalization", "mdd.resource.format-other",
  "rich.html-structure", "rich.inline-style", "rich.style-sheet-reference", "rich.compact-style-marker", "rich.relative-resource-path", "rich.other-uri-scheme", "rich.unusual-resource-extension", "rich.entry-reference", "rich.sound-reference", "rich.local-anchor", "rich.remote-url", "rich.image-reference", "rich.audio-reference"
];
export const CAPABILITY_LABELS = Object.freeze(Object.fromEntries(capabilityIds.map(id => [id, `localImport.capability.${id}`])));
const capabilityReasonIds = [
  "mdx.compression.lzo", "mdd.compression.lzo", "mdx.encoding.gbk", "mdx.encoding.big5", "mdx.encoding.gb18030", "mdd.encoding.gbk", "mdd.encoding.big5", "mdd.encoding.gb18030",
  "mdx.encryption.password-protected", "mdx.encryption.record", "mdd.encryption.password-protected", "mdd.encryption.record", "mdx.required-engine-version", "mdd.required-engine-version",
  "rich.remote-url", "rich.other-uri-scheme", "mdx.unsafe_content", "stardict.unsafe_content"
];
export const CAPABILITY_REASON_LABELS = Object.freeze(Object.fromEntries(capabilityReasonIds.map(id => [id, `localImport.capabilityReason.${id}`])));

export function findDuplicateCandidate(result, installedCandidates, selectedFiles) {
    const packId = result.identity.family === "tflex" ? tflexPackId(result) : "";
    if (packId) {
      const samePack = installedCandidates.find((item) => item.packId === packId);
      if (samePack) return samePack;
    }
    const title = normalizeIdentityText(result.identity.displayTitle || selectedFiles[0]?.name || "");
    if (!title) return null;
    return installedCandidates.find((item) => normalizeIdentityText(item.name) === title) || null;
  }

export function resolveAssociatedMddFiles(associatedMdd, selectedFiles) {
  const resolved = [];
  const used = new Set();
  for (const item of associatedMdd || []) {
    const matches = Array.from(selectedFiles || []).filter((file) =>
      !used.has(file) && safePreflightFileLabel(file.name) === item.fileName
    );
    if (matches.length !== 1) return null;
    used.add(matches[0]);
    resolved.push(matches[0]);
  }
  return resolved;
}

export function getLocalPreflightView(result, selectedFiles, installedCandidates, i18n) {
  const label = (key, args = {}) => translate(i18n, key, args);
  const capabilityLabel = id => label(CAPABILITY_LABELS[id] || "localImport.unknownFeature");
  const status = result.compatibility.status;
  const rows = [
    { label: label("localImport.row.result"), value: label(STATUS_LABELS[status] || STATUS_LABELS.invalid) },
    { label: label("localImport.row.family"), value: familyLabel(result.identity.family, i18n) },
    { label: label("localImport.row.route"), value: label(ROUTE_LABELS[result.route.importer] || ROUTE_LABELS.none) },
    ...(result.identity.displayTitle ? [{ label: label("localImport.row.name"), value: String(result.identity.displayTitle) }] : []),
    ...(Number.isSafeInteger(result.estimates.entryCount) ? [{ label: label("localImport.row.entryCount"), value: Number(result.estimates.entryCount).toLocaleString(i18n?.locale === "zh_CN" ? "zh-CN" : "en") }] : []),
    { label: label("localImport.row.selectedFiles"), value: label("localImport.fileCount", { count: selectedFiles.length, size: formatBytes(result.estimates.sourceBytes) }) },
    { label: label("localImport.row.storageEstimate"), value: label("localImport.storageEstimate", { size: formatBytes(result.estimates.sourceBytes) }) },
    { label: label("localImport.row.sourceTrust"), value: label("localImport.sourceUnverified") }
  ];
  const files = selectedFiles.map((file) => safeFileLabel(file.name, i18n));
  if (files.length) rows.push({ label: label("localImport.row.fileList"), value: joined(files, i18n) });
  const capabilities = result.compatibility.capabilitiesPresent || [];
  if (capabilities.length) rows.push({ label: label("localImport.row.recognizedFeatures"), value: joined(capabilities.map(capabilityLabel), i18n) });
  const encodings = capabilities.filter((item) => /\.encoding\./u.test(item)).map(id => CAPABILITY_LABELS[id] ? capabilityLabel(id) : label("localImport.unknownEncoding"));
  if (encodings.length) rows.push({ label: label("localImport.row.encoding"), value: joined(encodings, i18n) });
  if (result.resources.associatedMdd.length) {
    rows.push({ label: label("localImport.row.associatedMdd"), value: joined(result.resources.associatedMdd.map(item => `${safeFileLabel(item.fileName, i18n)} (${label("localImport.mddFileCount", { count: Number(item.entryCount || 0).toLocaleString(i18n?.locale === "zh_CN" ? "zh-CN" : "en") })})`), i18n) });
  }
  if (result.resources.missingCompanionHints.length) rows.push({ label: label("localImport.row.missingFiles"), value: joined(result.resources.missingCompanionHints.map(name => safeFileLabel(name, i18n)), i18n) });
  if (result.resources.unassociatedFiles.length) rows.push({ label: label("localImport.row.unassociatedFiles"), value: joined(result.resources.unassociatedFiles.map(name => safeFileLabel(name, i18n)), i18n) });
  if (isTflexOverInstallLimit(selectedFiles)) rows.push({ label: label("localImport.row.fileLimit"), value: label("localImport.limit.tflex") });
  const reasons = [
    ...(result.compatibility.reasons || []).map((item) => ({ ...item, warning: false })),
    ...(result.compatibility.warnings || []).map((item) => ({ ...item, warning: true }))
  ];
  for (const item of reasons) rows.push({ label: label(item.warning ? "localImport.row.warning" : "localImport.row.reason"), value: describeReason(item, i18n) });
  const unsupported = (result.compatibility.unsupportedCapabilities || []).map(id => CAPABILITY_LABELS[id] ? capabilityLabel(id) : label("localImport.unknownUnsupportedFeature"));
  if (unsupported.length) rows.push({ label: label("localImport.row.unsupportedFeatures"), value: joined(unsupported, i18n) });

  const needsSemantic = result.identity.family === "stardict" ||
    (result.identity.family.startsWith("mdict") && (result.compatibility.warnings || []).some((item) => item.code === "mdx.structured_semantics_not_confirmed"));
  const semanticText = label(result.identity.family === "stardict" ? "localImport.confirm.stardictSemantic" : "localImport.confirm.mdxSemantic");
  const needsLimitations = status === "partial" && result.route.importer !== "none";
  const limitationsText = label(result.identity.family === "tflex" ? "localImport.confirm.tflexValidation" : "localImport.confirm.partialCompatibility");
  const duplicate = findDuplicateCandidate(result, installedCandidates, selectedFiles);
  const sameTflexId = duplicate && result.identity.family === "tflex" && duplicate.packId && duplicate.packId === tflexPackId(result);
  const duplicateText = sameTflexId
    ? label("localImport.duplicate.sameTflex", { name: safeFileLabel(duplicate.name, i18n), installed: describeDuplicateSources(duplicate, selectedFiles, i18n).installed, incoming: describeDuplicateSources(duplicate, selectedFiles, i18n).incoming })
    : duplicate ? label("localImport.duplicate.possible", { name: safeFileLabel(duplicate.name, i18n), installed: describeDuplicateSources(duplicate, selectedFiles, i18n).installed, incoming: describeDuplicateSources(duplicate, selectedFiles, i18n).incoming }) : "";
  return { rows, needsSemantic, semanticText, needsLimitations, limitationsText, duplicate, duplicateText };
}

export function renderLocalPreflight({ result, selectedFiles, installedCandidates, summary, semanticLabel, semanticCheck, semanticText, limitationsLabel, limitationsCheck, limitationsText, duplicateLabel, duplicateCheck, duplicateText, updateImportEnabled, i18n }) {
  summary.replaceChildren();
  const view = getLocalPreflightView(result, selectedFiles, installedCandidates, i18n);
  for (const row of view.rows) appendSummaryLine(summary, row.label, row.value);
  semanticLabel.hidden = !view.needsSemantic; semanticCheck.disabled = !view.needsSemantic;
  semanticText.textContent = view.semanticText;
  limitationsLabel.hidden = !view.needsLimitations; limitationsCheck.disabled = !view.needsLimitations;
  limitationsText.textContent = view.limitationsText;
  duplicateLabel.hidden = !view.duplicate; duplicateCheck.disabled = !view.duplicate;
  duplicateText.textContent = view.duplicateText;
  updateImportEnabled();
}

export function appendSummaryLine(container, label, value) {
  const row = document.createElement("div");
  const key = document.createElement("strong");
  key.textContent = label;
  const text = document.createElement("span");
  text.textContent = String(value || "");
  row.append(key, text);
  container.appendChild(row);
}

export function describeReason(item, i18n) {
  const code = String(item?.capability || item?.code || "");
  const key = item?.capability ? CAPABILITY_REASON_LABELS[code] : REASON_LABELS[code];
  return key ? translate(i18n, key) : translate(i18n, "localImport.error.preflight");
}

export function familyLabel(family, i18n) {
  return translate(i18n, `localImport.family.${family || "unknown"}`);
}

export function tflexPackId(result) {
  return result.identity.hints?.find((hint) => hint.kind === "tflex-pack-identity")?.packId || "";
}

export function isTflexOverInstallLimit(files) {
  const tflexFiles = Array.from(files || []).filter((file) => /^(?:manifest\.json|index\.dat|entries\.dat)$/iu.test(file.name));
  const total = tflexFiles.reduce((sum, file) => sum + Number(file.size || 0), 0);
  return tflexFiles.some((file) => file.size > 64 * 1024 * 1024) || total > 128 * 1024 * 1024;
}

export function normalizeIdentityText(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function fileBaseName(name, i18n) {
  return safeFileLabel(name || translate(i18n, "dictionary.title"), i18n).replace(/\.mdx$/iu, "");
}

export function safeFileLabel(value, i18n) {
  return String(value || "")
    .normalize("NFC")
    .replace(/[\\/]/gu, "_")
    .replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 120) || translate(i18n, "localImport.unknownFile");
}

export function formatBytes(bytes, i18n) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  const locale = (i18n || defaultI18n).locale === "zh_CN" ? "zh-CN" : "en";
  if (value < 1024 * 1024) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1024)} KiB`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / (1024 * 1024))} MiB`;
}

function describeDuplicateSources(installed, selectedFiles, i18n) {
  const incomingNames = Array.from(selectedFiles || []).slice(0, 16).map((file) => safeFileLabel(file?.name, i18n));
  const incomingSize = Array.from(selectedFiles || []).reduce((sum, file) => sum + Math.max(0, Number(file?.size) || 0), 0);
  const installedNames = Array.isArray(installed?.sourceFiles)
    ? installed.sourceFiles.slice(0, 16).map(name => safeFileLabel(name, i18n))
    : installed?.fileName ? [safeFileLabel(installed.fileName, i18n)] : [];
  return {
    installed: translate(i18n, "localImport.duplicate.installedDetails", {
      version: installed?.version ? safeFileLabel(installed.version, i18n) : translate(i18n, "localImport.duplicate.unknownVersion"),
      files: installedNames.length ? joined(installedNames, i18n) : translate(i18n, "localImport.duplicate.unknownFiles"),
      size: Number.isFinite(Number(installed?.sourceSize)) && Number(installed.sourceSize) > 0 ? formatBytes(installed.sourceSize, i18n) : translate(i18n, "localImport.duplicate.unknownSize")
    }),
    incoming: translate(i18n, "localImport.duplicate.incomingDetails", {
      files: incomingNames.length ? joined(incomingNames, i18n) : translate(i18n, "localImport.duplicate.unknownFiles"),
      size: formatBytes(incomingSize, i18n)
    })
  };
}

export function importProgressLabel(phase, i18n) {
  return renderLocalizedMessage(i18n || defaultI18n, importProgressMessage(phase));
}

export function importProgressMessage(phase) {
  const key = ({ preflight: "preflight", read: "read", worker: "worker", convert: "convert", stage: "stage", index: "index", "store-source": "storeSource", "store-index": "storeIndex", commit: "commit", done: "done" })[phase || ""];
  return localizedMessage(key ? `localImport.progress.${key}` : "localImport.progress.unknown");
}

export function userMessage(error, route, i18n) {
  return renderLocalizedMessage(i18n || defaultI18n, userMessageDescriptor(error, route));
}

export function userMessageDescriptor(error, route) {
  if (error?.name === "AbortError") return localizedMessage("localImport.error.cancelled");
  const code = String(error?.code || "");
  if (route === "preflight") return localizedMessage(REASON_LABELS[code] || "localImport.error.preflight");
  if (code === "RICH_MDD_INPUT" || code === "RICH_MDD_ASSOCIATION") return localizedMessage("localImport.error.mddAssociation");
  if (code === "MDX_REQUIRED") return localizedMessage("localImport.error.mdxRequired");
  if (code === "MDD_TARGET_UNAVAILABLE") return localizedMessage("localImport.error.mddTarget");
  if (["RICH_MDD_LIMIT", "RICH_MDD_QUOTA", "RICH_MDICT_LIMIT", "RICH_MDICT_QUOTA", "PACK_QUOTA", "MDICT_IMPORT_LIMIT", "STARDICT_IMPORT_LIMIT"].includes(code) || /LIMIT|QUOTA/u.test(code)) return localizedMessage("localImport.error.limit");
  if (/UNSAFE/u.test(code)) return localizedMessage("localImport.error.unsafe");
  if (/CORRUPT|HASH|PACK_INVALID/u.test(code)) return localizedMessage("localImport.error.corrupt");
  if (/UNSUPPORTED/u.test(code)) return localizedMessage("localImport.error.unsupported");
  return localizedMessage("localImport.error.install");
}

export function setPageStatus(message, isError = false) {
  const target = document.getElementById("status");
  if (!target) return;
  target.textContent = message;
  target.classList.toggle("error", Boolean(isError));
}
