# 本地验收、执行记录与被动 hooks 逐文件说明

清单基线：main `d5246cae6469e4a876fc122b229a2e0ddf115709`；本轮完整复核 local-task、其测试、LOCAL_WORKFLOW 与 index，其余未变 blob 保留旧固定引用。历史 workflow-local 归档按当时规则解释，不是当前必需门槛。原源码基线 `9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0`，2026-10-03。对应[完整工作流](../features/local-task-acceptance.md)。本章完整解释 17 个文件；其他迁入任务卡与大型规范/认证流水线只登记局部或待解释，不能因使用同一模板算完成。全部运行验证 **NOT_RUN**。

<a id="file-local-task"></a>
## scripts/local-task.mjs：候选绑定、命令证据与同步门槛

[完整源码](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/scripts/local-task.mjs)。

本地 CLI 依赖 Node child_process/crypto/fs/path/url 和已有 Git/npm，无网络或模型调用，也不自动修改 Git。导出 buildIndex、inputTree、freeze、runCheck、fingerprint、gate 供测试调用；CLI 通过 import.meta.url 判断直接入口，错误打印 local-task 前缀并退出 1。

**路径与写入。** ID 限定字母数字开头、后续字母数字点下划线横线、长度最多 80；candidate SHA 限 40 位十六进制。safePath resolve/relative 拒绝 workspace 外路径及逐级 symlink；readEvidence 用 NOFOLLOW 文件描述符，必须普通文件且最多 64 MiB。save 以 UUID 临时文件 exclusive/0600 写入再 rename，不删除输出树。证据目录 0700；events 使用 append/NOFOLLOW、检查实际 fd 是文件。无恶意并发文件系统的全面隔离保证，尤其路径父层检查与后续打开并非单一原子动作。

**输入和快照。** load 检查 schema/task、非空合法字符串 argv 列表及 dependencies 数组；不要求固定 validate 命令。archiveFiles 只排除当前任务 state/acceptance/review 和全局 index。inputTree 对 git ls-tree -r -z 的其余原始条目连接后 SHA-256，含路径/mode/type/blob 身份，不是包树 hash。assertWorkingInputs 不相信 status：只接受 tracked 普通 blob 模式 100644/100755，按 Git blob header 加磁盘 bytes 重建对象 hash，POSIX 另检查可执行位。Git symlink/submodule 输入不支持；Windows 不查可执行位，CRLF 工作树可能与 Git blob 不同，不能宣称跨平台验证完成。

**冻结及失效。** freeze 要求整个 status clean、当前 HEAD 包含 origin/main，然后比对磁盘，记录 candidate/tree/inputTree、UTC frozenAt、Node/npm/browser NOT RUN、空 checks/artifact/limitations，并发 candidate_frozen 事件；不自动把 state.candidateHead 改成候选。ensureCandidate 检查 candidate SHA/task、origin/main→HEAD 与 candidate→HEAD 祖先、candidate tree/inputTree 及当前 inputTree；比较候选 state 的三项机器要求和当前 state，拒绝非归档 tracked diff/非 ignored untracked，最后再次查磁盘。未跟踪但 ignored 资源、工具版本/环境、外部输入不因这个 tree 成为可信源码。

**实际命令。** runCheck 先确保候选和准确 argv 在白名单。UUID.log exclusive 创建，stdout/stderr 既流向终端又顺序写同一个 log；累计超过 64 MiB 后停止保存新 chunk、继续转发并判日志不完整。使用 hrtime.bigint，shell:false、stdin ignore、POSIX 新进程组。SIGINT/SIGTERM 只转发该组，Windows 直接 child；无 timeout/强杀升级，不能保证忽略信号的命令退出。spawn error 按 127；close 带真实 exitCode/signal。结束移除监听、关闭 fd，复查输入，读取日志 hash；只有 exit0、无 signal、日志完整且输入未变才 PASS，追加 check 并发 command_end。日志写入/后验拒绝可令 exit0 仍 FAIL；CLI 最终映射为 0/1，而 check 保留原退出信息。并行验收/冻结没有文件锁，须协调者串行归档，不把这些 read-modify-save 当事务数据库。

**索引。** buildIndex 枚举 docs/tasks 的合法目录，读取 task 匹配的 state，投影 task/status/dependencies/branch/candidateHead，缺省后两者 null，按 en numeric task 排序。它不复制 mergeHead、下一动作或全部验收要求；gate 再从依赖 state 读 mergeHead。index 子命令用 save 更新生成文件。

**gate。** ensureCandidate 后要求 state.candidateHead=acceptance、当前 index 与 buildIndex JSON 顺序一致；每个依赖合法 ID、completed、真实格式 mergeHead 且为 origin/main 祖先。每条 validationCommand 用 findLast 找最后 check，必须 PASS、同候选、exit0、无 signal、有限非负 duration。log 必须是规范化的当前 task 证据目录内 .log，readEvidence/hash 一致。artifactRequired 要求 artifact；有 artifact 时无论是否必需都重算。当前 gate 不读取 review.md，也不检查 role/independent 或审核 PASS；review.md 可选记录主 Agent 自查或历史审核。最后 state 必须 ready_to_sync。返回 PASS/candidateHead/syncHead/inputTree 与“仅本地证据”的 note，不检测远端 PR head 或合并保护。

**其他入口。** artifact 不构建，仅记录允许根的 fingerprint；mark 仅接受 review_start/review_end/code_sync/task_complete/task_paused/task_blocked 并写事件，不改 state。report 只读当前 acceptance，返回 checks 总数/FAIL 数、每项命令与耗时，modelRequests/tokens 字符串 UNKNOWN。freeze 重置 checks，原日志不删除；report 不聚合历史 events。

**限制与影响。** check、review JSON/注释和环境仍是本地文件，hash 防止一般丢失/变更不构成防恶意伪造的签名系统。limitations/supplemental、人类验收和主 Agent 自查不由 gate 自动验证。修改排除集、归档三项要求、路径/日志边界须联动 local-task.test.mjs 全组反例与 LOCAL_WORKFLOW；改命令/产物要求另查构建章。完整日志可能含命令输出中的私密信息，不能从旁路 hook 的“无 stdout”承诺推导它会自动脱敏。

<a id="fingerprint-boundary"></a>
### 包 fingerprint 与 E2E hash 不是同一协议

fingerprint 只接受精确 `dist/extension` 或 `.output/chrome-mv3` 字符串；逐目录 .sort() 遍历，只读普通文件、拒 link，要求至少一文件和 manifest 存在。每项是相对 POSIX 路径 + NUL + 文件 SHA-256，items.join("\n") 后 SHA-256，没有末尾换行。它不检查 manifest JSON 内容、生产 allowlist、构建 provenance 或产品行为，空目录/文件 mode 不进入包 fingerprint。

[已解释 E2E adapter](build-test-release.md#file-production-artifact)的 inventoryArtifact 通过 byteSummary 得到排序文件，每项 path + NUL + hash + 换行，再连接 SHA-256；连末项也有换行。二者即使同包仍不能交换 treeSha256。修改任一算法须保留各自上下文、更新相应 fixture 与证据消费者，不能简单复制另一报告 hash。

<a id="file-execution-cli"></a>
## scripts/task-execution.mjs：显式阶段 CLI 与观察型 wrapper

[完整源码 L1–L93](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/scripts/task-execution.mjs#L1-L93)。

导入 createRecorder/commandKind/gitSnapshot、summarize/markdown。root 固定脚本上级。start/stage/finish 调 recorder；report 读取指定任务，可 JSON 或 Markdown；不写 docs/tasks 状态、审批或 Git。start/finish 的 pass 等是声明值，不能授权 merge。

run 要求 `-- executable args` 和 active context，更新一次 Git snapshot，发 command_start 的 UUID span/类别；shell:false 原样 argv、stdio inherit，所以输出可见但不被该记录器复制到 JSONL。POSIX detached group，转发 INT/TERM，pendingSignal 补偿 spawn 前到达的信号；Windows 仅直接 child。error 127，close 保留 code/signal；command_end 以同进程 hrtime 测量。终止 exit code 根据 128+系统信号编号；若记录 end 失败，给固定诊断且成功命令也将 wrapper 置 1，提示另查真实结果。信号转发不等于任意子树必然退出，且没有 escalation。

hook 从 stdin 分块最多读取 16 MiB JSON；无效输入或 recorder 失败只输出固定错误诊断，stdout 始终 `{}`，不会回显 payload、改工具输入、注入上下文、触发续写或在代码上以异常阻塞原工具。客户端协议/信任及超时能否实际调用仍须原生事件验证。普通 CLI 参数/操作异常给通用错误并退出 1。修改信号/错误处理同时验证 recorder 隐私、缺 executable、非零退出及 Linux 后代中断测试；不要与 local-task run 嵌套重复计时。

<a id="file-execution-recorder"></a>
## scripts/task-execution-log.mjs：任务上下文、匿名关联与有限事件

[完整源码 L1–L169](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/scripts/task-execution-log.mjs#L1-L169)。

createRecorder(root) 闭包持有固定 docs/task-execution/local 位置，磁盘 context.json 承载单个活动任务；方法 start/stage/finish/active/hook/emit/read。STAGES 包含 baseline/experiment/implementation/validation/review/fix/ci/sync/merge/checkpoint，RESULTS 为 pass/fail/paused/blocked，HOOK_EVENTS 为配置中的 12 种事件。

start 校验短 task/具名角色，拒保留名 unassigned-hooks 与覆盖 active task；创建新 UUID attempt、baseline、Git head/dirty 后 emit，再原子替换 context。stage 相同不重复记录，否则刷新 Git 并记 previousStage；finish 刷新 snapshot、task_end 后 active=false。Git read 有 1500ms timeout，失败 head/dirty=null。角色是 CLI declaredRole，不是观测身份。

prepare 逐层创建 0700 目录并拒 symlink；文件 safeRead 用 NOFOLLOW、普通文件/64MiB 限制；saveJson exclusive temp/0600→rename；emit 每事件一次 append/0600，附 schema/id/UTC/task/attempt/stage/head/dirty，不重写日志。没有跨 start/stage/finish 的锁，规则要求唯一协调者串行；并发 hook 不写共享 context，但同 call 同时重复 Pre 的竞态不能由“独立调用并发 append”测试推导为完全消除。

hook 只消费允许事件。session/turn/toolCall/agent 字符串经 SHA-256 截 24 位用于关联，tool/model/agent_type 还须匹配 ID 格式。commandKind 只保存 validate/e2e/node-tests/unit/typecheck/check/build/ci-check/merge/push/commit/other 类别，不存完整 command；regex 是提示而非安全解析器，多命令可能只被归为首个匹配类别。response 仅读取整数 exit_code 和布尔 isError，不解析 output 文本。prompt、assistant 文本、原始 IDs、argv、输出、transcript path、环境不落盘；关联 hash 是伪匿名而非不可逆匿名保证。

Pre 为匿名 session/call 保存当时 ctx 到 pending 文件；存在 binding 时复用原 ctx。Post 必须用原 binding，完成 emit 后删除；没有 binding 归 unassigned-hooks，即使当前任务活跃也不借用。非 Pre/Post 有 active 时用 active，否则 unassigned。没有 toolCall 的 Post 无法匹配；缺 Post binding 留存，finish 不清它，允许跨暂停/切换/同任务新 attempt 的迟到结果归旧任务。Stop/Interrupt 只是事件，不自动 finish 或 cancel。

read 校验每行 schema/task/id/attempt/stage/date，用 event.id 去重，坏行 invalidLines++；不存在返回空事件，超 64MiB 文件拒绝而非无限加载。没有对所有 event.type/字段的完整 schema 校验，不是任意外部 JSONL 导入器。修改关联键、保留目录或隐私字段须联动 report 和迟到/孤立 Post、并发/坏行/隐私测试；不能把未记录信息推算成已知。

<a id="file-execution-report"></a>
## scripts/task-execution-report.mjs：闭合跨度统计与 UNKNOWN

[完整源码 L1–L113](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/scripts/task-execution-report.mjs#L1-L113)。

summarize 为纯内存聚合，输入 recorder.read 的 events/invalidLines，输出 schema/task/attempts/stageWallMs/commandRuns/tools、事件计数及异常。无 Git/网络/模型、无持久写入。task_start 建 attempt；stage_change/task_end 只对 open attempt 关闭上一阶段。Date.parse 差值非负才计阶段/任务 wallMs，负值或无效计 clockAnomalies，开放阶段不补到当前时间。任务结果仍是声明值。

span key 区分 command 的 attempt/span 与 tool 的 attempt/session/toolCall。重复 start 增 unmatched 并替换，end 无 start 增 unmatched，剩余 pending 再计 unmatched。command_end 使用传入单调 duration，保留开始时 kind/stage/head/dirty、实际 exit/signal 并判 pass/fail。工具按 Pre tool 归组，Post isError=true 或非零 exit 判 knownFailure；既无明确 false 也无 exit 时 unknownResults++。壁钟错误跨度不计正常完成耗时。

observedTurns 由匿名 session:turn 去重，另计 SubagentStart/PreCompact/PermissionRequest、观测模型/agent_type 与声明角色分别集合。clean head 同 kind 多次 command 仅成为 repeatedCleanHeadCandidates 提示，参数、环境/生成资源可能不同；不能据此删测试或断定浪费。modelRequests/tokens 恒 null，未用回合数估算。

markdown 输出 attempt/阶段/命令表和按工具总 wallMs 排名前十，null 秒为 UNKNOWN，明确阶段含等待、工具并发重叠。数据顺序沿日志而非另排时钟，wall、工具和 wrapper 观察可能重叠，不能相加当任务时间/CPU。修改字段须同步 CLI 文案、TASK_EXECUTION 与回退时钟/overlap/unmatched 测试。

<a id="file-project-hooks"></a>
## .codex/hooks.json：项目原生观察钩子

[完整源码 L1–L17](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/.codex/hooks.json#L1-L17)。

12 个 Hook 事件都用标准 command 调 Git root 下 task-execution.mjs hook；Pre/PostToolUse、PermissionRequest、SubagentStart/Stop、Pre/PostCompact matcher 是 `.*`，SessionStart/End、UserPromptSubmit、Stop、Interrupt 不配 matcher。SessionEnd/Interrupt timeout=3，其余=5。description 明确本地元数据、无模型/注入。Git root 命令替换允许从子目录定位，依赖 POSIX shell/Git/Node；Windows 安装未验证。

它声明执行入口，不承担任务识别、role 设置或审核决策；hook 本身错误的非阻塞策略在 CLI。项目/定义必须由用户信任、定义改变重新审阅，文件存在不证明当前会话重载。修改事件、命令路径、timeout 必须同步模板、文档和实际客户端核验；本轮不安装/启用。

<a id="file-hook-template"></a>
## docs/task-execution/hooks.json：可审阅配置模板

[完整源码 L1–L17](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/docs/task-execution/hooks.json#L1-L17)。

完整内容与 `.codex/hooks.json` 一致，保存同样 12 个事件、matcher、POSIX Git root 命令和 3/5 秒 timeout，用于版本化审阅/复制的参考；它不被 recorder 自动加载，也不能独立证明 project hook 生效。修改实际定义时应一起更新以免错误模板重新引入旧行为；运行事实由原生 JSONL hook 事件确认，测试/本文都没有替用户授予 trust。

<a id="file-log-ignore"></a>
## docs/task-execution/.gitignore：原始记录与汇总默认不入库

[完整源码 L1–L2](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/docs/task-execution/.gitignore#L1-L2)。

仅 `local/`、`reports/` 两条目录规则，对本目录生效。local 存完整命令日志/事件/context/pending/本地备份，reports 是按需生成的汇总；脚本、模板和规范仍跟踪。Git ignore 不是访问控制、脱敏或加密，也不阻止用户 force add/上传；已跟踪文件不因新增规则自动删除。gate 必须本机读本地证据，缺失不能用 Git 忽略作为豁免。修改规则影响隐私/clone 可复验性，不能为通过 gate 把原始日志批量纳入代码。

<a id="file-execution-readme"></a>
## docs/task-execution/README.md：记录目录导航

[完整源码 L1–L9](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/docs/task-execution/README.md#L1-L9)。

把操作/字段定义委托给 TASK_EXECUTION，解释 hooks 模板、local 原始记录/context、reports 按需摘要和默认 ignore；分享须审阅且精确提交所需摘要，避免事件制造 diff。强调不自动上传/送模型、不代替源码/验收/独审/合并门槛。其“Issue 状态”提法不建立另一远端同步职责；现行任务状态以 LOCAL_WORKFLOW 为准。改存储路径或分享流程必须同步实际脚本与 ignore。

<a id="file-task-execution-doc"></a>
## docs/TASK_EXECUTION.md：启用、指标与隐私操作规范

[完整源码 L1–L91](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/docs/TASK_EXECUTION.md#L1-L91)。

全文为开发者操作文档：项目 hook 与模板、CLI /hooks 的信任/重载要求；start 的短 task/声明角色、合法阶段、wrapper 的 shell:false/信号/真实输出、finish 的声明结果；按需 JSON/Markdown 报告及每指标来源；Pre/Post 原上下文绑定、unassigned、记录不完整/坏行/时钟/并发等限制；固定目录/权限/体积和不持久化原文；最后接入 local-task 完整验收日志。

文档记录当时核对 CLI 0.159.2/hooks feature，不等于每台机器状态。legacy stage ci 兼容、工具覆盖不完整、turn 非模型请求、重复 clean-head 非浪费、Windows/CRLF/command hook 未验证都不能省略。旁路不存输出，但 local-task 明确保存完整受审验证日志，两层隐私范围不同。修改 CLI/字段/阶段、信任要求或信号边界后一起更新这份规范，不用历史数字补未知观测。

<a id="file-local-workflow"></a>
## docs/tasks/LOCAL_WORKFLOW.md：合同到受保护同步的规范

[完整源码](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/docs/tasks/LOCAL_WORKFLOW.md)。

规定五类任务文件、主 Agent 单写 state、状态/依赖语义、准确候选与输入指纹、实际日志与可选包 fingerprint；review.md 是可选自查/历史记录，不再强制模型独审，历史任务卡的 dev_reviewer 执行条款由当前规范替换，外部必需审查和人工验收仍保留。

开发/修复按最新 diff 定向验证，PR 后合入前一次适用完整验收；有效未变证据复用，失败只重验相应依赖。源码、测试、构建/fixture、词典输入分别选择对应检查，同一生产输入不重复构建，词典输入未变且完整性有效不重复编译。脚本允许 scoped validationCommands，但收窄要求必须有授权、依据和原覆盖，不可隐藏失败。

candidateHead/syncHead 分离；仅当前 task state/acceptance/review 与全局 index 可作归档差异。保留原候选/日志/包身份，合入后核对真实 merge tree/祖先；completed 不改回 ready_to_sync 骗 gate。脚本不自动 fetch、不验证远端保护或产品/人工验收，不维护状态机。新 clone 无日志/包无法重演 gate，不补造 PASS。

文中“产品暂停、本轮仅 workflow-local”是迁入时历史范围说明；当前各产品事实须读准确状态与源码：234/path-safety 已 completed，248 默认切换已合入但 index 仍 ready_to_sync。后续 epic 不因入库得到执行授权。本导读不执行任何任务命令。修改流程应同步 CONTRIBUTING/AGENTS、local-task 与测试；保留实际保护。

<a id="test-local-task"></a>
## tests/local-task.test.mjs：临时 Git 正反例

[完整源码](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/tests/local-task.test.mjs)。

fixture 创建独立 tmp Git 仓库、合成 task 234、简化 npm validate、ignored local 与 origin/main，测试结束删除自己的临时目录。ready 执行真合成命令并设置 candidate/index，不写模拟 reviewer。16 个测试完整覆盖：

1. 命令实际退出/单调耗时/log hash，允许仅 archive 提交且 candidate≠sync。
2. 冻结拒未跟踪文件，gate 拒新增/已 stage/已提交代码。
3. 即便 clean，缺当前 origin/main 提交仍拒 freeze。
4. state 依赖/冻结的命令要求/任务正文更改不可削弱旧验收。
5. 删除 review.md 或写 NOT RUN 均不阻挡有效命令证据；清空 checks 仍拒，移除模型独审不等于取消真实验收。
6. 未授权命令、缺 checks、篡改 log、陈旧 index 均拒。
7. paused dependency 拒；8. completed dependency 仍须真实 main ancestry。
9. validate 非零真实 FAIL，不能过 gate；10. state/acceptance 不同 candidate 拒。
11. dangling event symlink 不得创建外部目标；12. 缺 log 和规范化目录穿越伪装 task.md 均拒。
13. assume-unchanged/skip-worktree 隐藏修改在 freeze、run 前及 gate 仍拒。
14. 包 bytes 改变 hash，任意根/包内 symlink 拒。
15. 11 个 yml 的 on 顶层仅 workflow_dispatch、jobs 存在，指定 base_sha/experimental input 仍存在。

16. 合同使用合法非 validate 的 scoped argv 时允许 freeze/run/gate；测试调用实际合成进程，不是绕过空命令检查。

第15项不逐字证明所有 job body 完全相同；标题中的“remain intact”要以具体断言为准。此测试也没有覆盖真正 reviewer 身份、远端保护、忽略生成输入全审计、Windows 或真实产品行为。修改脚本必须复查相应负例；本轮未执行，NOT_RUN。

<a id="test-task-execution"></a>
## tests/task-execution.test.mjs：观察、隐私、时序与信号

[完整源码 L1–L258](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/tests/task-execution.test.mjs#L1-L258)。

fixture 为每 test 独立 temp root，CLI 用三脚本副本；合成 sentinel 检测 JSONL 不含 prompt/argv/output/private path，测试后清理。14 个测试分别断言：阶段/start 不覆盖、pause/resume 新 attempt；allowlist/匿名 ID 与明确失败；无任务不猜绑定、无退出结果为未知、Interrupt 留 unmatched；坏 JSON 行/重复 event 去重/回退时钟/开放阶段；不安全 ID 和 symlink 拒；wrapper 真非零并不存 argv/output；缺 executable 127 与 child SIGTERM 143；16 个独立 hook 并发追加完整行；坏 hook stdin 仍 `{}`/0 且不泄露输入；分类器标签；overlap 工具 200ms 与 task 130ms 不混；迟到 Post 跨 paused/switch/restart/finish 归旧 attempt；孤立 Post 到 unassigned；Linux wrapper SIGTERM 杀自有组内可见后代。

最后一例等待后代输出 READY:pid 才终止 wrapper，通过 /proc 消失或 zombie 确认不再活跃，有 timeout/清理兜底，仅 Linux；不推广 Windows 树终止或任意忽略 TERM 的程序。并发测试是不同 turn，不是所有同 call 竞态证明。测试读取模型字段仅支持“有观测名”，不是完整权限/计费审计。全文仅静态解释，NOT_RUN。

<a id="file-task-index"></a>
## docs/tasks/index.json：17 项状态的生成投影

[完整源码 L1–L152](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/docs/tasks/index.json)。

schema=1/source=`*/state.json`，每项只有 task/status/dependencies/branch/candidateHead；由 buildIndex 投影与排序，gate 用 JSON 相等检查陈旧。它不含完整合同、人工验收、mergeHead/本地 log，必须回源文件取证。

本基线全部条目：191/229 paused epic 索引；227、230、231、232、233、245、246、247、249 completed；234 completed，branch main，依赖231/233；235 blocked，依赖233/248/249；236 blocked，依赖234/235；248 ready_to_sync，branch build/248-default-switch，依赖246/247/227/path-safety；path-safety completed；workflow-local completed。完成链中231/232依赖230，233依赖232，246依赖245，247/249依赖246。234 的 candidate 为72fc8cdd，path-safety 为c77e52e9；248 为e722652a。#284已合入默认构建，索引保留ready_to_sync不能覆盖实际代码事实。candidate非空也不等于本轮验收通过；workflow-local 保存实际受审候选，branch main。其他 null 字段不是推定工作区不存在，只是投影当前缺省。

修改某 task 状态后生成 index，不能只手填投影；本文只解释 index 这一个文件，不把全部17组 task.md/acceptance/review/state 自动计全覆盖。

<a id="file-workflow-task"></a>
## docs/tasks/workflow-local/task.md：迁移合同

[完整源码 L1–L13](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/docs/tasks/workflow-local/task.md#L1-L13)。

历史合同范围为主 Agent 单写本地任务/证据工具、规范与11个Actions触发，复用 hooks，不改 runtime/依赖/全局配置；dev_reviewer 独立只读审准确候选，保留234与路径修复工作。验收要求完整 validate、门槛正反例、手动 inputs/jobs 保全、真实234卡缺证据拒绝；外部保护/自动审查只一次核对，无法变更须记录限制。非目标明确不恢复产品、不重配Agent/平台、不用模型统计/上传日志。它是 workflow-local 合同，不是其他任务恢复授权；实际执行结果看下面三个文件。

<a id="file-workflow-state"></a>
## docs/tasks/workflow-local/state.json：completed 归档与精确 SHA

[完整源码 L1–L37](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/docs/tasks/workflow-local/state.json#L1-L37)。

schema/task/owner=main，status=completed，无依赖，branch main/worktree .；只要求 npm run validate，artifactRequired=false。candidateHead=926ab1e02d3b493494475a36d7ee1867fad02e21，mergeHead=a02e000e80148f28dd2992cea45ee8dab9cc0afc，syncHead=5d870f86b30c4ac524bf154513b01c5b06c3a28a。implementationBranch/PR280 追溯实施；localGate 保存 PASS/syncHead/本地证据引用，postmergeVerification 保存 PASS/实际 tree/11手动入口；没有把当前归档 main 9bea 写成受测 candidate。

nextAction 明确流程完成、产品保持暂停/阻塞，blockers空只适用于此任务。externalSettings 写用户确认自动 PR Review disabled，与 acceptance 的“无独立 App API 验证”一起读；不能据此说脚本关闭了App。本轮未复验这些历史 PASS，本机无其原始日志。completed 不满足 gate 最终 ready_to_sync，归档完成状态不是可直接再执行 gate 的全新验收。

<a id="file-workflow-acceptance"></a>
## docs/tasks/workflow-local/acceptance.json：受测候选的历史证据摘要

[完整源码 L1–L79](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/docs/tasks/workflow-local/acceptance.json#L1-L79)。

记录同一926ab1e候选、Git tree/inputTree、2026-10-03冻结时间、Node v24.21.0/npm11.19.0/browser NOT RUN。checks只有一次准确 npm run validate，历史 PASS/exit0/signal null/51385.220474ms、开始时刻、ignored log相对路径/hash；artifact=null，因为合同不要求实际WXT包。

limitations 单列浏览器E2E/真实WXT构建 NOT RUN、hook重载/当前触发 NOT VERIFIED、Windows/CRLF/hooks未验证、不接触真实用户profile/付费Provider/发布/产品续做。supplemental 为29个task/hook回归、独审反例及正常归档、11workflow body/input比对、暂停工作区保全、234缺证据拒绝的历史 PASS 摘要；它们不是 gate.validationCommands 中独立强制项。

reviewerRuntime 保存具名角色/观测model effort和权限，明确 danger-full-access/never 覆盖默认，仅行为只读；externalSettings 记用户确认 disabled 而无独立API证实。这些字段是归档资料，local gate不自动核验其真实性，也不将 supplemental 作为签名证明。更新必须保留准确候选/限制，不把本轮静态阅读改写成实测或泄露原始日志。

<a id="file-workflow-review"></a>
## docs/tasks/workflow-local/review.md：候选审核绑定与已知限界

[完整源码 L1–L22](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/docs/tasks/workflow-local/review.md#L1-L22)。

首行 local-review JSON 绑定workflow-local/926ab1e/PASS/dev_reviewer/independent true，是旧 gate 当时使用的历史绑定；当前 gate 已不读取此记录。正文说明baseline→初候选全量及后续8文件增量审核，角色权限仅行为只读。记录四项原反例修复：隐藏tracked磁盘差异、悬空event symlink、缺日志/穿越替代、state候选不符；同时保留正常归档成功。

正文归档独立29测试/临时fixture、diff、workflow及依赖/真实234负例，核对主Agent新候选validate/log hash但 reviewer 未重跑完整 validate。浏览器、原生hook当前触发、远端保护/设置/同步未验证，PASS不等于合入或发布。最后协调者补充用户已关闭自动review但仅改元数据，不能倒推 reviewer 独立验证了该App。本文解释文件表达什么，不重新认证旧执行事实；修改审核绑定必须源于真实新审核，不能为 gate 绿灯手填。

<a id="partial-manual-workflows"></a>
## 局部：手动 Actions 与旧章节的消费边界

全部11个workflow当前 on 只有 workflow_dispatch：quality、e2e、dictionary-library-vnext-certification、freedict-source-audit、lexicon-release、mdd-resources、rich-lookup-cancellation、rich-mdict-compatibility、wikimedia-wiktionary-source-lock、wiktextract-ingest、wiktextract-rich-poc。这里只解释触发变化，不把后三类来源流水线所有job算全文覆盖。quality/e2e完整内容见[构建章](build-test-release.md#file-quality-workflow)。

vNext 保留必填 base_sha 的手动输入；rich-poc 保留 run_experimental_full_extraction。历史 event-base 表达式仍在vNext job内，不代表它还监听PR/push。五个既有 partial CI 的具体命令仍需按当前 package 别名解释；默认 build 已转 WXT，不能沿用 legacy 消费结论；不能再用PR paths推定是否触发，也不能因没有自动run推定测试通过。源码链接与范围见构建章 partial-ci。

固定源码入口（这里只覆盖触发变化，未逐一解释完整 job）：

- [.github/workflows/dictionary-library-vnext-certification.yml L1–L191](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/.github/workflows/dictionary-library-vnext-certification.yml#L1-L191)
- [.github/workflows/e2e.yml L1–L54](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/.github/workflows/e2e.yml#L1-L54)
- [.github/workflows/freedict-source-audit.yml L1–L87](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/.github/workflows/freedict-source-audit.yml#L1-L87)
- [.github/workflows/lexicon-release.yml L1–L151](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/.github/workflows/lexicon-release.yml#L1-L151)
- [.github/workflows/mdd-resources.yml L1–L63](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/.github/workflows/mdd-resources.yml#L1-L63)
- [.github/workflows/quality.yml L1–L18](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/.github/workflows/quality.yml#L1-L18)
- [.github/workflows/rich-lookup-cancellation.yml L1–L51](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/.github/workflows/rich-lookup-cancellation.yml#L1-L51)
- [.github/workflows/rich-mdict-compatibility.yml L1–L45](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/.github/workflows/rich-mdict-compatibility.yml#L1-L45)
- [.github/workflows/wikimedia-wiktionary-source-lock.yml L1–L103](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/.github/workflows/wikimedia-wiktionary-source-lock.yml#L1-L103)
- [.github/workflows/wiktextract-ingest.yml L1–L104](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/.github/workflows/wiktextract-ingest.yml#L1-L104)
- [.github/workflows/wiktextract-rich-poc.yml L1–L240](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/.github/workflows/wiktextract-rich-poc.yml#L1-L240)

<a id="partial-policy"></a>
## 局部：现行仓库规范与认证源码断言

AGENTS、CONTRIBUTING、README、docs/ARCHITECTURE 的本轮新增/变更部分统一把验收移到本地task/候选；当前由主 Agent 自查，不自动模型独审，日志留ignored local、Actions只手动，真实合并保护仍有效；常规不查Issue/Review/CI API。#275导读自身的明确周期授权范围由该任务合同约束，不能把规范段落理解为任意额外远端写权限。上述大型文档其余产品/架构内容继续属于其他章节或待解释，本节不计全文覆盖。

tests/selection-release-certification.test.mjs 的第一测试仍检查各Selection fixture名、missing/corrupt/incompatible消息、真实产物adapter及release词典门；新增断言lexicon-release只有workflow_dispatch、无push/pull_request、保留JSON E2E命令。第二测试检查浏览器源码硬断言/Provider零调用/焦点/窄屏/诊断重试等标记；是源码存在性检查，不执行浏览器。此处只复核手动入口消费语义，仍保持partial。

tests/dictionary-ecosystem-v2-certification.test.mjs 对手动vNext流程新增dispatch/无pushPR/必填base_sha的源码断言；ready scope/基线先于E2E/仅published summaries的要求仍在。其大量认证证据变异与性能/取消算法未在本章逐一解读，保持partial。

其他16组迁入任务目录不能仅因4文件格式相同获得解释完成状态。后续应按各任务目标、依赖、验收与历史证据独立解读；本章不继承它们的PASS，不启动产品队列。

本节固定源码：

- [AGENTS.md](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/AGENTS.md)
- [CONTRIBUTING.md](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/CONTRIBUTING.md)
- [README.md](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/README.md)
- [docs/ARCHITECTURE.md](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/docs/ARCHITECTURE.md)
- [tests/selection-release-certification.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/tests/selection-release-certification.test.mjs)
- [tests/dictionary-ecosystem-v2-certification.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0/tests/dictionary-ecosystem-v2-certification.test.mjs)


本轮按 d5246ca 完整重读四个变动文件并改写上述说明；其他旧源码固定引用只代表 blob 未变或历史归档。当前 AGENTS/CONTRIBUTING 的自查与定向复用部分已核对，大型规范其余内容仍按局部计。没有运行脚本或重新认证任何旧 PASS。
