# [Reading Loop][RL-00][P0] 冻结执行合同、数据模型与分阶段验收基线

历史引用：[#230](https://github.com/CoderLambert/translateflow-plugin/issues/230)。2026-10-03 一次迁入；后续以本目录任务和本地证据为准。

## 流程迁移决策

下方是迁入的产品/工程合同。历史合同中的 Issue 评论/标签、远端 CI、自动 GitHub Review 和旧状态流不再是日常执行动作；统一采用 [LOCAL_WORKFLOW.md](../LOCAL_WORKFLOW.md) 的本地完整验收、真实浏览器/产物要求、具名独立审核及受保护代码同步。安全、数据、硬依赖与人工验收保持有效。原有“规划待启动”限制以用户本轮授权和 state.json 为准。

## 已完成基线与后续修订归属
Parent #229；RL-00 / Release A领域合同；原难度L3，rl-architect实现、独立rl-reviewer审核。

本任务的初版合同已由 PR #258 合入 main（merge f5ca42745a36aa70a6882b1b34753aa44ceb30ea）。保留本Issue closed/audited的历史语义；它不代表Reading产品已经可用。原始计划、执行证据和独立审核见本Issue评论及#258。

**2026-10-02后续审核发现的接口覆盖缺口，统一转入现有 #232 的 C1–C8 窄合同补丁。** #232本来就是后续消息授权入口，先修规范/纯validator，再接policy；不重开整个RL-00、不重复测量全部词库、不新建架构Epic。本次仅同步Issue正文，不声称代码已按新方案修改。

## 已交付的领域基线
- docs/READING_LOOP_V1.md及src/shared/reading/的纯合同、校验器、合成测试和容量测量。
- stable UUID ReadingRecord、不可变SourceSnapshot/ResultArtifact，dictionary/translation/assistant完整结果与来源；itemKey仅聚合并保留大小写。
- tf-source-utf16-v1原文投影、inline/block/Unicode映射、TextQuote证据、position hint及保守定位状态；无automatic fuzzy。
- consent/operation/revision/删除失效、cache与Reading独立、commit ack前不报saved。
- 10k记录/64 MiB canonical rows/64 KiB artifact等设计预算；真实DOM/IDB/产品流不由纯合同测试证明。
- B1–B7到#231–#244的实施/验收映射。

## C1–C8补丁须以#232最新正文为准
1. 消息protocolVersion=2与持久schemaVersion=1分开，首次接线前同步validator/caller；不改旧翻译cache。
2. 学习中心列表有界预览/上下文/问答数，页面最小摘要有hasCompletedAssistant；不靠N+1完整详情或自动读全文补字段。
3. export-start/next/finish/cancel分块协议，完整消息字节上限、一致性版本与下载交付边界；原单消息export-json不得直接接生产。
4. 开启记录走精确受信任学习中心；返回当前有效卡显式保存本次结果，不回填历史、不重发Provider。
5. 站点排除的窄接口、独立意图、唯一repository归属和撤销旧操作。
6. operation级计数与artifact级幂等分离；列表/导出修订号不复用清空代次；取消和提交有线性化顺序。
7. Understand/Analyze/Usage为产品动作，follow-up为轮次；首版只重新生成动作根，完整stream/prompt预算归D实现任务。
8. sender/document/private/sensitivity、安全URL及明确AI上传范围不退化；不声称后台能凭布尔字段证明人类手势。

补丁合入前，下游不能把这八项当已实现能力。#231可继续原文映射/选区身份，不被无关导出细节阻塞；#233及使用新消息的下游依赖#232实际合入。发现并发代码接入旧合同应由coordinator协调，不覆盖正在进行的分支。

## 保留的工程与验收规则
shared纯函数、Content暂行classic、Provider网络owner、auto-sites唯一注册器不变。独立Reading IDB adapter及check/AGENTS/CONTRIBUTING/ARCHITECTURE精确例外由#233完成；WXT/React/TS/i18n由#191必要任务提供，#235直接使用React学习中心。

原56项合同专测及#258验证记录属于当时head证据，不可复制为新补丁PASS。补丁需当前npm run validate、有效/无效/超限/权限/兼容fixture与准确head独立review。实际事务、DOM、WXT包、浏览器升级、Provider和用户故事分别在实现/验收卡报告。

原合成全量投影339.94ms超过250ms预算的结果继续保留，不因规范修订抹成性能通过；后续DOM adapter必须实测并有界降级。

## 完成语义
RL00_CONTRACT_READY只证明初版合同交付。#236才是Release A产品门槛，#240是ABC，#244才是完整Reading Loop。保留原审核历史，不把本Issue的关闭当作后续补丁或整个Epic已完成。
