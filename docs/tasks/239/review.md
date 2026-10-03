# 239 主 Agent 自查

候选 `488d514ff2ef6ce4651908f36647586dbf9ae7c1`，基线 `origin/main=7c97090284b1e06b038c13788f98da324ec4ed2f`。主 Agent 自查，不称独立审核。

PASS。只有显式 marker intent + 有效权限 + 未排除站点会读取当前页两批、最多 200 个 `PageSummaryItem`；批量 resolver 共享 page/root/digest 与总预算，resolved 才画 Shadow marker，其余状态留在本页列表。无选区 page proof 只授权最小 state/site/summary；详情和写入仍拒绝。DOM replacement、SPA 离开/返回、断线和导航会重新注册或清理 controller、observer、timer、Range、marker、scroll/resize listener；Provider calls 为 0。

正式证据：`npm run validate` PASS（1055 Node、15 Vitest、strict typecheck、默认 WXT）；`npm run build:extension:wxt` PASS（160 files / 1,820,239 bytes，platform 1,572,850 ≤ 1,576,595，fingerprint `47bf5a9ab7851a6e288a7465fe64db23cac8b8b71a43b8f70015479fc7094647`）；`npm run test:e2e -- e2e/reading-page-markers.spec.mjs` PASS（Chromium 153.0.8010.12，1/1）。开发期两处独立 controller 文件名断言已迁到生成 bundle 并完整重跑。240、其它浏览器/隐身/真实权限撤销/发布 NOT RUN。
