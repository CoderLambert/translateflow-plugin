import { useState } from "react";
import { TRANSLATION_APPEARANCES } from "../shared/appearance.js";
import { TRANSLATION_PRESETS, getPresetLabel } from "../shared/presets.js";
import type { SiteEntry, SiteProfile } from "./client";

const emptyEditor = { origin: "", provider: "", preset: "", appearance: "", model: "", prompt: "", targetLanguage: "" };
type Editor = typeof emptyEditor;

export function SitesSection({ entries, loading, error, disabled, save, remove, retry }: { entries: SiteEntry[]; loading: boolean; error: string; disabled: boolean; save: (origin: string, profile: SiteProfile) => Promise<void>; remove: (origin: string) => Promise<void>; retry: () => void }) {
  const [editor, setEditor] = useState<Editor>(emptyEditor);
  const field = (patch: Partial<Editor>) => setEditor(value => ({ ...value, ...patch }));
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!event.nativeEvent.isTrusted || (event.nativeEvent instanceof InputEvent && event.nativeEvent.isComposing)) return;
    await save(editor.origin, { provider: editor.provider, preset: editor.preset, appearance: editor.appearance, model: editor.model, prompt: editor.prompt, targetLanguage: editor.targetLanguage }); setEditor(emptyEditor);
  }
  return <section id="sites" tabIndex={-1}><h2>站点</h2><p className="hint">用于 GitHub、文档站、新闻站等不同场景。未填写的字段继承默认配置。</p>
    <form onSubmit={event => void submit(event)} onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }}>
      <div className="profile-grid"><div><label htmlFor="siteOrigin">站点</label><input id="siteOrigin" disabled={disabled} value={editor.origin} onChange={event => field({ origin: event.target.value })} type="text" placeholder="https://github.com" /></div><div><label htmlFor="siteProvider">Provider</label><select id="siteProvider" disabled={disabled} value={editor.provider} onChange={event => field({ provider: event.target.value })}><option value="">继承默认</option><option value="deepseek">DeepSeek</option><option value="openai-compatible">OpenAI-compatible</option></select></div></div>
      <label htmlFor="sitePreset">翻译模式</label><select id="sitePreset" disabled={disabled} value={editor.preset} onChange={event => field({ preset: event.target.value })}><option value="">无 Preset / 使用 Prompt</option>{TRANSLATION_PRESETS.map(value => <option key={value.id} value={value.id}>{value.label} · {value.description}</option>)}</select>
      <label htmlFor="siteAppearance">阅读外观覆盖</label><select id="siteAppearance" disabled={disabled} value={editor.appearance} onChange={event => field({ appearance: event.target.value })}><option value="">继承默认外观</option>{TRANSLATION_APPEARANCES.map(value => <option key={value.id} value={value.id}>{value.label} · {value.description}</option>)}</select>
      <label htmlFor="siteModel">模型覆盖</label><input id="siteModel" disabled={disabled} value={editor.model} onChange={event => field({ model: event.target.value })} type="text" placeholder="留空继承 Provider 默认模型" />
      <label htmlFor="sitePrompt">Prompt 覆盖</label><textarea id="sitePrompt" disabled={disabled} value={editor.prompt} onChange={event => field({ prompt: event.target.value })} rows={6} placeholder="留空继承默认 Prompt" />
      <label htmlFor="siteTargetLanguage">目标语言覆盖</label><input id="siteTargetLanguage" disabled={disabled} value={editor.targetLanguage} onChange={event => field({ targetLanguage: event.target.value })} type="text" placeholder="留空继承默认目标语言" />
      <div className="actions"><button id="saveSiteProfile" className="primary" disabled={disabled} type="submit">保存站点配置</button><button id="clearSiteEditor" disabled={disabled} type="button" onClick={() => setEditor(emptyEditor)}>清空编辑器</button></div>
    </form>
    <div id="siteProfilesList" className="site-list" aria-busy={loading}>{loading ? "正在读取站点配置…" : error ? <><span role="alert">读取站点配置失败：{error}</span><button type="button" onClick={retry}>重试</button></> : !entries.length ? "暂无站点级覆盖。" : entries.map(item => <SiteRow key={item.origin} item={item} disabled={disabled} edit={() => setEditor({ origin: item.origin, provider: item.profile.provider || "", preset: item.profile.preset || "", appearance: item.profile.appearance || "", model: item.profile.model || "", prompt: item.profile.prompt || "", targetLanguage: item.profile.targetLanguage || "" })} remove={() => void remove(item.origin)} />)}</div>
  </section>;
}

function SiteRow({ item, disabled, edit, remove }: { item: SiteEntry; disabled: boolean; edit: () => void; remove: () => void }) {
  const p = item.profile;
  const detail = [p.provider ? `Provider: ${p.provider}` : "Provider: 继承", p.preset ? `Mode: ${getPresetLabel(p.preset)}` : "Mode: 无", p.appearance ? `外观: ${p.appearance}` : "外观: 继承", p.model ? `Model: ${p.model}` : "Model: 继承", p.prompt ? "Prompt: 自定义" : "Prompt: 继承", p.targetLanguage ? `目标语言: ${p.targetLanguage}` : "目标语言: 继承"].join(" · ");
  return <div className="site-row"><div className="site-summary"><strong>{item.origin}</strong><small>{detail}</small></div><div className="site-actions"><button type="button" disabled={disabled} onClick={edit}>编辑</button><button type="button" disabled={disabled} onClick={remove}>删除</button></div></div>;
}

export function BehaviorSection({ restoreSites, autoSites, loading, errors, disabled, refresh, remove }: { restoreSites: string[]; autoSites: string[]; loading: boolean; errors: string[]; disabled: boolean; refresh: () => void; remove: (key: "cacheRestoreSites" | "autoSites", origin: string) => void }) {
  return <section id="auto-sites" tabIndex={-1}><h2>站点自动行为</h2><p className="section-summary">持久站点权限按功能共享。自动恢复缓存只读取 IndexedDB；自动翻译才会在缓存缺失时调用 Provider。</p>
    <h3>自动恢复缓存</h3><SiteList id="cacheRestoreSitesList" values={restoreSites} loading={loading} error={errors[0] || ""} empty="暂无自动恢复缓存站点。请在目标网页的插件弹窗中开启。" disabled={disabled} remove={origin => remove("cacheRestoreSites", origin)} />
    <h3>自动翻译</h3><SiteList id="autoSitesList" values={autoSites} loading={loading} error={errors[1] || ""} empty="暂无自动翻译站点。请在目标网页的插件弹窗中开启。" disabled={disabled} remove={origin => remove("autoSites", origin)} />
    <div className="actions"><button id="refreshAutoSites" type="button" disabled={disabled} onClick={refresh}>刷新站点列表</button></div><p className="hint">关闭某项功能只会在没有其他站点功能或 OpenAI-compatible endpoint 继续需要该 Origin 时释放权限。</p></section>;
}

function SiteList({ id, values, loading, error, empty, disabled, remove }: { id: string; values: string[]; loading: boolean; error: string; empty: string; disabled: boolean; remove: (origin: string) => void }) {
  return <div id={id} className="site-list" aria-busy={loading}>{loading ? "正在读取已授权站点…" : error ? `读取站点失败：${error}` : !values.length ? empty : values.map(origin => <div className="site-row" key={origin}><div className="site-summary"><strong>{origin}</strong></div><div className="site-actions"><button type="button" disabled={disabled} onClick={() => remove(origin)}>关闭</button></div></div>)}</div>;
}
