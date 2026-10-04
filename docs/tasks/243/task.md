# 243 — Content 助手与学习中心历史追问 UI

Parent：任务 229。硬依赖：242、235。

- Content 在扩展 Shadow UI 中消费 241/242 Port：显示真实 partial、Stop、interrupted、retry、complete；选择/导航/关闭后旧 delta 不回写。只有 complete grounded turn 通过现有 Reading token/transaction 保存，partial/cancel/fail 不保存。
- 学习中心从实际 RecordDetail 的 completed assistant turn 发起有限 follow-up 或根 regenerate；后台重新读取 record/revision/source 并验证 parent/thread/branch，调用方不能靠 recordId/正文授权。完整回答 commit 后刷新历史；失败保留旧问答。
- 三个根入口 Understand/Analyze/Usage 与 follow-up/regenerate 文案/状态诚实；敏感来源不扩上下文。键盘、Escape、IME、窄屏、暗色、reduced-motion、断线恢复适用。
- 不新增 Provider、DB、Manifest 权限、通用 bus 或任意图编辑。

验收：Node/React 覆盖 partial/Stop/no-save、complete/save ack、迟到 delta、follow-up/regenerate graph、删除/修订冲突；真实 WXT Chromium 覆盖 Content stream 保存及学习中心 follow-up。完整门槛 `npm run validate`、WXT build、聚焦 E2E。
