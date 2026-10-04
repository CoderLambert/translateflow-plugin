import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { CacheSection, DeveloperSection } from "./CacheSection";
import { AppearanceSection, GeneralSection, ProviderSections, SelectionSection, ShortcutsSection, YoutubeSection } from "./CommonSections";
import { DictionarySection, createDictionaryClient } from "./DictionarySection";
import { GlossarySection } from "./GlossarySection";
import { BehaviorSection, SitesSection } from "./SiteSections";
import { UiLocaleSection } from "./UiLocaleSection";
import { optionsClient } from "./client";
import { glossaryClient } from "./glossary-client";
import { useOptions } from "./useOptions";

const navItems = [["general", "通用"], ["selection", "划词翻译"], ["appearance", "外观"], ["youtube", "YouTube"], ["sites", "站点"], ["auto-sites", "自动行为"], ["glossary", "术语表"], ["dictionary-packs", "词典库"], ["provider", "Provider"], ["cache", "缓存"], ["developer", "开发者 / 关于"]] as const;

export function App({ client: provided }: { client?: ReturnType<typeof optionsClient> }) {
  const client = useMemo(() => provided ?? optionsClient(), [provided]);
  const glossary = useMemo(() => glossaryClient(), []);
  const dictionaries = useMemo(() => createDictionaryClient(), []);
  const ui = useOptions(client);
  const [activeHash, setActiveHash] = useState(() => validHash(location.hash));
  const setStatus = useCallback((message: string, error = false) => ui.setStatus(message, error), [ui.setStatus]);
  useEffect(() => {
    const changed = () => setActiveHash(validHash(location.hash));
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  function navigate(event: React.MouseEvent<HTMLAnchorElement>, id: string) {
    event.preventDefault(); const hash = `#${id}`; history.replaceState(null, "", hash); setActiveHash(hash);
    const target = document.getElementById(id); if (!target) return;
    target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); target.focus({ preventScroll: true });
  }
  function onEscape(event: React.KeyboardEvent) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const link = document.querySelector<HTMLAnchorElement>(`.settings-nav a[href="${activeHash}"]`); if (link) { event.preventDefault(); link.focus(); }
  }
  const update = useCallback((patch: object) => ui.setConfig(value => value ? { ...value, ...patch } : value), [ui.setConfig]);
  const config = ui.config;
  return <div className="settings-shell" onKeyDown={onEscape}>
    <nav className="settings-nav" aria-label="设置分类"><div className="nav-brand"><span className="nav-brand-mark" aria-hidden="true">译</span><strong>TranslateFlow</strong></div>
      {navItems.map(([id, label], index) => <Fragment key={id}>{index === 8 ? <span>高级</span> : null}<a data-settings-nav href={`#${id}`} aria-current={activeHash === `#${id}` ? "page" : undefined} onClick={event => navigate(event, id)}>{label}</a></Fragment>)}
    </nav>
    <main><header className="settings-intro"><span className="section-kicker">TRANSLATEFLOW SETTINGS</span><h1>设置</h1><p className="lead">管理翻译行为、阅读外观、Provider、站点规则与本地缓存。高级配置保持可见，但不会抢占日常设置。</p></header>
      {!config ? <section className="tf-card" aria-busy={!ui.loadError}>{ui.loadError ? <><p role="alert">读取设置失败：{ui.loadError}</p><button type="button" onClick={() => void ui.loadConfig()}>重试</button></> : <p>正在读取设置…</p>}</section> : <>
        <GeneralSection config={config} disabled={ui.busy} update={update} /><UiLocaleSection /><SelectionSection config={config} disabled={ui.busy} update={update} /><AppearanceSection config={config} disabled={ui.busy} update={update} /><YoutubeSection config={config} disabled={ui.busy} update={update} /><ShortcutsSection />
        <SitesSection entries={ui.profiles.value} loading={ui.profiles.loading} error={ui.profiles.error} disabled={ui.busy} retry={() => void ui.refreshProfiles()} save={ui.saveProfile} remove={ui.deleteProfile} />
        <BehaviorSection restoreSites={ui.restoreSites.value} autoSites={ui.autoSites.value} loading={ui.restoreSites.loading || ui.autoSites.loading} errors={[ui.restoreSites.error, ui.autoSites.error]} disabled={ui.busy} refresh={() => void ui.refreshBehaviors()} remove={(key, origin) => void ui.removeBehavior(key, origin)} />
      </>}
      <GlossarySection client={glossary} setStatus={setStatus} />
      <DictionarySection client={dictionaries} setStatus={setStatus} />
      {config ? <>
        <ProviderSections config={config} disabled={ui.busy} update={update} />
        <CacheSection config={config} stats={ui.cache.value} loading={ui.cache.loading} error={ui.cache.error} disabled={ui.busy} update={update} refresh={() => void ui.refreshCache()} prune={() => void ui.prune()} clear={() => void ui.clear()} />
        <DeveloperSection version={client.version} />
        <div className="sticky-actions"><button id="save" className="primary" disabled={ui.busy} onClick={event => { if (event.nativeEvent.isTrusted) void ui.save(false); }}>保存全局设置</button><button id="test" disabled={ui.busy} onClick={event => { if (event.nativeEvent.isTrusted) void ui.save(true); }}>测试当前默认 Provider</button></div>
      </> : null}
      <div id="status" className={`status${ui.status.error ? " error" : ""}`} role="status" aria-live="polite">{ui.status.message}</div>
    </main>
  </div>;
}

function validHash(value: string) { return navItems.some(([id]) => value === `#${id}`) ? value : "#general"; }
