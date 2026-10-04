import { TRANSLATION_APPEARANCES } from "../shared/appearance.js";
import type { OptionsConfig } from "./client";

type Props = { config: OptionsConfig; disabled: boolean; update: (patch: Partial<OptionsConfig>) => void };

export function GeneralSection({ config, disabled, update }: Props) {
  return <section id="general" tabIndex={-1}><h2>通用</h2><p className="section-summary">设置默认翻译行为。Provider 凭据和缓存维护已移到高级区域。</p>
    <label htmlFor="defaultProvider">默认 Provider</label><select id="defaultProvider" disabled={disabled} value={config.provider} onChange={event => update({ provider: event.target.value })}><option value="deepseek">DeepSeek</option><option value="openai-compatible">OpenAI-compatible</option></select>
    <label htmlFor="targetLanguage">默认目标语言</label><input id="targetLanguage" disabled={disabled} value={config.targetLanguage} onChange={event => update({ targetLanguage: event.target.value })} type="text" placeholder="Simplified Chinese" />
    <label htmlFor="prompt">默认翻译 Prompt</label><textarea id="prompt" disabled={disabled} value={config.prompt} onChange={event => update({ prompt: event.target.value })} rows={6} onKeyDown={preventComposingSubmit} />
    <p className="hint">站点级设置可覆盖这些默认值；翻译配置变化会形成新的缓存版本。</p></section>;
}

export function SelectionSection({ config, disabled, update }: Props) {
  return <section id="selection" tabIndex={-1}><h2>划词翻译</h2><p className="section-summary">划词默认先查询本地词典并直接显示结果；AI 仅在你点击“AI 详解”后用于结合上下文解释。</p>
    <label htmlFor="selectionExplanationDepth">AI 详解深度</label><select id="selectionExplanationDepth" disabled={disabled} value={config.selectionExplanationDepth} onChange={event => update({ selectionExplanationDepth: event.target.value })}><option value="auto">Auto · 自动</option><option value="concise">Concise · 精简</option><option value="standard">Standard · 标准</option><option value="professional">Professional · 专业</option></select>
    <div className="setting-choice-help" aria-label="AI 详解深度说明"><div><strong>Auto</strong><span>点击 AI 详解后，根据选段类型与本地结果质量选择解释深度；推荐。</span></div><div><strong>Concise</strong><span>AI 详解保持精简；默认查词仍不会自动调用 AI。</span></div><div><strong>Standard</strong><span>点击 AI 详解后，给出核心含义与必要的短上下文说明。</span></div><div><strong>Professional</strong><span>点击 AI 详解后，保留专业术语并提供更完整的领域上下文说明。</span></div></div>
    <div className="data-source-card"><strong>本地词典与数据来源</strong><p>Core 词典使用锁定版本的 Princeton WordNet / Chinese Open Wordnet；技术词条使用已审核的结构化来源。每个词典包保持独立来源与许可记录。</p><a href="assets/lexicon/core/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noopener">查看当前 Core Pack 第三方许可与来源</a></div></section>;
}

export function AppearanceSection({ config, disabled, update }: Props) {
  return <section id="appearance" tabIndex={-1}><h2>外观</h2><label htmlFor="defaultAppearance">默认阅读外观</label><select id="defaultAppearance" disabled={disabled} value={config.appearance} onChange={event => update({ appearance: event.target.value })}>{TRANSLATION_APPEARANCES.map(value => <option key={value.id} value={value.id}>{value.label} · {value.description}</option>)}</select><p className="hint">Standard / Compact / Reading / Minimal 只改变译文排版与视觉层级，不改变翻译缓存 identity。</p></section>;
}

export function YoutubeSection({ config, disabled, update }: Props) {
  return <section id="youtube" tabIndex={-1}><h2>YouTube</h2><p className="section-summary">TranslateFlow 双语字幕在 YouTube 播放器中使用这些默认显示设置；播放器内仍可临时调整 Preset。</p><label htmlFor="youtubeSubtitleMode">默认字幕模式</label><select id="youtubeSubtitleMode" disabled={disabled} value={config.youtubeSubtitleMode} onChange={event => update({ youtubeSubtitleMode: event.target.value })}><option value="bilingual">双语</option><option value="original">仅原字幕</option><option value="off">关闭 TranslateFlow 字幕</option></select><label htmlFor="youtubeSubtitleSize">译文字幕大小</label><select id="youtubeSubtitleSize" disabled={disabled} value={config.youtubeSubtitleSize} onChange={event => update({ youtubeSubtitleSize: event.target.value })}><option value="small">小</option><option value="standard">标准</option><option value="large">大</option></select><p className="hint">字幕翻译继续复用当前站点 Profile / Preset / Glossary / Provider 有效配置。</p></section>;
}

export function ShortcutsSection() {
  return <section id="keyboard-shortcuts"><h2>键盘快捷键</h2><p>TranslateFlow 提供三个浏览器内快捷操作。Chrome 最终绑定以 <code>chrome://extensions/shortcuts</code> 为准，你可以在那里查看、修改或清除任意绑定。</p><div className="shortcut-list"><div><strong>翻译 / 更新当前页</strong><span><kbd>Ctrl+Shift+Y</kbd><small>macOS: Control+Shift+Y</small></span></div><div><strong>显示 / 隐藏译文</strong><span><kbd>Ctrl+Shift+K</kbd><small>macOS: Control+Shift+K</small></span></div><div><strong>切换 Quick Control</strong><span><kbd>Ctrl+Shift+.</kbd><small>macOS: Control+Shift+.</small></span></div></div><p className="hint">快捷键只在 Chrome 获得焦点时工作。浏览器或操作系统保留的快捷键优先级更高；如某个组合不可用，请在 Chrome 的扩展快捷键页面重新绑定。</p></section>;
}

export function ProviderSections({ config, disabled, update }: Props) {
  const open = (patch: Partial<OptionsConfig["openAICompatible"]>) => update({ openAICompatible: { ...config.openAICompatible, ...patch } });
  return <><section id="provider" className="advanced" tabIndex={-1}><h2>Provider · DeepSeek</h2><p className="section-summary">高级配置。API Key 仅保存在扩展本地存储中。</p><label htmlFor="deepseekApiKey">API Key</label><Password id="deepseekApiKey" value={config.apiKey} disabled={disabled} onChange={value => update({ apiKey: value })} /><label htmlFor="deepseekModel">模型</label><input id="deepseekModel" disabled={disabled} value={config.model} onChange={event => update({ model: event.target.value })} type="text" /><p className="hint">DeepSeek API 地址固定为 https://api.deepseek.com。</p></section>
    <section className="advanced"><h2>Provider · OpenAI-compatible</h2><label htmlFor="openaiBaseUrl">Base URL</label><input id="openaiBaseUrl" disabled={disabled} value={config.openAICompatible.baseUrl} onChange={event => open({ baseUrl: event.target.value })} type="url" placeholder="https://api.openai.com/v1" /><p className="hint">插件会自动追加 /chat/completions；首次使用某个 API Origin 时，Chrome 会在你的保存或测试操作中单独询问权限。</p><label htmlFor="openaiApiKey">API Key</label><Password id="openaiApiKey" value={config.openAICompatible.apiKey} disabled={disabled} onChange={value => open({ apiKey: value })} /><label htmlFor="openaiModel">模型</label><input id="openaiModel" disabled={disabled} value={config.openAICompatible.model} onChange={event => open({ model: event.target.value })} type="text" placeholder="gpt-4.1-mini / qwen / local-model ..." /><div className="inline-checks"><label className="checkbox-label" htmlFor="openaiStreaming"><input id="openaiStreaming" disabled={disabled} checked={config.openAICompatible.streaming} onChange={event => open({ streaming: event.target.checked })} type="checkbox" />启用 SSE streaming（兼容时）</label></div></section></>;
}

function Password({ id, value, disabled, onChange }: { id: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return <div className="password-row"><input id={id} disabled={disabled} value={value} onChange={event => onChange(event.target.value)} type="password" autoComplete="off" /><button id={id === "deepseekApiKey" ? "revealDeepSeek" : "revealOpenAI"} type="button" disabled={disabled} onClick={event => { const target = event.currentTarget.previousElementSibling as HTMLInputElement; const visible = target.type === "text"; target.type = visible ? "password" : "text"; event.currentTarget.textContent = visible ? "显示" : "隐藏"; }}>显示</button></div>;
}
function preventComposingSubmit(event: React.KeyboardEvent) { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }
