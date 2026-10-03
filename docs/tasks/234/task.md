# [Reading Loop][RL-04][P0] 接通划词、普通译文与现有 AI 详解的真实记录链路

历史引用：[#234](https://github.com/CoderLambert/translateflow-plugin/issues/234)。2026-10-03 一次迁入；后续以本目录任务和本地证据为准。

## 流程迁移决策

下方是迁入的产品/工程合同。历史合同中的 Issue 评论/标签、远端 CI、自动 GitHub Review 和旧状态流不再是日常执行动作；统一采用 [LOCAL_WORKFLOW.md](../LOCAL_WORKFLOW.md) 的本地完整验收、真实浏览器/产物要求、具名独立审核及受保护代码同步。安全、数据、硬依赖与人工验收保持有效。原有“规划待启动”限制以用户本轮授权和 state.json 为准。

当前已提交候选 f910e990a1ba7ef5e58250b99460a52e1128ece0 / PR #279；该提交之后还有未提交修复，旧验证不能证明最新修复。实际复核发现 saved→stale 状态及旧动态注册加载缺失模块问题；在原 worktree 已修复并通过定向测试，完整候选重验与独审 NOT RUN。先保全，未经用户再次恢复产品开发不继续实施。

## 执行卡
Parent #229；Release A；L3 Selection生命周期/提交一致性。硬依赖：#231、#233合入（传递包含#232.C1–C8新合同）。主执行rl-runtime；保存状态组件可由独占文件的rl-ui辅助；独立只读rl-reviewer。保留当前owner/标签。

2026-10-02修订：消费protocolVersion=2，持久schemaVersion=1；首次授权与#235按以下用户故事连接，不新增对#235的循环代码依赖，不等待新的AI Streaming。

## 用户结果
明确查词/翻译/现有Explain记录的是当时实际看到的结果及正确上下文；开启记录前不积累Reading历史，开启后可保存仍有效的当前结果；保存失败原结果仍可用。

## 有序实现
1. 从现有Selection明确查询入口创建operation。仅selectionchange/hover/chip不创建历史、不发AI；保留dictionary-first与真实no-hit。普通句子翻译只在用户主动动作中请求Provider。
2. 使用#231在查询开始冻结的source/anchor/projectionVersion；记录当前document/session/selection generation。相同词不同Range换generation，滚动/重复同Range事件不重置。异步结果不得重新抓DOM冒充原上下文。
3. 新增薄record-client/record-status，调用#233的begin/save/append/cancel接口；不自行签权限、不直接IDB、不复制repository事务。关闭/换选区/导航时取消自身操作；取消确认与已commit区分，不能假回滚。
4. 接本地词典摘要、真实普通句子译文、现有selection/explain.js完整结果。当前明确查询cache hit同样可记录；禁止扫描旧cache倒推历史。词典来源、目标语言和实际结果对应，不保存raw MDX/CSS/MDD路径/图片、密钥或完整请求体。
5. 同operation基础词义与迟到可靠Rich摘要使用不同artifactId追加，lookup只计一次；重发同artifact幂等，不覆盖旧快照。无法可靠提取Rich摘要且无基本摘要时显示“该结果暂不支持保存”，不伪造释义/no-hit；资源补充失败不删除基本记录。
6. 现有Explain主动作以实际系统问题文本保存，例如“这里是什么意思？”，保留完成答案/source/model/prompt/provenance；挂到当前record，AI append不多算lookup。普通翻译有独立translation artifact，不能误装成dictionary。

## 首次授权流程（#232.C4，确定性路径）
- 未开启时查询仍正常；当前卡仅有非阻断邀请“在学习中心开启阅读记录”和“暂不”。通过窄open-learning-center打开固定页面，不允许任意URL、选文/问答/token进URL。
- set-recording仅学习中心#235可调用；Content不能把用户点击伪装成全局设置权限。
- 用户完成开启再回原网页，重新读取授权/站点状态。**同一有效结果卡显示“保存本次结果”**；用户点击后使用新token保存已有冻结结果，不重发Provider、不从全局cache捞之前记录。
- blur/切标签本身不是关闭或新选区；明确关卡/换Range/导航/source失效则丢弃临时快照，返回后不补抓。没有有效结果卡时只提示之后查询会记录。
- 开启后的新明确查询按当前策略自动记录。未同意选文/结果仅保留当前卡有界内存，不写Reading仓库；原cache按独立原合同。
- 暂不不影响查词；同一document不反复邀请。#235可基于冻结DTO做授权UI，#234用mock界面回调做本模块测试；完整跨页故事必须#236验收，不靠mock声明完成。

## 状态和异常
UI只根据后台ack显示disabled/saving/saved/not-saved；AI完成与保存成功分开。存储失败可复制当前结果和重试保存；只重试同有效operation的存储部分，不重试Provider。token失效则提示重新明确操作，不将其自动当新查询。

private/editable/已识别敏感/排除站点不持久化；用户scope不扩大。历史查看走独立只读client，绝不调用translateSnapshot。删除/暂停/站点排除发生后，旧回调和迟到ack必须结合当前generation重新判断，不复活记录或覆盖新卡。

## 文件与冲突
拥有src/content/selection/controller.js中的窄接入、独立record-client.js/record-status.js、必要result-model/explain hook与对应测试。不改parser、排名、全文cache、字幕、Provider数量。
#228已合入，执行时读取新open PR检查实际冲突，不再等旧PR。不得与#231同时改controller。与#235可并行，router/constants/root UI/资源映射由coordinator单写随PR接线；使用实际已批准classic/legacy bridge，不引入React到Content。

## 验收与证据
- 真实local hit零Provider；chip不写历史；用户普通翻译/AI的请求计数精确。
- 同词不同位置source不同；同位置重查计数正确；基本→Rich→重复回调整个operation只加一次。
- 当前cache hit有记录；历史查看不lookup；no-hit/translation/explain均能从真实repository读回。
- 首次不开启、开启后返回保存当前卡、开启期间关卡/导航、暂不、被排除站点都走真实路径。
- storage abort/quota、worker丢ack、删除/暂停/取消与完成交错不串写/不重发收费请求；先commit的数据不假回滚。
- 消息旧版本拒绝有刷新退路；同ID扩展更新不误补发请求。

npm run validate +真实Chromium/MV3 Selection/Reading E2E；触及Rich取消时运行其适用回归。证据绑定准确head、命令/Provider次数/持久内容，截图只用合成数据；独立review。Release A发布门槛是#236，不在本卡宣称整个Reading完成。
