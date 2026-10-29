# 验证报告：整页翻译吞吐优化

分支 `feat/page-translation-throughput`，基于 `origin/main@06001cad`。

## 改动与预期收益

| 改动 | 预期 |
| --- | --- |
| 首批 4 段 + 其余并发 6 | 115 段实测 45s → 25s（本地模型；云端可继续受益） |
| 视口优先排序 | 首屏内容进入第一批，用户先看到自己正在读的段落 |
| 流式空闲超时替代总超时 | 健康长生成不再被 45s 掐断，减少重试 |
| 云端 malformed 只重试 1 次 | 失败路径少一次整请求 |

## 已执行

| 命令 | 结果 |
| --- | --- |
| `node --test tests/batch-head-first.test.mjs` | PASS 2（首批 ≤8 段、不丢组、顺序保持；短页单批） |
| `node --test tests/batch-concurrency.test.mjs` | PASS 1（首批独占，其后同时在飞 3 批，峰值恰为 3，共 7 次 provider 请求） |
| `node --test tests/openai-sse.test.mjs` | PASS 9（新增：慢但持续吐字的流在 1s 窗口下仍成功完成） |
| `npm test` | PASS 2173，FAIL 0 |
| `npm run validate` | PASS（check 887 文件、Node 2173、Vitest 93、build） |
| 真实模型实测（`hy-mt2-7b`，115 段） | 串行 18 段/批 **45s** → 首批 4 段 + 并发 6 **25s**；并发 3 与 6 在本地模型上同为 25s |

## 未验证

- 未做真实 provider 的端到端测速（需用户用 DeepSeek/本地模型实测同一篇文章的耗时对比）。
- 未验证 429/限流下的并发退避（当前只有单批失败即整体失败，没有专门针对限流降低并发）。
- 流式增量上屏（首段译文随 token 出现）未实现，属独立任务。
