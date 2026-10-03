# 本地任务执行流程

任务合同、执行状态、验收和独立审核以本目录为准。Git 管代码基线，GitHub 只用于代码备份、PR 差异和受保护 squash 合并。日常不调用 Issue、评论、标签、CI 状态或 Review API。迁入的历史合同保留产品、安全、硬依赖和人工验收；其中旧远端调度文字已由本规则替换。

## 文件与所有权

- `<task>/task.md`：目标、范围、验收与限制，没有合同变化不重写。
- `<task>/state.json`：主 Agent 单写。dependencies、validationCommands、artifactRequired 是机器可执行验收要求，合同中只引用，不另建状态机。更改这些要求使已冻结验收失效。
- `<task>/acceptance.json`：准确 candidateHead/tree、环境、实际 checks、单调耗时、日志 hash、实际包 fingerprint 和限制。
- `<task>/review.md`：未参与实现的具名 dev_reviewer 审核准确候选和真实 diff；写触发条件、位置、影响、检查、PASS/CHANGES_REQUESTED 和未验证内容。
- `index.json`：从每个 state.json 生成的只读投影。`node scripts/local-task.mjs index`；禁止手工维护。
- `../task-execution/local/`：Git 忽略的原始事件、完整日志、截图和备份。禁止提交原始私人信息；日志丢失时本地 gate 拒绝同步，不补造 PASS。

状态：working → reviewing → ready_to_sync → completed；问题修复为 changes_requested → working。暂停/阻塞使用 paused/blocked，保存下一动作。状态由协调者根据真实结果写入，Hook 不判断。completed 必须满足本任务验收/独审、实际合入 main 并记录 mergeHead；编写完成、PR、测试通过均不能单独作为完成。依赖要求 completed 且 mergeHead 为已 fetch 的 origin/main 祖先。

2026-10-03 迁入范围是 #191/#229 的索引、已完成前置 #227/#245–247/#249/#230–233，以及未完成 #234/#248/#235/#236 和必要路径安全修复。Epic 的后续章节只是历史合同，#237–244/#250–256 未获启动授权。产品开发当前暂停；本轮仅实施 workflow-local。旧闭合任务保留实际合入 SHA，但没有重新运行/改绑历史测试，acceptance/review 明确 NOT RUN。路径与 #234 未提交修改备份在原主工作区的本地目录，未经授权不覆盖或继续。

## 开发、冻结、验收与审核

1. 读本地任务卡，核对 Git 修改、分支、worktree、HEAD；按需要一次 fetch，不读取每日 GitHub 状态。独立工作区先确认，共享文件单一写入者；保留已有修改。
2. 开发中运行受影响测试。已有记录工具的 start/stage/finish 继续使用，事件只是观测；不为每个普通步骤额外调用模型。实际命令不重复嵌套 wrapper。
3. 将候选源码、任务合同和初始状态提交，工作区 clean，然后冻结：

   ```bash
   node scripts/local-task.mjs freeze workflow-local
   node scripts/local-task.mjs run workflow-local -- npm run validate
   ```

   使用每个 state.json 中的真实 validationCommands；完整 validate 永远必需。UI/交互运行真实 Chromium E2E；WXT 构建用实际 WXT 包；升级在临时 profile 同 ID 旧包→新包→重启，保留设置/cache/合成词典；词典、取消、存储、安全按任务保留对应回归，不用 mock 替代明确人工验收。不能运行的检查记 NOT RUN，失败记 FAIL。脚本计时，不估算，UNKNOWN 不填 0。environment.browser 在实际浏览器运行后填确切版本，未运行留 NOT RUN。
4. 需要实际安装包时完成构建后记录：

   ```bash
   node scripts/local-task.mjs artifact 234 .output/chrome-mv3
   ```

   只接受实际 `dist/extension` 或 `.output/chrome-mv3`；逐文件内容 fingerprint，拒绝 links、不修改包。产物变化使 gate 失败。任务还有逐项产品/人工验收时，在 acceptance 的 limitations/补充结果明确记录，协调者逐项判定；脚本通过不是产品验收自动签字。
5. 由真实 dev_reviewer 独立审查准确 candidateHead。审核正文第一条机器绑定如下（由实际审核结果填写，禁止自签）：

   ```text
   <!-- local-review {"schema":1,"task":"workflow-local","candidateHead":"<40-char SHA>","result":"PASS","role":"dev_reviewer","independent":true} -->
   ```

   脚本只检查声明与绑定，无法证明角色独立性；协调者保留真实委派/运行证据。子 Agent 只报告结论，主 Agent 单写任务结果。原生 payload 缺失的模型/权限信息标 UNKNOWN，不用自报身份补齐。修复之后新候选和准确增量独审；受影响验证重跑，要求/风险需要时再跑完整验收。

## 候选 SHA 与证据归档

候选必须先提交再测，避免“测过脏树但没有可审代码”。acceptance 生成后是元数据修改：它不可能同时包含自身未来 commit SHA。

candidateHead 是实际测试/审核的提交，syncHead 是归档提交和远端 expected-head。两者必须有 Git 祖先关系，且完整输入指纹一致；只允许**当前任务**的 state.json、acceptance.json、review.md 以及生成 index.json 的差异。task.md、其它任务文件、源码、测试、package/lock、workflow、脚本、构建输入的任何变化都使旧候选失效。冻结后的机器验收要求另与候选 state 比较，不能通过改 state 削弱依赖或检查。

主 Agent 根据真实结果将当前 state 写为 ready_to_sync/candidateHead，生成索引，归档证据并提交，然后：

```bash
node scripts/local-task.mjs index
node scripts/local-task.mjs gate workflow-local
```

gate 核对源码/合同、干净输入、索引、已合入依赖、每项最新命令的 PASS/退出码/实测耗时/日志内容、包指纹和同候选独立审核。元数据本身仍须准确、脱敏，由协调者复核；归档之后源码有改动不能继续引用旧结果。全新 clone 缺本地日志/包时门槛不通过，需转移受控本地证据或重验，不能把仓库里的 PASS 文本当可信执行。

## 代码同步与保护

1. 本地 gate 与任务逐项要求全部满足后推送聚焦分支。PR 仅保存代码差异和 squash 入口，不上传执行日志、进度评论或标签；不自动触发远端验证/模型审查。
2. 核对准确远端 head，与 syncHead 相等；使用 `gh pr merge --squash --match-head-commit <syncHead>`。不使用 admin bypass、强推或直接向 main 推实现。实际保护/必需审查/人工验收仍有效；若需远端 CI 的保护尚未正式迁移，合并 BLOCKED，不忽略失败或未运行检查。
3. 合并后 fetch，确认 origin/main 的 tree 等于预期 syncHead tree，记录真实 mergeHead。completed 状态和归档记录在本地更新；随下一次受审代码同步提交，不能为写状态直接向 main 推送。

11 个 Actions 保留为 workflow_dispatch 手动备用，现有 inputs/jobs/验证断言不变。手动运行由明确需求触发，不把普通开发回退成远端等待。自动 Codex/其它 PR review App 与 Actions 分离；GitHub 代码 API 不提供该 App 用户级开关。无法核对/关闭时明确 UNKNOWN/待用户在对应仓库 App 设置关闭自动 review，不修改全局 Codex 配置。

## 事件与统计

现有 task-execution start/stage/finish 提供 task_start/stage_change/task_end，保留历史兼容；wrapper 提供 command_start/command_end。local-task 提供 candidate_frozen、实际验收 command_start/command_end，`mark` 提供 review_start/review_end/code_sync/task_complete/task_paused/task_blocked；每个事件只保留任务、声明角色、时间、branch/head、耗时/退出码和证据路径。

`node scripts/local-task.mjs report <task>` 在任务完成/暂停或需要统计时输出验收运行耗时与失败次数；`task-execution.mjs report <task>` 汇总原生工具跨度和任务阶段。两者观察窗口/数据来源不同，不相加估算 token、模型调用或有效劳动。没有可靠 token 字段记 UNKNOWN。Hook 不联网、不调用大模型、不读取认证/完整会话、不注入原始日志、不决策任务状态。
