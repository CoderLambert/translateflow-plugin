# Provider 架构

TranslateFlow 的 API Key Provider 完全运行在扩展内部，不依赖 LiteLLM、网关服务或 Provider SDK。设置页保存连接，Background 根据连接的协议直接调用模型平台。ChatGPT 订阅登录继续作为独立、可选的 Native Messaging Provider。

## 连接模型

`providerConnections` 保存不含密钥的连接定义，`providerCredentials` 按 `credentialId` 保存密钥，`defaultService` 保存默认服务引用：

```js
{
  providerConnectionsVersion: 1,
  providerConnections: {
    openai: {
      id: "openai",
      revision: 1,
      name: "OpenAI",
      platform: "openai",
      protocol: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      credentialId: "openai",
      defaultModel: "gpt-5-mini",
      settings: {
        streaming: false,
        outputTokens: 4096,
        temperature: null,
        reasoning: "",
        allowEmptyApiKey: false,
        allowInsecureHttp: false
      }
    }
  },
  providerCredentials: { openai: "..." },
  defaultService: { kind: "api-key", connectionId: "openai" }
}
```

站点 Profile 只保存 `serviceRef`、Model、Prompt、Target Language 和 Preset 等覆盖值，不复制 API Key。连接引用缺失时明确失败，不回退到另一个可能收费的默认连接。

设置页和 Popup 属于 trusted extension context。Background 启动时把 `chrome.storage.local` 访问级别设为 `TRUSTED_CONTEXTS`；Content 通过只暴露公开行为配置的 runtime message 读取设置。Provider 连接列表仅返回 `hasApiKey`，不返回密钥内容。该边界用于阻止 API Key 进入网页 Content Script，并不把 `chrome.storage.local` 宣称为系统密钥保险库。

旧版 `deepseek` / `openai-compatible` 配置在首次读取时惰性迁移为稳定连接；旧字段暂时保留以支持回滚。迁移不清空缓存或用户配置。

## 第一版协议

| 协议 ID | 请求接口 | 鉴权 | 流式 |
| --- | --- | --- | --- |
| `openai-chat` | `<baseUrl>/chat/completions` | `Authorization: Bearer` | 支持，失败可安全回退 unary |
| `openai-responses` | `<baseUrl>/responses` | `Authorization: Bearer` | 当前 unary |
| `anthropic-messages` | `<baseUrl>/messages` | `x-api-key` + `anthropic-version` | 当前 unary |
| `gemini-generate` | `<baseUrl>/models/<model>:generateContent` | `x-goog-api-key` | 当前 unary |

OpenAI Responses、Anthropic Messages 和 Gemini generateContent 使用各自原生请求体及响应解析，不把它们伪装成 Chat Completions。未设置 Temperature 时适配器省略该字段，以兼容不接受 Temperature 的推理模型。翻译结果必须完整、唯一地覆盖请求 segment；结构化 Selection 结果解析失败时最多重试一次。

连接测试发送最小请求并要求精确返回 `OK`。HTTP 200 但内容为空或不符合约定仍视为失败。

## 平台预设

设置页提供 OpenAI、Anthropic、Google Gemini、DeepSeek、OpenRouter、Groq、xAI、Mistral、阿里云百炼兼容接口、SiliconFlow、Moonshot、智谱、火山方舟、Azure OpenAI v1、本地服务和自定义连接预设。预设只填写推荐协议和 Base URL；用户仍明确提供 Model 与 API Key。

Azure 仅支持统一的 OpenAI v1 Base URL，并按[微软 v1 Responses API 文档](https://learn.microsoft.com/en-us/rest/api/aifoundry/azureopenai/responses)使用 `api-key` header；不实现旧式 deployment URL 拼接、`api-version` 查询参数或 Azure Entra ID。AWS Bedrock、Vertex AI IAM/OAuth、自动 failover 和代理路由不在当前范围。

本地或自托管 OpenAI-compatible 服务可显式允许空 API Key 和 `http`。其他预设默认要求 API Key。Base URL 只允许 `http/https`，不能包含用户名、密码、query 或 fragment。

## Effective config 与缓存

所有翻译和缓存操作必须使用 `getEffectiveConfig(pageUrl)` 解析出的同一配置。页面批处理在首次 cache lookup 时创建短生命周期 effective-config snapshot，后续 Provider 调用和 cache store 复用同一个 snapshot，避免用户在处理中修改连接后产生混合配置。

有效配置包含：

```js
{
  provider, protocol, platform,
  connectionId, connectionRevision, providerLabel,
  apiKey, apiBaseUrl, model,
  prompt, targetLanguage,
  outputTokens, temperature, streaming,
  allowEmptyApiKey, allowInsecureHttp
}
```

缓存身份包含连接 ID、连接 revision、协议、规范化 endpoint、Model、Target Language、最终 Prompt 和有效 glossary identity，不包含 API Key。设置页每次保存连接都会保守地递增 revision 并隔离后续缓存；密钥本身不会写入指纹或日志。

## Provider runtime contract

Provider adapter 只接收已解析的有效配置：

```text
translateBatch(segments, config, options) -> [{ id, text }]
completeJson(input, config, options) -> structured result
completeText(input, config, options) -> { text, mode }
test(config) -> "OK"
```

Provider 不访问页面 DOM、IndexedDB 或 Options 状态。所有外部 HTTP 位于 `src/background/providers/`，共享 timeout、重试、取消和错误规范化。

## ChatGPT 订阅登录

`chatgpt-plan` 继续走同一个 Provider dispatcher，因此页面翻译、Selection AI 与学习中心追问复用 Effective Config 和完成态校验。它通过 Go Native Messaging Host 调用官方 ChatGPT Responses endpoint，没有 API Key fallback，也不属于 `providerConnections`。

扩展 service worker 是 `chrome.runtime.connectNative` 的唯一 owner。`nativeMessaging` 是可选权限，只能由设置页用户动作申请；普通扩展构建和离线验证不会安装 Host、登录账号或使用凭据。

## 权限

当前 Manifest 已为普通 `http/https` 页面静态 Content 注入声明对应访问范围。设置页保存连接时仍按 endpoint origin 执行权限检查/请求，Provider 调用前再次通过 `chrome.permissions.contains()` 验证；权限被撤销时返回明确错误。此实现不增加 Manifest 权限。

## 新增协议

新增协议时：

1. 在 `src/background/providers/` 添加原生 adapter，并在 `providers/index.js` 注册。
2. 在 `src/shared/provider-connections.js` 定义协议、URL 构造和必要预设。
3. 明确鉴权 header、请求/响应合同、取消、重试和连接测试行为。
4. 明确连接字段是否进入 cache fingerprint，并补迁移/缓存回归测试。
5. 增加合成 mock 的 Node 测试和真实 MV3 E2E；测试不得使用真实 API Key。

## Glossary

Provider adapter 不读取 glossary 存储。全局/站点 glossary 在 Provider 选择前规范化并组合进 Effective Prompt；非空 glossary 的稳定 identity 进入缓存指纹，空 glossary 不改变旧缓存身份。

## 浏览器基础翻译与 AI 的选择

无已配置 AI 服务且未显式启用免费在线机器翻译时，整页、字幕和获准的单词划词可使用默认开启的浏览器基础翻译；短语或长选区仍需要 AI。划词只有在 resolver 判定 `intent.kind === "lexical" && tokenCount === 1` 且当前请求明确带有 `browserTranslationAllowed: true` 时才使用 `selection-word`；标记为 false 或缺失时保持普通 `selection`，包括词典未命中后的普通翻译按钮。普通 `selection` 仍可使用显式启用的机器翻译，不等同于仅允许 AI 的 `selection-ai`。浏览器翻译不是 HTTP Provider，不能由后台执行。`translationConfig()` 为获准的 surface 生成带明确语言对的配置快照；原 `getEffectiveConfig()` 保留 AI 连接、Preset 和 Glossary。AI 配置错误不视为“未配置”；获准任务在 AI 请求失败后须由用户明确点击切换到新基础任务。基础引擎不执行 AI Prompt、术语表指令或风格 Preset，缓存与 AI 隔离。详见 [BROWSER_TRANSLATION.md](BROWSER_TRANSLATION.md)。


## 免费在线机器翻译

`machineTranslation` 是独立 opt-in 配置，不属于 `providerConnections`。缺失时为 legacy；合法配置包含 version=1、mode（legacy/free-online）、providerId、sourceLanguage。未知服务、模式或版本明确失败，不回退到可能收费的 AI。

首批固定服务为 `mt-microsoft-web`（Edge 网页接口）和 `mt-tencent-transmart`（腾讯交互翻译）。不包含用户 Key、Cookie、任意 Base URL、任意 Header 或代理。网络仅在 `providers/machine-translation-transport.js`；`credentials: omit`、拒绝重定向、请求前检查已授权 origin，真实 HTTP 及正文读取共用 15 秒超时、512 KiB 响应上限。每家串行、有界等待、429/403 冷却；失败不自动换线或转 AI。不会新增 Manifest 权限。

全局模式只修改自己的键；站点 `machineTranslation` 只作为覆盖值。未显式覆盖的旧站点 AI 选择优先于新增全局免费模式。Options 和 Popup 是设置/连接检查的唯一可信入口。启用或测试必须有用户动作和前端明确传输确认；检查只发送固定非敏感例句。读取状态不会联网。全局/站点切换会取消当前文字任务，不改 AI 凭据和独立助手任务。

开启“翻译前优先查询已安装词典”后，单词划选仍先查询本地词典；命中时不请求在线 MT，即使已有该词的在线译文缓存。免费模式的规范语言码 `zh` 与简体中文词典资格一致；未命中时保留原有普通翻译按钮和显式 MT 路线。

`translationConfig()` 在网页/文字划词解析免费路由；AI `getEffectiveConfig()`、`getEffectiveConfigForSite()`、字幕与助手保持原行为。免费配置不要求 Key，损坏的 AI 连接不阻断显式免费文字翻译。`hasConfiguredAi()` 语义不因免费模式改变。

免费快照有 mt: 前缀，绑定 tab/frame/document/pageUrl，缺失、过期、切换、导航及 worker 重启后拒绝旧任务，不落回 AI。Provider 和 cache store 复用同一快照。MT 指纹单独加入服务、固定 endpoint、源/目标语言及 adapter/input 版本，单条源身份额外包含 protectedIds。原 AI / browser-translator 指纹、IndexedDB schema、Reading schema 不改变、不清理。

富文本复用纯函数 `translationParts`：结构标记、链接目标及 code/kbd 留在本地，只有文字槽送给 Provider。返回结果必须完整且与输入一一对应；结构错误、实体损坏、空值、业务失败不作为成功写入缓存。显示复用现有安全 DOM 重建。首版不对免费接口承诺 AI Prompt、风格或自定义译法生效。

Reading 仍保存现有 `translation` artifact；provenance 使用真实 provider、`model: not-disclosed`、`promptVersion: mt-adapter-v1` 和实际配置指纹。未披露模型不伪装成具体 AI 模型。悬停和历史回看仍只读本地，助手 artifact 不改变。

单测：`node --test tests/machine-translation.test.mjs`。实际编译 MV3 流程：`npm run test:e2e -- e2e/machine-translation.spec.mjs`（先构建）。E2E 仅对两个固定域名注入合成响应，不替代用户网络的真实服务可用性验证。
