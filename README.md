# TranslateFlow v0.8

轻量、BYOK、缓存优先的 Chrome Manifest V3 双语阅读扩展。TranslateFlow 在原网页中保留原文并显示译文，同时提供本地查词、用户导入词典、显式 AI 详解、生词本、阅读历史和 YouTube 字幕翻译。网络翻译支持 DeepSeek、OpenAI-compatible API，以及通过独立 Native Messaging Host 连接的 ChatGPT 订阅。

## 当前功能

### 网页双语翻译

- 在原段落旁保留并展示译文，安全保留链接、强调、`code`、`kbd`、`mark` 等受控内联语义，不注入模型 HTML。
- 手动翻译、按站点自动翻译，以及动态页面新增内容的增量翻译。
- Standard / Compact / Reading / Minimal 四种阅读外观；Technical / Academic / News / Natural 四种翻译模式。
- Popup 和页内 Quick Control 显示任务阶段、段落进度、当前 Provider / Model / 模式，并支持重试、取消、临时切换或保存到本站。
- Chrome Commands：翻译或更新页面、显示或隐藏译文、切换 Quick Control。
- 全局与站点术语表，支持启停、大小写规则、站点覆盖和确定性缓存身份。
- 站点级 Provider、Model、Prompt、Target Language 和阅读外观配置。

### 缓存与任务恢复

- 按“规范化 URL + 有效翻译配置 + 原文指纹”写入 IndexedDB 缓存。
- 缓存命中直接恢复；按站点自动恢复既有译文时，cache miss 不会隐式调用 Provider。
- 正文、划词和增量翻译共用任务、取消、有限重试、超时、缓存提交和 in-flight 请求去重机制。
- 旧请求、已取消任务、导航前任务或过期选区不能覆盖新结果。

### Provider

- **DeepSeek**：固定官方 API Origin，保持既有缓存兼容。
- **OpenAI-compatible**：自定义 Base URL、API Key、Model；支持无 API Key 的本地兼容服务和可选 SSE streaming。
- **ChatGPT 订阅**：通过单独安装的 Go Native Messaging Host 完成官方 ChatGPT 授权、账号状态、模型列表和流式 Responses 调用；访问令牌保存在系统安全凭据存储中，不进入扩展存储。
- 所有 Provider 都通过同一 Effective Translation Config、缓存身份和完成校验；只有用户明确发起的翻译或 AI 操作才会发送文本。

### 划词查词与 AI 详解

- 普通网页选择文本后显示轻量“译”入口；单词优先走本地词典，句子和不适合本地释义的文本进入翻译路径。
- 内置 Core Semantic 与 Technical Concepts 词典包；本地查词不需要 Provider 或网络。
- 支持用户本地导入 TFLex、StarDict 和经过兼容性检查的 MDX/MDD 文件，包含安装预检、进度、取消、重试、更新、修复、卸载、首选词典、排序和展开策略。
- Rich MDX 内容经过限定 HTML/CSS sanitizer 后在隔离视图中展示；本地 MDD 图片与音频按受控资源路径解析，不执行脚本，也不自动加载远程资源。
- 已对用户本地合法持有的 Oxford Advanced Learner's Dictionary 10th Edition 完成富文本标题、语义词头、Oxford 3000/OPP 行内图标、英美发音标签及本地媒体的定向验收；这不代表所有商业 MDX/MDD 全面兼容。
- 本地结果之后可显式选择“理解 / 分析 / 用法”或完整“AI 详解”。停止、完成或失败不会覆盖本地词典卡；只有完整 AI 结果可进入历史。
- 支持复制、关闭、Escape、焦点退路、窄屏布局、失败重试和旧选区回调拒绝。

### 生词本与最小复习

- 从成功的本地词典结果显式收藏到本机生词本；不会自动把 AI 输出当作词典事实。
- 生词条目保存规范化词形、语言、可信词典摘要、来源和可选 Reading 关联，不保存页面 URL 或选区上下文。
- 学习中心提供按保存时间排列的生词列表、来源查看、删除，以及“再学一次 / 已掌握”的最小复习排期。
- 生词本与 Reading 历史职责分离：删除生词不会删除 Reading 记录，删除 Reading 记录也不会隐式修改生词本。

### Reading 历史与学习中心

- Reading 记录需用户显式开启；首次开启不会回填旧查询，当前仍有效的结果可显式保存。
- 支持最近记录、按页面浏览、搜索、完整结果与上下文快照、已完成 AI 问答、暂停/恢复、排除站点、单条/单页/全部删除和 JSON 导出。
- 可从历史返回原网页；只有唯一且仍匹配的 Range 会被滚动并临时标记，定位缺失、歧义、页面变化或权限不足时提供明确退路。
- 站点历史标记单独启用和授权，不会改变翻译、缓存恢复或 Quick Control 设置。
- 历史浏览、回到原文、生词复习和缓存恢复不会重新调用 Provider。

### YouTube 字幕

- YouTube MAIN-world player-owned timedtext 主路径，TextTrack 与已渲染字幕 DOM 作为 fallback。
- 支持双语、仅原文和关闭状态，兼容 ASR 与人工字幕、SPA 视频切换、媒体身份隔离、取消和缓存复用。

### 界面与隐私

- Popup、Settings、Quick Control、划词卡和学习中心统一使用柔和鼠尾草绿 / 暖米色设计系统。
- 扩展自有 UI 使用隔离的 Shadow DOM 或扩展页面；支持键盘、可见焦点、Escape、窄屏、暗色和减少动画。
- API Key 保存在扩展本地存储；ChatGPT 令牌只保存在操作系统安全凭据存储。原始本地词典文件和媒体不会上传到仓库或 Provider；只有用户显式触发 AI 操作时，才发送完成该请求所需的有界文本与候选摘要。
- 翻译缓存、Reading 数据库、生词本和词典 OPFS 分别维护，不通过清空用户数据掩盖错误。

## 架构

```text
Web Page
   │
   ▼
Content / Selection / YouTube
   │
   ▼
Background router + task coordinator
   ├── Effective Translation Config
   │      ├── DeepSeek
   │      ├── OpenAI-compatible
   │      └── ChatGPT subscription → Native Messaging Host
   ├── Translation cache IndexedDB
   ├── Lexical Gateway
   │      ├── bundled Core / Technical TFLex
   │      └── user-imported TFLex / StarDict / MDX + MDD in OPFS
   ├── ReadingRecord repository
   └── local vocabulary book
            │
            ▼
       Learning Center
```

关键原则：**API 请求和缓存查询必须使用同一份有效配置**。站点覆盖和术语表先在共享配置层解析，Provider adapter 不读取术语存储。

词典/划词能力遵循另一条硬边界：**Source-driven data → Rule-driven retrieval → Context-driven ranking → User-driven AI**。TranslateFlow 负责查询、排序、来源追踪和展示，不把持续人工维护单词释义当作 coverage 方案。测试/benchmark 词条属于验证资产，不应为了通过测试进入运行时词典；大型辞典通过可下载/本地导入机制提供，而不是塞进基础扩展包。

详细设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、[docs/LEXICAL_DATA_BOUNDARIES.md](docs/LEXICAL_DATA_BOUNDARIES.md) 和 [docs/PROVIDERS.md](docs/PROVIDERS.md)。

## 技术栈

生产扩展由 WXT 从唯一源码图构建并审核安装包边界；Content、MAIN、Worker、Background 和 shared 业务层保持原生 Web API / JavaScript 边界：

- Chrome Manifest V3
- WXT 0.21
- 原生 JavaScript / TypeScript
- React 19（仅 Popup / Options / Learning Center 扩展页）
- 原生 CSS；Content / MAIN / Worker / Background 不引入 React
- chrome.storage.local
- IndexedDB、OPFS
- DeepSeek / OpenAI-compatible Chat Completions
- ChatGPT Responses API（经 Go Native Messaging Host）

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
│   │   ├── Provider / glossary / preset / cache contracts
│   │   ├── Reading v2 contracts
│   │   └── vocabulary-book.js
│   │
│   ├── background/
│   │   ├── cache-db.js
│   │   ├── auto-sites.js
│   │   ├── lexical/ + packs/
│   │   ├── reading-record/
│   │   ├── selection/
│   │   ├── vocabulary-book.js
│   │   └── providers/
│   │       ├── deepseek.js
│   │       ├── openai-compatible.js
│   │       └── chatgpt-plan.js
│   │
│   ├── content/             # 页面翻译、Selection、字幕与隔离 UI
│   ├── options/             # React 设置页与词典导入
│   ├── popup/               # React Popup
│   ├── learning-center/     # Reading、生词本与复习
│   └── entries/             # WXT 生产入口
│
├── native-host/             # ChatGPT 订阅 Go Native Messaging Host
├── lexicon/                 # source locks、构建规则和认证元数据
├── tests/
├── e2e/                     # 实际 WXT / Chromium / MV3 场景
├── playwright.config.mjs
├── scripts/
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
npm ci
npm run setup:lexicon
npm run validate
npm run build:extension:release
```

`setup:lexicon` 会读取已审核的 source lock，使用锁定的 OMW revision/source URL，校验下载文件 SHA-256，再生成并认证 `assets/lexicon/core` 与 `assets/lexicon/technical`。校验不通过时会 fail closed，不会继续构建。

真实 Chromium 扩展 E2E：

```bash
npm ci
npx playwright install chromium
npm run build:extension:wxt
npm run test:e2e
```

E2E 使用临时 unpacked 扩展副本、本地 fixture 页面和本地 OpenAI-compatible mock server，不需要真实 API Key。生产 `manifest.json` 不会因为测试而扩大 Host Permission；测试副本运行时才临时加入 localhost 权限。

## Chrome 本地安装

首次安装或更新到包含词典格式/数据变更的版本：

```bash
npm ci
npm run setup:lexicon
npm run validate
npm run build:extension:release
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

生产扩展已获得普通 `http/https` 页面的访问权限，因此 OpenAI-compatible Provider 不再为每个 API Origin 单独弹出权限请求；Provider 凭据、调用时机和缓存身份仍按现有配置边界处理。

例如 Ollama/OpenAI-compatible 网关：

```text
http://localhost:11434/v1
```

生产 Manifest 的普通 `http/https` 页面范围同时承载 Content 注入和已配置的兼容服务访问，因此 localhost 不按端口精细隔离。

### ChatGPT 订阅

ChatGPT 订阅 Provider 不读取浏览器 Cookie，也没有 API Key fallback。它通过独立安装的 Native Messaging Host 完成官方授权，并使用当前 ChatGPT 账号可用的模型和套餐额度。

1. 按 [Native Host 安装说明](native-host/INSTALLATION.md) 构建并注册本机 Host。
2. 在 TranslateFlow 设置页打开 **Provider · ChatGPT 订阅**。
3. 点击“检查状态并加载模型”或“连接 ChatGPT 账号”。
4. 在官方授权页完成登录后，返回设置页选择 Host 返回的模型并保存。

Host 将账号注册、会话和模型列表分开管理；设置页支持添加账号和选择已保存账号。切换账号会清除旧的 ChatGPT 模型选择，但不会改写 DeepSeek 或 OpenAI-compatible 凭据。授权停滞、超时或遗留登录进程可从设置页重新连接；新的授权会取消并等待旧任务退出。

当前真实验收覆盖 Linux 主 Chrome 的单账号登录、GPT-6-Luna 模型加载、非缓存推理、退出、重新授权和浏览器重启恢复。多账号界面与协议已实现，但多个真实账号的添加/切换尚未执行产品验收；Windows 实机安装也仍未验证。更多合同见 [Provider Architecture](docs/PROVIDERS.md) 和 [Native Host README](native-host/README.md)。

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

扩展权限：

- `storage`
- `activeTab`
- `scripting`
- `nativeMessaging`

Host Permissions：

- `https://api.deepseek.com/*`
- `http://*/*`
- `https://*/*`

`http://*/*` 与 `https://*/*` 用于在普通网页加载时静态注入同一套 Content Script，使划词功能无需先打开 Popup。Chrome 内置页、Chrome Web Store 等受保护页面仍不会注入。

实际运行中：

- 划词：普通网页打开后即可使用，只有点击“译”才进行本地查询或按需调用 Provider；
- 自动翻译、缓存恢复和持久 Quick Control：仍由用户按站点开启；
- OpenAI-compatible：只在用户配置并触发翻译时调用。
- ChatGPT 订阅：`nativeMessaging` 只连接用户单独安装并注册的 TranslateFlow Host；普通扩展构建不会安装 Host、登录账号或读取凭据。

关闭某个站点的自动翻译只移除该站点模式，不会撤销全站划词所需的 Manifest 权限。

## 划词翻译

在普通 http/https 网页中无需先打开 Popup；选择 2–2000 字符的文本后会出现轻量“译”按钮。用户点击后，Selection 会根据文本形态选择本地查词或翻译路径，并复用当前站点的 Effective Translation Config。

支持：

- 英文单词及受支持短词优先查询内置和用户安装的本地词典，命中时 Provider 调用为 0；
- 多词典摘要、来源、首选顺序、展开详情和 Rich MDX/MDD 受控媒体；
- 普通句子翻译及缓存命中时 0 API 恢复；
- 本地词典结果之后显式触发 AI 理解、分析、用法或完整详解；
- 将成功的本地词典结果显式收藏到生词本；
- Reading 开启后显式保存结果，并可设置本站历史标记；
- Copy；
- Escape、右上角关闭按钮或点击外部关闭；
- Provider 失败后 Retry；
- AI 流式请求停止、失败和重试；Selection 变化、关闭或导航后旧回调不会覆盖当前卡片；
- 与自动增量翻译同时启用时，划词 UI 不会进入 MutationObserver 翻译队列。

词典导入、格式与安全边界见 [Lexical data boundaries](docs/LEXICAL_DATA_BOUNDARIES.md) 和 [MDX/MDD compatibility evidence](docs/MDICT_REAL_WORLD_COMPATIBILITY.md)。解析成功或单个真实词典验收不等于所有 MDX/MDD 全面兼容。

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

从 Popup 或划词结果卡进入独立学习中心。当前包含三个相互关联但存储职责独立的流程：

- **Reading 历史**：最近记录、按页面浏览、搜索、词典/译文/已完成 AI 快照、暂停/恢复、排除站点、删除和 JSON 导出。
- **生词本**：查看本地收藏的词头、发音、词性、释义、来源和关联 Reading 记录；支持删除。
- **最小复习**：显示答案后选择“再学一次”或“已掌握”，更新本地待复习时间和统计；当前不是 SRS/FSRS。

首次开启 Reading 后只记录之后的查询；原网页仍有效的结果卡可显式“保存本次结果”。历史详情可以在不查询词典、不读取 MDD、不调用 Provider 的情况下离线阅读。返回原网页时重新验证授权、记录 revision、页面投影和唯一位置；无法精确定位时保留安全的手动入口。生词本和 Reading 删除互不级联。完整操作与数据边界见 [Learning center v1](docs/LEARNING_CENTER_V1.md) 和 [Reading loop v1](docs/READING_LOOP_V1.md)。

## 开发约束

`npm run check` 自动执行：

- `src/shared/` 禁止依赖 `chrome.*`
- 外部 `fetch()` 只能位于 `src/background/providers/`
- 翻译缓存 IndexedDB 只能由 `src/background/cache-db.js` 访问；ReadingRecord IndexedDB 只能由 `src/background/reading-record/idb.js` 访问
- 动态 Content Script 注册只能由 `src/background/auto-sites.js` 调用
- Content Script 模块禁止 ESM import/export
- `src/` 单文件超过 420 行失败
- `background.js` / `content.js` 保持薄入口
- 旧根目录 `cache-db.js` 不允许重新出现
- 生产扩展使用 allowlist `dist/extension`；测试、E2E、构建脚本、raw/source-lock/benchmark 资产不得进入发布包

`npm run validate` 和受影响的 Chromium/MV3 E2E 在本地运行。GitHub Actions 的 quality/e2e 等工作流仅保留手动 workflow_dispatch 入口，不自动响应 PR 或 push。

## 当前限制

- OpenAI-compatible 当前基于 Chat Completions 接口，不是 Responses API。
- 不同兼容服务对 JSON 输出能力差异较大，当前通过严格 Prompt + 容错 JSON 解析适配。
- Provider 额外 Header 尚未开放配置；OpenRouter 等需要特殊 Header 的场景后续可扩展。
- ChatGPT 订阅需要单独安装 Native Messaging Host；当前真实产品验收覆盖 Linux 单账号，真实多账号切换和 Windows 实机安装尚未验证。
- MDX/MDD 支持以现有兼容矩阵、sanitizer 和资源边界为准；Oxford 10 的定向实机结果不能升格为所有商业词典、所有编码或全部 MDict 版本的认证。
- 生词本提供本地显式收藏与最小复习，不包含云同步、自动 AI 释义、SRS/FSRS 或跨设备账号体系。
- PDF、Side Panel、非 YouTube 视频站点的双语字幕尚未实现；v0.8 视频体验首发支持 YouTube。
- 当前生产目标是 Chrome Manifest V3；Edge / Firefox / Safari 和浏览器商店发布未完成独立交付认证。
- Chrome 内部页面、Chrome Web Store 等受保护页面无法注入。
- API Key 保存于 `chrome.storage.local`，适合个人 BYOK，不是服务端密钥保险库。

## 开发任务与本地验收

任务和执行状态见 [docs/tasks/index.json](docs/tasks/index.json)，完整流程见 [docs/tasks/LOCAL_WORKFLOW.md](docs/tasks/LOCAL_WORKFLOW.md)。日常在本地完成验收与具名独立审核；GitHub 仅用于代码同步。Actions 只接受手动触发，原始执行日志/截图保持本地并忽略。
