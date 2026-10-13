# TranslateFlow v0.8

轻量、BYOK、缓存优先的 Chrome Manifest V3 双语网页翻译扩展。保留英文原文，在原段落中展示中文译文；直接支持 OpenAI、Anthropic、Gemini 与主流 OpenAI-compatible API，并按“规范化 URL + 有效翻译配置 + 原文指纹”缓存翻译结果。

## v0.8 重点

- OpenAI Chat Completions、OpenAI Responses、Anthropic Messages、Gemini generateContent 四种原生协议
- OpenAI、Anthropic、Gemini、DeepSeek、OpenRouter、Groq、xAI、Mistral、百炼等平台预设
- 可配置多个 API Key 连接，并为默认服务或站点保存稳定引用
- 支持无 API Key 的本地兼容服务
- 按 API Origin 动态申请 Host Permission
- 站点级连接 / Model / Prompt / Target Language 覆盖
- 划词翻译浮层：选择文本后按需翻译、复制、取消、失败重试，并复用站点配置与 IndexedDB 缓存
- 统一 Translation Task：阶段进度、用户取消、Provider timeout/retry 与 in-flight 请求去重
- 结构化双语渲染：保留链接、强调、code/kbd/mark 等安全内联语义，不注入模型 HTML
- Provider Base URL 纳入 OpenAI-compatible 缓存版本
- DeepSeek v0.3/v0.4 缓存继续兼容
- 全局 + 站点术语表：支持覆盖、启停、大小写规则，并纳入有效缓存身份
- Technical / Academic / News / Natural 四种内置翻译模式
- Popup 展示当前站点 / 模式 / Provider / Model，并支持临时切换或保存到本站

## v0.8 体验更新

- **Calm UI**：Popup、Quick Control、Settings 与状态反馈统一使用柔和鼠尾草绿 / 暖米色设计系统。
- **Reading Appearance**：Standard / Compact / Reading / Minimal 四种双语阅读外观。
- **Quick Control**：低干扰页内翻译、任务状态、重试/取消、Preset、阅读外观、自动翻译与 Settings 入口。
- **Persistent cache restore**：可按站点自动恢复 IndexedDB 已有译文；cache miss 不触发 Provider。
- **Chrome Commands**：翻译/更新页面、显示/隐藏译文、切换 Quick Control。
- **YouTube subtitles**：MAIN-world player-owned timedtext 主路径，TextTrack 与 rendered DOM 作为 fallback；支持双语/原文/off、ASR、人类字幕、SPA 切换与缓存复用。
- **Settings IA**：General / Appearance / YouTube / Sites / Automatic behavior / Glossary + Advanced Provider / Cache / Developer。

## 架构

```text
Web Page
   │
   ▼
content/
   │
   │ pageUrl + segments
   ▼
background/router
   │
   ▼
resolveTranslationConfig(pageUrl)
   +
resolveEffectiveGlossary(pageUrl)
   │
   ├── global provider/site profile
   └── global glossary/site glossary
   │
   ├───────────────┐
   ▼               ▼
cache-db        providers/
                   ├── openai-chat / openai-responses
                   ├── anthropic-messages / gemini-generate
                   └── chatgpt-plan (optional native host)
```

关键原则：**API 请求和缓存查询必须使用同一份有效配置**。站点覆盖和术语表先在共享配置层解析，Provider adapter 不读取术语存储。

词典/划词能力遵循另一条硬边界：**Source-driven data → Rule-driven retrieval → Context-driven ranking → User-driven AI**。TranslateFlow 负责查询、排序、来源追踪和展示，不把持续人工维护单词释义当作 coverage 方案。测试/benchmark 词条属于验证资产，不应为了通过测试进入运行时词典；大型辞典通过可下载/本地导入机制提供，而不是塞进基础扩展包。

详细设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、[docs/LEXICAL_DATA_BOUNDARIES.md](docs/LEXICAL_DATA_BOUNDARIES.md) 和 [docs/PROVIDERS.md](docs/PROVIDERS.md)。

## 技术栈

运行时保持零第三方依赖、零 bundler；发布阶段只做 allowlist 文件打包：

- Chrome Manifest V3
- 原生 JavaScript
- React 19（仅 Popup / Options / Learning Center 扩展页）
- 原生 CSS；Content / MAIN / Worker / Background 不引入 React
- chrome.storage.local
- IndexedDB
- OpenAI Chat Completions / Responses、Anthropic Messages、Gemini generateContent

Node.js 只用于开发校验；单元测试使用 `node:test`，浏览器 E2E 使用 Playwright。Playwright 仅为开发依赖，不进入扩展运行时。

## 仓库结构

```text
translateflow-plugin/
├── manifest.json
├── background.js
├── content.js
├── popup.*
├── options.*
├── content.css
│
├── src/
│   ├── shared/
│   │   ├── constants.js
│   │   ├── provider-config.js
│   │   ├── glossary.js
│   │   ├── presets.js
│   │   ├── hash.js
│   │   ├── text.js
│   │   ├── url.js
│   │   └── retry-policy.js
│   │
│   ├── background/
│   │   ├── index.js
│   │   ├── router.js
│   │   ├── config.js
│   │   ├── cache-db.js
│   │   ├── auto-sites.js
│   │   ├── translation-requests.js
│   │   └── providers/
│   │       ├── index.js
│   │       ├── shared.js
│   │       ├── deepseek.js
│   │       └── openai-compatible.js
│   │
│   ├── options/
│   │   ├── main.tsx / App.tsx
│   │   ├── client.ts / useOptions.ts
│   │   ├── GlossarySection.tsx / glossary-client.ts
│   │   └── DictionarySection.tsx / typed dictionary clients / existing import controllers
│   ├── popup/
│   │   └── main.tsx / App.tsx / client.ts / usePopup.ts
│   │
│   └── content/
│       ├── runtime.js
│       ├── tasks.js
│       ├── dom.js
│       ├── batch.js
│       ├── processor.js
│       ├── auto.js
│       └── selection/
│           ├── selection.js
│           ├── popover.js
│           └── controller.js
│
├── tests/
├── e2e/
│   ├── support/
│   │   ├── extension-fixture.mjs
│   │   └── mock-server.mjs
│   └── translateflow.spec.mjs
├── playwright.config.mjs
├── scripts/check.mjs
├── docs/
└── .github/workflows/quality.yml
```

## 获取代码

```bash
git clone https://github.com/CoderLambert/translateflow-plugin.git
cd translateflow-plugin
```

默认构建由 WXT 编译后台、Popup 和 Options，Content/MAIN/Worker 继续复用精确源码桥；`npm run build:extension` 将审核过的 WXT 包输出到稳定安装目录 `dist/extension/`。Selection v2 的 Core / Technical 真实词典资源属于生成产物，`assets/lexicon/` 不提交到 Git；`tests/`、`e2e/`、`scripts/`、`docs/`、`lexicon/sources/` 和 source-lock 等开发/验证资产不会进入生产扩展。

首次源码安装或清理过词典产物后，先执行：

```bash
npm install
npm run setup:lexicon
npm run validate
npm run build:extension:release
```

`setup:lexicon` 会读取已审核的 source lock，使用锁定的 OMW revision/source URL，校验下载文件 SHA-256，再生成并认证 `assets/lexicon/core` 与 `assets/lexicon/technical`。校验不通过时会 fail closed，不会继续构建。

真实 Chromium 扩展 E2E：

```bash
npm install
npx playwright install chromium
npm run build:extension:wxt
npm run test:e2e
```

E2E 使用临时 unpacked 扩展副本、本地 fixture 页面和本地 OpenAI-compatible mock server，不需要真实 API Key。生产 `manifest.json` 不会因为测试而扩大 Host Permission；测试副本运行时才临时加入 localhost 权限。

## Chrome 本地安装

首次安装或更新到包含词典格式/数据变更的版本：

```bash
npm install
npm run setup:lexicon
npm run validate
```

然后：

1. 打开 `chrome://extensions/`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择 `dist/extension/`。仓库根目录只用于开发调试，不作为正式发布包
5. 打开 TranslateFlow 设置页 → **本地词典**
6. 确认 **Core Semantic** 与 **Technical Concepts** 均显示“已就绪”
7. 配置 Provider 并测试 API
8. 刷新目标英文网页后测试

日常开发循环：

```text
修改代码
  ↓
npm run validate
  ↓
chrome://extensions/ → 重新加载
  ↓
刷新目标网页
```

如果 Settings 显示内置词典“资源缺失或不可读”，重新运行 `npm run setup:lexicon` 后再重新加载扩展。可选 OPFS 词典与内置 Core / Technical 是两套独立机制；当前没有通过产品质量门并注册为可下载来源的可选词典包。

## Provider 配置

### API Key 连接

配置示例：

```text
平台: Anthropic
协议: anthropic-messages
Base URL: https://api.anthropic.com/v1
API Key:  sk-ant-...
Model:    claude-...
```

设置页可保存多个连接，并选择默认翻译服务。第一版原生支持：

```text
openai-chat         -> <Base URL>/chat/completions
openai-responses    -> <Base URL>/responses
anthropic-messages  -> <Base URL>/messages
gemini-generate     -> <Base URL>/models/<model>:generateContent
```

Azure OpenAI v1 使用 `https://<resource>.openai.azure.com/openai/v1` 形式的 Base URL，并自动改用 Azure 的 `api-key` header；旧 deployment API 与 Entra ID 不在当前范围。

本地服务可选择 Local / self-hosted，显式允许空 API Key 和 `http`，例如：

```text
http://localhost:11434/v1
```

API Key 独立保存在 trusted extension context 可访问的本地存储中，Content Script 只能通过脱敏消息读取公开设置。连接列表只显示“已保存 API Key”，不会把密钥回传给页面。

### ChatGPT 订阅

ChatGPT 订阅 Provider 通过可选的 TranslateFlow 本地组件连接。未安装组件时，词典和 API Key 连接仍可使用。设置页只会在用户点击 **启用本地连接** 后申请 `nativeMessaging` 权限，并提供下载、重新检测和重启入口。

面向用户的 Windows/Linux 安装、升级、卸载与故障恢复步骤见 [ChatGPT 本地组件安装与发布引导](docs/CHATGPT_NATIVE_HOST_INSTALL.md)。

## 站点级配置

设置页可以针对站点覆盖：

- API Key 连接或 ChatGPT 订阅服务
- Model
- Prompt
- Target Language

例如：

```text
https://github.com
连接: OpenAI-compatible
Model: qwen-coder
Prompt: 技术文档翻译 Prompt
Target Language: English
```

而新闻网站可继续继承默认连接。

站点配置只保存覆盖项，API 凭据仍由 Provider 全局配置统一管理，避免每个站点重复保存密钥。

解析顺序：

```text
默认服务 + 连接定义与凭据
      +
默认 Prompt / Target Language
      ↓
站点连接 / Model / Prompt / Target Language 覆盖
      ↓
Effective Translation Config
```



## 翻译模式 / Preset

v0.8 内置四种只描述“翻译风格”的模式：

- **Technical**：技术文档、API、工程内容，优先术语精确与标识符保真。
- **Academic**：论文、研究、学术内容，保留限定语、逻辑关系和正式语体。
- **News**：新闻报道，强调中性、姓名/日期/数字/归因准确。
- **Natural**：日常阅读，强调流畅自然但不丢失事实细节。

Preset 不保存 API Key、Provider 或模型参数，也不会改写用户的全局 Prompt。

Prompt 解析优先级：

```text
本站自定义 Prompt
      ↓（若不存在）
临时 / 本站保存的 Preset 风格
      +
全局自定义 / 默认 Prompt
      ↓
有效 Prompt
      +
有效 Glossary
```

Popup 可以临时切换当前站点模式，也可以明确“保存到本站”。临时模式使用 `chrome.storage.session`，只保存在当前浏览器会话的内存中；浏览器重启、扩展重载/更新后自动清除。由于 `storage.session` 从 Chrome 102 起提供，v0.8 的最低 Chrome 版本调整为 102。

如果站点 Profile 已经填写自定义 Prompt，则该 Prompt 优先，Popup 会显示 **Custom Prompt**；选择 Preset 不会覆盖这个自定义 Prompt。

## 术语表

设置页支持全局和站点级术语，例如：

```text
repository   -> 仓库
pull request -> 拉取请求
middleware   -> 中间件
```

每条术语包含：

- 来源术语与目标译法；
- 是否区分大小写；
- 启用/停用状态；
- 稳定 ID，便于编辑和后续迁移。

存储使用 versioned shape：

```text
glossary:
  version: 1
  entries: [...]

siteGlossaries:
  version: 1
  sites:
    https://github.com: [...]
```

运行时会先规范化术语。相同 scope 下重复的有效 source key 只保留一个，最新保存值生效；匹配站点的术语会扩展并覆盖同 key 的全局术语。站点术语只影响对应规范化 Origin。

术语在共享配置层被组合进最终 Prompt，DeepSeek/OpenAI-compatible Provider 本身不感知 glossary 数据结构。

## 缓存

IndexedDB 名称和数据结构保持不变：

```text
ai_bilingual_translator
├── pages
└── translations
```

缓存身份：

```text
page:
normalized URL

config:
cache schema
+ provider connection ID / revision / protocol
+ model
+ target language
+ prompt
+ Provider endpoint
+ effective glossary identity（仅非空术语表）

Preset 不额外写入 cache fingerprint；它通过最终解析出的 Prompt 进入缓存身份。因此切回曾经使用过的同一有效模式，会复用之前的缓存版本。

segment:
SHA-256(normalized source text)
```

普通纯文本段落继续使用原有规范化文本作为缓存身份，因此既有缓存继续命中。包含受支持内联结构的段落使用带 TranslateFlow 结构标记的确定性 source fingerprint，首次可能 miss 一次，但不会提升全局缓存 schema。

迁移后的旧 DeepSeek / OpenAI-compatible 配置保留旧缓存兼容路径。新连接把连接 ID、revision、协议和 Base URL 纳入缓存版本，避免不同后端或连接版本使用同一模型名时误复用译文。API Key 字节不进入缓存。非空有效术语表也会以确定性 identity 参与缓存；空术语表保持既有缓存兼容。

## 权限

必需权限：

- `storage`
- `activeTab`
- `scripting`
- `https://api.deepseek.com/*`
- `http://*/*`
- `https://*/*`

`http://*/*` 与 `https://*/*` 用于在普通网页加载时静态注入同一套 Content Script，使划词功能无需先打开 Popup。Chrome 内置页、Chrome Web Store 等受保护页面仍不会注入。

实际运行中：

- 划词：普通网页打开后即可使用，只有点击“译”才进行本地查询或按需调用 Provider；
- 自动翻译、缓存恢复和持久 Quick Control：仍由用户按站点开启；
- API Key Provider：只在用户配置并触发翻译时调用。
- ChatGPT 订阅：`nativeMessaging` 是可选权限，仅在用户从设置页启用本地连接后申请；未授权不影响其他 Provider。

关闭某个站点的自动翻译只移除该站点模式，不会撤销全站划词所需的 Manifest 权限。

## 划词翻译

在普通 http/https 网页中无需先打开 Popup；选择 2–2000 字符的英文文本后会出现轻量“译”按钮。仅在用户点击后才检查 IndexedDB 缓存并调用 Provider；翻译使用当前站点的 Effective Translation Config。

支持：

- 缓存命中时 0 API 恢复；
- Copy；
- Escape、右上角关闭按钮或点击外部关闭；
- Provider 失败后 Retry；
- 与自动增量翻译同时启用时，划词 UI 不会进入 MutationObserver 翻译队列。

## 翻译任务与错误恢复

正文翻译、划词翻译和自动增量翻译共享同一套任务/请求基础设施。用户主动翻译会展示：

```text
检查缓存 → 调用模型 → 保存译文 → 完成
```

支持：

- Popup 显示当前阶段和段落进度；
- 正文翻译和划词翻译可取消；
- 取消后不会写入未完成的缓存；
- 网络错误、HTTP 429 与 5xx 使用有界重试；
- HTTP 429 尊重 `Retry-After`；
- API Key、权限和配置错误立即失败，不自动重试；
- 相同 in-flight Provider 请求在安全条件下复用同一次调用。

## 自动增量翻译

自动模式保持原有机制：

- IntersectionObserver：只处理近视口内容
- MutationObserver：动态新增内容进入队列
- IndexedDB：缓存优先
- API：只翻译未命中段落
- SPA 路由变化：重新计算页面身份
- API 错误：退避重试

修改全局 Provider、OpenAI-compatible 配置、当前站点 Profile 或有效术语表时，自动模式会清理当前页面译文并按新配置重新处理。Popup 的临时 Preset 会立即重新翻译当前页面，之后新增内容继续使用该 session 模式。

## 学习中心

从 Popup 的“学习中心”或划词结果卡进入独立页面，可找回最近记录、按页面浏览、搜索、阅读历史快照，以及暂停/恢复记录、管理排除站点、删除和导出 JSON。首次开启后只记录之后的查询；原网页仍有效的结果卡可显式“保存本次结果”。历史阅读无需重新查词或调用 Provider。完整操作与数据边界见 [Learning center v1](docs/LEARNING_CENTER_V1.md)。

站点历史高亮默认开启。重新访问页面时，仍能精确匹配的原文会显示轻量高亮；同一位置的重复记录只显示一次。鼠标悬停在高亮单词上，会在隔离预览中显示保存时的语境、词典释义、翻译，以及当前页同一词项已保存且完成的“AI 详解 / 分析 / 用法 / 继续追问”问答；读取历史不会重新调用 Provider。若没有完成并保存过 AI 操作，预览会明确说明。页面不再显示额外的数字 badge 或“本页历史”面板；完整管理、删除与无法重新定位的记录仍在学习中心处理，删除后对应高亮会立即消失。

## 开发约束

`npm run check` 自动执行：

- `src/shared/` 禁止依赖 `chrome.*`
- 外部 `fetch()` 只能位于 `src/background/providers/`
- IndexedDB 只能由 `src/background/cache-db.js` 访问
- 动态 Content Script 注册只能由 `src/background/auto-sites.js` 调用
- Content Script 模块禁止 ESM import/export
- `src/` 单文件超过 420 行失败
- `background.js` / `content.js` 保持薄入口
- 旧根目录 `cache-db.js` 不允许重新出现
- 生产扩展使用 allowlist `dist/extension`；测试、E2E、构建脚本、raw/source-lock/benchmark 资产不得进入发布包

`npm run validate` 和受影响的 Chromium/MV3 E2E 在本地运行。GitHub Actions 的 quality/e2e 等工作流仅保留手动 workflow_dispatch 入口，不自动响应 PR 或 push。

## 当前限制

- 当前支持 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 和 Gemini generateContent；不支持旧 Azure deployment API、Bedrock、Vertex IAM/OAuth 或自动 failover。
- 不同兼容服务对结构化输出能力差异较大，当前通过严格 Prompt、完整 segment 校验和一次格式重试适配。
- 自定义额外 Header 尚未开放配置。
- PDF、Side Panel、非 YouTube 视频站点的双语字幕尚未实现；v0.8 视频体验首发支持 YouTube。
- Chrome 内部页面、Chrome Web Store 等受保护页面无法注入。
- API Key 保存于仅 trusted extension context 可访问的 `chrome.storage.local`，适合个人 BYOK，不是操作系统密钥保险库。

## 开发任务与本地验收

任务和执行状态见 [docs/tasks/index.json](docs/tasks/index.json)，完整流程见 [docs/tasks/LOCAL_WORKFLOW.md](docs/tasks/LOCAL_WORKFLOW.md)。日常在本地完成验收与具名独立审核；GitHub 仅用于代码同步。Actions 只接受手动触发，原始执行日志/截图保持本地并忽略。
