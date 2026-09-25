# TranslateFlow Browser E2E

TranslateFlow 的浏览器 E2E 使用 Playwright 驱动真实 Chromium，并以 unpacked Manifest V3 扩展运行。

## 目标

覆盖纯单元测试无法验证的边界：

- MV3 service worker 消息路由；
- `chrome.scripting` 注入；
- YouTube MAIN-world bridge installation, player-owned timedtext observation and isolated-world cue delivery；
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

Playwright suite covers:

1. Manual/automatic/selection translation, structured inline safety and Provider call-count cache assertions.
2. Persistent cache restore, cache-miss Provider isolation and Quick-Control-only non-restore behavior.
3. Reading Appearance, Site Profile / Preset / Glossary and translation task retry/cancel.
4. Popup active-page translate/show-hide/remove/cache restore and the redesigned 360px layout.
5. Quick Control Shadow isolation, task state, Escape/click-outside, dark mode and reduced motion.
6. Chrome Commands first-use injection, translate, visibility, Quick Control toggle and protected-page rejection.
7. Settings navigation, responsive layout, focus behavior and save/reload persistence.
8. YouTube MAIN-world bridge installation, player-owned timedtext observation, human/ASR metadata, cue timing, track changes and A→B stale-response rejection.
9. YouTube TextTrack/DOM fallback ordering, native-caption restoration and reinjection idempotence.
10. Subtitle stabilization/batching/cache, bilingual renderer, preset/size, Provider failure fallback and stale Provider-result rejection.

Real public YouTube and OS/browser chrome are not stable CI dependencies; live evidence is tracked separately in `docs/RELEASE_V0.8.md`.

## Test isolation requirements

The Playwright extension fixture uses a worker-scoped persistent Chromium profile, so tests must reset both extension storage and IndexedDB-backed translation cache between cases.

`harness.reset()` therefore clears cache through the public `CACHE_CLEAR_ALL` background route before restoring baseline `chrome.storage.local` values. Clearing storage alone is insufficient because IndexedDB survives and can create order-dependent cache hits.

Multiple test pages may also remain open at the same URL. URL-only tab lookup is ambiguous, so `harness.open()` stamps each page with a unique test token and `tabId(page)` resolves the exact Chrome tab by checking that token through `chrome.scripting.executeScript`.

These fixture rules prevent false cache/provider assertions without changing production behavior.

## CI

`.github/workflows/e2e.yml` 与快速的 `quality` workflow 分离。E2E workflow：

1. `npm install`
2. `npx playwright install --with-deps chromium`
3. `npm run test:e2e`
4. 失败时上传 Playwright report / trace artifacts

生产运行时不依赖 Playwright。
