import { useMemo } from "react";
import { CONTENT_MESSAGES } from "../shared/constants.js";
import { TRANSLATION_PRESETS } from "../shared/presets.js";
import { popupClient, type ToggleStatus } from "./client";
import { contextHint, usePopup } from "./usePopup";

export function App({ client: provided }: { client?: ReturnType<typeof popupClient> }) {
  const client = useMemo(() => provided ?? popupClient(), [provided]);
  const ui = usePopup(client);
  const context = ui.context.value;
  const cache = ui.cache.value;
  const auto = ui.auto.value;
  const cacheRestore = ui.cacheRestore.value;
  const quick = ui.quick.value;
  const appearance = ui.appearance.value;
  const cacheText = useMemo(() => {
    if (ui.cache.loading) return "正在检查本页缓存…";
    if (!cache) return ui.cache.error || "普通 http/https 网页可使用翻译缓存";
    const time = cache.lastAccessedAt ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(cache.lastAccessedAt)) : "";
    if (cache.count > 0) { const old = Math.max(0, cache.totalCount - cache.count); return `当前配置 ${cache.count} 条${old ? ` · 历史版本 ${old} 条` : ""}${time ? ` · ${time}` : ""}`; }
    return cache.totalCount > 0 ? `当前配置暂无缓存 · 另有 ${cache.totalCount} 条历史配置缓存` : "本页暂无翻译缓存";
  }, [cache, ui.cache.error, ui.cache.loading]);

  return <main className="popup-shell">
    <header className="popup-header">
      <div className="brand"><div className="brand-mark" aria-hidden="true">译</div><div className="brand-copy"><strong>TranslateFlow</strong><span>安静地翻译当前网页</span></div></div>
      <div className="header-actions"><span className="ready-badge"><span aria-hidden="true" />{ui.busy ? "处理中" : "就绪"}</span><button id="settings" className="icon-btn" aria-label="打开高级设置" title="高级设置" onClick={() => void client.openOptions()}>⚙</button></div>
    </header>

    <section id="effectiveContext" className="page-card" hidden={!context} aria-label="当前翻译配置" aria-busy={ui.context.loading}>
      <div className="page-card-head"><div className="site-icon" aria-hidden="true">🌐</div><div className="site-copy"><span className="section-kicker">当前页面</span><strong id="contextSite">{context?.hostname || context?.origin || "—"}</strong></div></div>
      <div className="context-grid"><span>翻译模式</span><strong id="contextMode">{context?.hasSitePromptOverride ? "Custom Prompt" : context?.presetLabel || "Default"}</strong><span>模型服务</span><strong><span id="contextProvider">{formatProvider(context?.provider)}</span> · <span id="contextModel">{context?.model || "—"}</span></strong></div>
    </section>
    {ui.context.error ? <div className="preset-hint" role="alert">{ui.context.error} <button type="button" onClick={() => void ui.refreshContext()}>重试</button></div> : null}

    <div className="learning-center-nav"><button id="learningCenter" className="learning-center-link" onClick={() => void ui.openLearning()}>{ui.learningLabel}</button></div>

    <section className="primary-section" aria-label="页面翻译">
      <button id="translate" className="tf-button tf-button--primary primary-action" disabled={ui.busy} onClick={() => void ui.translate()}>翻译当前页面</button>
      <button id="cancelTask" className="tf-button cancel-task" hidden={!ui.translating} onClick={() => void ui.cancel()}>取消当前翻译</button>
      <div id="status" className={`status-banner${ui.notice.error ? " error" : ""}`} role="status" aria-live="polite">{ui.notice.message}</div>
    </section>

    <section className="control-card tf-card" aria-label="页面偏好">
      <div className="control-row"><div className="control-copy"><strong>自动翻译</strong><div id="autoInfo" className="supporting">{toggleText("auto", ui.auto.loading, auto, ui.auto.error)}</div></div>
        <button id="autoSite" className="toggle-button" role="switch" aria-checked={Boolean(auto?.enabled)} aria-label={auto?.enabled ? "关闭本站自动翻译" : "开启本站自动翻译"} disabled={ui.busy || !auto} onClick={event => { if (event.nativeEvent.isTrusted) void ui.toggleSite("auto", ui.auto); }}><span className="toggle-track" aria-hidden="true" /></button></div>
      <label className="field-row" htmlFor="appearanceSelect"><span className="control-copy"><strong>阅读外观</strong><small>仅调整译文排版，不改变翻译结果</small></span>
        <select id="appearanceSelect" className="tf-select appearance-select" aria-label="本站阅读外观" disabled={ui.busy || ui.appearance.loading || !appearance?.available} value={appearance?.selected || ""} title={appearance?.title || ui.appearance.error} onChange={event => void ui.changeAppearance(event.target.value)}>
          <option value="">跟随默认 · {labelFor(client, appearance?.defaultId)}</option>{client.appearances.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
    </section>

    <details className="secondary-card tf-accordion"><summary>翻译模式与页面控制</summary><div className="secondary-content">
      <label className="preset-label" htmlFor="presetSelect">翻译模式</label>
      <select id="presetSelect" className="tf-select" disabled={ui.busy} value={ui.preset} onChange={event => ui.setPreset(event.target.value)}><option value="inherit">继承本站设置</option><option value="none">无 Preset / 使用默认 Prompt</option>{TRANSLATION_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label} · {item.description}</option>)}</select>
      <div className="row preset-actions"><button id="applyPreset" className="tf-button tf-button--secondary" disabled={ui.busy} onClick={() => void ui.applyPreset(false)}>临时应用</button><button id="savePreset" className="tf-button tf-button--secondary" disabled={ui.busy} onClick={() => void ui.applyPreset(true)}>保存到本站</button></div>
      <div id="presetHint" className="preset-hint">{context ? contextHint(context) : ui.context.loading ? "正在读取当前配置…" : ui.context.error}</div>
      <div className="row maintenance-actions"><button id="toggle" className="tf-button tf-button--ghost" disabled={ui.busy} onClick={() => void ui.pageAction(CONTENT_MESSAGES.TOGGLE_TRANSLATIONS)}>显示 / 隐藏译文</button><button id="clear" className="tf-button tf-button--ghost" disabled={ui.busy} onClick={() => void ui.pageAction(CONTENT_MESSAGES.CLEAR_TRANSLATIONS)}>移除页面译文</button></div>
    </div></details>

    <details className="secondary-card tf-accordion"><summary>Quick Control 与缓存</summary><div className="secondary-content stacked-actions">
      <SiteSetting id="quickControl" text={toggleText("quick", ui.quick.loading, quick, ui.quick.error)} label={quick?.hidden ? "在当前页重新显示 Quick Control" : quick?.enabled ? "关闭本站持久 Quick Control" : "以后在本站自动显示 Quick Control"} enabled={Boolean(quick?.enabled)} disabled={ui.busy || !quick} onClick={(trusted) => { if (trusted) void ui.toggleSite("quick", ui.quick); }} />
      <SiteSetting id="cacheRestore" text={toggleText("cache", ui.cacheRestore.loading, cacheRestore, ui.cacheRestore.error)} label={cacheRestore?.enabled ? "关闭本站自动缓存恢复" : "以后进入本站自动恢复缓存"} enabled={Boolean(cacheRestore?.enabled)} disabled={ui.busy || !cacheRestore} onClick={(trusted) => { if (trusted) void ui.toggleSite("cache", ui.cacheRestore); }} />
      <div className="setting-block cache-block"><div id="cacheInfo" className="supporting">{cacheText}</div>{ui.cache.error ? <button type="button" onClick={() => void ui.refreshCache()}>重试缓存状态</button> : null}<button id="restore" className="tf-button tf-button--secondary" disabled={ui.busy} onClick={() => void ui.pageAction(CONTENT_MESSAGES.RESTORE_CACHE)}>仅恢复本页缓存</button><button id="clearCache" className="tf-button danger-lite" disabled={ui.busy || cache?.totalCount === 0} onClick={() => void ui.pageAction(CONTENT_MESSAGES.CLEAR_PAGE_CACHE)}>删除本页全部缓存版本</button></div>
    </div></details>
  </main>;
}

function SiteSetting({ id, text, label, enabled, disabled, onClick }: { id: string; text: string; label: string; enabled: boolean; disabled: boolean; onClick: (trusted: boolean) => void }) {
  return <div className="setting-block"><div id={`${id}Info`} className="supporting">{text}</div><button id={`${id}Site`} className={`tf-button tf-button--secondary quick-btn${enabled ? " enabled" : ""}`} disabled={disabled} onClick={event => onClick(event.nativeEvent.isTrusted)}>{label}</button></div>;
}

function toggleText(kind: "auto" | "cache" | "quick", pending: boolean, value: ToggleStatus | null, error: string) {
  if (pending) return kind === "quick" ? "正在检查 Quick Control…" : kind === "cache" ? "正在检查自动缓存恢复…" : "正在检查本站设置…";
  if (!value) return error;
  if (kind === "quick") return value.hidden ? "Quick Control：本站已隐藏" : value.enabled ? `Quick Control：本站持久显示（${value.origin}）` : "Quick Control：仅在主动使用 TranslateFlow 的当前标签页显示";
  if (kind === "cache") return value.enabled ? `本站自动缓存恢复：已开启（${value.origin}）` : "本站自动缓存恢复：未开启";
  return value.enabled ? `本站自动增量翻译：已开启（${value.origin}）` : "本站自动增量翻译：未开启";
}
function formatProvider(value?: string) { return value === "openai-compatible" ? "OpenAI-compatible" : value === "deepseek" ? "DeepSeek" : value || "—"; }
function labelFor(client: ReturnType<typeof popupClient>, id?: string) { return client.appearances.find(item => item.id === id)?.label || "Standard"; }
