# Provider Architecture

TranslateFlow v0.5 支持两类 Provider：

- `deepseek`
- `openai-compatible`

## Runtime contract

Provider 只关心已经解析后的有效配置：

```js
{
  provider,
  apiKey,
  apiBaseUrl,
  model,
  prompt,
  targetLanguage
}
```

Provider contract：

```text
translateBatch(segments, config) -> [{ id, text }]
test(config) -> string
```

Provider 不得访问页面 DOM、IndexedDB 或 Popup 状态。

## Effective config

所有翻译和缓存操作必须通过：

```text
getEffectiveConfig(pageUrl)
```

内部使用：

```text
resolveTranslationConfig(globalConfig, pageUrl)
```

站点 Profile 当前只覆盖：

- provider
- model
- prompt
- targetLanguage

凭据和 Base URL 仍属于 Provider 全局配置。

## OpenAI-compatible

Base URL 会被规范化，然后自动组成：

```text
<baseUrl>/chat/completions
```

若输入已经以 `/chat/completions` 结尾，则直接使用。

API Key 可以为空，以支持本地兼容服务。

与 DeepSeek 不同，OpenAI-compatible 的 Base URL 会进入缓存配置指纹，因为同一模型名可能指向完全不同的后端。

OpenAI-compatible 高级配置可显式开启 SSE streaming。该开关默认关闭，只改变传输方式，不改变翻译语义，因此不进入缓存指纹。流式响应仅在 Background Provider/Gateway 内组装；只有收到完整 `[DONE]`、并通过既有翻译结果校验后才返回给上层。服务端明确拒绝 streaming 时，会在产生可用流式结果之前回退到非流式请求。Hy-MT2 / TranslateGemma 等结构化本地翻译模型保持非流式请求。

## Permissions

通用 Provider 不能依赖固定 Manifest host permission。

设置页在用户手势中调用：

```text
chrome.permissions.request()
```

只申请对应 API Origin。

Provider 调用前再次通过 `chrome.permissions.contains()` 验证权限，权限被用户撤销时会返回明确错误。

## Adding another Provider

新增 Provider 时：

1. 在 `src/background/providers/` 添加实现。
2. 在 `providers/index.js` 注册。
3. 在配置解析器中定义它的凭据来源。
4. 明确哪些字段进入 cache fingerprint。
5. 增加 Provider/缓存兼容测试。
6. 如需新 Host Permission，优先使用 optional permission。


## Glossary composition

Provider adapters remain glossary-agnostic. Global/site glossary entries are normalized and resolved before provider selection, then composed into the effective system prompt.

A non-empty effective glossary also contributes a deterministic glossary identity to the cache fingerprint. Empty glossary state does not change legacy cache identity.
