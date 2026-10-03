# 238 — Reading 精确回到原文与目标页历史卡

Parent：本地任务 229（Reading Loop）。硬依赖：237、231 已合入。历史引用：`#238`；后续以本地合同和证据为准。

## 用户结果

- 用户从学习中心发起安全回访后，目标页对 handoff 携带的冻结 anchor 做有界精确恢复；唯一可信匹配时滚动到原文并以扩展 Shadow UI 临时标示，不包装或改写网页正文。
- 目标页显示可关闭的历史卡，明确区分 locating、resolved、ambiguous、missing、not-loaded、unsupported 和连接/失效错误；失败仍显示保存的 quote，并可打开对应学习中心记录。
- 回访、定位、卡片和重试全程本地，不重新查词、不调用 Provider、不增加 lookupCount、不写新 Reading 记录。

## 定位合同

1. 仅使用 handoff 已返回的 `PageSummaryItem.anchor`；不接受网页或调用方提供 record/page 身份。exact 必须逐字匹配；prefix/suffix 与 blockDigest 存在时必须验证。position 仅作候选提示，重新验证后才能采用。
2. 复用 `textProjection` 的隐藏/敏感/扩展 UI/翻译排除与 UTF-16 映射。扫描普通 HTML/light DOM；closed shadow、frame、canvas、PDF/video、editable/sensitive/未知根保持 unsupported。
3. 只在一个去重后的可信 Range 时 resolved；多个匹配为 ambiguous，完整扫描无匹配为 missing，预算/尚未加载为 not-loaded。禁止 fuzzy、first-match 或把保存 position 当当前事实。
4. 每片最多 8ms / 500 nodes / 16k UTF-16；单次总计最多 250ms / 25k nodes / 1M UTF-16，先到者停止。DOM revision 变化最多做 3 次、150ms debounce 的有界重试；关闭/导航/pagehide 后清理 listener、timer、overlay 与 Range 句柄。
5. resolved 临时标示使用扩展 Shadow layer 和 Range rect，不插入 `<mark>`、不改变页面文本/链接/选择。滚动与缩放后有界更新；Escape/关闭恢复焦点和清理。

## 协议与 UI

- `reading.open-learning-center` 可带可选 `recordId`，仅由受控 Content/扩展入口打开固定 `learning-center.html#record=<UUID>`；不接受 URL 或正文。
- Content return card 复用现有 token/primitives，支持键盘、Escape、窄屏、暗色、reduced-motion；用户文案不暴露 parser/worker/内部错误。
- 本任务不实现 239 的持久站点 marker、本页历史列表、自动再访扫描或 SPA 自动恢复。

## 验收

- Node/DOM 测试覆盖 split-inline/emoji/combining text、position moved、节点替换、唯一 quote、同块/跨块重复导致 ambiguous、prefix/suffix/digest、missing、unsupported、预算停止、revision 重试/清理。
- 实际 WXT Chromium：保存记录 → 学习中心安全回访 → 目标页唯一定位/滚动/临时 overlay/历史卡 → 打开准确学习中心 deep link；另覆盖 ambiguous 与 missing 退路，Provider calls 为 0。
- 合入前执行 `npm run validate`、`npm run build:extension:wxt`、`npm run test:e2e -- e2e/reading-return-location.spec.mjs`，绑定准确候选与构建 fingerprint。

## 不做

不做 fuzzy、正文包装、持久 marker、本页全量历史、AI/Provider 请求、数据库/缓存 schema、Manifest 权限、发布或商店操作。
