import type { CacheStats, OptionsConfig } from "./client";

export function CacheSection({ config, stats, loading, error, disabled, update, refresh, prune, clear }: { config: OptionsConfig; stats: CacheStats | null; loading: boolean; error: string; disabled: boolean; update: (patch: Partial<OptionsConfig>) => void; refresh: () => void; prune: () => void; clear: () => void }) {
  const confirmClear = () => { if (confirm("确定清空全部网页翻译缓存？API Key 和设置不会删除。")) clear(); };
  return <section id="cache" className="advanced destructive-zone" tabIndex={-1}><h2>缓存</h2><label htmlFor="cacheMaxMB">缓存软上限（MB）</label><input id="cacheMaxMB" disabled={disabled} value={config.cacheMaxMB} onChange={event => update({ cacheMaxMB: Number(event.target.value) })} type="number" min={20} max={2048} step={10} /><p className="hint">默认 200 MB，按最近最少使用（LRU）策略清理超额缓存。</p>
    <div id="cacheStats" className="cache-card" aria-busy={loading}>{loading ? "正在读取缓存统计…" : error ? `读取缓存统计失败：${error}` : stats ? `${stats.pageCount} 个网页 · ${stats.segmentCount} 个翻译段落 · 约 ${formatBytes(stats.bytes)}` : "暂无缓存统计"}</div>
    <div className="actions"><button id="refreshCache" disabled={disabled} onClick={refresh}>刷新统计</button><button id="pruneCache" disabled={disabled} onClick={prune}>按上限立即清理</button><button id="clearAllCache" className="danger" disabled={disabled} onClick={confirmClear}>清空全部翻译缓存</button></div></section>;
}

export function DeveloperSection({ version }: { version: string }) {
  return <section id="developer" className="advanced" tabIndex={-1}><h2>开发者 / 关于</h2><p>TranslateFlow <span id="extensionVersion">v{version}</span> · Popup、通用设置与学习中心使用 React；词典设置保留兼容岛。</p><p className="hint">键盘快捷键管理、Provider 调试与缓存维护均保留在本页对应区域。</p></section>;
}

function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`; if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`; return `${(bytes / 1024 ** 3).toFixed(2)} GB`; }
