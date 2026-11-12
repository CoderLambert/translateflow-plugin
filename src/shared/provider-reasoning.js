// Shared by the editor, cache and background. Exact IDs only; no prefix inference.
// Bump when preset mappings change so cached text cannot cross policy versions.
export const REASONING_POLICY_VERSION = 'translation-presets-v1';
const OPENAI_MINIMAL = ['gpt-5', 'gpt-5-mini', 'gpt-5-nano'];
const OPENAI_NONE = ['gpt-5.1', 'gpt-5.2'];
const OPENAI_LOW = ['o3', 'o4-mini', 'gpt-6-astra', 'gpt-6.1-sol'];
const CLAUDE_BUDGET = ['claude-sonnet-4-5', 'claude-sonnet-4-20250514', 'claude-opus-4-20250514'];
const DEEPSEEK_THINKING = ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro'];
const MOONSHOT_THINKING = ['kimi-k2.5', 'kimi-k2.6'];
const PROFILES = {
  openai: { modes: ['effort'], efforts: ['minimal', 'low', 'medium', 'high'], models: [...OPENAI_MINIMAL, ...OPENAI_NONE, ...OPENAI_LOW] },
  'azure-v1': { modes: ['effort'], efforts: ['low', 'medium', 'high'], models: [...OPENAI_MINIMAL, ...OPENAI_NONE, ...OPENAI_LOW] },
  anthropic: { modes: ['disabled', 'budget', 'adaptive', 'effort'], efforts: ['low', 'medium', 'high', 'max'], models: [] },
  gemini: { modes: ['budget', 'effort'], efforts: ['minimal', 'low', 'medium', 'high'], models: [] },
  deepseek: { modes: ['enabled', 'disabled', 'effort'], efforts: ['low', 'high', 'max'], models: DEEPSEEK_THINKING },
  dashscope: { modes: ['enabled', 'disabled', 'budget'], efforts: [], models: [] },
  moonshot: { modes: ['enabled', 'disabled'], efforts: [], models: MOONSHOT_THINKING },
  groq: { modes: ['effort'], efforts: ['none', 'low', 'medium', 'high'], models: [] },
  mistral: { modes: ['effort'], efforts: ['none', 'low', 'medium', 'high', 'max'], models: [] },
  xai: { modes: ['effort'], efforts: ['none', 'low', 'medium', 'high', 'xhigh'], models: [] },
  openrouter: { modes: ['enabled', 'disabled', 'effort', 'budget'], efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'], models: [] },
  siliconflow: { modes: ['enabled', 'disabled', 'budget'], efforts: [], models: [] },
  zhipu: { modes: ['enabled', 'disabled'], efforts: [], models: [] },
  volcengine: { modes: ['enabled', 'disabled', 'adaptive', 'effort'], efforts: ['minimal', 'low', 'medium', 'high'], models: [] }
};
const COMPATIBLE = { modes: ['effort'], efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'], models: [] };
/** @returns {{modes: string[], efforts: string[], verified: boolean}} */
export function reasoningCapabilities(platform, model, protocol = '') {
  platform = reasoningFamily(platform, protocol);
  let profile = PROFILES[platform] || COMPATIBLE;
  if (['openai','azure-v1'].includes(platform)) {
    if (OPENAI_MINIMAL.includes(model)) profile = {...profile,efforts:['minimal','low','medium','high']};
    if (OPENAI_NONE.includes(model)) profile = {...profile,efforts:['none','low','medium','high']};
    if (OPENAI_LOW.includes(model)) profile = {...profile,efforts:['low','medium','high']};
  }
  if (platform === 'anthropic') {
    if (CLAUDE_BUDGET.includes(model)) profile = { ...profile, modes: ['disabled', 'budget'], models: [model] };
  }
  if (platform === 'gemini' && ['gemini-2.5-flash', 'gemini-2.5-pro'].includes(model)) profile = { ...profile, modes: ['budget'], models: [model] };
  if (protocol && !['openai-chat','openai-responses'].includes(protocol) && !['anthropic','gemini'].includes(platform)) profile = {modes:[],efforts:[],models:[]};
  const verified = profile.models.includes(model);
  return { modes: ['default', ...(verified ? ['enhanced'] : []), 'model-default', ...profile.modes], efforts: profile.efforts, verified };
}
/** @returns {{mode: string, effort?: string, budget?: number, advanced?: boolean}} */
export function normalizeReasoning(value) {
  if (!value || value === 'default') return { mode: 'default' };
  if (typeof value === 'string') value = { mode: 'effort', effort: value };
  const mode = value.mode || 'default';
  if (!['default','enhanced','model-default','enabled','disabled','adaptive','effort','budget'].includes(mode)) throw new Error('推理模式无效。');
  if (['default','enhanced','model-default'].includes(mode)) return { mode };
  const result = { mode };
  if (mode === 'effort') {
    if (typeof value.effort !== 'string' || !value.effort.trim() || value.effort.length > 24) throw new Error('推理强度无效。');
    result.effort = value.effort;
  }
  if (mode === 'budget') {
    if (!Number.isSafeInteger(value.budget) || value.budget < 0 || value.budget > 131072) throw new Error('推理预算必须为 0 至 131072 的整数。');
    result.budget = value.budget;
  }
  if (value.advanced === true) result.advanced = true;
  return result;
}
// Preserve custom settings. Only the default/enhanced presets resolve automatically.
export function resolveReasoning(config) {
  const r = normalizeReasoning(config.reasoning ?? config.settings?.reasoning);
  if (!['default','enhanced'].includes(r.mode)) return r;
  const p = reasoningFamily(config.platform || (config.provider === 'deepseek' ? 'deepseek' : 'custom'), config.protocol);
  const model = String(config.model || '').trim();
  const enhanced = r.mode === 'enhanced';
  if (['openai','azure-v1'].includes(p)) {
    const fast = OPENAI_MINIMAL.includes(model) ? 'minimal' : OPENAI_NONE.includes(model) ? 'none' : OPENAI_LOW.includes(model) ? 'low' : '';
    if (fast) return {mode:'effort',effort:enhanced ? 'medium' : fast};
  }
  if (p === 'deepseek' && DEEPSEEK_THINKING.includes(model)) return enhanced ? {mode:'enabled',effort:'low'} : {mode:'disabled'};
  if (p === 'anthropic' && CLAUDE_BUDGET.includes(model)) return enhanced ? {mode:'budget',budget:1024} : {mode:'disabled'};
  if (p === 'gemini' && ['gemini-2.5-flash','gemini-2.5-pro'].includes(model)) return {mode:'budget',budget:enhanced ? -1 : model === 'gemini-2.5-pro' ? 128 : 0};
  if (p === 'moonshot' && MOONSHOT_THINKING.includes(model)) return {mode:enhanced ? 'enabled' : 'disabled'};
  return {mode:'model-default'};
}
export function reasoningProviderOptions(config) {
  const r = resolveReasoning(config);
  if (r.mode === 'model-default') return {};
  const p = reasoningFamily(config.platform || (config.provider === 'deepseek' ? 'deepseek' : 'custom'), config.protocol);
  const cap = reasoningCapabilities(p, config.model, config.protocol);
  if (!cap.modes.includes(r.mode) || (r.effort && !cap.efforts.includes(r.effort))) throw new Error('该平台或协议不支持所选推理参数。');
  if (!cap.verified && !r.advanced) throw new Error('该模型的自定义推理设置未验证，请选回“快速翻译”，或重新选择自定义模式。');
  const enabled = r.mode !== 'disabled';
  if (p === 'anthropic') {
    if (r.mode === 'budget' && (r.budget < 1024 || (config.outputTokens && r.budget >= config.outputTokens))) throw new Error('Claude 思考预算至少 1024，且必须小于输出 token 上限。');
    return {anthropic: r.mode === 'effort' ? {effort:r.effort} : {thinking:r.mode === 'budget' ? {type:'enabled',budgetTokens:r.budget} : {type:r.mode}}};
  }
  if (p === 'gemini') return {google:{thinkingConfig:r.mode === 'budget' ? {thinkingBudget:r.budget} : {thinkingLevel:r.effort}}};
  if (p === 'dashscope') return {alibaba:{enableThinking:enabled,...(r.mode === 'budget' ? {thinkingBudget:r.budget} : {})}};
  if (p === 'moonshot') return {moonshotai:{thinking:{type:enabled ? 'enabled':'disabled'}}};
  if (p === 'deepseek') return {deepseek:r.mode === 'effort' ? {reasoningEffort:r.effort} : {thinking:{type:enabled?'enabled':'disabled'},...(r.effort ? {reasoningEffort:r.effort} : {})}};
  if (p === 'openrouter') return {openrouter:{reasoning:r.mode === 'effort' ? {effort:r.effort} : r.mode === 'budget' ? {max_tokens:r.budget} : {enabled}}};
  if (p === 'siliconflow') return {siliconflow:{enable_thinking:enabled,...(r.mode === 'budget' ? {thinking_budget:r.budget} : {})}};
  if (['zhipu','volcengine'].includes(p)) return {[p]:r.mode === 'effort' ? {reasoning_effort:r.effort} : {thinking:{type:r.mode}}};
  if (['openai','azure-v1','groq','mistral'].includes(p)) return {[p === 'azure-v1' ? 'openai':p]:{reasoningEffort:r.effort,...(config.protocol === 'openai-responses' && ['openai','azure-v1'].includes(p) ? {reasoningSummary:null} : {}),...(r.advanced && config.protocol === 'openai-responses' && ['openai','azure-v1'].includes(p) ? {forceReasoning:true} : {})}};
  if (p === 'xai') return config.protocol === 'openai-responses' ? {xai:{reasoningEffort:r.effort}} : {xai:{reasoning_effort:r.effort}};
  return {[p]:{reasoning_effort:r.effort}};
}

function reasoningFamily(platform, protocol = '') {
  if (protocol === 'anthropic-messages') return 'anthropic';
  if (protocol === 'gemini-generate') return 'gemini';
  if (protocol === 'openai-responses') return ['azure-v1','xai'].includes(platform) ? platform : 'openai';
  if (protocol === 'openai-chat' && ['anthropic','gemini'].includes(platform)) return 'custom';
  return platform;
}
