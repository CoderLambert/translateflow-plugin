# TranslateFlow v0.8

轻量、BYOK、缓存优先的 Chrome Manifest V3 双语网页翻译扩展。保留英文原文，在原段落中展示中文译文；支持 DeepSeek 与 OpenAI-compatible API，并按“规范化 URL + 有效翻译配置 + 原文指纹”缓存翻译结果。

## v0.8 重点

- DeepSeek Provider
- OpenAI-compatible Provider
- 自定义 OpenAI-compatible Base URL / API Key / Model
- 支持无 API Key 的本地兼容服务
- 按 API Origin 动态申请 Host Permission
- 站点级 Provider / Model / Prompt / Target Language 覆盖
- 划词翻译浮层：选择文本后按需翻译、复制、取消、失败重试，并复用站点配置与 IndexedDB 缓存
- 统一 Translation Task：阶段进度、用户取消、Provider timeout/retry 与 in-flight 请求去重
- 结构化双语渲染：保留链接、强调、code/kbd/mark 等安全内联语义，不注入模型 HTML
- Provider Base URL 纳入 OpenAI-compatible 缓存版本
- DeepSeek v0.3/v0.4 缓存继续兼容
- 全局 + 站点术语表：支持覆盖、启停、大小写规则，并纳入有效缓存身份
- Technical / Academic / News / Natural 四种内置翻译模式
- Popup 展示当前站点 / 模式 / Provider / Model，并支持临时切换或保存到本站
- Shared Shadow DOM UI foundation：统一 tokens / primitives / toast，避免宿主页 CSS 污染扩展控件
- Reading Appearance：Standard / Compact / Reading / Minimal 四种双语阅读外观
- Quick Control：页内低干扰翻译、重试/取消、Preset、阅读外观、自动翻译与 Settings 入口
- 三个 Chrome Commands：翻译/更新页面、显示/隐藏译文、切换 Quick Control
- YouTube 双语字幕：TextTrack 优先 + DOM fallback、稳定化/批处理/缓存、双语/原文/关闭模式、大小与 Preset 控制
- Settings IA：General / Appearance / YouTube / Sites / Glossary + Advanced Provider / Cache / Developer

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
                   ├── deepseek
                   └── openai-compatible
```

关键原则：**API 请求和缓存查询必须使用同一份有效配置**。站点覆盖和术语表先在共享配置层解析，Provider adapter 不读取术语存储。

详细设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 和 [docs/PROVIDERS.md](docs/PROVIDERS.md)。

## 技术栈

运行时保持零第三方依赖、零打包：

- Chrome Manifest V3
- 原生 JavaScript
- 原生 HTML / CSS
- chrome.storage.local
- IndexedDB
- DeepSeek / OpenAI-compatible Chat Completions

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
│   │   └── glossary-ui.js
│   ├── popup/
│   │   └── preset-ui.js
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

不需要安装运行时依赖，也没有 build 步骤。

开发校验：

```bash
npm run validate
```

真实 Chromium 扩展 E2E：

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

E2E 使用临时 unpacked 扩展副本、本地 fixture 页面和本地 OpenAI-compatible mock server，不需要真实 API Key。生产 `manifest.json` 不会因为测试而扩大 Host Permission；测试副本运行时才临时加入 localhost 权限。

## Chrome 本地安装

1. 打开 `chrome://extensions/`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择仓库根目录
5. 打开 TranslateFlow 设置页
6. 配置 Provider
7. 测试 API
8. 刷新目标英文网页后测试

开发循环：

```text
修改代码
  ↓
npm run validate
  ↓
chrome://extensions/ → 重新加载
  ↓
刷新目标网页
```

## Provider 配置

### DeepSeek

配置：

```text
Provider: DeepSeek
API Key: sk-...
Model: deepseek-flash
```

API Origin 固定为：

```text
https://api.deepseek.com
```

### OpenAI-compatible

配置示例：

```text
Provider: OpenAI-compatible
Base URL: https://api.example.com/v1
API Key:   sk-...        # 本地服务可留空
Model:     your-model
```

插件会自动请求：

```text
<Base URL>/chat/completions
```

如果 Base URL 已经以 `/chat/completions` 结尾，则不会重复追加。

首次保存/测试 OpenAI-compatible Provider 时，Chrome 会请求该 API Origin 的访问权限。插件不会因为配置了通用 Provider 就在安装时直接获得所有 API 地址权限。

例如 Ollama/OpenAI-compatible 网关：

```text
http://localhost:11434/v1
```

Host Permission 会按浏览器 Match Pattern 申请，因此 localhost 不按端口精细隔离。

## 站点级配置

设置页可以针对站点覆盖：

- Provider
- Model
- Prompt
- Target Language

例如：

```text
https://github.com
Provider: OpenAI-compatible
Model: qwen-coder
Prompt: 技术文档翻译 Prompt
Target Language: English
```

而新闻网站可继续继承默认 DeepSeek 配置。

站点配置只保存覆盖项，API 凭据仍由 Provider 全局配置统一管理，避免每个站点重复保存密钥。

解析顺序：

```text
Provider 全局配置
      +
默认 Prompt / Target Language
      ↓
站点 Provider / Model / Prompt / Target Language 覆盖
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
+ provider
+ model
+ target language
+ prompt
+ OpenAI-compatible endpoint（仅通用 Provider）
+ effective glossary identity（仅非空术语表）

Preset 不额外写入 cache fingerprint；它通过最终解析出的 Prompt 进入缓存身份。因此切回曾经使用过的同一有效模式，会复用之前的缓存版本。

segment:
SHA-256(normalized source text)
```

普通纯文本段落继续使用原有规范化文本作为缓存身份，因此既有缓存继续命中。包含受支持内联结构的段落使用带 TranslateFlow 结构标记的确定性 source fingerprint，首次可能 miss 一次，但不会提升全局缓存 schema。

DeepSeek 不把固定 API Base URL 放进指纹，因此 v0.3/v0.4 DeepSeek 缓存继续命中。

OpenAI-compatible 会把 Base URL 纳入缓存版本，避免两个不同兼容服务使用同一模型名时误复用译文。非空有效术语表也会以确定性 identity 参与缓存；空术语表不会增加字段，因此保持既有缓存兼容。修改无关站点的术语不会使当前站点缓存失效。

## 权限

必需权限：

- `storage`
- `activeTab`
- `scripting`
- `https://api.deepseek.com/*`

可选 Host Permission 声明：

- `http://*/*`
- `https://*/*`

该声明是“允许用户以后授权的最大范围”，不是安装时直接授予。

实际运行中：

- 自动翻译：用户按站点授权
- Quick Control 持久显示：用户在 Popup 明确操作后按站点授权
- OpenAI-compatible：用户按 API Origin 授权

如果某个 Origin 同时是自动翻译站点和 API Provider 地址，关闭自动翻译时不会误撤销 Provider 仍需要的 Host Permission。

## 划词翻译

在普通 http/https 网页中选择 2–2000 字符的英文文本后，会出现轻量“译”按钮。仅在用户点击后才检查 IndexedDB 缓存并调用 Provider；翻译使用当前站点的 Effective Translation Config。

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

GitHub Actions 的 `quality` workflow 在 PR 和 main push 时执行 `npm run validate`；独立 `e2e` workflow 在相关运行时代码变化时安装 Playwright Chromium 并执行 `npm run test:e2e`。

## 当前限制

- OpenAI-compatible 当前基于 Chat Completions 接口，不是 Responses API。
- 不同兼容服务对 JSON 输出能力差异较大，当前通过严格 Prompt + 容错 JSON 解析适配。
- Provider 额外 Header 尚未开放配置；OpenRouter 等需要特殊 Header 的场景后续可扩展。
- PDF、Side Panel、非 YouTube 视频站点的双语字幕尚未实现；v0.8 视频体验首发支持 YouTube。
- Chrome 内部页面、Chrome Web Store 等受保护页面无法注入。
- API Key 保存于 `chrome.storage.local`，适合个人 BYOK，不是服务端密钥保险库。
