# TranslateFlow Browser E2E

TranslateFlow 的浏览器 E2E 使用 Playwright 驱动真实 Chromium，并以 unpacked Manifest V3 扩展运行。

## 目标

覆盖纯单元测试无法验证的边界：

- MV3 service worker 消息路由；
- `chrome.scripting` 注入；
- Content Script 隔离世界和 DOM 渲染；
- IndexedDB 缓存；
- MutationObserver / IntersectionObserver 自动增量翻译；
- selection popover；
- Host Permission + OpenAI-compatible Provider 路径；
- Site Profile / Glossary / Preset 的最终有效配置。

## 本地运行

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

Linux 首次安装浏览器系统依赖时可使用：

```bash
npx playwright install --with-deps chromium
```

## 测试架构

```text
Playwright test worker
   |
   +-- local HTTP server
   |     +-- deterministic fixture pages
   |     +-- /v1/chat/completions mock Provider
   |
   +-- temporary extension copy
   |     +-- production source files
   |     +-- test-only localhost host_permission
   |     +-- e2e-driver.html
   |
   +-- Chromium persistent context
         +-- MV3 service worker
         +-- fixture tab
         +-- extension driver page
```

测试 driver page 运行在 `chrome-extension://` origin 下，用真实 `chrome.tabs`、`chrome.scripting`、`chrome.storage` 和 `chrome.runtime` API 驱动扩展。核心 runtime 测试不依赖 Popup 是否处于当前活动标签页。

## Mock Provider

mock server 解析真实 Chat Completions request：

- 记录 system prompt；
- 记录发送的 segments；
- 返回符合 TranslateFlow parser 预期的 JSON；
- 保留 structured markers；
- 可按序模拟 401 / 429 / 500；
- 根据 Technical / Academic / News / Natural prompt 生成确定性前缀；
- 检测 glossary 并应用 `repository -> 仓库` fixture 映射。

因此缓存测试可以直接断言 Provider 调用次数，而不是根据 UI 时间推断是否命中缓存。

## 当前 smoke flows

1. 手动正文翻译 + 双语 DOM。
2. 富文本 link/code 安全语义保留。
3. 清除 DOM 后 IndexedDB cache-only 恢复，Provider 不二次调用。
4. 自动增量翻译只发送新增段落。
5. Site Profile 有效 Provider/Model/Target/Preset。
6. 划词翻译与第二次缓存命中。
7. 401 可见错误 + Retry；429/500 自动重试恢复。
8. Glossary + Preset 行为与缓存版本回切。

## CI

`.github/workflows/e2e.yml` 与快速的 `quality` workflow 分离。E2E workflow：

1. `npm install`
2. `npx playwright install --with-deps chromium`
3. `npm run test:e2e`
4. 失败时上传 Playwright report / trace artifacts

生产运行时不依赖 Playwright。
