import {
  BACKGROUND_MESSAGES
} from "../shared/constants.js";
import {
  OPTIONAL_PACK_SOURCES
} from "../shared/pack-sources.js";

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
    .filter(([, entry]) => entry?.active)
    .sort((a, b) => compareText(
      installedPackName(a[0], a[1], sources),
      installedPackName(b[0], b[1], sources)
    ));

  if (!entries.length) {
    container.textContent =
      "暂无额外安装词典。可从上方下载精选上游词典，或从下方导入本地 StarDict / MDict 文件。";
    return;
  }

  for (const [packId, entry] of entries) {
    const row = document.createElement("div");
    row.className = "site-row dictionary-pack-row";

    const summary = document.createElement("div");
    summary.className = "site-summary";
    const heading = document.createElement("div");
    heading.className = "dictionary-pack-heading";
    const title = document.createElement("strong");
    title.textContent =
      installedPackName(packId, entry, sources);
    const badge = document.createElement("span");
    badge.className = "dictionary-health-badge";
    badge.dataset.kind =
      entry.status === "healthy" ? "success" : "warning";
    badge.textContent =
      entry.status === "healthy" ? "可用" : "需检查";
    heading.append(title, badge);
    summary.appendChild(heading);

    const meta = document.createElement("div");
    meta.className = "dictionary-pack-meta";
    for (const item of installedPackMeta(entry)) {
      const value = document.createElement("span");
      value.textContent = item;
      meta.appendChild(value);
    }
    summary.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "site-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "删除";
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
  sources = OPTIONAL_PACK_SOURCES
) {
  const displayName =
    String(entry?.display?.name || "").trim();
  if (displayName) return displayName;

  const declared = (Array.isArray(sources) ? sources : [])
    .flatMap((source) => source?.packs || [])
    .find((pack) => pack?.packId === packId);
  return declared?.label || "已安装词典";
}

export function installedPackMeta(entry) {
  const active = entry?.active || {};
  const display = entry?.display || null;
  const result = [];
  if (display?.kind === "local-import") {
    result.push("本地导入", "用户提供 · 未验证");
    if (display.formatLabel) {
      result.push(display.formatLabel);
    }
  } else if (display?.kind === "curated-upstream") {
    result.push("精选上游", "上游 / 社区");
    if (display.formatLabel) {
      result.push(display.formatLabel);
    }
    if (display.sourceLabel) {
      result.push(`来源 ${display.sourceLabel}`);
    }
    if (display.licenseLabel) {
      result.push(`许可 ${display.licenseLabel}`);
    }
  }
  if (active.packVersion) {
    result.push(
      `版本 / 导入标识 ${active.packVersion}`
    );
  }
  if (Number.isFinite(Number(active.totalBytes))) {
    result.push(formatBytes(Number(active.totalBytes)));
  }
  return result;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + " KiB";
  }
  return (bytes / (1024 * 1024)).toFixed(1) + " MiB";
}

function compareText(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  return left < right ? -1 : left > right ? 1 : 0;
}
