# TranslateFlow v0.4

轻量、BYOK、缓存优先的 Chrome Manifest V3 双语网页翻译扩展。保留英文原文，在原段落中展示中文译文；使用自己的 DeepSeek API Key，并按“规范化 URL + 翻译配置 + 原文指纹”将结果缓存在扩展 IndexedDB 中。

v0.4 是一次**架构版本**：用户行为和已有缓存保持兼容，代码拆分为明确模块，并加入可执行的项目规范、单元测试和 GitHub Actions。

## 功能

- 英文原文 + 简体中文双语展示
- DeepSeek BYOK
- URL 感知的 IndexedDB 段落缓存
- 再次访问可 0 API 恢复缓存
- 页面局部变化只补译变化段落
- 按站点授权的自动增量翻译
- IntersectionObserver 近视口处理
- MutationObserver 动态内容补译
- SPA / Hash Router 页面身份处理
- LRU 缓存清理
- 模型 / Prompt / 目标语言变化自动切换缓存版本

## 技术栈

运行时保持零第三方依赖、零打包：

- Chrome Manifest V3
- 原生 JavaScript
- 原生 HTML / CSS
- chrome.storage.local
- IndexedDB
- DeepSeek Chat Completions API

开发质量工具也不依赖第三方 npm 包，Node.js 只用于执行内置语法检查和 `node:test`。

## 仓库结构

```text
translateflow-plugin/
├── manifest.json
├── background.js                 # Service Worker 薄入口
├── content.js                    # Content Script 薄入口
├── popup.html / popup.js / popup.css
├── options.html / options.js / options.css
├── content.css
│
├── src/
│   ├── shared/
│   │   ├── constants.js          # 默认配置、消息协议、脚本清单
│   │   ├── hash.js
│   │   ├── text.js
│   │   └── url.js
│   │
│   ├── background/
│   │   ├── index.js              # Service Worker 生命周期
│   │   ├── router.js             # Runtime message 路由
│   │   ├── config.js
│   │   ├── cache-db.js           # IndexedDB 唯一访问层
│   │   ├── auto-sites.js         # 站点权限 / 动态 Content Script
│   │   └── providers/
│   │       ├── index.js          # Provider registry
│   │       └── deepseek.js
│   │
│   └── content/
│       ├── runtime.js            # Content 环境状态 / 页面身份 / 消息
│       ├── dom.js                # DOM 扫描、文本提取、译文渲染
│       ├── batch.js              # 去重、分组、批处理
│       ├── processor.js          # cache-first 翻译流程
│       └── auto.js               # 自动增量队列 / Observer / backoff
│
├── tests/
├── scripts/check.mjs
├── docs/ARCHITECTURE.md
├── CONTRIBUTING.md
└── .github/workflows/quality.yml
```

详细架构边界见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，开发约束见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 获取代码

```bash
git clone https://github.com/CoderLambert/translateflow-plugin.git
cd translateflow-plugin
```

当前没有第三方 npm 依赖，因此运行扩展**不需要** `npm install`、`npm run build` 或本地 Web Server。

如果本机有 Node.js 18+，建议开发前执行：

```bash
npm run validate
```

它会执行：

```text
JavaScript 语法检查
        +
Manifest 检查
        +
架构边界检查
        +
node:test 单元测试
```

## Chrome 本地安装

1. 打开 `chrome://extensions/`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择仓库根目录（包含 `manifest.json`）
5. 固定 TranslateFlow 到工具栏
6. 打开设置页，填入 DeepSeek API Key
7. 点击“测试 API”
8. 在普通 http/https 英文网页上测试翻译

Chrome 加载的是源码目录，不是 ZIP。

## 本地开发循环

```text
修改代码
  ↓
npm run validate
  ↓
chrome://extensions/
  ↓
重新加载 TranslateFlow
  ↓
刷新目标网页
  ↓
验证功能
```

注意：

- 修改 Service Worker / Manifest / shared / background：重新加载扩展。
- 修改 Content Script：重新加载扩展后还要刷新目标网页。
- 修改 Popup / Options：重新加载后重新打开对应页面。
- 已开启自动翻译的站点如果仍运行旧脚本，可关闭该站自动翻译，再重新开启一次。

## 开发约束

`npm run check` 会自动执行关键架构规则：

- `src/shared/` 不允许依赖 `chrome.*`
- 外部 `fetch()` 只能位于 `src/background/providers/`
- IndexedDB 只能由 `src/background/cache-db.js` 访问
- 动态 `registerContentScripts()` 只能由 `src/background/auto-sites.js` 调用
- build-free Content Script 模块禁止使用 ESM import/export
- 单个 `src/` JS 文件超过 420 行会失败
- `background.js` / `content.js` 必须保持薄入口
- 根目录旧 `cache-db.js` 不允许重新出现

PR 和 push 到 main 时 GitHub Actions 会执行相同的 `npm run validate`。

## 模块设计

### Background

```text
background.js
    ↓
src/background/index.js
    ↓
router.js
 ├─ config.js
 ├─ cache-db.js
 ├─ auto-sites.js
 └─ providers/
```

Provider 层已经抽象。以后增加 OpenAI-compatible / OpenRouter / Ollama 等 Provider 时，不需要修改缓存层或 DOM 层。

### Content Script

为了保持“零 build”，Content Script 不使用 ESM，而是按固定顺序加载多个经典脚本，并挂在扩展隔离世界内的私有命名空间：

```text
runtime
  ↓
dom
  ↓
batch
  ↓
processor
  ↓
auto
  ↓
content.js bootstrap
```

加载顺序只定义在 `CONTENT_SCRIPT_FILES`，手动注入与自动站点注册共用同一清单。

## 缓存兼容

v0.4 **不修改**：

- IndexedDB 名称：`ai_bilingual_translator`
- DB version：`1`
- object stores：`pages` / `translations`
- cache schema：`2`
- 既有 DeepSeek 配置的 cache-key 语义

因此从 v0.3 升级后，已有翻译缓存继续可用。

缓存身份：

```text
page = normalized URL

config =
provider
+ model
+ target language
+ prompt
+ cache schema

segment =
SHA-256(normalized source text)
```

URL 规范化：

- 删除 `utm_*`、`fbclid`、`gclid` 等跟踪参数
- 保留业务 Query
- Query 参数排序
- 普通 `#section` 忽略
- `#/route` / `#!/route` 保留

## 权限

必需：

- `storage`
- `activeTab`
- `scripting`
- `https://api.deepseek.com/*`

可选：

- `http://*/*`
- `https://*/*`

可选 Host Permission 只用于用户主动开启的站点自动翻译，不代表安装时获得全站读取权限。

## 调试

### Service Worker

`chrome://extensions/` → TranslateFlow → Service Worker → Inspect

主要看：

- Provider 请求
- IndexedDB
- Runtime messages
- 自动站点注册
- chrome.storage.local

### Content Script

目标网页 DevTools：

- Console
- Elements
- Sources → Content scripts

### Popup / Options

右键对应扩展页面 → Inspect。

## 发布打包

当前无 build 步骤，源码即运行产物。

macOS / Linux：

```bash
zip -r translateflow-plugin-v0.4.zip translateflow-plugin \
  -x "*/.git/*" \
  -x "*/.DS_Store" \
  -x "*/node_modules/*"
```

Chrome 本地安装仍需要解压后加载目录。

## 贡献

提交前：

```bash
npm run validate
```

涉及以下变化时不要当作普通重构：

- IndexedDB schema / version
- cache-key 语义
- Runtime message value
- required / optional permissions
- 自动站点注册 ID

详细规则见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 当前限制

- 主要面向正文、文章、文档和 Feed；复杂 Web App UI 不保证所有文本都适合自动翻译。
- PDF、视频双语字幕、划词翻译尚未实现。
- 自动授权按 scheme + hostname 管理，localhost 多端口场景会共享主机授权范围。
- Chrome 内部页面、Chrome Web Store 等受保护页面无法注入。
- API Key 保存在 `chrome.storage.local`，适合个人 BYOK，不是服务端密钥保险库。
