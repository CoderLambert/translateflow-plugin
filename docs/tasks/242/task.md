# 242 — Grounded 助手动作、有限追问与历史分支

Parent：任务 229。硬依赖：241、234。

- Port start 冻结 understand/analyze/usage 三个根动作；问题由后台拥有。follow-up 必须有同线程 parent，最多携带 6 个有界已完成历史 turn；不提供任意旧节点编辑。
- 根 regenerate 只能 parent=null、regenerationOf 指向旧根并使用新 turn/branch；follow-up 不可 regenerate。完整 complete 返回可直接进入 Reading assistant artifact 的严格 turn DTO；partial/cancel/fail 没有 completed DTO，不能保存。
- prompt 只含经过 Selection resolver 收窄的 selection/context/candidate facts 与有限历史，不含 URL、页面全文或私有数据；仍复用 241 Port/Provider/Abort。
- 验收：领域形状/图反例、真实 SSE completed turn、Stop 无 completed turn；`npm run validate`、WXT build、`npm run test:e2e -- e2e/selection-assistant-stream.spec.mjs`。
