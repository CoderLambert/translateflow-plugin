# TranslateFlow v0.8.57

轻量、缓存优先的 Chrome Manifest V3 双语网页翻译扩展。单词查词与句段／全文分别保存一种翻译方式：单词可选免费在线、词典、Chrome 本地或 AI；短语、句子、段落和全文可选 AI、Chrome 本地或免费在线。未命中、未就绪或失败时保留所选方式，用户可在划选面板临时切换。字幕保持独立路径。直接支持 OpenAI、Anthropic、Gemini 与主流 OpenAI-compatible API，并按有效配置与原文指纹缓存结果。

划选结果顶部显示当前方式；点击「切换方式」，再点击一种方式即可重新查词或翻译，仅对本次生效。识别有误时可在展开区改按单词或选段处理；长期偏好通过「修改默认方式」进入设置后保存。

设置 → 常规包含两个单选区域，点击「保存翻译偏好」统一保存。单词首次默认免费在线；句段仅在首次初始化时按完整 AI 配置、明确就绪的 Chrome 本地模型、免费在线依次选择。安装词典、配置 AI 或准备模型不会改变已经保存的选择。Popup 仅编辑本站句段／全文，单词方式全局统一。默认免费在线不代表同意上传，仍须联网确认与服务权限。契约见 [Provider 说明](docs/PROVIDERS.md#翻译偏好与执行方式)。

## AI 文本翻译

点击 Popup 或网页悬浮球面板中的「AI 文本翻译」打开独立小窗，粘贴文字即可调用已有 AI 服务。可直接选择邮件、办公、日常交流、学术等场景，另行填写补充要求；支持选择目标语言、复制译文、继续调整、停止和重试。草稿与最近 20 条结果仅保留在本次浏览器会话中。详见[AI 文本翻译使用说明](docs/INPUT_TRANSLATION.md)。

## 免费在线机器翻译

选中免费在线后默认「自动选择（推荐）」，也可展开「手动选择服务」指定服务；折叠不改变选择。设置页读取和编辑不发送翻译或测试请求，「检查连接」单独发送内置例句。Popup 的更改保留为草稿，点击唯一主按钮「应用并翻译」后先授权、保存本站句段覆盖，再翻译；失败不发起翻译，关闭时放弃草稿。「跟随默认设置」也须点击主按钮后生效。

自动服务为微软 → B站 → 谷歌 → 有道，近期成功线路优先；腾讯保持手选，火山不进入默认池。自动备用仅限免费在线内部，不转 AI、词典或 Chrome 本地。免费服务参数继续使用 v2；旧 mode 仅供兼容，新路由由翻译偏好唯一决定。

这些网页接口可能变化或限流；当前网络的真实扩展测试不代表国内直连和海外网络的双环境认证。

缓存继续使用统一 DB4 和首次查询的写入围栏；换线记录真实服务，不创建虚构 auto 缓存，
清缓存不会被在途结果重新填充。详见 [Provider 接口说明](docs/PROVIDERS.md)、
[设计与来源](docs/tasks/free-mt-auto-routing/design.md) 和 [本地验收](docs/tasks/free-mt-auto-routing/validation-report.md)。

## v0.8.1 基础翻译

- 选中 Chrome 本地时可处理单词、短语、句段和全文；模型仅由设置页或页面提示中的真实点击准备。未选择本地时不会自动创建或下载模型。
- 划词释义自动识别源语言，目标语言默认简体中文；短词识别不确定时可手动纠正。
- 语言包可由设置页 **常规 → Chrome 本地模型 → 准备并校验两个模型**统一准备，也可在页面、划词或字幕提示中点击准备；安装和页面载入不会自动下载。
- 切换保存的方式会取消受影响任务并释放旧实例，不删除 Chrome 的共享语言包。
- 基础安装包不再附带词典；可选词典管理位于高级设置，升级保留已安装词典的启用状态。

详见[浏览器基础翻译使用说明与限制](docs/BROWSER_TRANSLATION.md)。接口存在不代表模型可运行；真实离线能力需在本机完成语言包准备后验证。

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
- 翻译、字幕与 AI 解释分命名空间缓存；策略变化只改变业务 identity，不反复升级物理数据库
- 全局 + 网站自定义译法：支持覆盖、启停和大小写规则
- Technical / Academic / News / Natural 四种内置翻译模式
- Popup 展示当前站点 / 模式 / Provider / Model，并支持临时切换或保存到本站

## v0.8 体验更新

- **Calm UI**：Popup、Quick Control、Settings 与状态反馈统一使用柔和鼠尾草绿 / 暖米色设计系统。
- **Reading Appearance**：Standard / Compact / Reading / Minimal 四种双语阅读外观。
- **Quick Control**：低干扰页内翻译、任务状态、重试/取消、Preset、阅读外观、自动翻译与 Settings 入口。
- **Persistent cache restore**：可按站点自动恢复 IndexedDB 已有译文；cache miss 不触发 Provider。
- **Chrome Commands**：翻译/更新页面、显示/隐藏译文、切换 Quick Control。
- **YouTube subtitles**：MAIN-world player-owned timedtext 主路径，TextTrack 与 rendered DOM 作为 fallback；支持双语/原文/off、ASR、人类字幕、SPA 切换与缓存复用。
- **Settings IA**：General / Appearance / YouTube / Sites / Automatic behavior / Preferred translations + Advanced Provider / Cache / Developer。

## 本地词典、AI 与学习记录

安装包不附带词典。用户可主动下载精选词典或导入 TFLex、StarDict、MDX/MDD；支持预检、进度、取消、启停、首选、排序、更新和删除。富词典通过隔离视图与限定 HTML/CSS 显示 MDD 本地图片、音频及受支持的字体/SVG，不执行词典脚本或自动请求远程资源。没有安装词典属于正常空状态。

单词查询仅执行保存的方式；“理解 / 分析 / 用法”由用户明确激活，分别保存请求状态与完整结果。切换词典/AI 标签不会把本地查询伪装为 Provider 结果，停止、失败或旧选区回调不能覆盖当前内容。

学习中心区分 Reading 历史、生词本与最小复习：Reading 保存原文位置和已完成结果；生词本保存用户明确收藏的词典摘要或独立标注的 AI 学习笔记；复习通过“再学一次 / 已掌握”更新本地计划，尚不提供 SRS/FSRS 或云同步。历史恢复不重新查询词典或调用 Provider，Reading 与生词本删除互不级联。完整边界见 [学习中心](docs/LEARNING_CENTER_V1.md) 与 [Reading loop](docs/READING_LOOP_V1.md)。

已完成的 Oxford 10 定向验收不代表所有商业 MDX/MDD、编码或 MDict 版本全面兼容，具体证据见 [MDict compatibility](docs/MDICT_REAL_WORLD_COMPATIBILITY.md)。

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

关键原则：**API 请求和缓存查询必须使用同一份有效配置**。站点覆盖和自定义译法先在共享配置层解析，Provider adapter 不读取 glossary 存储。

词典/划词能力遵循另一条硬边界：**Source-driven data → Rule-driven retrieval → Context-driven ranking → User-driven AI**。TranslateFlow 负责查询、排序、来源追踪和展示，不把持续人工维护单词释义当作 coverage 方案。测试/benchmark 词条属于验证资产，不应为了通过测试进入运行时词典；大型辞典通过可下载/本地导入机制提供，而不是塞进基础扩展包。

详细设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、[docs/LEXICAL_DATA_BOUNDARIES.md](docs/LEXICAL_DATA_BOUNDARIES.md) 和 [docs/PROVIDERS.md](docs/PROVIDERS.md)。

## 技术栈

生产扩展由 WXT 编译，按 allowlist 审核安装包；Content、后台和 Worker 保持原生 JavaScript 业务模块：

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

默认构建由 WXT 编译后台、Content、Popup 和 Options，MAIN/Worker 保留精确资源映射；`npm run build:extension` 将审核过的 WXT 包输出到稳定安装目录 `dist/extension/`。安装包不包含词典内容；`tests/`、`e2e/`、`scripts/`、`docs/`、原始词典来源和 source-lock 等开发/验证资产不会进入生产扩展。

源码安装不需要词典包或 AI Key，执行：

```bash
npm ci
npm run validate
npm run build:extension:release
```

所有正式构建均不附带词典。需要离线查词时，在 **高级设置 → 词典库** 主动下载精选词典，或导入 TFLex、StarDict、MDX/MDD。没有安装词典是正常空状态，不会自动下载、调用 AI 或要求重装扩展。通用查询引擎与词典内容来源相互独立；升级保留已安装词典、排序偏好及缓存。

真实 Chromium 扩展 E2E：

```bash
npm install
npx playwright install chromium
npm run build:extension:wxt
npm run test:e2e
```

E2E 使用临时 unpacked 扩展副本、本地 fixture 页面和本地 OpenAI-compatible mock server，不需要真实 API Key。生产 `manifest.json` 不会因为测试而扩大 Host Permission；测试副本运行时才临时加入 localhost 权限。

## 新用户安装与首次配置

先在仓库目录构建可安装的扩展：

```bash
npm ci
npm run build:extension
```

构建完成后按以下步骤安装和配置：

1. 打开 `chrome://extensions/`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择仓库内的 `dist/extension/`；不要选择仓库根目录
5. 打开 TranslateFlow 设置，在「通用」中分别选择「单词查词方式」和「句段与全文翻译方式」，点击「保存翻译偏好」
6. 单词首次默认为免费在线；句段首次按已配置 AI、已就绪 Chrome 本地、免费在线确定。资源准备不会改变已保存的选择；目标语言默认简体中文
7. 使用免费在线前，明确勾选允许发送待翻译文本并保存，在浏览器提示中授予所选服务权限。未同意时不上传；划词错误中的「前往设置」可返回此处。取消勾选并保存可撤回全局同意
8. 打开一个 HTTPS 网页并刷新，然后划选单词查词或划选句段翻译。Popup 仅修改本站句段／全文方式，主按钮先授权、保存，再翻译；单词方式在全局设置中修改

设置页按栏目展示内容，切换栏目保留尚未保存的修改。「保存翻译偏好」专门保存两类方式和在线参数；其他通用配置使用底部「保存全局设置」。界面语言即时保存，连接、站点、术语与词典使用各自的保存或安装入口。

Chrome 本地翻译不需要 API Key，选择该方式后按提示准备支持的语言对。词典是可选资源：在「高级 → 词典库」导入并启用后，将单词方式选为「词典」并保存，查词才会使用它。选择在线、本地或 AI 时不会先查词典，也不会在失败时自动改用另一方式。AI 译文及「AI · 理解／分析／用法」需要配置 AI 连接，由明确操作触发。

全局联网同意适用于单词和跟随默认的网站。已单独确认的网站可在 Popup 取消勾选并点击「保存撤回本站联网同意」；此操作不翻译，也不修改全局单词选择。

学习中心的 Reading 区可导出和恢复阅读历史，生词本区可导出和恢复生词、AI 笔记、来源及复习状态。文件只在本机处理，不包含连接密钥或授权，仍可能包含私人文本，请自行妥善保管。导入保留已有 ID／生词语种身份对应的条目并报告跳过数；损坏、版本不兼容或超过现有容量时整次拒绝。备份不代替清理或云同步。新版 Reading 导出 v2 补充来源网站；旧 v1 中有安全返回地址的记录仍可恢复，缺少地址的旧备份无法还原来源，请保留文件并尽量在原安装重新导出。

更新本地安装时，重新执行 `npm run build:extension`，再到 `chrome://extensions/` 点击 TranslateFlow 卡片上的“重新加载”，最后刷新正在验收的网页。扩展设置、词典、收藏和阅读记录保存在 Chrome 配置中，重新构建不会主动删除这些数据。

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

词典缺失、损坏或未命中不会阻断翻译；不使用词典时可在高级设置中关闭。个人导入词典、收藏和阅读记录保持独立保存。

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

## 自定义译法

可以告诉 TranslateFlow 遇到某个词或短语时优先翻成什么。网页和字幕翻译、划词查词都会使用这里的译法，但不会修改已安装的本地词典。例如：

```text
repository   -> 仓库
pull request -> 拉取请求
middleware   -> 中间件
```

每条自定义译法包含：

- 原文词语与希望译成的内容；
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

运行时会先规范化自定义译法。相同 scope 下重复的有效 source key 只保留一个，最新保存值生效；匹配网站的译法会扩展并覆盖同 key 的全局译法。网站译法只影响对应规范化 Origin。

自定义译法在共享配置层被组合进最终 Prompt，DeepSeek/OpenAI-compatible Provider 本身不感知 glossary 数据结构。

## 缓存

缓存入口仍由 `src/background/cache-db.js` 提供稳定 API，底层采用独立缓存模块。`ai_bilingual_translator` 的物理布局为 DB4，使用通用 `entries` / `epochs`；记录 envelope 与各业务策略版本独立演进。

页面翻译、字幕和 AI 解释使用隔离的命名空间。译文 identity 包含实际原文、有效连接与 endpoint/model、语言、最终 Prompt、模型参数、格式和策略版本；Provider 调用与读写缓存共享同一份有效配置。密钥明文不进入缓存 identity。显式清除会使在途旧结果的写入 token 失效，避免结果返回后重新写回。

升级会一次性丢弃旧普通译文与页面索引，不读取旧译文格式、回退旧 key 或双写；独立解释缓存按原值保留，Reading、词典、设置与凭据不受影响。只支持旧 DB2/3 的旧程序不能直接降级打开 DB4。完整合同见 [独立缓存模块](docs/CACHE_SYSTEM.md)。

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

在普通 http/https 网页中无需先打开 Popup；选择 2–2000 字符的文本后会出现轻量“译”按钮。点击后按文本形态和用户设置查询本地词典、浏览器基础释义或翻译；AI 操作使用当前站点的 Effective Translation Config。

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

修改全局 Provider、OpenAI-compatible 配置、当前站点 Profile 或有效自定义译法时，自动模式会清理当前页面译文并按新配置重新处理。Popup 的临时 Preset 会立即重新翻译当前页面，之后新增内容继续使用该 session 模式。

## 学习中心

从 Popup 的“学习中心”或划词结果卡进入独立页面，可找回最近记录、按页面浏览、搜索、阅读历史快照，以及暂停/恢复记录、管理排除站点、删除和导出 JSON。首次开启后只记录之后的查询；原网页仍有效的结果卡可显式“保存本次结果”。历史阅读无需重新查词或调用 Provider。完整操作与数据边界见 [Learning center v1](docs/LEARNING_CENTER_V1.md)。

站点历史高亮默认开启。重新访问页面时，仍能精确匹配的原文会显示轻量高亮；同一位置的重复记录只显示一次。鼠标悬停在高亮单词上，会在隔离预览中显示保存时的语境、词典释义、翻译，以及当前页同一词项已保存且完成的“AI 详解 / 分析 / 用法 / 继续追问”问答；读取历史不会重新调用 Provider。若没有完成并保存过 AI 操作，预览会明确说明。页面不再显示额外的数字 badge 或“本页历史”面板；完整管理、删除与无法重新定位的记录仍在学习中心处理，删除后对应高亮会立即消失。

## 开发约束

`npm run check` 自动执行：

- `src/shared/` 禁止依赖 `chrome.*`
- 外部 `fetch()` 只能位于 `src/background/providers/`
- 通用缓存 IndexedDB 仅由 `src/background/cache/storage-indexeddb.js` 访问，`cache-db.js` 保持稳定外观；ReadingRecord 仅由 `src/background/reading-record/idb.js` 直接访问
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
- ChatGPT 订阅需要单独安装 Native Messaging Host；未授权或未安装不影响 API Key 与本地词典，Windows 实机、签名与公开分发仍需独立验收。
- PDF、Side Panel、非 YouTube 视频站点的双语字幕尚未实现；v0.8 视频体验首发支持 YouTube。
- Chrome 内部页面、Chrome Web Store 等受保护页面无法注入。
- API Key 保存于仅 trusted extension context 可访问的 `chrome.storage.local`，适合个人 BYOK，不是操作系统密钥保险库。

## 开发任务与本地验收

任务和执行状态见 [docs/tasks/index.json](docs/tasks/index.json)，完整流程见 [docs/tasks/LOCAL_WORKFLOW.md](docs/tasks/LOCAL_WORKFLOW.md)。日常在本地完成验收与主 Agent 自查；GitHub 仅用于代码同步。Actions 只接受手动触发，原始执行日志/截图保持本地并忽略。
