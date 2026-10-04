import { createI18n } from "../i18n/index.js";
import { localizedMessage } from "../i18n/messages.js";

const defaultI18n = createI18n({ uiLocale: "zh_CN" });

export function getCuratedMdxInstallPresentation(source, dictionary, i18n = defaultI18n) {
  if (!dictionary) {
    return {
      status: "not-installed",
      kind: "warning",
      badgeLabel: i18n.t("dictionary.curated.notInstalledBadge"),
      actionLabel: i18n.t("dictionary.curated.install"),
      detail: i18n.t("dictionary.curated.notInstalledDetail")
    };
  }

  if (dictionary.curated?.recipeId !== source?.id) {
    return {
      status: "identity-conflict",
      kind: "error",
      badgeLabel: i18n.t("dictionary.curated.identityConflictBadge"),
      actionLabel: i18n.t("dictionary.curated.unavailable"),
      detail: i18n.t("dictionary.curated.identityConflictDetail")
    };
  }

  if (dictionary.status !== "ready") {
    return {
      status: "needs-reinstall",
      kind: "warning",
      badgeLabel: i18n.t("dictionary.curated.repairBadge"),
      actionLabel: i18n.t("dictionary.curated.reinstall"),
      detail: i18n.t("dictionary.curated.repairDetail")
    };
  }

  const currentVersion = String(dictionary.curated?.upstreamRevision || "");
  const currentHash = String(dictionary.curated?.mdxSha256 || "");
  if (
    currentVersion === String(source?.upstreamRevision || "") &&
    currentHash === String(source?.mdx?.sha256 || "")
  ) {
    return {
      status: "current",
      kind: "success",
      badgeLabel: i18n.t("dictionary.curated.readyBadge"),
      actionLabel: i18n.t("dictionary.curated.reinstall"),
      detail: i18n.t("dictionary.curated.mdxCurrentDetail", { version: String(source.upstreamRevision || "") })
    };
  }

  return {
    status: "update-available",
    kind: "warning",
    badgeLabel: i18n.t("dictionary.curated.updateBadge"),
    actionLabel: i18n.t("dictionary.curated.update"),
    detail: i18n.t("dictionary.curated.mdxUpdateDetail", { current: currentVersion || i18n.t("localImport.duplicate.unknownVersion"), next: String(source?.upstreamRevision || i18n.t("localImport.duplicate.unknownVersion")) })
  };
}

export function getCuratedInstallPresentation(
  source,
  entry,
  i18n = defaultI18n
) {
  const active = entry?.active || null;
  if (!active) {
    return {
      status: "not-installed",
      kind: "warning",
      badgeLabel: i18n.t("dictionary.curated.notInstalledBadge"),
      actionLabel: i18n.t("dictionary.curated.install"),
      detail: i18n.t("dictionary.curated.packNotInstalledDetail")
    };
  }

  if (entry?.status === "needs-reinstall") {
    return {
      status: "needs-reinstall",
      kind: "warning",
      badgeLabel: i18n.t("dictionary.curated.repairBadge"),
      actionLabel: i18n.t("dictionary.curated.reinstall"),
      detail: i18n.t("dictionary.curated.packRepairDetail")
    };
  }

  if (
    active.packVersion === source?.output?.packVersion
  ) {
    return {
      status: "current",
      kind: "success",
      badgeLabel: i18n.t("dictionary.curated.readyBadge"),
      actionLabel: i18n.t("dictionary.curated.reinstall"),
      detail: i18n.t("dictionary.curated.packCurrentDetail")
    };
  }

  return {
    status: "update-available",
    kind: "warning",
    badgeLabel: i18n.t("dictionary.curated.updateBadge"),
    actionLabel: i18n.t("dictionary.curated.update"),
    detail: i18n.t("dictionary.curated.packUpdateDetail")
  };
}

export function describeCuratedProgress(message, source) {
  if (message.phase === "download") {
    const loaded = Number(message.inputBytes || 0);
    return loaded ? localizedMessage("dictionary.curated.progressDownload", { loaded: formatCuratedBytes(loaded), total: formatCuratedBytes(source.downloadBytes) }) : localizedMessage("dictionary.curated.progressConnecting");
  }
  if (message.phase === "convert") {
    return localizedMessage("dictionary.curated.progressConvert", { count: Number(message.retainedRecords || 0).toLocaleString() });
  }
  if (message.phase === "stage") return localizedMessage("dictionary.curated.progressStage");
  return localizedMessage("dictionary.curated.progressUnknown");
}

export function shortCuratedRevision(value) {
  return String(value || "").slice(0, 12);
}

export function formatCuratedBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return value + " B";
  if (value < 1024 * 1024) {
    return (value / 1024).toFixed(1) + " KiB";
  }
  return (value / (1024 * 1024)).toFixed(1) + " MiB";
}
