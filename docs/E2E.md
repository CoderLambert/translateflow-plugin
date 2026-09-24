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

## 当前 v0.8 smoke flows

Playwright suite 现在覆盖：

1. 正文手动翻译、富文本安全语义、cache-only 恢复与 Provider 调用次数。
2. 自动增量翻译、Appearance 切换、Site Profile / Preset / Glossary。
3. 划词翻译、错误反馈、Retry、取消与 Quick Control 共存。
4. Quick Control Shadow isolation、任务状态、Preset/Appearance、Escape/click-outside 与暗色可读性。
5. Popup 针对当前活动网页的翻译、译文显隐、移除与 cache-only 恢复。
6. Chrome Commands 首次注入、翻译、译文显隐、Quick Control toggle 与受保护页拒绝。
7. Settings 分类导航、键盘焦点与 YouTube 默认设置 save → reload。
8. SubtitleSource 的 TextTrack/YouTube DOM fallback、SPA 切换与 teardown。
9. 字幕稳定化、批处理、缓存 identity 与 Provider 调用次数。
10. YouTube controller → pipeline → renderer 双语显示、Preset/大小、cache reuse、失败 fallback 与 stale video rejection。

真实 YouTube 的 live DOM、theater/fullscreen 和账号/地区差异不作为稳定 CI 依赖；这些项目记录在 `docs/RELEASE_V0.8.md` 的人工 smoke checklist。

## CI

`.github/workflows/e2e.yml` 与快速的 `quality` workflow 分离。E2E workflow：

1. `npm install`
2. `npx playwright install --with-deps chromium`
3. `npm run test:e2e`
4. 失败时上传 Playwright report / trace artifacts

生产运行时不依赖 Playwright。
