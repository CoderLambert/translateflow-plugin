# TranslateFlow v0.5

轻量、BYOK、缓存优先的 Chrome Manifest V3 双语网页翻译扩展。保留英文原文，在原段落中展示中文译文；支持 DeepSeek 与 OpenAI-compatible API，并按“规范化 URL + 有效翻译配置 + 原文指纹”缓存翻译结果。

## v0.5 重点

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
   │
   ├── global provider config
   └── site profile override
   │
   ├───────────────┐
   ▼               ▼
cache-db        providers/
                   ├── deepseek
                   └── openai-compatible
```

关键原则：**API 请求和缓存查询必须使用同一份有效配置**。站点覆盖不会绕过缓存层，也不会另起翻译流程。

详细设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 和 [docs/PROVIDERS.md](docs/PROVIDERS.md)。

## 技术栈

运行时保持零第三方依赖、零打包：

- Chrome Manifest V3
- 原生 JavaScript
- 原生 HTML / CSS
- chrome.storage.local
- IndexedDB
- DeepSeek / OpenAI-compatible Chat Completions

Node.js 只用于开发校验和 `node:test`，不参与扩展运行。

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

segment:
SHA-256(normalized source text)
```

普通纯文本段落继续使用原有规范化文本作为缓存身份，因此既有缓存继续命中。包含受支持内联结构的段落使用带 TranslateFlow 结构标记的确定性 source fingerprint，首次可能 miss 一次，但不会提升全局缓存 schema。\n\nDeepSeek 不把固定 API Base URL 放进指纹，因此 v0.3/v0.4 DeepSeek 缓存继续命中。

OpenAI-compatible 会把 Base URL 纳入缓存版本，避免两个不同兼容服务使用同一模型名时误复用译文。

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

修改全局 Provider、OpenAI-compatible 配置或当前站点 Profile 时，自动模式会清理当前页面译文并按新配置重新处理。

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

GitHub Actions 在 PR 和 main push 时执行同一套 `npm run validate`。

## 当前限制

- OpenAI-compatible 当前基于 Chat Completions 接口，不是 Responses API。
- 不同兼容服务对 JSON 输出能力差异较大，当前通过严格 Prompt + 容错 JSON 解析适配。
- Provider 额外 Header 尚未开放配置；OpenRouter 等需要特殊 Header 的场景后续可扩展。
- PDF、视频双语字幕尚未实现。
- Chrome 内部页面、Chrome Web Store 等受保护页面无法注入。
- API Key 保存于 `chrome.storage.local`，适合个人 BYOK，不是服务端密钥保险库。
