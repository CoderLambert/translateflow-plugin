# 验证报告：单段恢复失败不再拖垮整页翻译

候选：`origin/main@de298d51` + 本任务改动，分支 `fix/partial-local-translation-recovery`。

## 根因证据（修复前）

用真实 provider 代码 + mock 模型复现（`openAICompatibleProvider.translateBatch`）：

| 场景 | 修复前 |
| --- | --- |
| 两段纯文本，模型对第 2 段恢复返回空 | 整批 `MALFORMED_RESPONSE`，页面零翻译 |
| 单段富文本，模型丢失 `⟦TF:n:S/E⟧` 标记 | 整批 `MALFORMED_RESPONSE` |
| 同时 | `auto.js` 对 `MALFORMED_RESPONSE` 立即暂停自动翻译并提示"重试整页翻译" |

## 已执行

| 命令 | 结果 |
| --- | --- |
| `node --test tests/local-partial-batch.test.mjs tests/local-plain-recovery.test.mjs tests/local-translation.test.mjs tests/auto-context-invalidated.test.mjs` | PASS 24 |
| 回退 provider 改动后重跑新增用例 | FAIL 2（确认红→绿） |
| `npm test` | PASS 2155，FAIL 0 |
| `npm run validate` | PASS（check 883 文件、Node 2155、Vitest 93、build） |

新增/更新的用例：

- `tests/local-partial-batch.test.mjs`（新）：一段恢复失败时其余段落仍返回；全段失败仍抛 `MALFORMED_RESPONSE`；富文本段的标记与受保护内容保持不变。
- `tests/local-plain-recovery.test.mjs`：`invalid=true` 分支由"整批拒绝"改为"只返回成功段"，并保留调用次数断言（仍只给失败段两次机会）。
- `tests/auto-context-invalidated.test.mjs`：`MALFORMED_RESPONSE` 与 `NETWORK` 一样重试到 3 次才暂停，`AUTH` 仍立即暂停。

## 未验证

- 未用真实 `hy-mt2-7b` / LM Studio 在 nextjs.org 上复跑（需要用户的本地模型服务）；建议合并前由用户实机确认整页可翻译。
- 未跑浏览器 E2E（`npm run test:e2e`）与真机目视。
- 未合入 main、未发版、未更新国内镜像。
