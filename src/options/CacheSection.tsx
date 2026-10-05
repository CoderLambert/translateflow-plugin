import type { CacheStats, OptionsConfig } from "./client";
import { useOptionsI18n } from "./LocaleContext";

export function CacheSection({ config, stats, loading, error, disabled, update, refresh, prune, clear }: { config: OptionsConfig; stats: CacheStats | null; loading: boolean; error: string; disabled: boolean; update: (patch: Partial<OptionsConfig>) => void; refresh: () => void; prune: () => void; clear: () => void }) {
  const i18n = useOptionsI18n();
  const confirmClear = () => { if (confirm(i18n.t("options.cache.confirm"))) clear(); };
  return <section id="cache" className="advanced destructive-zone" tabIndex={-1}><h2>{i18n.t("options.cache.title")}</h2><label htmlFor="cacheMaxMB">{i18n.t("options.cache.limit")}</label><input id="cacheMaxMB" disabled={disabled} value={config.cacheMaxMB} onChange={event => update({ cacheMaxMB: Number(event.target.value) })} type="number" min={20} max={2048} step={10} /><p className="hint">{i18n.t("options.cache.limitHelp")}</p>
    <div id="cacheStats" className="cache-card" aria-busy={loading}>{loading ? i18n.t("options.cache.loading") : error ? i18n.t("options.cache.error", { message: error }) : stats ? i18n.t("options.cache.stats", { pages: stats.pageCount, segments: stats.segmentCount, bytes: formatBytes(stats.bytes) }) : i18n.t("options.cache.empty")}</div>
    <div className="actions"><button id="refreshCache" disabled={disabled} onClick={refresh}>{i18n.t("options.cache.refresh")}</button><button id="pruneCache" disabled={disabled} onClick={prune}>{i18n.t("options.cache.prune")}</button><button id="clearAllCache" className="danger" disabled={disabled} onClick={confirmClear}>{i18n.t("options.cache.clear")}</button></div></section>;
}

export function DeveloperSection({ version }: { version: string }) {
  const i18n = useOptionsI18n();
  return <section id="developer" className="advanced" tabIndex={-1}><h2>{i18n.t("options.developer.title")}</h2><p id="extensionVersion">{i18n.t("options.developer.summary", { version })}</p><p className="hint">{i18n.t("options.developer.help")}</p></section>;
}

function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`; if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`; return `${(bytes / 1024 ** 3).toFixed(2)} GB`; }
