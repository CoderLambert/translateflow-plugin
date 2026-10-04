import { useMemo } from "react";
import { CONTENT_MESSAGES } from "../shared/constants.js";
import { TRANSLATION_PRESETS } from "../shared/presets.js";
import type { I18n } from "../i18n/index.js";
import { popupClient, type ToggleStatus } from "./client";
import { contextHint, localizedPresetLabel, usePopup } from "./usePopup";
import { useLocale } from "./useLocale";

export function App({ client: provided }: { client?: ReturnType<typeof popupClient> }) {
  const locale = useLocale();
  const client = useMemo(() => provided ?? popupClient(chrome, locale.i18n), [provided, locale.i18n]);
  const ui = usePopup(client, locale.i18n, locale.ready);
  const { i18n } = locale;
  const context = ui.context.value;
  const cache = ui.cache.value;
  const auto = ui.auto.value;
  const cacheRestore = ui.cacheRestore.value;
  const quick = ui.quick.value;
  const appearance = ui.appearance.value;
  const cacheText = useMemo(() => {
    if (ui.cache.loading) return i18n.t("popup.cacheChecking");
    if (!cache) return ui.cache.error || i18n.t("popup.cacheUnsupported");
    if (cache.count > 0) {
      const parts = [i18n.t("popup.cacheCurrent", { count: cache.count })];
      const historical = Math.max(0, cache.totalCount - cache.count);
      if (historical) parts.push(i18n.t("popup.cacheHistorical", { count: historical }));
      if (cache.lastAccessedAt) parts.push(i18n.t("popup.cacheLastUsed", { date: i18n.formatDateTime(new Date(cache.lastAccessedAt), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) }));
      return parts.join(" · ");
    }
    return cache.totalCount > 0 ? i18n.t("popup.cacheNoneCurrent", { count: cache.totalCount }) : i18n.t("popup.cacheNone");
  }, [cache, i18n, ui.cache.error, ui.cache.loading]);

  if (!locale.ready) return <main className="popup-shell" aria-busy="true">
    {locale.error ? <div className="status-banner error" role="alert">{i18n.t("settings.readError")} <button type="button" onClick={locale.retry}>{i18n.t("common.retry")}</button></div> : null}
  </main>;

  return <main className="popup-shell">
    <header className="popup-header">
      <div className="brand"><div className="brand-mark" aria-hidden="true">{i18n.t("content.brandMark")}</div><div className="brand-copy"><strong>TranslateFlow</strong><span>{i18n.t("popup.brandTagline")}</span></div></div>
      <div className="header-actions"><span className="ready-badge"><span aria-hidden="true" />{i18n.t(ui.busy ? "common.working" : "common.ready")}</span><button id="settings" className="icon-btn" aria-label={i18n.t("popup.openSettings")} title={i18n.t("popup.openSettings")} onClick={() => void client.openOptions()}>⚙</button></div>
    </header>

    <section id="effectiveContext" className="page-card" hidden={!context} aria-label={i18n.t("popup.currentContext")} aria-busy={ui.context.loading}>
      <div className="page-card-head"><div className="site-icon" aria-hidden="true">🌐</div><div className="site-copy"><span className="section-kicker">{i18n.t("popup.currentPage")}</span><strong id="contextSite">{context?.hostname || context?.origin || "—"}</strong></div></div>
      <div className="context-grid"><span>{i18n.t("popup.translationMode")}</span><strong id="contextMode">{context?.hasSitePromptOverride ? i18n.t("popup.contextModeCustomPrompt") : context?.presetId ? localizedPresetLabel(context.presetId, i18n) : i18n.t("popup.contextModeDefault")}</strong><span>{i18n.t("popup.modelService")}</span><strong><span id="contextProvider">{formatProvider(context?.provider)}</span> · <span id="contextModel">{context?.model || "—"}</span></strong></div>
    </section>
    {ui.context.error ? <div className="preset-hint" role="alert">{ui.context.error} <button type="button" onClick={() => void ui.refreshContext()}>{i18n.t("common.retry")}</button></div> : null}

    <div className="learning-center-nav"><button id="learningCenter" className="learning-center-link" onClick={() => void ui.openLearning()}>{i18n.t("learning.title")}</button></div>

    <section className="primary-section" aria-label={i18n.t("popup.pageTranslation")}>
      <button id="translate" className="tf-button tf-button--primary primary-action" disabled={ui.busy} onClick={() => void ui.translate()}>{i18n.t("popup.translatePage")}</button>
      <button id="cancelTask" className="tf-button cancel-task" hidden={!ui.translating} onClick={() => void ui.cancel()}>{i18n.t("popup.cancelTranslation")}</button>
      <div id="status" className={`status-banner${ui.notice.error ? " error" : ""}`} role="status" aria-live="polite">{ui.notice.message}</div>
    </section>

    <section className="control-card tf-card" aria-label={i18n.t("popup.pagePreferences")}>
      <div className="control-row"><div className="control-copy"><strong>{i18n.t("popup.autoTranslation")}</strong><div id="autoInfo" className="supporting">{toggleText("auto", ui.auto.loading, auto, ui.auto.error, i18n)}</div></div>
        <button id="autoSite" className="toggle-button" role="switch" aria-checked={Boolean(auto?.enabled)} aria-label={i18n.t(auto?.enabled ? "popup.disableAuto" : "popup.enableAuto")} disabled={ui.busy || !auto} onClick={event => { if (event.nativeEvent.isTrusted) void ui.toggleSite("auto", ui.auto); }}><span className="toggle-track" aria-hidden="true" /></button></div>
      <label className="field-row" htmlFor="appearanceSelect"><span className="control-copy"><strong>{i18n.t("popup.readingAppearance")}</strong><small>{i18n.t("popup.appearanceHelp")}</small></span>
        <select id="appearanceSelect" className="tf-select appearance-select" aria-label={i18n.t("popup.siteAppearance")} disabled={ui.busy || ui.appearance.loading || !appearance?.available} value={appearance?.selected || ""} title={appearance?.title || ui.appearance.error} onChange={event => void ui.changeAppearance(event.target.value)}>
          <option value="">{i18n.t("popup.followDefault", { appearance: appearanceLabel(appearance?.defaultId, i18n) })}</option>{client.appearances.map(item => <option key={item.id} value={item.id}>{appearanceLabel(item.id, i18n)}</option>)}
        </select></label>
    </section>

    <details className="secondary-card tf-accordion"><summary>{i18n.t("popup.modeAndControls")}</summary><div className="secondary-content">
      <label className="preset-label" htmlFor="presetSelect">{i18n.t("popup.translationMode")}</label>
      <select id="presetSelect" className="tf-select" disabled={ui.busy} value={ui.preset} onChange={event => ui.setPreset(event.target.value)}><option value="inherit">{i18n.t("popup.inheritSite")}</option><option value="none">{i18n.t("popup.noPreset")}</option>{TRANSLATION_PRESETS.map(item => <option key={item.id} value={item.id}>{localizedPresetLabel(item.id, i18n)} · {i18n.t(`preset.${item.id}.description` as "preset.technical.description")}</option>)}</select>
      <div className="row preset-actions"><button id="applyPreset" className="tf-button tf-button--secondary" disabled={ui.busy} onClick={() => void ui.applyPreset(false)}>{i18n.t("popup.applyTemporarily")}</button><button id="savePreset" className="tf-button tf-button--secondary" disabled={ui.busy} onClick={() => void ui.applyPreset(true)}>{i18n.t("popup.saveToSite")}</button></div>
      <div id="presetHint" className="preset-hint">{context ? contextHint(context, i18n) : ui.context.loading ? i18n.t("popup.loadingContext") : ui.context.error}</div>
      <div className="row maintenance-actions"><button id="toggle" className="tf-button tf-button--ghost" disabled={ui.busy} onClick={() => void ui.pageAction(CONTENT_MESSAGES.TOGGLE_TRANSLATIONS)}>{i18n.t("popup.toggleTranslations")}</button><button id="clear" className="tf-button tf-button--ghost" disabled={ui.busy} onClick={() => void ui.pageAction(CONTENT_MESSAGES.CLEAR_TRANSLATIONS)}>{i18n.t("popup.clearTranslations")}</button></div>
    </div></details>

    <details className="secondary-card tf-accordion"><summary>{i18n.t("popup.quickAndCache")}</summary><div className="secondary-content stacked-actions">
      <SiteSetting id="quickControl" text={toggleText("quick", ui.quick.loading, quick, ui.quick.error, i18n)} label={i18n.t(quick?.hidden ? "popup.showQuickHere" : quick?.enabled ? "popup.disableQuickSite" : "popup.enableQuickSite")} enabled={Boolean(quick?.enabled)} disabled={ui.busy || !quick} onClick={(trusted) => { if (trusted) void ui.toggleSite("quick", ui.quick); }} />
      <SiteSetting id="cacheRestore" text={toggleText("cache", ui.cacheRestore.loading, cacheRestore, ui.cacheRestore.error, i18n)} label={i18n.t(cacheRestore?.enabled ? "popup.disableCacheRestore" : "popup.enableCacheRestore")} enabled={Boolean(cacheRestore?.enabled)} disabled={ui.busy || !cacheRestore} onClick={(trusted) => { if (trusted) void ui.toggleSite("cache", ui.cacheRestore); }} />
      <div className="setting-block cache-block"><div id="cacheInfo" className="supporting">{cacheText}</div>{ui.cache.error ? <button type="button" onClick={() => void ui.refreshCache()}>{i18n.t("popup.retryCache")}</button> : null}<button id="restore" className="tf-button tf-button--secondary" disabled={ui.busy} onClick={() => void ui.pageAction(CONTENT_MESSAGES.RESTORE_CACHE)}>{i18n.t("popup.restoreCache")}</button><button id="clearCache" className="tf-button danger-lite" disabled={ui.busy || cache?.totalCount === 0} onClick={() => void ui.pageAction(CONTENT_MESSAGES.CLEAR_PAGE_CACHE)}>{i18n.t("popup.clearPageCache")}</button></div>
    </div></details>
  </main>;
}

function SiteSetting({ id, text, label, enabled, disabled, onClick }: { id: string; text: string; label: string; enabled: boolean; disabled: boolean; onClick: (trusted: boolean) => void }) {
  return <div className="setting-block"><div id={`${id}Info`} className="supporting">{text}</div><button id={`${id}Site`} className={`tf-button tf-button--secondary quick-btn${enabled ? " enabled" : ""}`} disabled={disabled} onClick={event => onClick(event.nativeEvent.isTrusted)}>{label}</button></div>;
}

function toggleText(kind: "auto" | "cache" | "quick", pending: boolean, value: ToggleStatus | null, error: string, i18n: I18n) {
  if (pending) return i18n.t(kind === "quick" ? "popup.quickChecking" : kind === "cache" ? "popup.cacheRestoreChecking" : "popup.siteSettingChecking");
  if (!value) return error;
  if (kind === "quick") return value.hidden ? i18n.t("popup.quickHidden") : value.enabled ? i18n.t("popup.quickPersistent", { origin: value.origin }) : i18n.t("popup.quickCurrentTab");
  if (kind === "cache") return value.enabled ? i18n.t("popup.cacheRestoreEnabled", { origin: value.origin }) : i18n.t("popup.cacheRestoreDisabled");
  return value.enabled ? i18n.t("popup.autoEnabled", { origin: value.origin }) : i18n.t("popup.autoDisabled");
}
function formatProvider(value?: string) { return value === "openai-compatible" ? "OpenAI-compatible" : value === "deepseek" ? "DeepSeek" : value || "—"; }
function appearanceLabel(id: unknown, i18n: I18n) {
  const normalized = String(id || "standard");
  return (["standard", "compact", "reading", "minimal"] as const).includes(normalized as "standard")
    ? i18n.t(`appearance.${normalized}.label` as "appearance.standard.label") : normalized;
}
