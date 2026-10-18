import { OPTIONAL_PACK_SOURCES } from "../shared/pack-sources.js";
import {
  formatDictionaryBytes,
  formatLocalDictionaryVersion,
  formatLocalInstallDate
} from "./dictionary-library-v2-presentation.js";

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
    result.push("本地导入 · 用户提供 / 未验证");
    result.push("兼容性 当前版本可使用");
    if (display.formatLabel) {
      result.push(display.formatLabel);
    }
  } else if (display?.kind === "curated-upstream") {
    result.push("精选上游 · 非官方");
    if (display.formatLabel) {
      result.push(display.formatLabel);
    }
  }
  const installedVersion = formatLocalDictionaryVersion(active.packVersion);
  if (installedVersion !== "未记录") result.push(`本地安装版本 ${installedVersion}`);
  const installedDate = formatLocalInstallDate(display?.importedAt || active.verifiedAt);
  if (installedDate) result.push(`本机安装日期 ${installedDate}`);
  if (Number.isFinite(Number(active.totalBytes))) {
    result.push(`已安装大小 ${formatDictionaryBytes(Number(active.totalBytes))}`);
  }
  return result;
}
