# 244 — Reading Loop A–D 最终闭环验收

Parent：任务 229。硬依赖：240、243。本任务在当前 main 的同一真实 WXT 安装包上完成最终 QA/产品验收，不新增业务功能，也不授权商店发布。

## 验收目标

证明完整用户路径：真实查询与本地保存（A）→ 重启后离线回顾 → 安全回访与唯一/歧义/缺失定位（B）→ 明确授权站点再访 marker、本页历史与 SPA 恢复（C）→ Content 真实文本流、Stop/no-save、重试完整保存及学习中心 repository-grounded follow-up（D）。历史读取、回访、marker 不新增 Provider 调用或 lookupCount；AI 只由用户明确触发。

## 证据矩阵

- `reading-loop-release-a.spec.mjs`：真实创建、授权、重启、离线历史、数据退出、容量与中断。
- `reading-handoff.spec.mjs`：精确 tab/document handoff、站点 marker 意图与零 Provider。
- `reading-return-location.spec.mjs`：resolved/ambiguous/missing、DOM replacement、overlay 清理与 deep link。
- `reading-page-markers.spec.mjs`：新 tab 再访 marker/list、节点替换与 SPA 恢复。
- `selection-assistant-ui.spec.mjs`：Content partial/Stop/no-save/retry/save ACK 与学习中心基于真实仓库的 follow-up commit。
- Node/Vitest/typecheck/build：权限、事务、有限历史图、regenerate、修订冲突、迟到结果、投影加载顺序和固定包体门槛。

## 完成标准

准确候选执行 `npm run validate`、`npm run build:extension:wxt`，以及一次组合 Chromium 命令：

```bash
npm run test:e2e -- \
  e2e/reading-loop-release-a.spec.mjs \
  e2e/reading-handoff.spec.mjs \
  e2e/reading-return-location.spec.mjs \
  e2e/reading-page-markers.spec.mjs \
  e2e/selection-assistant-ui.spec.mjs
```

固定实际包 fingerprint，并更新 `docs/READING_LOOP_ACCEPTANCE.md` 的 A–D 决策、逐项 PASS/FAIL/NOT RUN、用户复现路径和限制。只有本地 gate、准确远端 head、实际保护要求和合并树核对全部满足后才标 completed；不把 Chromium/mock Provider 证据扩展成其它浏览器、真实模型质量、商店发布或 SRS/云同步。
