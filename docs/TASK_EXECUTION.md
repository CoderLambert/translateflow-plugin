# Task execution efficiency logging

本工具只记录开发任务的节点、观测耗时和有限状态，不属于扩展运行时。无新依赖、网络请求、模型调用、后台服务或全局配置改动。记录和汇总都由 Node 脚本完成。

## 一次启用

项目原生 hook 位于 `.codex/hooks.json`，模板在 [task-execution/hooks.json](task-execution/hooks.json)。本次核对的 Codex CLI 为 0.159.2，`hooks` feature 已启用。项目 hook 仍须用户在 CLI `/hooks` 中审阅并信任当前定义；项目 `.codex` 层也须可信。修改 hook 定义后需重新审阅，不能使用 bypass-trust 代替。

这是标准 command hook，使用 [官方 Hooks 协议](https://learn.chatgpt.com/docs/hooks)。从仓库子目录启动时通过 Git root 定位脚本。安装到仓库不会证明当前已有会话已重载或执行；应在重新加载后检查 `local/*.jsonl` 中实际的 `hook` 事件。

脚本收到协议 JSON 后，只选取事件名、匿名会话/调用关联 ID、工具类别、原生提供的模型/角色名称以及明确数值状态。始终输出空 JSON `{}`，不注入上下文、不改变工具输入、不触发续写。失败只输出固定诊断，观察型 hook 不阻止原工具。

## 每个任务的使用

每个 worktree 同时只维护一个活动任务上下文，阶段由协调者切换；并行实现仍使用各自独立、持久的 worktree。任务 ID 使用本地任务编号或短标识，不填用户原文、私人路径或自由文本。角色参数是声明值，与 native hook 观测到的模型/角色字段分开。

开始任务时，在已有基线检查命令中附加一次：

```bash
node scripts/task-execution.mjs start issue-234 dev_specialist
```

进入实际阶段时，在已有执行命令中附加一次标记，避免为记录单独调用模型：

```bash
node scripts/task-execution.mjs stage implementation
node scripts/task-execution.mjs stage validation
```

支持阶段：`baseline`、`experiment`、`implementation`、`validation`、`review`、`fix`、`sync`、`merge`（历史 `ci` 仍可读取）、`checkpoint`。不需要为每个文件或普通步骤创建阶段。

验证命令使用 wrapper，自动记录开始、结束、单调时钟耗时和真实退出码，并原样传递输出与参数：

```bash
node scripts/task-execution.mjs run -- npm run validate
node scripts/task-execution.mjs run -- node --test tests/task-execution.test.mjs
```

wrapper 不使用 shell 拼接；需要 shell 时必须显式传入已有审查过的 shell 命令。Linux/POSIX 上每次命令创建独立进程组，收到 SIGINT/SIGTERM 时只向该组转发，包含 npm/shell 后代进程；Windows 目前只能转发给直接子进程，进程树中断 NOT VERIFIED。分类器只保留 `validate`、`node-tests`、`e2e`、`unit`、`typecheck`、`check`、`build`、`ci-check`、`commit`、`push`、`merge` 或 `other`，不保存命令全文。混合多命令的类别只是提示，统计中不能推断它们输入完全相同。

结束或暂停时：

```bash
node scripts/task-execution.mjs stage checkpoint
node scripts/task-execution.mjs finish paused
```

结果可用 `pass`、`fail`、`paused`、`blocked`，是协调者声明，不改变本地状态、审查或合并资格。`Stop` 只表示会话回合结束，不能自动判定任务完成。已有活动任务时重复 start 会失败，防止静默覆盖；finish 后再次 start 同任务会创建新的 attempt。

## 按需统计

```bash
node scripts/task-execution.mjs report issue-234
mkdir -p docs/task-execution/reports
node scripts/task-execution.mjs report issue-234 --json > docs/task-execution/reports/issue-234.json
node scripts/task-execution.mjs report issue-234 > docs/task-execution/reports/issue-234.md
```

默认不逐事件调用模型或生成 Markdown。只有任务结束、暂停或用户要求统计时生成汇总；需要模型审查时只提供这份小汇总和异常对应的证据，不读取整个会话/日志。

| 指标 | 来源与准确性 |
| --- | --- |
| task/attempt、阶段、声明结果 | 每次显式 start/stage/finish；不是由模型推测 |
| 阶段和任务跨度 | 完成边界间的壁钟差，包含等待与人工审批；不是 CPU/有效工作时间 |
| wrapper 命令耗时、退出码、信号 | 同一进程单调时钟，真实子进程结果；缺失结束不能记 PASS |
| 工具次数与耗时、已知失败/未知结果 | 原生 Pre/Post 关联；壁钟差；并发跨度重叠，不能相加当任务时间 |
| 用户回合、子 Agent 启动、压缩、审批事件 | 原生事件计数；不等于模型请求数或浪费次数 |
| 原生模型/角色名称 | 仅保存 payload 实际提供的字段，缺失即未知；与 CLI 声明角色区分 |
| 重复 clean head 的验证候选 | 同命令类别/commit 的 wrapper 重复执行；参数、环境和生成资源仍可能不同，不自动判为浪费或跳过测试 |
| modelRequests / tokens | `null` / UNKNOWN：当前 hook 未提供可信统计，不读不稳定 transcript 估算，也不伪造数字 |
| 未匹配跨度、损坏行、时钟异常 | 汇总明确计数；不补造缺失结束时间、不把负耗时改成 PASS |

无需任务号时不猜关联，也不检查提示词寻找 Issue；写入保留标识 `unassigned-hooks`，可用 report 查看缺失绑定。任务号由单次 start 明确绑定。PreToolUse 将匿名 session/call 与当时的 task/attempt 保存为独立绑定；Post 使用该绑定，即使任务已暂停、切换或重开，也不会回写新任务。没有 Pre 绑定的 Post 只记录为未绑定，不能假定属于当前任务。

原生事件覆盖受客户端/工具路径影响，专用工具可能不经过 hook；报告不是完整调用审计。wrapper 与 native hook 可能同时观察同一命令，报告分别展示，不能重复相加。

## 数据与开销边界

原始记录存放在持久工作区 `docs/task-execution/local/<task>.jsonl`；上下文在同目录 `context.json`，未完成调用的匿名归属在 `pending-*.json`。完成 Post 后删除对应绑定；缺失 Post 时保留，不能在暂停时删除而丢失迟到结果的归属。事件以小型单次追加写入，不重写日志；hook 不修改任务上下文，支持同 worktree 内并发 hook。start/stage/finish 由唯一协调者串行执行。每个任务日志超过 64 MiB 时 report 明确失败，应先分任务/归档，不无限读取。

不保存 prompt、assistant 文本、完整 command/argv、stdout/stderr、transcript/private 路径、环境变量、密钥、页面原文或词典内容。会话/turn/tool/agent ID 只保存关联 hash。Git head/dirty 只在任务边界与 wrapper 开始时读取，不每个 hook 跑 Git。路径使用固定 docs 子目录、限制任务 ID、拒绝符号链接，避免写出仓库。

`local/`、`reports/` 默认 Git 忽略，免除频繁提交/CI 和自动上下文增长；源码、模板和操作文档正常受版本控制。需要分享汇总时先审核内容，再精确提交选定文件；不批量公开原始日志。docs/scripts/.codex 不属于实际 legacy/WXT 扩展输入。

历史任务不回填猜测数据。本次工具完成后开始的记录只能证明从实际 start 开始的过程。hook 本身仍有 Node 启动与少量文件 I/O 成本，不宣称零延迟；它不增加模型调用。若记录失败，保留 UNKNOWN/未匹配状态并检查权限，不能把缺失记录当成功。

## 本地验收接入

冻结、实际命令验收、产物指纹和 gate 使用 [tasks/LOCAL_WORKFLOW.md](tasks/LOCAL_WORKFLOW.md) 的 local-task.mjs。它保存本地完整验证日志和每次真实耗时；不要再用 task-execution wrapper 包住它重复计算命令时长。原生 hooks 单独观测工具跨度，两种跨度不相加。日志捕获只用于已审核的验证命令、mock Provider 和合成数据，不用于认证、真实用户数据或付费请求。

原生 hook 模板使用 POSIX shell 的 Git root 替换语法；Windows command hook 安装 NOT VERIFIED，不宣称跨平台。Windows 的不跟随链接 flag 缺失时采用显式 lstat 检查，不宣称抵抗恶意并发文件系统竞态。SessionEnd/Interrupt 的超时设为 3 秒；定义改变后须在 CLI /hooks 重新审阅。会话是否加载新定义以实际原生事件为证，不影响本地 CLI 验收。
