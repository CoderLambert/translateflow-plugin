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
| `node --test tests/generic-partial-batch.test.mjs`（云端路径） | PASS 3；回退 generic 改动后 FAIL 1 |
| `node --test tests/auto-heal-after-manual.test.mjs tests/cache-system-persistence-failure.test.mjs` | PASS 22 |
| `npm test` | PASS 2162，FAIL 0 |
| `npm run validate` | PASS（check 885 文件、Node 2162、Vitest 93、build） |

真实模型对照（本机 LM Studio `hy-mt2-7b` + 只让一个指定段落永远失败的注入代理，provider 层直接调用）：

| 构建 | 同一批 3 段、其中 1 段被注入失败 |
| --- | --- |
| 修复前（main 0.8.67） | `MALFORMED_RESPONSE 单段恢复没有返回有效译文`，3 段全部丢弃 |
| 修复后（本分支） | 成功返回其余 2 段真实译文（"与要求从零开始编写代码的教程不同…"、"要创建一个Next.js应用…"），仅注入段缺失 |

新增/更新的用例：

- `tests/auto-heal-after-manual.test.mjs`（新）：手动翻译后自愈生效（两个 observer 装上、重新入队按 cacheOnly 处理、零 Provider 调用），自动翻译已开启时不做任何事。
- `tests/cache-system-persistence-failure.test.mjs`：新增"手动翻译成功后触发自愈"和"翻译失败不触发自愈"两个接线用例。

- `tests/local-partial-batch.test.mjs`（新）：一段恢复失败时其余段落仍返回；全段失败仍抛 `MALFORMED_RESPONSE`；富文本段的标记与受保护内容保持不变。
- `tests/local-plain-recovery.test.mjs`：`invalid=true` 分支由"整批拒绝"改为"只返回成功段"，并保留调用次数断言（仍只给失败段两次机会）。
- `tests/auto-context-invalidated.test.mjs`：`MALFORMED_RESPONSE` 与 `NETWORK` 一样重试到 3 次才暂停，`AUTH` 仍立即暂停。

## 未验证

- 未用真实 `hy-mt2-7b` / LM Studio 在 nextjs.org 上复跑整页（扩展层种子设置会被自身归一化为免费在线，harness 不可靠）；provider 层的真实模型对照已完成，整页确认需用户在实机完成。
- 云端（generic）路径只做了 mock 回归，未用真实云服务验证二分重试的额外请求量与费用影响。
- 自愈修的是"页面重渲染冲掉译文"，未在 vercel.com/frameworks/nextjs 上实机复验（用户报告的站点）；真机确认仍未执行。
- 未跑浏览器 E2E（`npm run test:e2e`）与真机目视。
- 未合入 main、未发版、未更新国内镜像。
