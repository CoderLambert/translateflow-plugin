import { createI18n } from "../i18n/index.js";
import { catalogs } from "../i18n/catalog.js";
import { localizedMessage, renderLocalizedMessage } from "../i18n/messages.js";

const defaultI18n = createI18n({ uiLocale: "zh_CN" });
const text = (i18n, key, args = {}) => Object.hasOwn(catalogs.en, key)
  ? (i18n || defaultI18n).t(key, args)
  : (i18n || defaultI18n).t("dictionary.compatibility.unknown");

const TRUST_KEYS = Object.freeze({
  "curated-upstream": "dictionary.trust.curated",
  official: "dictionary.trust.official",
  "user-provided-unverified": "dictionary.trust.local"
});

const COMPATIBILITY_KEYS = Object.freeze({
  "reviewed-compatible": "dictionary.compatibility.reviewedCompatible",
  "reviewed-partial": "dictionary.compatibility.reviewedPartial",
  "reviewed-incompatible": "dictionary.compatibility.reviewedIncompatible",
  "not-reviewed": "dictionary.compatibility.notReviewed",
  supported: "dictionary.compatibility.supported",
  partial: "dictionary.compatibility.partial",
  unsupported: "dictionary.compatibility.unsupported",
  invalid: "dictionary.compatibility.invalid"
});

const CAPABILITY_KEYS = Object.freeze({
  "mdx.compression.lzo": "dictionary.capability.mdx.compression.lzo",
  "mdx.encoding.gbk": "dictionary.capability.mdx.encoding.gbk",
  "mdx.encoding.big5": "dictionary.capability.mdx.encoding.big5",
  "mdx.encoding.gb18030": "dictionary.capability.mdx.encoding.gb18030",
  "mdx.engine.v1": "dictionary.capability.mdx.engine.v1",
  "mdd.compression.lzo": "dictionary.capability.mdd.compression.lzo",
  "mdd.encoding.gbk": "dictionary.capability.mdd.encoding.gbk",
  "mdd.encoding.big5": "dictionary.capability.mdd.encoding.big5"
});

export function getCatalogDictionaryRows(entry, {
  installedCatalog,
  installedVersion = "",
  installedSize,
  entryCount,
  resourceCount,
  resourceBytes,
  installedSourceFileName = "",
  installedSourceSize = 0,
  includeDownload = true,
  i18n
} = {}) {
  if (!entry || typeof entry !== "object") return [];
  const artifact = Array.isArray(entry.artifacts) ? entry.artifacts[0] : null;
  const rows = [
    { label: text(i18n, "dictionary.meta.trust"), value: trustLabel(entry.trustClass, i18n) },
    { label: text(i18n, "dictionary.meta.publisher"), value: entry.identity?.publisher || entry.source?.attribution || text(i18n, "dictionary.value.unknownSource") },
    { label: text(i18n, "dictionary.meta.direction"), value: entry.language?.directionLabel || text(i18n, "dictionary.value.unknownDirection") },
    { label: text(i18n, "dictionary.meta.format"), value: formatCatalogArtifacts(entry.artifacts, i18n) },
    { label: text(i18n, "dictionary.meta.upstreamVersion"), value: versionValue(entry.version?.sourceVersion, i18n) },
    { label: text(i18n, "dictionary.meta.releaseDate"), value: dateValue(entry.version?.releaseDate, "dictionary.value.unannounced", i18n) },
    { label: text(i18n, "dictionary.meta.contentDate"), value: dateValue(entry.version?.contentDate, "dictionary.value.unknownContentDate", i18n) },
    {
      label: text(i18n, "dictionary.meta.compatibility"),
      value: compatibilityLabel(entry.compatibility?.status, i18n)
    },
    { label: text(i18n, "dictionary.meta.reviewDate"), value: dateValue(entry.compatibility?.reviewedAt, "dictionary.value.unannounced", i18n) },
    { label: text(i18n, "dictionary.meta.maintenance"), value: maintenanceLabel(entry.version?.maintenanceStatus, i18n) }
  ];

  if (includeDownload && Number.isSafeInteger(artifact?.expectedBytes)) {
    rows.push({ label: text(i18n, "dictionary.meta.downloadSize"), value: formatDictionaryBytes(artifact.expectedBytes, i18n) });
  }
  if (isExplicitlyOldContent(entry.version?.contentDate)) {
    rows.push({
      label: text(i18n, "dictionary.meta.contentNote"),
      value: text(i18n, "dictionary.value.oldContent")
    });
  }
  if (Number.isSafeInteger(Number(entryCount)) && Number(entryCount) > 0) {
    rows.push({ label: text(i18n, "dictionary.meta.entryCount"), value: Number(entryCount).toLocaleString(i18n?.locale === "zh_CN" ? "zh-CN" : "en") });
  }
  if (installedCatalog?.installedVersion || installedVersion) {
    rows.push({
      label: text(i18n, "dictionary.meta.installedVersion"),
      value: installedVersionValue(
        installedVersion || installedCatalog.installedVersion,
        entry.version?.sourceVersion,
        i18n
      )
    });
  }
  if (Number.isSafeInteger(Number(installedSize)) && Number(installedSize) > 0) {
    rows.push({ label: text(i18n, "dictionary.meta.installedSize"), value: formatDictionaryBytes(Number(installedSize), i18n) });
  }
  if (installedSourceFileName) {
    rows.push({ label: text(i18n, "dictionary.meta.sourceFile"), value: safeDictionaryFileName(installedSourceFileName, i18n) });
  }
  if (Number.isSafeInteger(Number(installedSourceSize)) && Number(installedSourceSize) > 0) {
    rows.push({ label: text(i18n, "dictionary.meta.sourceFileSize"), value: formatDictionaryBytes(Number(installedSourceSize), i18n) });
  }
  if (resourceCount !== undefined) {
    const count = Math.max(0, Number(resourceCount) || 0);
    const bytes = Math.max(0, Number(resourceBytes) || 0);
    rows.push({
      label: text(i18n, "dictionary.meta.resources"),
      value: count
        ? text(i18n, bytes ? "dictionary.value.mddResourceCountBytes" : "dictionary.value.mddResourceCount", { count: count.toLocaleString(i18n?.locale === "zh_CN" ? "zh-CN" : "en"), size: formatDictionaryBytes(bytes, i18n) })
        : text(i18n, "dictionary.value.noMdd")
    });
  }
  if (entry.source?.licenseLabel) {
    rows.push({ label: text(i18n, "dictionary.meta.license"), value: entry.source.licenseLabel });
  }
  if (entry.source?.homepage) {
    rows.push({ label: text(i18n, "dictionary.meta.upstreamProject"), value: text(i18n, "dictionary.value.openProject"), href: entry.source.homepage });
  }
  if (entry.source?.licenseUrl) {
    rows.push({ label: text(i18n, "dictionary.meta.licenseNote"), value: text(i18n, "dictionary.value.openLicense"), href: entry.source.licenseUrl });
  }
  return rows;
}

export function renderDictionaryMetadata(container, rows, { className = "dictionary-v2-metadata" } = {}) {
  if (!container || !Array.isArray(rows) || !rows.length) return null;
  const list = document.createElement("dl");
  list.className = className;
  for (const row of rows) {
    const item = document.createElement("div");
    item.className = "dictionary-v2-metadata-item";
    const term = document.createElement("dt");
    term.textContent = String(row.label || "");
    const description = document.createElement("dd");
    if (row.href) {
      const link = document.createElement("a");
      link.href = row.href;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = String(row.value || "");
      description.appendChild(link);
    } else {
      description.textContent = String(row.value || "");
    }
    item.append(term, description);
    list.appendChild(item);
  }
  container.appendChild(list);
  return list;
}

export function renderCatalogLimitations(container, entry, i18n) {
  const notes = [
    ...(Array.isArray(entry?.source?.legalLimitations) ? entry.source.legalLimitations : []),
    ...(Array.isArray(entry?.knownLimitations) ? entry.knownLimitations.map(item => {
      const key = `dictionary.limitation.${String(item?.id || "")}`;
      return Object.hasOwn(catalogs.en, key) ? text(i18n, key) : item?.description;
    }) : [])
  ].filter((item) => typeof item === "string" && item.trim()).slice(0, 16);
  if (!container || !notes.length) return null;
  const details = document.createElement("details");
  details.className = "dictionary-v2-limitations";
  const summary = document.createElement("summary");
  summary.textContent = text(i18n, "dictionary.limitations");
  const list = document.createElement("ul");
  for (const note of notes) {
    const item = document.createElement("li");
    item.textContent = note;
    list.appendChild(item);
  }
  details.append(summary, list);
  container.appendChild(details);
  return details;
}

export function getDictionaryCompatibilityLabel(value, i18n) {
  if (typeof value === "string") return compatibilityLabel(value, i18n);
  const compatibility = value && typeof value === "object" ? value : {};
  const status = compatibility.status || compatibility.result || "";
  const base = compatibilityLabel(status, i18n);
  const unsupported = Array.isArray(compatibility.unsupportedCapabilities)
    ? compatibility.unsupportedCapabilities.map(id => text(i18n, CAPABILITY_KEYS[id] || "dictionary.capabilityFallback"))
    : [];
  const limitations = Array.isArray(compatibility.knownLimitations) ? compatibility.knownLimitations.map(item => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "";
    const key = `dictionary.limitation.${String(item.id || "")}`;
    return Object.hasOwn(catalogs.en, key) ? text(i18n, key) : typeof item.description === "string" ? item.description : "";
  }).filter(Boolean) : [];
  const detail = [...new Set([...unsupported, ...limitations])].slice(0, 4).join(" ");
  return { label: base, detail };
}

export function renderLocalRichDictionaryMetadata(container, dictionary, installedBytes, i18n) {
  const { rows, detail: compatibilityDetail } = getLocalRichDictionaryRows(dictionary, installedBytes, i18n);
  renderDictionaryMetadata(container, rows);
  if (!compatibilityDetail) return null;
  const detail = document.createElement("small");
  detail.className = "dictionary-pack-detail";
  detail.textContent = compatibilityDetail;
  container.appendChild(detail);
  return detail;
}

export function getLocalRichDictionaryRows(dictionary = {}, installedBytes = 0, i18n) {
  const compatibility = getDictionaryCompatibilityLabel(
    dictionary.compatibility || { status: dictionary.status === "ready" ? "supported" : "not-reviewed" }, i18n
  );
  return {
    rows: [
    { label: text(i18n, "dictionary.meta.trust"), value: trustLabel(dictionary.trust || "user-provided-unverified", i18n) },
    { label: text(i18n, "dictionary.meta.note"), value: text(i18n, "dictionary.value.localSource") },
    { label: text(i18n, "dictionary.meta.direction"), value: text(i18n, "dictionary.value.localDirection") },
    { label: text(i18n, "dictionary.meta.format"), value: text(i18n, "dictionary.value.formatMdxRich") },
    { label: text(i18n, "dictionary.meta.compatibility"), value: compatibility.label },
    { label: text(i18n, "dictionary.meta.installedVersion"), value: formatLocalDictionaryVersion(dictionary.packVersion, i18n) },
    { label: text(i18n, "dictionary.meta.releaseDate"), value: formatLocalInstallDate(dictionary.installedAt) || text(i18n, "dictionary.value.unknownDate") },
    { label: text(i18n, "dictionary.meta.sourceFile"), value: dictionary.fileName ? safeDictionaryFileName(dictionary.fileName, i18n) : text(i18n, "localImport.unknownFile") },
    ...(Number(dictionary.sourceSize) > 0
      ? [{ label: text(i18n, "dictionary.meta.sourceFileSize"), value: formatDictionaryBytes(dictionary.sourceSize, i18n) }]
      : []),
    { label: text(i18n, "dictionary.meta.entryCount"), value: Number(dictionary.entryCount || 0).toLocaleString(i18n?.locale === "zh_CN" ? "zh-CN" : "en") },
    { label: text(i18n, "dictionary.meta.installedSize"), value: formatDictionaryBytes(installedBytes, i18n) },
    {
      label: text(i18n, "dictionary.meta.resources"),
      value: Number(dictionary.resourceCount || 0)
        ? text(i18n, "dictionary.value.mddResourceCountBytes", { count: Number(dictionary.resourceCount).toLocaleString(i18n?.locale === "zh_CN" ? "zh-CN" : "en"), size: formatDictionaryBytes(dictionary.resourceBytes, i18n) })
        : text(i18n, "dictionary.value.noLocalMdd")
    }
    ],
    detail: compatibility.detail
  };
}

function safeDictionaryFileName(value, i18n) {
  return String(value || "")
    .normalize("NFC")
    .replace(/[\\/]/gu, "_")
    .replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 120) || text(i18n, "localImport.unknownFile");
}

export function getDictionaryHealthPresentation(status, i18n) {
  if (["ready", "healthy"].includes(status)) return { label: text(i18n, "dictionary.health.ready"), kind: "success", detail: text(i18n, "dictionary.healthDetail.ready") };
  if (["missing", "unavailable"].includes(status)) return { label: text(i18n, "dictionary.health.missing"), kind: "error", detail: text(i18n, "dictionary.healthDetail.missing") };
  if (["corrupt", "unhealthy"].includes(status)) return { label: text(i18n, "dictionary.health.corrupt"), kind: "error", detail: text(i18n, "dictionary.healthDetail.corrupt") };
  if (["incompatible", "needs-reinstall"].includes(status)) return { label: text(i18n, "dictionary.health.repair"), kind: "warning", detail: text(i18n, "dictionary.healthDetail.repair") };
  return { label: text(i18n, "dictionary.health.unknown"), kind: "warning", detail: text(i18n, "dictionary.healthDetail.unknown") };
}

export function getCuratedMdxErrorDescriptor(error, phase = "") {
  if (error?.name === "AbortError") return localizedMessage("dictionary.installCancelled");
  const code = String(error?.code || "");
  if (code === "DICTIONARY_PERMISSION_DENIED") return localizedMessage("dictionary.client.permissionDenied");
  if (code === "ECDICT_DOWNLOAD_REDIRECT" || code === "RICH_MDICT_PROVENANCE") return localizedMessage("dictionary.client.provenanceMismatch");
  if (/HASH|CRC/u.test(code)) return localizedMessage("dictionary.client.hashMismatch");
  if (/DOWNLOAD/u.test(code) || (phase === "download" && !code)) return localizedMessage("dictionary.client.downloadFailed");
  if (code === "RICH_MDICT_QUOTA" || code === "RICH_MDICT_LIMIT") return localizedMessage("dictionary.client.storageLimit");
  if (code === "RICH_MDICT_STORAGE") return localizedMessage("dictionary.client.saveFailed");
  if (code === "RICH_MDICT_REPLACEMENT_CONFLICT") return localizedMessage("dictionary.client.changed");
  if (code === "MDICT_UNSUPPORTED" || code === "MDICT_LIMIT") return localizedMessage("dictionary.client.formatUnsupported");
  if (/CORRUPT|PROVENANCE|IDENTITY|OUTPUT/u.test(code)) return localizedMessage("dictionary.client.integrityFailed");
  return localizedMessage("dictionary.client.operationFailed");
}

export function getCuratedMdxErrorMessage(error, phase = "", i18n = defaultI18n) {
  return renderLocalizedMessage(i18n, getCuratedMdxErrorDescriptor(error, phase));
}

export function formatDictionaryBytes(value, i18n) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return text(i18n, "dictionary.value.unknownSize");
  const locale = (i18n || defaultI18n).locale === "zh_CN" ? "zh-CN" : "en";
  const number = value => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  if (bytes < 1024) return `${Math.floor(bytes)} B`;
  if (bytes < 1024 * 1024) return `${number(bytes / 1024)} KiB`;
  return `${number(bytes / (1024 * 1024))} MiB`;
}

export function formatLocalDictionaryVersion(value, i18n) {
  const version = String(value || "").trim();
  if (!version || version.length > 120 || /[\u0000-\u001f\u007f]/u.test(version)) return text(i18n, "dictionary.value.versionNotRecorded");
  return version;
}

export function formatLocalInstallDate(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

function compatibilityLabel(status, i18n) {
  return text(i18n, COMPATIBILITY_KEYS[status] || "dictionary.compatibility.unknown");
}

function trustLabel(trustClass, i18n) {
  return text(i18n, TRUST_KEYS[trustClass] || "dictionary.trust.unknown");
}

function formatCatalogArtifacts(artifacts, i18n) {
  if (!Array.isArray(artifacts) || !artifacts.length) return text(i18n, "dictionary.value.formatUnknown");
  return artifacts.map((artifact) => {
    if (artifact.kind === "mdx") return text(i18n, "dictionary.value.formatMdxRich");
    if (artifact.kind === "mdd") return text(i18n, "dictionary.value.formatMdd");
    const name = artifact.archiveRules?.entryName || artifact.filename || "";
    if (artifact.kind === "zip" && /\.mdx$/iu.test(name)) return text(i18n, "dictionary.value.formatMdxZip");
    if (artifact.kind === "source-data" && /\.csv$/iu.test(name)) return text(i18n, "dictionary.value.formatCsv");
    if (artifact.kind === "zip") return text(i18n, "dictionary.value.formatZip");
    if (artifact.kind === "stardict") return text(i18n, "dictionary.value.formatStarDict");
    if (artifact.kind === "tflex") return text(i18n, "dictionary.value.formatTflex");
    return text(i18n, "dictionary.value.formatUnknown");
  }).join(" + ");
}

function dateValue(value, fallback = "dictionary.value.unannounced", i18n) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(String(value || "")) ? value : text(i18n, fallback);
}

function versionValue(value, i18n) {
  if (typeof value !== "string" || !value) return text(i18n, "dictionary.value.versionNotRecorded");
  return /^[a-f0-9]{40}$/iu.test(value) ? value.slice(0, 12) : value;
}

function maintenanceLabel(value, i18n) {
  if (value === "maintained") return text(i18n, "dictionary.value.maintenanceActive");
  if (value === "unmaintained") return text(i18n, "dictionary.value.maintenanceStopped");
  return text(i18n, "dictionary.value.maintenanceUnknown");
}

function isExplicitlyOldContent(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(value || ""))) return false;
  const date = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(date) && date < Date.now() - 5 * 365.25 * 24 * 60 * 60 * 1000;
}

function installedVersionValue(value, sourceVersion, i18n) {
  const installed = String(value || "");
  if (/^(?:import-[a-z0-9]+-[a-f0-9]{8}|rich-mdict-[a-f0-9-]{36})$/iu.test(installed)) {
    return sourceVersion && /^\d+(?:\.\d+){1,3}(?:[-+][\w.-]+)?$/u.test(sourceVersion)
      ? text(i18n, "dictionary.value.installedCopy", { version: sourceVersion })
      : text(i18n, "dictionary.value.installedLocalCopy");
  }
  const transformed = /^(\d{4}-\d{2}-\d{2})-[a-f0-9]{8}$/iu.exec(installed);
  if (transformed) return text(i18n, "dictionary.value.transformedVersion", { date: transformed[1] });
  return installed || text(i18n, "dictionary.value.installed");
}
