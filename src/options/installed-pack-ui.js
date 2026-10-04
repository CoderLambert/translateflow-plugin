import {
  BACKGROUND_MESSAGES
} from "../shared/constants.js";
import {
  OPTIONAL_PACK_SOURCES
} from "../shared/pack-sources.js";
import { getDictionaryCatalogEntry } from "../shared/dictionary-catalog-v2.js";
import {
  formatDictionaryBytes,
  formatLocalDictionaryVersion,
  formatLocalInstallDate,
  getCatalogDictionaryRows,
  getDictionaryHealthPresentation,
  renderCatalogLimitations,
  renderDictionaryMetadata
} from "./dictionary-library-v2-presentation.js";
import { createI18n } from "../i18n/index.js";

const defaultI18n = createI18n({ uiLocale: "zh_CN" });

export function renderInstalledPackList({
  container,
  state,
  runtime = globalThis.chrome?.runtime,
  setStatus,
  onChanged = () => {},
  sources = OPTIONAL_PACK_SOURCES
} = {}) {
  if (!container) return;
  container.replaceChildren();

  const entries = Object.entries(state?.packs || {})
    .filter(([, entry]) => entry && (entry.active || entry.display || entry.status === "needs-reinstall"))
    .sort((a, b) => compareText(
      installedPackName(a[0], a[1], sources),
      installedPackName(b[0], b[1], sources)
    ));

  if (!entries.length) {
    container.textContent =
      "暂无额外安装词典。可从上方下载精选上游词典，或从下方导入本地 StarDict / MDict 文件。";
    return;
  }

  for (const [index, [packId, entry]] of entries.entries()) {
    const row = document.createElement("div");
    row.className = "site-row dictionary-pack-row";
    row.setAttribute("role", "group");
    row.dataset.packId = packId;

    const summary = document.createElement("div");
    summary.className = "site-summary";
    const heading = document.createElement("div");
    heading.className = "dictionary-pack-heading";
    const title = document.createElement("strong");
    title.textContent =
      installedPackName(packId, entry, sources);
    title.id = `installed-dictionary-${index}`;
    const badge = document.createElement("span");
    badge.className = "dictionary-health-badge";
    const health = getDictionaryHealthPresentation(entry.status);
    badge.dataset.kind = health.kind;
    badge.textContent = health.label;
    badge.setAttribute("aria-label", `词典状态：${health.label}`);
    heading.append(title, badge);
    row.setAttribute("aria-labelledby", title.id);
    summary.appendChild(heading);

    const catalog = entry?.display?.catalog;
    const catalogEntry = catalog ? getDictionaryCatalogEntry(catalog.entryId) : null;
    if (catalogEntry) {
      renderDictionaryMetadata(summary, getCatalogDictionaryRows(catalogEntry, {
        installedCatalog: catalog,
        installedSize: entry.active?.totalBytes,
        entryCount: entry.active?.recordCount
      }));
      renderCatalogLimitations(summary, catalogEntry);
    } else {
      const meta = document.createElement("div");
      meta.className = "dictionary-pack-meta";
      for (const item of installedPackMeta(entry)) {
        const value = document.createElement("span");
        value.textContent = item;
        meta.appendChild(value);
      }
      summary.appendChild(meta);
    }
    if (health.detail && health.kind !== "success") {
      const detail = document.createElement("small");
      detail.className = "dictionary-pack-detail";
      detail.textContent = health.detail;
      summary.appendChild(detail);
    }

    const actions = document.createElement("div");
    actions.className = "site-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "删除";
    remove.setAttribute("aria-label", `删除${installedPackName(packId, entry, sources)}`);
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        const response = await runtime.sendMessage({
          type:
            BACKGROUND_MESSAGES.DICTIONARY_PACK_UNINSTALL,
          packId
        });
        if (!response?.ok) {
          throw new Error(
            response?.error || "词典删除失败。"
          );
        }
        setStatus?.(
          `${installedPackName(packId, entry, sources)} 已删除。`
        );
        onChanged();
      } catch (error) {
        setStatus?.(
          error?.message || String(error),
          true
        );
        remove.disabled = false;
      }
    });
    actions.append(remove);

    row.append(summary, actions);
    container.appendChild(row);
  }
}

export function installedPackName(
  packId,
  entry,
  sources = OPTIONAL_PACK_SOURCES,
  i18n = defaultI18n
) {
  const displayName =
    String(entry?.display?.name || "").trim();
  if (displayName) return displayName;

  const declared = (Array.isArray(sources) ? sources : [])
    .flatMap((source) => source?.packs || [])
    .find((pack) => pack?.packId === packId);
  return declared?.label || i18n.t("dictionary.value.installed");
}

export function installedPackMeta(entry, i18n = defaultI18n) {
  const active = entry?.active || {};
  const display = entry?.display || null;
  const result = [];
  if (display?.kind === "local-import") {
    result.push(i18n.t("dictionary.value.localImportTag"));
    result.push(i18n.t("dictionary.value.localCompatibility"));
    if (display.formatLabel) {
      result.push(display.formatLabel);
    }
  } else if (display?.kind === "curated-upstream") {
    result.push(i18n.t("dictionary.value.curatedTag"));
    if (display.formatLabel) {
      result.push(display.formatLabel);
    }
  }
  const installedVersion = formatLocalDictionaryVersion(active.packVersion, i18n);
  if (installedVersion !== i18n.t("dictionary.value.versionNotRecorded")) result.push(i18n.t("dictionary.value.installedVersion", { version: installedVersion }));
  const installedDate = formatLocalInstallDate(display?.importedAt || active.verifiedAt);
  if (installedDate) result.push(i18n.t("dictionary.value.installedDate", { date: installedDate }));
  if (Number.isFinite(Number(active.totalBytes))) {
    result.push(i18n.t("dictionary.value.installedBytes", { size: formatDictionaryBytes(Number(active.totalBytes), i18n) }));
  }
  return result;
}

function compareText(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  return left < right ? -1 : left > right ? 1 : 0;
}
