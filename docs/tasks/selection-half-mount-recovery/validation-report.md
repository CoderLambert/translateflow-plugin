# 验证报告：划词浮窗半挂载恢复与候选回归修复

候选源码：`feat/unified-reading-polish@98218db2`（0.8.65）+ 本任务改动，在独立 worktree 中执行，未改动主工作区未提交内容。

## 1. 错误归属（先于修复的证据）

`content-scripts/content.js` 第 1402 行是整包唯一的压缩行；枚举其中全部 39 处 `removeEventListener` 后，可空接收者只有划词浮窗的 `panel`，该处已在 0.8.64 改为 `panel?.`。

真实包对照（headless Chromium，真实 dist 包 + `chrome.developerPrivate` 读取 runtimeErrors；步骤：健康上下文内 show/hide 一次 → 不刷新页面重载扩展 → 再次 show → hide）：

| 构建 | show | hide#1 | hide#2 |
| --- | --- | --- | --- |
| 0.8.63 | `Extension context invalidated.` | **`Cannot read properties of null (reading 'removeEventListener')`** | 同左 |
| 0.8.65（含 0.8.64 修复） | ok | ok | ok |

结论：截图错误来自更新前仍存活于该 dev.to 标签页的旧脚本；0.8.65 已不再产生。Chrome 的 Errors 列表会保留旧记录，需先刷新所有旧页面再 `Clear all`。

## 2. 已执行

| 命令 | 结果 |
| --- | --- |
| `node --test tests/content-ui-reload.test.mjs` | PASS 5（回退本修复后新增用例 FAIL，确认红→绿） |
| `node --test tests/quick-control-position-controller.test.mjs` | PASS 4 |
| `node --test tests/reading-content-classic.test.mjs` | PASS 1 |
| `npm run check` | PASS（880 文件 + i18n 1596 keys） |
| `npm test` | PASS 2152，FAIL 0（修复前该候选有 2 个失败） |
| `npm run typecheck` | PASS（`wxt prepare` + `tsc --noEmit` 无输出错误） |
| `npm run test:unit` | PASS，16 文件 / 93 用例 |
| `node scripts/reading-content-classic.mjs` 两次 | 生成结果一致（md5 `e3c546a2…`），确定性可复现 |
| `npm run build:extension:release` | PASS，0.8.65 阶段包 146 文件 / 3.27 MiB |
| 真实包流程烟测（dev.to 页面：加载/划词/chip/Quick Control 开关与拖拽/Escape/刷新/扩展重载/旧文档再划词） | `runtimeErrors` 为空 |

## 3. 修复前状态（原始回归证据）

- `tests/reading-content-classic.test.mjs`：`src/content/reading-record.js is stale; run node scripts/reading-content-classic.mjs`（该文件上次生成于 0.8.61，其后 vite/esbuild 升级到 7.3.7 / 0.28.2 未重新生成）。
- `tests/quick-control-position-controller.test.mjs`：用例命中 0.8.56 引入的"升级后提示刷新"占位实现，`showForTab` 不发送 `QUICK_CONTROL_POSITION_GET`，并因未消费的 Promise 触发 `Promise resolution is still pending`。

## 4. 未执行 / 未验证

- Playwright E2E 套件（`npm run test:e2e`）与 `test:wxt:smoke` 未执行。
- 非 headless 真机 Chrome 的人工目视确认未执行。
- push、PR、合并、GitHub Release 与商店上传未执行（需单独授权）。
