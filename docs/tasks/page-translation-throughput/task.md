# 整页翻译吞吐优化：并发批次、首屏小批、失败快速路径

用户反馈长页面翻译"感觉慢"。实际耗时结构是：段落按 18 段/7000 字符分批，`processPage` 里**逐批串行** await，每批一次完整 provider 往返，所以总耗时 ≈ 批数 × 单批时间；同时流式请求用 45 秒**总时长**超时，长批次会被整条掐断；云端模型的 malformed 重试 2 次等于把必然失败的请求做两遍。

范围：

1. `src/content/batch.js`：新增 `makeBatchesHeadFirst(groups, headItems = 8)`——首批最多 8 段，其余按原限制分批，且不丢组、保持阅读顺序。
2. `src/content/processor.js`：首批单独执行（首屏更快，并冻结后续批次复用的 config snapshot），其余批次以 `BATCH_CONCURRENCY = 3` 并发；聚合 `cacheHits/apiTranslated/missing/done` 与进度提示；任一批失败时停止调度新批次、等在飞批次结束后抛出该错误（保持原有"失败即整体失败"语义）。
3. `src/background/providers/openai-sse.js`：流式请求改为**空闲超时**（每收到一块数据就重置 45 秒窗口），健康但很长的生成不再被总时长掐断；非流式请求保持单一总超时。
4. `src/background/providers/openai-compatible.js`：云端/通用路径 `maxAttempts: 1`（模型答复损坏时直接进入二分重试，而不是把同一请求重复两遍）；本地模型路径不变。

不做：不提高并发上限到 4 以上（429 风险）、不把批量降到单段（请求数暴涨）、不改流式增量上屏（需改响应协议，另开任务）。

验收：新增批次切分与并发调度回归、流式空闲超时回归；全量 Node 测试与 `validate` 通过。
