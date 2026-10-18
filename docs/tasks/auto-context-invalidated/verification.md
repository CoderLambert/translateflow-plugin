# 自动翻译上下文失效修复的验证记录

以下是 2026-10-16 旧基线上的单项历史证据；当前集成验收与新包 fingerprint 见 [content-runtime-closeout](../content-runtime-closeout/verification.md) 和其 `acceptance.json`。旧日志保留原结果，不改写为当前候选结果。

2026-10-16。基线仍为 `c19b79dcbee3dd03d80c906ea857bae679e72ee8`；当前分支 `fix/rich-dictionary-ai-actions-20261016`，含前序词典修复，均未提交；没有 candidate/sync/merge commit 或 PR。以下为主 Agent 自查及实际执行结果。

## 结果

- `node --test tests/auto-context-invalidated.test.mjs tests/content-runtime-context.test.mjs tests/cache-restore-mode.test.mjs tests/constants.test.mjs tests/reading-text-projection.test.mjs tests/selection-multi-dictionary.test.mjs`：**55 PASS**。覆盖自动、缓存恢复、同时启用、启动配置/恢复失效、等待中的自动启用、失效后不重新调度、普通错误保留重试、消息 API 消失及正常消息行为。
- `npm run check`、`npm run typecheck`、`npm run build:extension`、`git diff --check`：**PASS**。构建保留既有 #245 advisory budget 告警。
- `TF_E2E_ARTIFACT=dist/extension npm run test:e2e -- e2e/auto-context-invalidated.spec.mjs e2e/translateflow.spec.mjs --grep 'actual extension reload|automatic mode translates incremental|restore-only mode incrementally'`：**3 PASS**。

新 E2E 在一次性 Chromium profile 通过浏览器自己的扩展管理功能真实重载扩展，保留旧网页及旧 isolated-world 只读观测器；没有重新注入脚本冒充旧上下文。实际观察到一次“扩展已更新，请刷新当前网页后重试。”提示，auto/cacheRestore 均关闭，pending 为零，两个 observer 和 timer 清理，后续页面变化不会产生 Provider 请求。持久 autoSites/cacheRestoreSites 保持不变。刷新网页后先从缓存恢复原文段，新增段落正常触发一次 mock Provider 请求。

首次浏览器验证：新专项 **FAIL**，另两项 **PASS**。真实重载后 Chromium 直接移除了 `chrome.runtime`，原代码产生 `Cannot read properties of undefined (reading 'sendMessage')`，仅匹配英文 invalidated 字符串不足。补齐 runtime API 缺失识别后，同一场景 **PASS**，未放宽断言或加入固定 sleep。原始失败日志与 trace 保存在 `first-browser-failure/`。

## 交付与边界

实际安装目录 `dist/extension/` 已更新；128 文件、2,885,174 字节、词典资源 0 字节。tree SHA-256：`ad0619c0c332fea8e182e39174a0bbf434fe80fac8fb6919e7b507afae057f3c`。这是未提交工作区构建，不能当作基线 HEAD 本身的验收。版本仍为 `0.8.11`。

日志和合成截图在 Git 忽略目录 `docs/task-execution/local/auto-context-invalidated/`：`node-tests.log`、`check.log`、`typecheck.log`、`build.log`、`e2e.log`、`source-sha256.txt`、`browser-pass/`。已查看实际失效后的中文刷新提示截图。

自查：只在明确失效或消息 API 不存在时终止；不将普通网络失败或暂时无接收端当作永久失效。不修改持久站点偏好，不清缓存、不移除已完成译文、不增加外部请求或权限。刷新前的旧页面不能自行重新启用已失效的上下文，恢复入口是刷新网页。没有输入变化的前序词典验收结果保持原记录，不改写成新构建结论。

全量 validate/E2E、用户真实网页及真实 Provider：**NOT RUN**。本次浏览器证据使用合成页面、mock Provider 和临时扩展副本。

应用本次修复时，在 `chrome://extensions` 重新加载 TranslateFlow，再刷新当前网页；后续若扩展再次重载，网页会明确提示刷新并停止旧队列。
