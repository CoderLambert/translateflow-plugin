# 集成验收记录

当前验收以 `state.json` 和对应 `acceptance.json` 为准。开发阶段已在最新 main 上运行定向 Node 80/80、`npm run check`、`npm run typecheck`、默认构建，以及 22 个相关 Chromium 场景（首轮 21 PASS / 1 个测试期望与 main 路由不符；修正测试后该场景单独 PASS）。完整候选验收仍待提交后执行。

首次集成时确认最新 main 已通过 #346 移除随包词典路径。旧分支新增的 `optional-package-reader.js`、对应单测及对用户词典缺失诊断 E2E 的替换没有带入；主分支已有的损坏用户词典诊断保留。新的可选词典 E2E 只验证空库、手动安装 TFLex、无外部请求和 MDX/AI 流程。

原三份任务记录的历史基线和单项测试仍保留在相邻目录中；它们不代表当前集成候选，也不替代下方准确 head 的完整验收证据。
