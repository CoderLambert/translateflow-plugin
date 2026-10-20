import { useState } from "react";
import { TRANSLATION_APPEARANCES } from "../shared/appearance.js";
import { TRANSLATION_PRESETS } from "../shared/presets.js";
import type { ProviderConnection, SiteEntry, SiteProfile } from "./client";
import { useOptionsI18n } from "./LocaleContext";
import type { I18n } from "../i18n/index.js";

const emptyEditor = { origin: "", service: "", preset: "", appearance: "", model: "", prompt: "", targetLanguage: "" };
type Editor = typeof emptyEditor;

export function SitesSection({ entries, connections, loading, error, disabled, save, remove, retry }: { entries: SiteEntry[]; connections: ProviderConnection[]; loading: boolean; error: string; disabled: boolean; save: (origin: string, profile: SiteProfile) => Promise<void>; remove: (origin: string) => Promise<void>; retry: () => void }) {
  const i18n = useOptionsI18n();
  const [editor, setEditor] = useState<Editor>(emptyEditor);
  const field = (patch: Partial<Editor>) => setEditor(value => ({ ...value, ...patch }));
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!event.nativeEvent.isTrusted || (event.nativeEvent instanceof InputEvent && event.nativeEvent.isComposing)) return;
    const serviceRef = parseService(editor.service);
    await save(editor.origin, { ...(serviceRef ? { serviceRef } : {}), preset: editor.preset, appearance: editor.appearance, model: editor.model, prompt: editor.prompt, targetLanguage: editor.targetLanguage }); setEditor(emptyEditor);
  }
  return <section id="sites" tabIndex={-1}><h2>{i18n.t("options.sites.title")}</h2><p className="hint">{i18n.t("options.sites.help")}</p>
    <form onSubmit={event => void submit(event)} onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }}>
      <div className="profile-grid"><div><label htmlFor="siteOrigin">{i18n.t("options.sites.site")}</label><input id="siteOrigin" disabled={disabled} value={editor.origin} onChange={event => field({ origin: event.target.value })} type="text" placeholder="https://github.com" /></div><div><label htmlFor="siteProvider">{i18n.t("options.connections.siteConnection")}</label><select id="siteProvider" disabled={disabled} value={editor.service} onChange={event => field({ service: event.target.value })}><option value="">{i18n.t("options.sites.inheritDefault")}</option>{connections.map(connection => <option value={`api-key:${connection.id}`} key={connection.id}>{connection.name}</option>)}<option value="chatgpt-plan">{i18n.t("options.chatgptPlan.providerName")}</option></select></div></div>
      <label htmlFor="sitePreset">{i18n.t("options.sites.mode")}</label><select id="sitePreset" disabled={disabled} value={editor.preset} onChange={event => field({ preset: event.target.value })}><option value="">{i18n.t("options.sites.noPreset")}</option>{TRANSLATION_PRESETS.map(value => <option key={value.id} value={value.id}>{presetLabel(value.id, i18n)} · {i18n.t(`preset.${value.id}.description` as "preset.technical.description")}</option>)}</select>
      <label htmlFor="siteAppearance">{i18n.t("options.sites.appearance")}</label><select id="siteAppearance" disabled={disabled} value={editor.appearance} onChange={event => field({ appearance: event.target.value })}><option value="">{i18n.t("options.sites.inheritAppearance")}</option>{TRANSLATION_APPEARANCES.map(value => <option key={value.id} value={value.id}>{appearanceLabel(value.id, i18n)} · {i18n.t(`appearance.${value.id}.description` as "appearance.standard.description")}</option>)}</select>
      <label htmlFor="siteModel">{i18n.t("options.sites.model")}</label><input id="siteModel" disabled={disabled} value={editor.model} onChange={event => field({ model: event.target.value })} type="text" placeholder={i18n.t("options.sites.modelPlaceholder")} />
      <label htmlFor="sitePrompt">{i18n.t("options.sites.prompt")}</label><textarea id="sitePrompt" disabled={disabled} value={editor.prompt} onChange={event => field({ prompt: event.target.value })} rows={6} placeholder={i18n.t("options.sites.promptPlaceholder")} />
      <label htmlFor="siteTargetLanguage">{i18n.t("options.sites.target")}</label><input id="siteTargetLanguage" disabled={disabled} value={editor.targetLanguage} onChange={event => field({ targetLanguage: event.target.value })} type="text" placeholder={i18n.t("options.sites.targetPlaceholder")} />
      <div className="actions"><button id="saveSiteProfile" className="primary" disabled={disabled} type="submit">{i18n.t("options.sites.save")}</button><button id="clearSiteEditor" disabled={disabled} type="button" onClick={() => setEditor(emptyEditor)}>{i18n.t("options.sites.clearEditor")}</button></div>
    </form>
    <div id="siteProfilesList" className="site-list" aria-busy={loading}>{loading ? i18n.t("options.sites.loading") : error ? <><span role="alert">{i18n.t("options.sites.error", { message: error })}</span><button type="button" onClick={retry}>{i18n.t("common.retry")}</button></> : !entries.length ? i18n.t("options.sites.empty") : entries.map(item => <SiteRow key={item.origin} item={item} connections={connections} disabled={disabled} edit={() => setEditor({ origin: item.origin, service: serviceValue(item.profile), preset: item.profile.preset || "", appearance: item.profile.appearance || "", model: item.profile.model || "", prompt: item.profile.prompt || "", targetLanguage: item.profile.targetLanguage || "" })} remove={() => void remove(item.origin)} />)}</div>
  </section>;
}

function SiteRow({ item, connections, disabled, edit, remove }: { item: SiteEntry; connections: ProviderConnection[]; disabled: boolean; edit: () => void; remove: () => void }) {
  const i18n = useOptionsI18n(), p = item.profile;
  const inherit = i18n.t("options.sites.inherit"), none = i18n.t("options.sites.none"), custom = i18n.t("options.sites.custom");
  const detail = i18n.t("options.sites.detail", {
    provider: serviceLabel(p, connections) || inherit, mode: p.preset ? presetLabel(p.preset, i18n) : none,
    appearance: p.appearance ? appearanceLabel(p.appearance, i18n) : inherit,
    model: p.model || inherit, prompt: p.prompt ? custom : inherit, target: p.targetLanguage || inherit
  });
  return <div className="site-row"><div className="site-summary"><strong>{item.origin}</strong><small>{p.textMethod ? i18n.t(`mt.method.${p.textMethod}`) : i18n.t("mt.inherit")} · {detail}</small></div><div className="site-actions"><button type="button" disabled={disabled} onClick={edit}>{i18n.t("common.edit")}</button><button type="button" disabled={disabled} onClick={remove}>{i18n.t("common.delete")}</button></div></div>;
}

export function BehaviorSection({ restoreSites, autoSites, loading, errors, disabled, refresh, remove }: { restoreSites: string[]; autoSites: string[]; loading: boolean; errors: string[]; disabled: boolean; refresh: () => void; remove: (key: "cacheRestoreSites" | "autoSites", origin: string) => void }) {
  const i18n = useOptionsI18n();
  return <section id="auto-sites" tabIndex={-1}><h2>{i18n.t("options.behavior.title")}</h2><p className="section-summary">{i18n.t("options.behavior.summary")}</p>
    <h3>{i18n.t("options.behavior.cache")}</h3><SiteList id="cacheRestoreSitesList" values={restoreSites} loading={loading} error={errors[0] || ""} empty={i18n.t("options.behavior.cacheEmpty")} disabled={disabled} remove={origin => remove("cacheRestoreSites", origin)} />
    <h3>{i18n.t("options.behavior.auto")}</h3><SiteList id="autoSitesList" values={autoSites} loading={loading} error={errors[1] || ""} empty={i18n.t("options.behavior.autoEmpty")} disabled={disabled} remove={origin => remove("autoSites", origin)} />
    <div className="actions"><button id="refreshAutoSites" type="button" disabled={disabled} onClick={refresh}>{i18n.t("options.behavior.refresh")}</button></div><p className="hint">{i18n.t("options.behavior.help")}</p></section>;
}

function SiteList({ id, values, loading, error, empty, disabled, remove }: { id: string; values: string[]; loading: boolean; error: string; empty: string; disabled: boolean; remove: (origin: string) => void }) {
  const i18n = useOptionsI18n();
  return <div id={id} className="site-list" aria-busy={loading}>{loading ? i18n.t("options.behavior.loading") : error ? i18n.t("options.behavior.error", { message: error }) : !values.length ? empty : values.map(origin => <div className="site-row" key={origin}><div className="site-summary"><strong>{origin}</strong></div><div className="site-actions"><button type="button" disabled={disabled} onClick={() => remove(origin)}>{i18n.t("common.disable")}</button></div></div>)}</div>;
}

function presetLabel(id: string, i18n: I18n) { return i18n.t(`preset.${id}.label` as "preset.technical.label"); }
function appearanceLabel(id: string, i18n: I18n) { return i18n.t(`appearance.${id}.label` as "appearance.standard.label"); }
function parseService(value: string) { return value === "chatgpt-plan" ? { kind: "chatgpt-plan" as const } : value.startsWith("api-key:") ? { kind: "api-key" as const, connectionId: value.slice(8) } : undefined; }
function serviceValue(profile: SiteProfile) { return profile.serviceRef?.kind === "chatgpt-plan" ? "chatgpt-plan" : profile.serviceRef?.kind === "api-key" ? `api-key:${profile.serviceRef.connectionId}` : profile.provider ? `api-key:${profile.provider === "openai-compatible" ? "openai-compatible" : profile.provider}` : ""; }
function serviceLabel(profile: SiteProfile, connections: ProviderConnection[]) { const service = profile.serviceRef; if (service?.kind === "chatgpt-plan") return "ChatGPT subscription"; if (service?.kind === "api-key") return connections.find(value => value.id === service.connectionId)?.name || service.connectionId; return profile.provider || ""; }
