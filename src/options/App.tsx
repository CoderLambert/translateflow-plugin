import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CacheSection, DeveloperSection } from "./CacheSection";
import { AppearanceSection, GeneralSection, ProviderSections, SelectionSection, ShortcutsSection, YoutubeSection } from "./CommonSections";
import { DictionarySection, createDictionaryClient } from "./DictionarySection";
import { GlossarySection } from "./GlossarySection";
import { LocaleProvider } from "./LocaleContext";
import { BehaviorSection, SitesSection } from "./SiteSections";
import { UiLocaleSection } from "./UiLocaleSection";
import { optionsClient } from "./client";
import { glossaryClient } from "./glossary-client";
import { useLocale } from "./useLocale";
import { useOptions } from "./useOptions";
import { MachineTranslationSection } from "./MachineTranslationSection";
import { SettingSwitch } from "./SettingSwitch";

const navItems = [
  ["general", "options.nav.general"], ["selection", "options.nav.selection"], ["appearance", "options.nav.appearance"],
  ["youtube", "options.nav.youtube"], ["sites", "options.nav.sites"], ["auto-sites", "options.nav.behavior"],
  ["glossary", "options.nav.glossary"], ["dictionary-packs", "options.nav.dictionaries"], ["provider", "options.nav.provider"],
  ["cache", "options.nav.cache"], ["developer", "options.nav.developer"]
] as const;

export function App({ client: provided }: { client?: ReturnType<typeof optionsClient> }) {
  const locale = useLocale();
  const client = useMemo(() => provided ?? optionsClient(chrome, locale.i18n), [provided, locale.i18n]);
  const glossary = useMemo(() => glossaryClient(), []);
  const dictionaries = useMemo(() => createDictionaryClient(), []);
  const ui = useOptions(client, locale.i18n, locale.ready);
  const [activeHash, setActiveHash] = useState(() => validHash(location.hash));
  const focusRequested = useRef(Boolean(location.hash));
  const setStatus = useCallback((message: string, error = false) => ui.setStatus(message, error), [ui.setStatus]);
  useEffect(() => {
    const readHash = () => {
      const hash = validHash(location.hash);
      if (location.hash !== hash) history.replaceState(history.state, "", hash);
      return hash;
    };
    const changed = () => { focusRequested.current = true; setActiveHash(readHash()); };
    setActiveHash(readHash());
    window.addEventListener("hashchange", changed);
    window.addEventListener("popstate", changed);
    return () => { window.removeEventListener("hashchange", changed); window.removeEventListener("popstate", changed); };
  }, []);
  const contentReady = Boolean(ui.config) && locale.ready;
  useEffect(() => {
    if (contentReady && focusRequested.current) {
      focusRequested.current = false;
      focusPanel(activeHash);
    }
  }, [activeHash, contentReady]);
  function navigate(event: React.MouseEvent<HTMLAnchorElement>, id: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const hash = `#${id}`;
    if (activeHash === hash && contentReady) { focusPanel(hash); return; }
    if (location.hash !== hash) history.pushState(null, "", hash);
    focusRequested.current = true;
    setActiveHash(hash);
  }
  function onEscape(event: React.KeyboardEvent) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const link = document.querySelector<HTMLAnchorElement>(`.settings-nav a[href="${activeHash}"]`); if (link) { event.preventDefault(); link.focus(); }
  }
  const update = useCallback((patch: object) => ui.setConfig(value => value ? { ...value, ...patch } : value), [ui.setConfig]);
  const config = ui.config, i18n = locale.i18n;
  const localeSection = <UiLocaleSection i18n={i18n} locale={locale.locale} ready={locale.ready} busy={locale.busy} status={locale.status} save={locale.save} retry={locale.retry} />;

  if (!locale.ready) return <LocaleProvider value={i18n}><div className="settings-shell" aria-busy="true"><main>{locale.status ? localeSection : null}</main></div></LocaleProvider>;

  return <LocaleProvider value={i18n}><div className="settings-shell" onKeyDown={onEscape}>
    <nav className="settings-nav" aria-label={i18n.t("options.navAria")}><div className="nav-brand"><span className="nav-brand-mark" aria-hidden="true">{i18n.t("content.brandMark")}</span><strong>TranslateFlow</strong></div>
      {navItems.map(([id, key], index) => <Fragment key={id}>{index === 7 ? <span>{i18n.t("options.nav.advanced")}</span> : null}<a id={`settings-nav-${id}`} data-settings-nav href={`#${id}`} aria-controls={`settings-panel-${id}`} aria-current={activeHash === `#${id}` ? "page" : undefined} onClick={event => navigate(event, id)}>{i18n.t(key)}</a></Fragment>)}
    </nav>
    <main><header className="settings-intro"><span className="section-kicker">{i18n.t("options.kicker")}</span><h1>{i18n.t("options.title")}</h1><p className="lead">{i18n.t("options.lead")}</p></header>
      {!config ? <section className="tf-card" aria-busy={!ui.loadError}>{ui.loadError ? <><p role="alert">{i18n.t("options.loadFailed", { message: ui.loadError })}</p><button type="button" onClick={() => void ui.loadConfig()}>{i18n.t("common.retry")}</button></> : <p>{i18n.t("options.loading")}</p>}</section> : <>
        <SettingsPanel id="general" activeHash={activeHash}><MachineTranslationSection /><GeneralSection config={config} disabled={ui.busy} update={update} />{localeSection}<ShortcutsSection /></SettingsPanel>
        <SettingsPanel id="selection" activeHash={activeHash}><SelectionSection config={config} disabled={ui.busy} update={update} /></SettingsPanel>
        <SettingsPanel id="appearance" activeHash={activeHash}><AppearanceSection config={config} disabled={ui.busy} update={update} /></SettingsPanel>
        <SettingsPanel id="youtube" activeHash={activeHash}><YoutubeSection config={config} disabled={ui.busy} update={update} /></SettingsPanel>
        <SettingsPanel id="sites" activeHash={activeHash}>
        <SitesSection entries={ui.profiles.value} connections={ui.connections.value?.connections || []} loading={ui.profiles.loading} error={ui.profiles.error} disabled={ui.busy} retry={() => void ui.refreshProfiles()} save={ui.saveProfile} remove={ui.deleteProfile} />
        </SettingsPanel>
        <SettingsPanel id="auto-sites" activeHash={activeHash}>
        <BehaviorSection restoreSites={ui.restoreSites.value} autoSites={ui.autoSites.value} loading={ui.restoreSites.loading || ui.autoSites.loading} errors={[ui.restoreSites.error, ui.autoSites.error]} disabled={ui.busy} refresh={() => void ui.refreshBehaviors()} remove={(key, origin) => void ui.removeBehavior(key, origin)} />
        </SettingsPanel>
      </>}
      <SettingsPanel id="glossary" activeHash={activeHash}><GlossarySection client={glossary} setStatus={setStatus} /></SettingsPanel>
      {config ? <SettingsPanel id="dictionary-packs" activeHash={activeHash}><DictionarySection client={dictionaries} setStatus={setStatus} /></SettingsPanel> : null}
      {config ? <>
        <SettingsPanel id="provider" activeHash={activeHash}>
        <ProviderSections config={config} disabled={ui.busy} update={update} client={client} connections={ui.connections.value} loading={ui.connections.loading} error={ui.connections.error} reload={ui.refreshConnections} setStatus={setStatus} />
        </SettingsPanel>
        <SettingsPanel id="cache" activeHash={activeHash}>
        <CacheSection config={config} stats={ui.cache.value} loading={ui.cache.loading} error={ui.cache.error} disabled={ui.busy} update={update} refresh={() => void ui.refreshCache()} prune={() => void ui.prune()} clear={() => void ui.clear()} />
        </SettingsPanel>
        <SettingsPanel id="developer" activeHash={activeHash}><DeveloperSection version={client.version} /></SettingsPanel>
        <div className="sticky-actions"><small>{i18n.t("mt.otherScope")}</small><button id="save" className="primary" disabled={ui.busy} onClick={event => { if (event.nativeEvent.isTrusted) void ui.save(false); }}>{i18n.t("mt.saveOther")}</button>{activeHash === "#provider" ? <button id="test" disabled={ui.busy} onClick={event => { if (event.nativeEvent.isTrusted) void ui.save(true); }}>{i18n.t("options.testProvider")}</button> : null}</div>
      </> : null}
      <div id="status" className={`status${ui.status.error ? " error" : ""}`} role="status" aria-live="polite">{ui.status.message}</div>
    </main>
  </div></LocaleProvider>;
}

function validHash(value: string) { return navItems.some(([id]) => value === `#${id}`) ? value : "#general"; }

// Keep owners mounted: hiding a panel must not reset drafts or dispose native models/imports.
function SettingsPanel({ id, activeHash, children }: { id: string; activeHash: string; children: React.ReactNode }) {
  return <div id={`settings-panel-${id}`} className="settings-panel" data-settings-panel={id} role="region"
    aria-labelledby={`settings-nav-${id}`} tabIndex={-1} hidden={activeHash !== `#${id}`}>{children}</div>;
}

function focusPanel(hash: string) {
  const target = document.getElementById(`settings-panel-${hash.slice(1)}`);
  if (!target) return;
  target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  target.focus({ preventScroll: true });
}
