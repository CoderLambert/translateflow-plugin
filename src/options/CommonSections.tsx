import { TRANSLATION_APPEARANCES } from "../shared/appearance.js";
import type { OptionsConfig } from "./client";
import { useOptionsI18n } from "./LocaleContext";

type Props = { config: OptionsConfig; disabled: boolean; update: (patch: Partial<OptionsConfig>) => void };

export function GeneralSection({ config, disabled, update }: Props) {
  const i18n = useOptionsI18n();
  return <section id="general" tabIndex={-1}><h2>{i18n.t("options.general.title")}</h2><p className="section-summary">{i18n.t("options.general.summary")}</p>
    <label htmlFor="defaultProvider">{i18n.t("options.general.defaultProvider")}</label><select id="defaultProvider" disabled={disabled} value={config.provider} onChange={event => update({ provider: event.target.value })}><option value="deepseek">DeepSeek</option><option value="openai-compatible">OpenAI-compatible</option></select>
    <label htmlFor="targetLanguage">{i18n.t("options.general.targetLanguage")}</label><input id="targetLanguage" disabled={disabled} value={config.targetLanguage} onChange={event => update({ targetLanguage: event.target.value })} type="text" placeholder="Simplified Chinese" />
    <label htmlFor="prompt">{i18n.t("options.general.prompt")}</label><textarea id="prompt" disabled={disabled} value={config.prompt} onChange={event => update({ prompt: event.target.value })} rows={6} onKeyDown={preventComposingSubmit} />
    <p className="hint">{i18n.t("options.general.help")}</p></section>;
}

export function SelectionSection({ config, disabled, update }: Props) {
  const i18n = useOptionsI18n();
  return <section id="selection" tabIndex={-1}><h2>{i18n.t("options.selection.title")}</h2><p className="section-summary">{i18n.t("options.selection.summary")}</p>
    <label htmlFor="selectionExplanationDepth">{i18n.t("options.selection.depth")}</label><select id="selectionExplanationDepth" disabled={disabled} value={config.selectionExplanationDepth} onChange={event => update({ selectionExplanationDepth: event.target.value })}><option value="auto">{i18n.t("options.selection.auto")}</option><option value="concise">{i18n.t("options.selection.concise")}</option><option value="standard">{i18n.t("options.selection.standard")}</option><option value="professional">{i18n.t("options.selection.professional")}</option></select>
    <div className="setting-choice-help" aria-label={i18n.t("options.selection.depthAria")}><div><strong>Auto</strong><span>{i18n.t("options.selection.autoHelp")}</span></div><div><strong>Concise</strong><span>{i18n.t("options.selection.conciseHelp")}</span></div><div><strong>Standard</strong><span>{i18n.t("options.selection.standardHelp")}</span></div><div><strong>Professional</strong><span>{i18n.t("options.selection.professionalHelp")}</span></div></div>
    <div className="data-source-card"><strong>{i18n.t("options.selection.sources")}</strong><p>{i18n.t("options.selection.sourcesHelp")}</p><a href="assets/lexicon/core/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noopener">{i18n.t("options.selection.notices")}</a></div></section>;
}

export function AppearanceSection({ config, disabled, update }: Props) {
  const i18n = useOptionsI18n();
  return <section id="appearance" tabIndex={-1}><h2>{i18n.t("options.appearance.title")}</h2><label htmlFor="defaultAppearance">{i18n.t("options.appearance.default")}</label><select id="defaultAppearance" disabled={disabled} value={config.appearance} onChange={event => update({ appearance: event.target.value })}>{TRANSLATION_APPEARANCES.map(value => <option key={value.id} value={value.id}>{i18n.t(`appearance.${value.id}.label` as "appearance.standard.label")} · {i18n.t(`appearance.${value.id}.description` as "appearance.standard.description")}</option>)}</select><p className="hint">{i18n.t("options.appearance.help")}</p></section>;
}

export function YoutubeSection({ config, disabled, update }: Props) {
  const i18n = useOptionsI18n();
  return <section id="youtube" tabIndex={-1}><h2>YouTube</h2><p className="section-summary">{i18n.t("options.youtube.summary")}</p><label htmlFor="youtubeSubtitleMode">{i18n.t("options.youtube.mode")}</label><select id="youtubeSubtitleMode" disabled={disabled} value={config.youtubeSubtitleMode} onChange={event => update({ youtubeSubtitleMode: event.target.value })}><option value="bilingual">{i18n.t("options.youtube.bilingual")}</option><option value="original">{i18n.t("options.youtube.original")}</option><option value="off">{i18n.t("options.youtube.off")}</option></select><label htmlFor="youtubeSubtitleSize">{i18n.t("options.youtube.size")}</label><select id="youtubeSubtitleSize" disabled={disabled} value={config.youtubeSubtitleSize} onChange={event => update({ youtubeSubtitleSize: event.target.value })}><option value="small">{i18n.t("options.youtube.small")}</option><option value="standard">{i18n.t("options.youtube.standard")}</option><option value="large">{i18n.t("options.youtube.large")}</option></select><p className="hint">{i18n.t("options.youtube.help")}</p></section>;
}

export function ShortcutsSection() {
  const i18n = useOptionsI18n();
  return <section id="keyboard-shortcuts"><h2>{i18n.t("options.shortcuts.title")}</h2><p>{i18n.t("options.shortcuts.summary")}</p><div className="shortcut-list"><div><strong>{i18n.t("options.shortcuts.translate")}</strong><span><kbd>Ctrl+Shift+Y</kbd><small>macOS: Control+Shift+Y</small></span></div><div><strong>{i18n.t("options.shortcuts.toggle")}</strong><span><kbd>Ctrl+Shift+K</kbd><small>macOS: Control+Shift+K</small></span></div><div><strong>{i18n.t("options.shortcuts.quick")}</strong><span><kbd>Ctrl+Shift+.</kbd><small>macOS: Control+Shift+.</small></span></div></div><p className="hint">{i18n.t("options.shortcuts.help")}</p></section>;
}

export function ProviderSections({ config, disabled, update }: Props) {
  const i18n = useOptionsI18n();
  const open = (patch: Partial<OptionsConfig["openAICompatible"]>) => update({ openAICompatible: { ...config.openAICompatible, ...patch } });
  return <><section id="provider" className="advanced" tabIndex={-1}><h2>Provider · DeepSeek</h2><p className="section-summary">{i18n.t("options.provider.deepseekSummary")}</p><label htmlFor="deepseekApiKey">API Key</label><Password id="deepseekApiKey" value={config.apiKey} disabled={disabled} onChange={value => update({ apiKey: value })} /><label htmlFor="deepseekModel">{i18n.t("options.provider.model")}</label><input id="deepseekModel" disabled={disabled} value={config.model} onChange={event => update({ model: event.target.value })} type="text" /><p className="hint">{i18n.t("options.provider.deepseekHelp")}</p></section>
    <section className="advanced"><h2>Provider · OpenAI-compatible</h2><label htmlFor="openaiBaseUrl">Base URL</label><input id="openaiBaseUrl" disabled={disabled} value={config.openAICompatible.baseUrl} onChange={event => open({ baseUrl: event.target.value })} type="url" placeholder="https://api.openai.com/v1" /><p className="hint">{i18n.t("options.provider.openaiHelp")}</p><label htmlFor="openaiApiKey">API Key</label><Password id="openaiApiKey" value={config.openAICompatible.apiKey} disabled={disabled} onChange={value => open({ apiKey: value })} /><label htmlFor="openaiModel">{i18n.t("options.provider.model")}</label><input id="openaiModel" disabled={disabled} value={config.openAICompatible.model} onChange={event => open({ model: event.target.value })} type="text" placeholder="gpt-4.1-mini / qwen / local-model ..." /><div className="inline-checks"><label className="checkbox-label" htmlFor="openaiStreaming"><input id="openaiStreaming" disabled={disabled} checked={config.openAICompatible.streaming} onChange={event => open({ streaming: event.target.checked })} type="checkbox" />{i18n.t("options.provider.streaming")}</label></div></section></>;
}

function Password({ id, value, disabled, onChange }: { id: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  const i18n = useOptionsI18n();
  return <div className="password-row"><input id={id} disabled={disabled} value={value} onChange={event => onChange(event.target.value)} type="password" autoComplete="off" /><button id={id === "deepseekApiKey" ? "revealDeepSeek" : "revealOpenAI"} type="button" disabled={disabled} onClick={event => { const target = event.currentTarget.previousElementSibling as HTMLInputElement; const visible = target.type === "text"; target.type = visible ? "password" : "text"; event.currentTarget.textContent = i18n.t(visible ? "options.password.show" : "options.password.hide"); }}>{i18n.t("options.password.show")}</button></div>;
}
function preventComposingSubmit(event: React.KeyboardEvent) { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }
