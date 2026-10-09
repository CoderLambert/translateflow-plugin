# 主 Agent 自查：Selection Vocabulary Book v1

**candidateHead:** `033540996db9ce4150d949772f4386b258456673`

**检查主体:** 主 Agent（自查，不是独立审核）

## 实现与验收

- 保存只接受明确点击后的本地词典结果，写入独立的 `tfVocabularyBookV1`；快照字段有白名单与单条/总量/条目数上限，不包含页面 URL 或选区上下文。
- Reading 历史、同意设置、数据库及标记未改动。Learning Center 的 Wordbook 与 Review 使用现有页面；选区变化、关闭、返回导航保持原有路由/快照处理。
- 已通过 `npm run check`、`npm run typecheck`、`node --test tests/vocabulary-book.test.mjs`、`npm run test:unit`、`npm run build:extension:wxt` 和指定 Chromium E2E。逐项耗时、日志 hash 与退出码记录在 `acceptance.json`。
- WXT 产物为 `.output/chrome-mv3`，197 个文件、39,137,824 bytes，树 fingerprint `31cdc135f8bfbac1791b1366760bc67ec530f082321d96ed19c7cee94a451b60`。构建报告平台代码超过 #245 建议预算 90,135 bytes；构建仍通过。

## Chromium 流程与证据

Chrome for Testing 153.0.8010.12 中加载了真实 WXT MV3 包的临时副本。用合成 Core TFLex fixture（保留内置 Technical 包）选择 `persistent`，看到本地释义并显式保存；核对来源 `pwn-3.0`、未写入 `pageUrl`/`context`；打开 Learning Center、揭示释义、选择 Know it、确认下一次复习排期、删除条目并回到空态；再切换 Reading history 并用浏览器 Back 返回 Wordbook。测试 mock server 收到 0 次请求。

截图位于忽略目录 `test-results/e2e/selection-vocabulary-book--3c7b7-ly-the-local-wordbook-entry/`：

- `synthetic-local-wordbook-save.png`
- `synthetic-selection-saved.png`
- `synthetic-wordbook-list.png`
- `synthetic-wordbook-review.png`
- `synthetic-wordbook-review-scheduled.png`
- `synthetic-wordbook-empty.png`

## 限制

- 合成 Core fixture 仅证明交互、存储与来源展示；不证明 Oxford 或私有词典兼容性。
- 没有调用真实 AI/Provider。localhost 权限只加在临时测试副本。
- 未进行 OS 级输入法/IME 验收。
- 初次静态检查发现 popover 物理行数越限，修正后已在当前候选重新通过；失败记录和日志保存在本地忽略的任务证据目录。

## 合并状态校准（2026-10-09）

PR #316 已合入 `main`，merge commit 为 `bfd837c8dcff83fd31b2b4a889866eeb7e0dd8bf`。本次仅修正任务状态与远端事实；没有修改实现、测试或构建输入。
