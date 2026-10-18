# Selection、Content 自动恢复与悬浮入口收口

本任务把三个尚未登记状态的本地工作集合并到最新 `origin/main`：富文本词典命中后的显式 AI 操作、扩展上下文失效后的旧页面停止自动任务、Quick Control 本站位置记忆。原工作区的 native-host 分支提交不属于本任务，保持独立。

基线为 `37082358c57f688b159900e38aa1087bdeabf678`，实现分支为 `fix/local-content-reliability-20261019`。当前实现只合并上述三个相互独立、同一安装包验收的功能；保留现有路由、取消、权限、Provider、缓存身份和数据格式。位置只保存 scheme + hostname 与归一化坐标，最多 256 个站点。

重基到 main 时清理了已失效的旧实现：#346 已移除随包词典 reader，因此不再添加 `optional-package-reader` 或旧的 bundled status 测试。结构化查询失败仍保留真实错误和“不自动翻译”路由；仅单词查询允许先尝试用户导入的 MDX，并在命中后提供显式 AI 操作。用户词典资源损坏仍由现有诊断流程处理。

## 验收

- `git diff --check origin/main...HEAD`
- `npm run validate`：静态检查、Node、类型、Vitest 与默认 WXT 安装包。
- `npm run build:extension:wxt` 后分别对 `dist/extension/` 与 `.output/chrome-mv3/` 运行 smoke。
- 完整 `npm run test:e2e` 按用户要求延至下一项功能验收，不作为本次合并门槛。此前针对改动流程的定向 E2E 为 22/22 PASS；在候选 `fa010838154245f35fdb48e6fbc3fbf0a6de599f` 上启动的完整套件被用户要求停止，停止时 226/239 PASS、1 项中断、9 项跳过、3 项未运行，不记为完整 E2E 通过。
- 包 fingerprint 绑定实际 `dist/extension/`；不含词典数据。

当前任务不包含 native-host 功能、商店发布或真实 Provider 认证。各原始工作记录保留在 `auto-context-invalidated/`、`quick-control-position/` 与 `rich-dictionary-ai-actions/`，本任务为它们唯一的集成状态与当前验收入口。
