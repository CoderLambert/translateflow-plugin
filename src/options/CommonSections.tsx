import { TRANSLATION_APPEARANCES } from "../shared/appearance.js";
import type { OptionsConfig } from "./client";
import { useOptionsI18n } from "./LocaleContext";
import { ChatGPTPlanSection } from "./ChatGPTPlanSection";
import type { OptionsClient } from "./client";
import type { ProviderConnectionState } from "./client";
import { ProviderConnectionsSection } from "./ProviderConnectionsSection";

type Props = { config: OptionsConfig; disabled: boolean; update: (patch: Partial<OptionsConfig>) => void };

export function GeneralSection({ config, disabled, update }: Props) {
  const i18n = useOptionsI18n();
  return <section id="general" tabIndex={-1}><h2>{i18n.t("options.general.title")}</h2><p className="section-summary">{i18n.t("options.general.summary")}</p>
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

export function ProviderSections({ config, disabled, update, client, connections, loading, error, reload, setStatus }: Props & { client: OptionsClient; connections: ProviderConnectionState | null; loading: boolean; error: string; reload: () => Promise<void>; setStatus: (message: string, error?: boolean) => void }) {
  return <><ProviderConnectionsSection client={client} state={connections} loading={loading} error={error} disabled={disabled} reload={reload} setStatus={setStatus} />
    <ChatGPTPlanSection config={config} disabled={disabled} update={update} client={client} /></>;
}
function preventComposingSubmit(event: React.KeyboardEvent) { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }
