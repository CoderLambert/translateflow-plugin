# 240 — Reading ABC 闭环综合验收

Parent：任务 229。硬依赖：239。历史引用：`#240`。本任务是当前 main 的 QA/产品验收，不新增业务功能。

## 验收目标

在同一准确候选和真实 WXT 包上证明：真实查询与本地保存（A）→ 浏览器重启后离线可读 → 学习中心安全回访与唯一/歧义/缺失定位（B）→ 明确授权站点再访 marker、本页历史与 SPA 恢复（C）。

必须覆盖：拒绝/暂停/站点排除、删除/清空、容量/中断、worker/browser restart、redirect/权限与导航失效、节点替换、重复文本、大页面退路、键盘/Escape、en/zh_CN 既有界面合同；历史读取/回访/marker 不新增 Provider 调用或 lookupCount。所有输入使用合成数据和 mock Provider，不使用私有词典/密钥。

## 证据矩阵

- `reading-loop-release-a.spec.mjs`：真实创建、首次授权、重启、离线历史、删除/导出/容量/中断。
- `reading-handoff.spec.mjs`：精确 tab/document handoff、站点 marker 意图与零 Provider。
- `reading-return-location.spec.mjs`：resolved/ambiguous/missing、DOM replacement、overlay 清理、准确 deep link。
- `reading-page-markers.spec.mjs`：新 tab 再访 marker/list、DOM replacement、SPA 离开清理/返回恢复。
- Node/contract/storage/access tests 与 `npm run validate` 提供权限、事务、TTL、redirect、预算、unsupported 等反例。

## 完成标准

准确候选执行 `npm run validate`、`npm run build:extension:wxt`、`npm run test:e2e -- e2e/reading-loop-release-a.spec.mjs e2e/reading-handoff.spec.mjs e2e/reading-return-location.spec.mjs e2e/reading-page-markers.spec.mjs` 全部 PASS；产物 fingerprint 固定；主 Agent 核对任务 236–239 的未验证范围，不把 ABC 通过扩展成 D、其它浏览器或商店发布。
