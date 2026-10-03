# 从本地任务合同到候选验收与代码同步

[逐文件说明](../modules/local-task-acceptance.md) · [构建与测试](build-test-release.md) · [首页](../README.md)

源码清单固定于 main `2e7661a7f08e6a069f8bf4fb9c54b26e6de8f503`（2026-10-03）。#280 迁移本地验收流程，#281归档其合入状态，#282进一步明确证据复用；不是恢复 Reading、WXT 切换或路径修复。本文仅静态阅读，全部运行验证 **NOT_RUN**，没有执行 freeze/run/gate、安装 hooks、修改配置或重跑归档测试。

## 入口、参与者与结果

这是开发工作流，不是扩展用户的翻译 task。协调者从 `docs/tasks/<id>/task.md` 和 `state.json` 读取范围、依赖及命令，提交候选后调用 `scripts/local-task.mjs`。结果是与 candidateHead 关联的本地命令证据、实际包身份和审核绑定，最终允许协调者考虑代码同步；没有自动 PR、合并、发布或产品验收。

职责链：合同/状态 → 冻结候选 → 实际命令与日志 → 可选实际包指纹 → 真实独立审核 → 索引及 gate → 人工协调代码同步。旁路 `task-execution` 只观察阶段/工具和耗时；hook 不推进状态。

## 1. 合同与状态只保留一个事实来源

`task.md` 描述目标、非目标与人工验收；`state.json` 的 dependencies、validationCommands、artifactRequired 是机器要求。主 Agent 单写状态，子 Agent 报告实际结果；`index.json` 由脚本生成，不是另一份人工任务队列。[规范](../modules/local-task-acceptance.md#file-local-workflow)要求 working → reviewing → ready_to_sync → completed，修复回到 changes_requested/working，也可 paused/blocked。

这里的箭头是协调规范，脚本没有自动状态机，也不验证所有中间转移。`finish pass` 是记录器的声明结果，`mark task_complete` 是生命周期事件；二者都不会把 state 变为 completed。completed 还要求真实 main 合入及任务所有要求完成，必须保留 mergeHead。

[当前索引](../modules/local-task-acceptance.md#file-task-index)中 workflow-local 已 completed；234、248、path-safety 仍 paused，235/236 blocked。历史 completed 任务的导入记录不能等价为当前 main 的新验收。

## 2. 为什么先提交再冻结

`freeze` 要求干净 Git status，HEAD 包含本地已 fetch 的 origin/main，并逐个核对 tracked blob 的实际磁盘字节及 Linux executable 位。这一步不会自己 fetch；过时的 origin/main 仍是过时的事实。冻结输出 candidateHead、完整 Git tree、排除当前任务四种归档文件后的 inputTree，以及 Node/npm 环境、空 checks 和空 artifact；browser 初始明确 NOT RUN。

candidateHead 是待测源码；syncHead 是以后归档证据的提交。允许差异仅为当前 task 的 state.json、acceptance.json、review.md 及 docs/tasks/index.json。task.md、其他任务文件、源码、测试、lock、workflow、脚本均不在例外中。state 虽可归档，冻结的三项机器要求仍单独和 candidate 中的 state 对比，不能删除必需测试或改依赖蒙混通过。

每次命令前后及 gate 再验证祖先关系、tree/inputTree、非归档修改、非 ignored untracked 和真实 tracked 字节。Git assume-unchanged/skip-worktree 不会掩盖已跟踪源码的磁盘变更。不过 ignored 生成输入不在全部 tracked 字节校验内，环境和外部工具也不是 inputTree；实际包另有 fingerprint。见[机器边界](../modules/local-task-acceptance.md#file-local-task)。

## 3. 实际执行与失败证据

`run <task> -- <argv>` 只允许与 state 中某条 argv 数组完全相同的命令，用 shell:false 启动，不能把任意 shell 文本当已批准命令。对新实现候选，完整 `npm run validate` 必需；浏览器/词典/升级测试按实际合同增加，validate 自身仍不包括它们。

stdout/stderr 同时转交终端并写入本地独立 UUID.log，hrtime.bigint 测单调耗时。只有 exitCode=0、无 signal、日志完整、执行前后输入未变，才记录 PASS；缺 executable、非零退出、信号终止、日志超过 64 MiB/写失败、命令中源码变化都不能成为 PASS。checks 追加记录，gate 对每种要求选最后一次，不能拿旧成功掩盖后一次失败。

日志是 gate 的必要证据，保存在忽略目录，不随普通代码 clone 到另一台机器。丢失/篡改日志、用带 ../ 的任务卡伪装日志、链接逃逸均拒绝；不能只凭 acceptance 中 PASS 文本或 GitHub 归档重新声称本地 gate 可通过。适用命令须使用合成数据/mock，不把认证或私有内容送入完整日志。

SIGINT/SIGTERM 在 POSIX 转发给该命令自己的进程组；Windows 仅直接子进程。转发信号是请求，不是保证任意程序退出；没有强杀升级，也不能靠记录一个 Interrupt 宣称已取消。最终 check 依真实进程结果，缺结束记录不能推定成功。

## 4. 包与独立审核绑定同一候选

任务要求实际包时，构建后使用 artifact 子命令读取 `dist/extension` 或 `.output/chrome-mv3`。它递归排序文件、逐文件 SHA-256、拒绝符号链接/非普通文件并要求 manifest 存在，保存树 fingerprint；gate 重算一致才接受。它不构建、不清理、不验证 Manifest 全合同，也不证明包一定由 candidate 源码生成。两种产物根的含义见[构建章](build-test-release.md)。

特别注意：local-task fingerprint 与 E2E inventoryArtifact 都叫 treeSha256，但串行化不同；local-task 用换行连接且末尾没有换行，E2E 每项末尾都有换行，遍历排序实现也独立，不能直接比较或互换。详见[指纹公式](../modules/local-task-acceptance.md#fingerprint-boundary)。

真实未参与实现的 dev_reviewer 审查 candidate 和实际 diff，再写 review.md 机器注释。gate 只解析 task、candidateHead、PASS、role=dev_reviewer、independent=true；无法验证是谁写的、模型/权限是否正确或审核是否真的独立。人工产品验收、limitations、补充证据和 reviewer 真实运行记录仍须协调者核对，不能以 JSON 布尔值替代独审。

## 5. gate 成功之后仍要正确同步

gate 要求 state/acceptance/review 同一候选、fresh index、每个 dependency completed 且 mergeHead 是本地 origin/main 祖先、全部最后一次命令通过且日志 hash 相等、所需实际包存在/一致、审核声明通过、当前 status=ready_to_sync。它返回 candidateHead 和当前 HEAD 作为 syncHead，只读 Git，不 push/merge。

协调规范接着要求：推送授权分支、核对准确远端 head=syncHead、受保护 squash 时绑定 expected head；真实保护/必需审查/人工验收不因本地 gate 消失。合并后 fetch，核对 main tree 与同步 tree，写真实 mergeHead/completed；状态归档走以后受审同步，不直接向 main 推元数据。

[11 个 Actions](../modules/local-task-acceptance.md#partial-manual-workflows)现都只有 workflow_dispatch；PR/push 不再自动运行 quality/E2E。手動备用保留原 jobs/inputs，定义存在不代表运行通过。自动 PR Review App 是独立设置，不由 workflow YAML 或 local gate 控制。归档任务说用户已关闭，但没有独立 App API 验证，不能把它推广为脚本能力。

## 6. 被动 hooks 与两类报告

项目 `.codex/hooks.json` 和模板调用 task-execution.mjs hook，收到输入后只持久化允许字段并输出空 JSON。安装定义不证明当前会话已信任、加载或实际触发；本文不安装/启用。SessionEnd/Interrupt 3 秒，其余事件 5 秒，仍有 Node 启动和文件 I/O 成本。

显式 start 绑定 task/attempt，PreToolUse 将匿名 session/tool call 与当时上下文保存为 pending 文件。即使暂停、切任务、重启同任务或 finish，迟到 Post 仍归原 attempt；没有 Pre 的 Post 进入 unassigned-hooks，不借用新任务身份。缺 Post 留 unmatched；Stop/Interrupt 不自动完成任务、不终止 wrapper。

`task-execution report` 汇总闭合壁钟任务/阶段、工具 Pre/Post、单调命令跨度和明确失败；壁钟倒退记异常，未闭合不猜结束。工具并发相互重叠、wrapper 与 hook 可观察同一次命令，不能相加成有效劳动。模型请求/token 未提供就 UNKNOWN，observed turns 不是模型调用数。

`local-task report` 仅报告当前 acceptance.checks 的次数、失败和每条实测耗时，freeze 重置 checks 后不再代表全部历史；旧事件/日志仍在 local。两个工具的存储形态与统计窗口不同，不互喂原始事件或重复嵌套 wrapper。

## 测试与最小修改入口

[local-task tests](../modules/local-task-acceptance.md#test-local-task)用临时 Git 仓库覆盖候选/归档、隐藏磁盘变更、日志缺失/篡改、审核声明、依赖、包和手动入口；[记录器 tests](../modules/local-task-acceptance.md#test-task-execution)覆盖隐私、并发、迟到 Post、未知结果、时钟回退和 POSIX 后代进程中断。它们是源码断言，本轮 NOT_RUN，不是产品验收。

改任务要求从 state/合同入手并重新冻结；改门槛看 local-task 与负例；改观察字段同时看 recorder/report/hooks/privacy tests；改命令/产物查看 package、构建章与真实合同。不要为导读创建第二套 task card 或运行任何验收命令。


## 发布前增量：纯文档和归档不重复整套实现流程

main2e7661只修改AGENTS/CONTRIBUTING/LOCAL_WORKFLOW，没有修改脚本。当前规范要求先判断实际diff与有效证据：纯文档校对路径、命令、语义和交叉引用；符合当前任务四类元数据白名单且源码/合同/机器要求不变的归档复用原candidate验收与独审，不改绑旧结论。合并前归档仍走gate；合并后只更新completed记录时，核对原sync与真实merge tree、祖先与输入/index，不把completed改回ready_to_sync强行过门槛。白名单外变化、缺失证据或新风险停止复用。涉及安全/权限/验收规则的文档改变仍按影响审核，实际保护和人工门槛保留。
