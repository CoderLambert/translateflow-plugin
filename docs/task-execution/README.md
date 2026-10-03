# Task execution records

执行效率记录的操作与字段定义见 [TASK_EXECUTION.md](../TASK_EXECUTION.md)。

- `hooks.json`：受版本控制的项目 hook 模板，与实际 `.codex/hooks.json` 保持一致。
- `local/`：本地原始 JSONL 和当前任务上下文，默认 Git 忽略，位于持久工作区。
- `reports/`：按需生成的本地 JSON/Markdown 汇总，默认 Git 忽略；审核后可精确提交所需汇总，避免每个事件制造工作区 diff。

原始记录不自动公开上传，也不自动输入模型。它们不替代源码保全、测试证据、独立审核、Issue 状态或合并门禁。
