# AI Bilingual Translator v0.3

轻量 Chrome Manifest V3 双语网页翻译扩展：保留英文原文，插入简体中文译文，使用自己的 DeepSeek API Key，并将翻译结果按网页 URL 与正文内容缓存在扩展 IndexedDB 中。

## 技术栈与开发前提

本项目目前刻意保持为 **零构建、零第三方运行时依赖** 的 Chrome Extension：

- Chrome Manifest V3
- 原生 JavaScript（ES Modules）
- 原生 HTML / CSS
- `chrome.storage.local`
- IndexedDB
- DeepSeek Chat Completions API

因此当前版本：

- **不需要 `npm install`**
- **不需要 `npm run build`**
- **不需要启动本地 Web Server**
- Chrome 直接加载仓库中包含 `manifest.json` 的目录即可开发和运行

建议开发环境：

- Chrome 96+（`manifest.json` 当前最低版本为 96）
- 推荐使用较新的稳定版 Chrome
- Git
- Node.js 18+：**可选**，仅用于本地 JavaScript / Manifest 静态检查，不参与扩展运行

## 仓库结构

```text
ai-bilingual-translator/
├── manifest.json       # Chrome Manifest V3 配置
├── background.js       # Extension Service Worker；API、缓存、站点权限与自动注入
├── cache-db.js         # IndexedDB 缓存实现
├── content.js          # 页面扫描、双语展示、滚动/动态内容增量处理
├── content.css         # 页面译文样式
├── popup.html          # 浏览器工具栏弹窗
├── popup.js
├── popup.css
├── options.html        # 设置页面
├── options.js
├── options.css
└── README.md
```

主要数据流：

```text
Web Page
   │
   ▼
content.js
   │  提取正文 / 计算待翻译段落
   ▼
background.js
   │
   ├── cache-db.js → IndexedDB 命中 → 返回译文
   │
   └── 未命中 → DeepSeek API → 写入 IndexedDB → 返回译文
```

## 获取代码

如果代码已经在本地，直接进入项目根目录即可。

从 Git 仓库开发时：

```bash
git clone <YOUR_REPOSITORY_URL>
cd ai-bilingual-translator
```

> `<YOUR_REPOSITORY_URL>` 替换成实际仓库地址。

### 安装依赖

当前版本没有 `package.json`，也没有 npm/pnpm/yarn 依赖，所以 **无需安装依赖**：

```bash
# 不需要执行 npm install
# 不需要执行 pnpm install
# 不需要执行 yarn
```

如果以后引入 TypeScript、Vite、React 或其他构建工具，再补充对应的依赖安装和 build 脚本；当前不要为了运行 v0.3 额外安装这些工具。

## 本地开发安装

Chrome 扩展本地开发不是执行 `npm start`，而是通过 Chrome 的“加载已解压的扩展程序”运行源码。

### 第一次安装

1. 打开 Chrome。
2. 地址栏访问：

```text
chrome://extensions/
```

3. 打开右上角 **开发者模式**。
4. 点击 **加载已解压的扩展程序**。
5. 选择项目根目录，即包含 `manifest.json` 的目录：

```text
ai-bilingual-translator/
```

不要选择 ZIP 文件，也不要选择它的上一级目录。

6. 安装成功后建议将扩展固定到 Chrome 工具栏。
7. 点击扩展图标 → 进入设置页 → 填入 DeepSeek API Key。
8. 可先执行“测试 API”，确认配置正常。

### 本地开发“启动”

项目没有常驻开发服务器。完成上述“加载已解压”后，扩展已经处于运行状态。

开发循环为：

```text
修改源码
  ↓
保存文件
  ↓
chrome://extensions/
  ↓
点击该扩展的“重新加载”按钮
  ↓
刷新正在测试的网页
  ↓
重新测试
```

注意：

- 修改 `background.js` / `cache-db.js` / `manifest.json` 后，必须重新加载扩展。
- 修改 `content.js` / `content.css` 后，重新加载扩展后还需要刷新目标网页，因为已经注入页面的旧 Content Script 不会自动替换。
- 修改 `popup.*` / `options.*` 后，重新加载扩展并重新打开对应页面即可。
- 如果某个自动翻译站点在开发过程中仍表现为旧逻辑，可在设置中关闭该站自动翻译，再重新开启一次，然后刷新页面。

## 配置 DeepSeek

扩展设置页中配置：

```text
API Key:        你的 DeepSeek Key
Model:          deepseek-flash（默认，可修改）
Target Language: Simplified Chinese
Prompt:         可自定义
```

API Key 与其他设置保存于：

```text
chrome.storage.local
```

翻译正文缓存保存于扩展自身 Origin 的 IndexedDB，不保存在目标网站自己的 IndexedDB 中。

## 手动模式测试

打开任意英文文章或文档页面，然后：

1. 点击扩展图标。
2. 点击 **翻译 / 更新当前页面**。
3. 首次翻译时，未命中的段落会调用 DeepSeek。
4. 刷新或重新打开同一页面。
5. 点击 **仅恢复本页缓存（0 API）**。
6. 已缓存内容应直接恢复，不再请求模型。

建议开发阶段首先用结构简单的英文页面验证，例如技术博客、GitHub README、文档站文章页。

## 自动增量翻译测试

1. 打开目标英文网站。
2. 点击扩展图标。
3. 点击 **开启此站自动增量翻译**。
4. Chrome 只会请求当前站点访问权限。
5. 刷新页面。
6. 页面视口附近内容会自动恢复缓存或翻译。
7. 向下滚动，后续内容会按需处理。
8. 页面动态新增内容会由 `MutationObserver` 加入处理队列。

关闭该站自动翻译后，会注销对应动态 Content Script 并尝试撤销该站点权限；IndexedDB 中已经生成的翻译缓存不会因此删除。

## 开发调试

### 1. 调试 Service Worker

打开：

```text
chrome://extensions/
```

找到 AI Bilingual Translator，在扩展卡片中进入详情并点击 Service Worker 的 **检查 / Inspect**。

这里主要调试：

- `background.js`
- `cache-db.js`
- DeepSeek API 请求
- IndexedDB
- `chrome.storage.local`
- 自动站点注册与权限逻辑

可在 Console 中查看当前设置：

```javascript
chrome.storage.local.get().then(console.log)
```

### 2. 调试 Content Script

在目标网页按 F12 打开 DevTools：

- Console：查看 `content.js` 运行错误
- Elements：检查插入的翻译 DOM
- Sources → Content scripts：查看扩展注入脚本

因为翻译 IndexedDB 属于 **扩展 Origin**，不要在普通网页自己的 Application → IndexedDB 中查找它；应从扩展 Service Worker 的 DevTools 中检查。

### 3. 调试 Popup

打开扩展 Popup 后，可以右键 Popup → **检查**，查看：

- `popup.js`
- Popup DOM / CSS
- Popup 与 background message 通信

### 4. 调试 Options

打开扩展设置页后直接使用该页面 DevTools，即可调试：

- `options.js`
- 配置保存
- API 测试
- 缓存统计
- 自动站点管理

## 静态检查

当前没有编译器，因此提交代码前建议至少做 JavaScript 语法检查和 Manifest JSON 检查。

如果本机安装了 Node.js 18+：

### macOS / Linux

```bash
node --check background.js
node --check cache-db.js
node --check content.js
node --check popup.js
node --check options.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest.json OK')"
```

也可以一次执行：

```bash
for f in background.js cache-db.js content.js popup.js options.js; do node --check "$f" || exit 1; done
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest.json OK')"
```

### Windows PowerShell

```powershell
node --check background.js
node --check cache-db.js
node --check content.js
node --check popup.js
node --check options.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest.json OK')"
```

Node.js 只用于这些静态检查；Chrome 运行扩展并不依赖 Node.js。

## 编译 / Build

### 当前版本

**没有编译步骤。**

源码就是 Chrome 实际运行的代码：

```text
*.js + *.html + *.css + manifest.json
        ↓
Chrome 直接加载
```

因此本地验证通过后，不需要执行：

```text
npm run build
```

也不存在 `dist/` 目录。

如果未来引入 TypeScript / bundler，建议统一输出到 `dist/`，届时本地 Chrome 应加载 `dist/` 而不是源码目录；当前 v0.3 不适用该流程。

## 发布前打包

开发时始终推荐 Chrome 直接加载源码目录；ZIP 主要用于分发、备份或发布制品。

假设当前目录的上一级包含：

```text
ai-bilingual-translator/
```

### macOS / Linux

```bash
zip -r ai-bilingual-translator-v0.3.zip ai-bilingual-translator \
  -x "*/.git/*" \
  -x "*/.DS_Store" \
  -x "*/node_modules/*"
```

检查 ZIP：

```bash
unzip -l ai-bilingual-translator-v0.3.zip
```

### Windows PowerShell

```powershell
Compress-Archive \
  -Path .\ai-bilingual-translator\* \
  -DestinationPath .\ai-bilingual-translator-v0.3.zip \
  -Force
```

注意：用于 Chrome “加载已解压的扩展程序”时，仍然需要先解压 ZIP，然后选择包含 `manifest.json` 的目录。

## 升级本地开发版本

如果你之前已经以“加载已解压”的方式安装旧版本，推荐保持同一个项目目录：

```text
原目录更新代码 / git pull
        ↓
chrome://extensions/
        ↓
重新加载
        ↓
刷新测试网页
```

这种方式通常可以继续保留当前开发扩展实例的：

- API Key
- 模型 / Prompt 设置
- IndexedDB 翻译缓存
- 已授权自动翻译站点

如果删除旧扩展后，再从另一个目录重新“加载已解压”，Chrome 可能创建新的开发扩展 ID；此时扩展 Origin、`chrome.storage.local` 和 IndexedDB 都可能被视为新的实例，因此不适合作为日常升级方式。

## v0.3 重点

- **按站点开启自动增量翻译**：只对用户主动授权的站点持久运行，不申请全局常驻网页读取权限
- 自动模式进入页面后：**先查 IndexedDB，命中立即显示，缺失内容才调用 DeepSeek**
- **IntersectionObserver 近视口处理**：长文章/无限滚动页面不会一打开就把全部内容送去 API
- **MutationObserver 动态补译**：SPA、无限滚动、新增评论/正文等内容出现后自动加入翻译队列
- SPA URL 变化会重新计算页面身份并切换缓存上下文
- `#/route`、`#!/route` 类型 Hash Router 会保留在页面缓存身份中；普通 `#section` 锚点不会造成重复缓存
- 同一页面的相同原文会合并，只请求一次模型，再复用到多个 DOM 元素
- API 异常自动退避，避免网络错误、限流或 Key 未配置时形成请求风暴
- 模型 / Prompt / 目标语言变化时，自动模式会清掉页面旧译文并重新按新缓存版本处理
- 修复 v0.2：原文仅因换行/空格变化时，SHA-256 相同但二次复核误判为缓存 miss 的问题
- 设置页可以查看并移除已授权的自动翻译站点

## 缓存策略

缓存主存储为扩展自身 Origin 下的 IndexedDB：

- 页面身份：规范化 URL
- 翻译版本：模型 + Prompt + 目标语言配置指纹
- 段落身份：归一化原文 SHA-256

因此再次访问相同内容时可以 0 API 恢复；网页只修改一部分时，仅新增或变化段落会重新翻译。

URL 规范化规则：

- 移除 `utm_*`、`fbclid`、`gclid` 等常见跟踪参数
- 保留正常业务 Query 参数
- Query 参数排序，减少参数顺序造成的重复缓存
- 普通页面锚点 `#section` 忽略
- SPA 路由 `#/...`、`#!/...` 保留

## 存储结构

### `chrome.storage.local`

保存少量配置：

- API Key
- 模型
- Prompt
- 目标语言
- 缓存软上限
- 自动翻译站点列表

### IndexedDB `ai_bilingual_translator`

`pages`

- `pageKey`
- `url`
- `title`
- `createdAt`
- `lastAccessedAt`

`translations`

- `cacheKey`
- `pageKey`
- `pageConfigKey`
- `configHash`
- `sourceHash`
- `sourceText`
- `translation`
- `bytes`
- `createdAt`
- `lastAccessedAt`

默认缓存软上限 200 MB，按 LRU 清理。

## 权限设计

必需权限：

- `storage`
- `activeTab`
- `scripting`
- `https://api.deepseek.com/*`

可选站点权限：

- `http://*/*`
- `https://*/*`

后两项只是声明“允许在用户确认后申请的最大范围”，安装时不会自动获得所有网站权限。只有用户点击“开启此站自动增量翻译”时，才请求当前站点权限并注册对应动态 Content Script。

## 常见问题

### 为什么没有 `npm install` / `npm start`？

因为当前代码没有构建层。Chrome 可以直接执行仓库里的原生 JavaScript、HTML 和 CSS。对目前这个体量，引入 bundler 只会增加开发复杂度，并不会提升扩展能力。

### 修改代码后为什么页面还是旧效果？

通常需要两个动作：

```text
chrome://extensions/ → 重新加载扩展
目标网页 → 刷新
```

已经注入页面的 Content Script 不会因为磁盘上的 `content.js` 改变而自动热更新。

### 为什么 `chrome://` 页面不能翻译？

Chrome 内部页面、Chrome Web Store 等受保护页面禁止普通扩展注入，这是浏览器安全限制。

### 为什么自动翻译需要额外授权？

手动模式使用 `activeTab`，只有用户主动点击扩展时临时访问当前页面。自动模式必须在以后再次进入站点时自行运行，因此需要用户对该站点授予持久 Host Permission。

### 修改 Prompt / Model 后旧缓存会不会误用？

不会。缓存版本包含模型、Prompt 与目标语言配置指纹。配置发生变化后会使用新的缓存版本；旧版本仍可保留，直到被手动删除或 LRU 清理。

### 如何完全清除本地翻译缓存？

在扩展设置页使用“清空全部缓存”。API Key / Prompt 等设置位于 `chrome.storage.local`，翻译正文位于 IndexedDB，两者是分开的。

## 当前限制

- 主要针对网页正文、文章、文档、Feed；复杂 Web App UI 不保证所有文本都适合自动翻译。
- PDF、视频双语字幕、划词翻译尚未实现。
- 自动模式当前按同一 scheme + hostname 授权；Chrome Match Pattern 不按端口做精细隔离，因此 localhost 等多端口场景会共享该主机授权范围。
- Chrome 内部页面、Chrome Web Store 等受保护页面无法注入。
- API Key 位于 `chrome.storage.local`，适合个人 BYOK，但不是服务端密钥保险库。
