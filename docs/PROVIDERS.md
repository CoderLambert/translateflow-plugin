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

连接测试发送最小请求并要求精确返回 `OK`。HTTP 200 但内容为空或不符合约定仍视为失败；连接测试成功不能替代真实页面的结构化翻译验收。

翻译 adapter 在格式重试边界内验证完整且唯一的 ID、非空译文、标记结构和受保护代码。HY-MT 等专用本地模型拆分批次时保留 format/protectedIds，并提示模型保持代码原文；两次格式尝试仍失败时，仅对不合格的富文本段落做一次安全恢复：复用 `translationParts` 留住标记、代码和空白，只把普通文字槽交给同一 Provider，验证完整槽结果后按原结构重组。每段最多 128 个文字槽，槽请求仍使用原有批大小、格式重试和取消边界。额外拒绝译文中原文没有的 JSON 围栏、协议字段或跨段落协议残片；多段纯文本格式尝试耗尽后可以拆成单段重试一次，单段不继续拆分；该降级可能降低跨格式片段的语境连贯性，不以删标记、改代码或更换服务换取成功。

HTTP 超时和外部取消覆盖读取完整响应体。流式网络/限流/服务端暂时故障只在尚未输出内容时按既有策略重试，已输出的流不重放。页面错误仅按本地错误码显示操作建议；自动翻译在格式/认证/配置/权限错误时暂停，其他连续失败最多三轮，手动整页翻译成功或关闭再开启自动翻译后恢复。

## 平台预设

设置页提供 OpenAI、Anthropic、Google Gemini、DeepSeek、OpenRouter、Groq、xAI、Mistral、阿里云百炼兼容接口、SiliconFlow、Moonshot、智谱、火山方舟、Azure OpenAI v1、Ollama 本地、Ollama Cloud、LM Studio、本地服务和自定义连接预设。预设只填写推荐协议和 Base URL；用户明确选择模型并按服务要求填写 API Key，不限制模型 ID 白名单。

| 服务 | Base URL 默认值 | 模型与认证 |
| --- | --- | --- |
| Ollama (local) | `http://127.0.0.1:11434/v1` | 填写 `ollama list` 中的完整聊天模型名，默认允许无 Key / HTTP |
| Ollama Cloud | `https://ollama.com/v1` | 填写云端目录模型 ID 和 Ollama API Key，无需安装本地 Ollama |
| LM Studio | `http://127.0.0.1:1234/v1` | 启动本地服务，填写聊天模型 ID；服务启用认证时填写 Key |
| Local / self-hosted、Custom | 用户服务的 OpenAI API 基础地址 | 适用于 vLLM、llama.cpp 等兼容服务及自定义云端，认证按服务要求配置 |

在“设置 → Provider → API Key 连接”选择预设、填写模型、保存后点击“测试”，再将其选为默认翻译服务或站点覆盖。保存新连接不会自动替换当前默认服务。浏览器刷新后保留连接、模型和选择；密码框留空不展示已保存 Key。预设只是协议配置，聊天模型是否遵守翻译 JSON 合同仍由实际模型决定；embedding、reranker 或纯补全模型不作为翻译聊天模型使用。

Ollama / Ollama Cloud / LM Studio 在 `openai-chat` 下接受服务根地址并规范为 `/v1`。Ollama 的根 `/api`、`/api/chat` 也转换为 `/v1`；带反向代理前缀的地址仍请填写完整兼容 API 路径。不改变旧 Local / Custom 连接的地址语义，不猜测其他平台的版本路径。Ollama 本地入口中的 `:cloud` 模型实际通过已登录的 Ollama 服务请求云端，不能视为离线翻译。

接入依据：[Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)、[Ollama cloud](https://docs.ollama.com/cloud)、[LM Studio OpenAI compatibility](https://lmstudio.ai/docs/developer/openai-compat)。扩展复用现有 `openai-chat`，不增加 Ollama 原生协议或自动下载模型。

Ollama 在浏览器扩展中返回 403、命令行却正常时，检查服务端来源限制。按 [Ollama FAQ](https://docs.ollama.com/faq#how-can-i-allow-additional-web-origins-to-access-ollama)，将当前扩展的 `chrome-extension://<扩展 ID>` 加入 `OLLAMA_ORIGINS`，保留已有来源，再由服务管理员重启 Ollama。“测试”失败会显示当前扩展的准确来源，便于配置；不自动修改服务、不扩大插件权限，也不移除请求 Origin 绕过限制。若服务使用认证或反向代理，还需检查相应的 Key 和访问策略。单独运行已安装本地模型的浏览器验证：`TF_OLLAMA_REAL_MODEL=<模型名> TF_TEST_WORKERS=1 npm run test:e2e -- e2e/provider-connections.spec.mjs --grep 'real local Ollama' --retries=0`；需先构建 `.output/chrome-mv3`，测试拒绝云端转发模型且不下载模型。

Azure 仅支持统一的 OpenAI v1 Base URL，并按[微软 v1 Responses API 文档](https://learn.microsoft.com/en-us/rest/api/aifoundry/azureopenai/responses)使用 `api-key` header；不实现旧式 deployment URL 拼接、`api-version` 查询参数或 Azure Entra ID。AWS Bedrock、Vertex AI IAM/OAuth、自动 failover 和代理路由不在当前范围。

本地或自托管 OpenAI-compatible 服务可显式允许空 API Key 和 `http`。其他预设默认要求 API Key。Base URL 只允许 `http/https`，不能包含用户名、密码、query 或 fragment。

## Effective config 与缓存

所有翻译和缓存操作必须使用 `getEffectiveConfig(pageUrl)` 解析出的同一配置。页面批处理在首次 cache lookup 时创建短生命周期 effective-config snapshot，后续 Provider 调用和 cache store 复用同一个 snapshot，避免用户在处理中修改连接后产生混合配置。

快照以最后使用时间计算五分钟空闲期限；后台翻译执行期间保留同一冻结配置，完成后留出缓存提交时间。最多保留 256 份，淘汰时不移除正在使用的快照；配置变更、导航失效等现有撤销规则仍立即生效，不复活失效快照。

快照固定版本之前先等待 `ensureConfigInitialized()` 完成连接与翻译偏好的迁移；并发首次读取共用这次初始化，初始化结果不永久缓存。无指定版本的新查询随后重新解析有效配置，并检查解析期间版本未变；指定 `configRevision` 的恢复请求在初始化前后均校验版本，不能借初始化跨越配置失效。迁移不调用翻译服务，也不清空缓存。

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

富文本翻译合同升级为 `tf-markers-v2`，仅富文本缓存通过既有 promptVersion 隔离旧结果；纯文本缓存身份和 DB schema 不变，不清空数据。

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

Native client 将网页翻译、Selection 与追问的推理请求统一 FIFO 串行执行；最多等待 32 项、单项排队最多两分钟，超限返回 HOST_BUSY。排队中的取消不启动推理；运行中的取消仍等待 Host 的终态，连接断开会拒绝当前和排队请求，不自动重放。

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

## 翻译偏好与执行方式

`translationPreferences: { version: 1, wordMethod, textMethod }` 是网页与划词方式的唯一事实来源。
单词允许 `free-online` / `dictionary` / `browser-local` / `ai`；短语、句段和全文允许后三种翻译方式（不含 dictionary）。网站仅允许覆盖 `textMethod`；单词不使用网站方式、连接或服务参数覆盖。

首次初始化单词为 free-online，句段按现有完整 AI 配置、明确可用本地模型、free-online 顺序确定并持久化。初始化不会发送连接测试、创建模型或下载资源；未知/超时探测不计为就绪。旧网站的明确在线、AI 和 legacy 实际选择迁移为可见的 textMethod；其它网站跟随默认。保留词典、凭据、语言、Prompt 与缓存。旧 machineTranslation.mode、dictionaryEnabled、browserTranslationEnabled 不再竞争网页／划词路由。字幕、显式 AI 助手保持独立路径。

可信 Options / Popup 使用 `TRANSLATION_PREFERENCES_GET` 和 `TRANSLATION_PREFERENCES_SAVE`。保存校验方式、服务参数、联网确认及已授予的 origin 权限；旧 `MACHINE_TRANSLATION_SAVE` 返回 PREFERENCES_REOPEN，要求重开设置。Content 的引擎设置只暴露执行所需公开字段，不返回凭据。Options 统一保存两类偏好；Popup 只保存本站句段，恢复默认不创建本站单词方式。资源管理不修改偏好。

后台按场景、唯一方式和有效配置解析。lookup、执行与写入共用快照；配置变化取消文字任务并失效所有相关快照。本地恢复同时校验配置代次，旧结果不能跨偏好变化重新取快照写入。缓存身份仍使用实际 AI/本地/在线服务、语言对和配置；不升级或清空 DB4。

选词典时只查词典；其它方式不先查词典。未命中、未就绪、失败和拒绝授权都不跨方式备用。划选的内容类型纠正和临时方式只属于当前操作，长期选择必须在设置页明确保存。结果和缓存显示原始来源，AI 理解／分析／用法仍由明确点击触发。Chrome 本地句段在 Content 本地执行，不扩大共享单词 Port。详见 [本地翻译](BROWSER_TRANSLATION.md)。

## 免费在线机器翻译

`machineTranslation` 继续保存 v2 免费服务参数（routing、providerId、sourceLanguage 与兼容 mode），不属于 providerConnections。只有当前场景偏好为 free-online 才执行，旧 mode 不再决定新版路由；未知服务/语言/版本明确失败。

薄适配器注册表包含微软、腾讯、B站、谷歌、火山和有道；自动池只允许已通过真实 MV3 测试的微软 → B站 → 谷歌 → 有道，腾讯保持手选，火山当前网络未通过不默认启用。最近成功方向优先 10 分钟，自动模式顺序备用，固定模式不换线，均不转收费 AI。每段文字槽同一服务完成，已完成段落保留。

网络仅在 `providers/machine-translation-transport.js`；不携带用户 Key/Cookie，不接受 UI 提供的地址/Header，拒绝重定向。p-limit 控制两条真实 HTTP，单供应商串行；25 秒批次预算、网页 5 秒/B站 8 秒包括排队和读取，512 KiB 响应上限。p-retry 仅管理候选尝试，不替代 AbortController。取消消费者不提前释放真实传输槽。冷却状态仅由 health owner 维护，保留原存储键。

B站固定官方模型和非流式请求，验证 stop/非空/无 thinking 输出。新增 `declarativeNetRequestWithHostAccess`，只对本扩展固定 POST 端点移除 Origin；规则初始化失败则该线路不可用，host permissions 不扩大。

自动计划由既有配置快照持有，首次 lookup 冻结各具体配置/写令牌；结果带实际 providerId、routeRef、来源。缓存业务消息层验证原文/结果/引用后使用原令牌写入具体服务；DB4、通用 service/storage 和 envelope 不变。清缓存使计划不可持久写入，换线不刷新令牌。cacheOnly 仅查询各候选已有缓存。

联网确认单独保存在 machineTranslationConsent（站点可保存自己的确认），与自动／固定服务选择匹配。新默认不生成确认；迁移只继承旧版经过确认的明确免费设置。缺少确认或权限的自动翻译停在授权错误，不上传、不改方式。检查连接仍要求明确确认，只发送固定非敏感例句；读取、编辑和保存本身不翻译。

`translationConfig()` 在网页/文字划词解析免费路由；AI `getEffectiveConfig()`、`getEffectiveConfigForSite()`、字幕与助手保持原行为。免费配置不要求 Key，损坏的 AI 连接不阻断显式免费文字翻译。`hasConfiguredAi()` 语义不因免费模式改变。

免费快照有 mt: 前缀，绑定 tab/frame/document/pageUrl，缺失、过期、切换、导航及 worker 重启后拒绝旧任务，不落回 AI。Provider 和 cache store 复用同一快照。MT 指纹单独加入服务、固定 endpoint、源/目标语言及 adapter/input 版本，单条源身份额外包含 protectedIds。原 AI / browser-translator 指纹、IndexedDB schema、Reading schema 不改变、不清理。

富文本复用纯函数 `translationParts`：结构标记、链接目标及 code/kbd 留在本地，只有文字槽送给 Provider。返回结果必须完整且与输入一一对应；结构错误、实体损坏、空值、业务失败不作为成功写入缓存。显示复用现有安全 DOM 重建。首版不对免费接口承诺 AI Prompt、风格或自定义译法生效。

Reading 仍保存现有 `translation` artifact；provenance 使用真实 provider、披露模型（未披露时 `model: not-disclosed`）、`promptVersion: mt-adapter-v1` 和实际配置指纹。未披露模型不伪装成具体 AI 模型。悬停和历史回看仍只读本地，助手 artifact 不改变。

单测：`node --test tests/translation-preferences.test.mjs tests/machine-translation.test.mjs`。实际编译 MV3 流程：`npm run test:e2e -- e2e/machine-translation.spec.mjs`（先构建）。E2E 对登记的固定域名注入合成响应，不替代真实服务与双网络环境验收。协议来源、许可、准入和验收限制见 [设计记录](tasks/free-mt-auto-routing/design.md)。
