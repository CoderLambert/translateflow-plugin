# 本地任务执行流程

任务合同、执行状态和验收以本目录为准。验收后由主 Agent 自查，不自动启动审核 Agent；历史任务卡中要求 dev_reviewer/模型独审的执行条款由本规则替换，实际外部必需审查和人工验收仍保留。Git 管代码基线，GitHub 只用于代码备份、PR 差异和受保护 squash 合并。日常不调用 Issue、评论、标签、CI 状态或 Review API。迁入的历史合同保留产品、安全、硬依赖和人工验收；其中旧远端调度文字已由本规则替换。

## 文件与所有权

- `<task>/task.md`：目标、范围、验收与限制，没有合同变化不重写。
- `<task>/state.json`：主 Agent 单写。dependencies、validationCommands、artifactRequired 是机器可执行验收要求，合同中只引用，不另建状态机。更改要求时重新绑定任务合同；用户授权的验证范围收窄须说明依据和既有覆盖，不能把未解决失败或数据/安全问题排除出验收。
- `<task>/acceptance.json`：准确 candidateHead/tree、环境、实际 checks、单调耗时、日志 hash、实际包 fingerprint 和限制。
- `<task>/review.md`：可选的自查或历史审核记录，写明实际主体与准确 head；不要求模型审核，不把自查写成独审通过。
- `index.json`：从每个 state.json 生成的只读投影。`node scripts/local-task.mjs index`；禁止手工维护。
- `../task-execution/local/`：Git 忽略的原始事件、完整日志、截图和备份。禁止提交原始私人信息；日志丢失时本地 gate 拒绝同步，不补造 PASS。

状态：working → reviewing → ready_to_sync → completed；问题修复为 changes_requested → working。暂停/阻塞使用 paused/blocked，保存下一动作。状态由协调者根据真实结果写入，Hook 不判断。completed 必须满足本任务验收、实际合入 main 并记录 mergeHead；编写完成、PR、测试通过均不能单独作为完成。依赖要求 completed 且 mergeHead 为已 fetch 的 origin/main 祖先。

2026-10-03 迁入范围是 #191/#229 的索引、已完成前置 #227/#245–247/#249/#230–233，以及未完成 #234/#248/#235/#236 和必要路径安全修复。Epic 的后续章节只是历史合同，#237–244/#250–256 未获启动授权。产品开发当前暂停；本轮仅实施 workflow-local。旧闭合任务保留实际合入 SHA，但没有重新运行/改绑历史测试，acceptance/review 明确 NOT RUN。路径与 #234 未提交修改备份在原主工作区的本地目录，未经授权不覆盖或继续。

## 最小执行与证据复用

- 先判断实际 diff 与已有证据。每次追加读取、命令或 Agent 调用应解决一个未决问题；相同输入已有有效结果就复用。只在输入变化、失败、证据缺失/失效或有具体未解决风险时重做受影响检查；说明触发原因，不为提交、会话恢复或普通子步骤重复执行整条流程。
- 小任务由主 Agent 直接完成；委派限于确有价值的独立实现或定位，不为展示分工拆任务。角色已核对时不重复发现或跑空任务；不为生成状态、摘要或搬运证据额外调用模型。验收后由主 Agent 自查，不再自动委派第二轮模型审核。
- 开发和修复阶段按最新 diff 做定向验证；PR 后、合入前仅执行一次完整验收。冻结、提交、归档或会话恢复不触发全量测试。已有完整结果时，只补失败项及其受影响依赖，未变化输入的 PASS 继续复用。纯文档改动检查实际 diff、路径、命令、交叉引用和规则一致性，不安装无关依赖、不构建扩展或跑浏览器。任务卡、验收要求及涉及权限、安全、审核/合并门槛的规范变化仍由主 Agent 核对实际影响，不能借“文档”降低要求。
- 核对 Git 基线后保留本轮结果；有远端代码变化迹象或到合并边界才再次刷新，不循环查询同一状态。日常不查询 GitHub Issue/评论/标签/CI。独立读取可批量进行，只读取相关片段，不反复加载原始日志或整段历史。
- 沿用现有任务卡、脚本和状态机。完成记录优先随下一次已授权同步归档；用户要求单独同步时做最小归档，不为归档新建递归任务、重复冻结/验收/模型审核或继续生成下一轮待归档记录。除用户明确要求或实际功能缺口，不增加平台、Hook、检查脚本、流程层级或重复文档；满足验收及本次授权后结束。

纯元数据归档仅允许当前任务的 state.json、acceptance.json、review.md 和生成 index.json 的事实记录变化。主 Agent 核对实际 diff、索引、原候选证据、未变化的源码/合同输入指纹及真实合入 SHA；不改 candidateHead，不改写独审结论，不降低 dependencies、validationCommands、artifactRequired 或人工验收。条件满足时复用原验收证据，不再调用模型审核或重跑完整 validate；复用不代表新归档提交获得了独立审核。

合并前归档仍执行现有 gate。合并后仅更新完成记录时，保留原实现 mergeHead 和验收/审核绑定，核对原 syncHead 与实际 squash 合入的 tree 一致、合入提交属于当前 main，再校对上述输入指纹与生成索引；不将 completed 临时改为 ready_to_sync 来强行通过 gate。缺失证据、出现白名单外修改或验收要求变化时停止复用，按影响恢复验证。准确远端 head、实际分支保护/必需审查、人工验收和合并后核对始终保留。

## 按改动选择验证

| 最新改动 | 必要检查 | 复用内容 |
| --- | --- | --- |
| 文档、任务状态、证据归档 | diff、路径、命令和事实校对 | 全部未受影响的测试、构建和浏览器结果 |
| 纯函数、局部业务逻辑 | 对应 Node/Vitest 测试；TS 改动加类型检查 | 无关单测与用户流程 |
| UI、Content、异步消息 | 对应单测和涉及的 E2E 文件/用例 | 未触及的浏览器故事 |
| 测试 fixture | fixture 测试及消费它的场景 | 未变化的生产安装包和词典 |
| Manifest、构建入口、资源映射 | 一次真实构建/审计及受影响消费者、升级场景 | 未变化语料的词典编译产物 |
| 词典输入/编译器/格式 | 受影响包的编译、完整性和相关认证 | 其它词典包及未变化产物 |

扩大范围须有可核对原因，例如跨模块契约、权限、存储迁移、默认构建切换、失败指向共享路径或缺失覆盖。没有这些原因不追加全量 validate、全量 E2E、下载、词典编译、审核 Agent 或新流程工具。相同生产输入只构建一次；验证多个消费者优先读取同一已审计包，不为每个测试重建。词典输入、source lock、编译器和格式未变且现有产物校验有效时不重编译。

复用须记录原 testedHead、命令、结果、日志/hash、受影响输入或包 fingerprint，并核对最新 diff 未改变这些输入。新候选可以有新的 scoped check，不能把旧执行改写成新执行，不能把 FAIL 改为 PASS。失败项的单独重验仅解决对应失败；未解决失败保持 FAIL/BLOCKED，不靠收窄范围隐藏。改变输入后只废弃依赖它的证据，不废弃整组无关 PASS。原始日志丢失或实际输入无法确认时，只补缺失的相关证据。

## 开发、冻结、验收与自查

以下是实现任务流程；纯文档及满足上述条件的元数据归档只执行其适用步骤。

1. 读本地任务卡，核对 Git 修改、分支、worktree、HEAD；按需要一次 fetch，不读取每日 GitHub 状态。独立工作区先确认，共享文件单一写入者；保留已有修改。
2. 开发中运行受影响测试。已有记录工具的 start/stage/finish 继续使用，事件只是观测；不为每个普通步骤额外调用模型。实际命令不重复嵌套 wrapper。
3. 将候选源码、任务合同和初始状态提交并建立 PR；开发阶段选择相关检查，合入前完成一次完整验收。工作区 clean，确认 HEAD 包含 origin/main，然后冻结（脚本拒绝遗漏 main 提交）：

   ```bash
   node scripts/local-task.mjs freeze workflow-local
   node scripts/local-task.mjs run workflow-local -- npm run validate
   ```

   使用根据当前 diff 和已有证据选定的 validationCommands；脚本不再强制每个候选含完整 validate。仅因代码提交或修复失败不得重新运行全部检查。UI/交互只运行受影响的真实 Chromium E2E；WXT 构建用实际 WXT 包；升级在临时 profile 同 ID 旧包→新包→重启，保留设置/cache/合成词典；词典、取消、存储、安全按任务保留对应回归，不用 mock 替代明确人工验收。不能运行的检查记 NOT RUN，失败记 FAIL。脚本计时，不估算，UNKNOWN 不填 0。environment.browser 在实际浏览器运行后填确切版本，未运行留 NOT RUN。
4. 需要实际安装包时完成构建后记录：

   ```bash
   node scripts/local-task.mjs artifact 234 .output/chrome-mv3
   ```

   只接受实际 `dist/extension` 或 `.output/chrome-mv3`；逐文件内容 fingerprint，拒绝 links、不修改包。产物变化使 gate 失败。任务还有逐项产品/人工验收时，在 acceptance 的 limitations/补充结果明确记录，协调者逐项判定；脚本通过不是产品验收自动签字。
5. 主 Agent 对照验收合同与准确候选的实际 diff 自查，记录未解决问题和未验证项。没有新输入或具体问题，不自动委派审核 Agent，也不重复已通过的验证。修复后只重验受影响部分；自查不声称独立审核。

## 候选 SHA 与证据归档

候选必须先提交再测，避免“测过脏树但没有可审代码”。acceptance 生成后是元数据修改：它不可能同时包含自身未来 commit SHA。

candidateHead 是实际测试的提交，syncHead 是归档提交和远端 expected-head。两者必须有 Git 祖先关系，且完整输入指纹一致；冻结、命令前后和 gate 逐文件校对真实磁盘输入与 Git blob，不依赖可被 assume-unchanged/skip-worktree 隐藏的 Git status。当前 Linux 使用精确字节和可执行位；CRLF 转换/Windows 该门槛 NOT VERIFIED，不能宣称跨平台。只允许**当前任务**的 state.json、acceptance.json、review.md 以及生成 index.json 的差异。task.md、其它任务文件、源码、测试、package/lock、workflow、脚本、构建输入的任何变化都使旧候选失效。冻结后的机器验收要求另与候选 state 比较，不能通过改 state 削弱依赖或检查。

主 Agent 根据真实结果将当前 state 写为 ready_to_sync/candidateHead，生成索引，归档证据并提交，然后：

```bash
node scripts/local-task.mjs index
node scripts/local-task.mjs gate workflow-local
```

gate 核对 state/acceptance 的同一候选、源码/合同、干净输入、索引、已合入依赖、每项最新命令的 PASS/退出码/实测耗时/日志内容和包指纹。元数据本身仍须准确、脱敏，由协调者复核；归档之后源码有改动不能继续引用旧结果。全新 clone 缺本地日志/包时门槛不通过，需转移受控本地证据或重验，不能把仓库里的 PASS 文本当可信执行。

## 代码同步与保护

1. 可先推送聚焦分支建立 PR；完整验收在 PR 后、合入前执行一次，本地 gate 和任务逐项要求满足后才合并。PR 仅保存代码差异和 squash 入口，不上传执行日志、进度评论或标签；不自动触发远端验证/模型审查。
2. 核对准确远端 head，与 syncHead 相等；使用 `gh pr merge --squash --match-head-commit <syncHead>`。不使用 admin bypass、强推或直接向 main 推实现。实际保护/必需审查/人工验收仍有效；若需远端 CI 的保护尚未正式迁移，合并 BLOCKED，不忽略失败或未运行检查。
3. 合并后 fetch，确认 origin/main 的 tree 等于预期 syncHead tree，记录真实 mergeHead。completed 状态和归档记录在本地更新；随下一次受审代码同步提交，不能为写状态直接向 main 推送。

11 个 Actions 保留为 workflow_dispatch 手动备用，现有 inputs/jobs/验证断言不变。手动运行由明确需求触发，不把普通开发回退成远端等待。自动 Codex/其它 PR review App 与 Actions 分离；本轮可用接口未核对到该 App 开关。无法核对/关闭时明确 UNKNOWN/待用户在对应仓库 App 设置关闭自动 review，不修改全局 Codex 配置。

## 事件与统计

现有 task-execution start/stage/finish 提供 task_start/stage_change/task_end，保留历史兼容；wrapper 提供 command_start/command_end。local-task 提供 candidate_frozen、实际验收 command_start/command_end，`mark` 提供 review_start/review_end/code_sync/task_complete/task_paused/task_blocked；每个事件只保留任务、声明角色、时间、branch/head、耗时/退出码和证据路径。

`node scripts/local-task.mjs report <task>` 在任务完成/暂停或需要统计时输出当前 acceptance 的验收运行耗时与失败次数（不冒充全部历史；历史事件保留在 local）；`task-execution.mjs report <task>` 汇总原生工具跨度和任务阶段。两者观察窗口/数据来源不同，不相加估算 token、模型调用或有效劳动。没有可靠 token 字段记 UNKNOWN。Hook 不联网、不调用大模型、不读取认证/完整会话、不注入原始日志、不决策任务状态。
