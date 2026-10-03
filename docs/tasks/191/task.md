# [Platform Epic][In Progress] AI 学习工作台工程升级：WXT / React / TS / Vitest / i18n / 多浏览器发布

历史引用：[#191](https://github.com/CoderLambert/translateflow-plugin/issues/191)。2026-10-03 一次迁入；后续以本目录任务和本地证据为准。

## 流程迁移决策

下方是迁入的产品/工程合同。历史合同中的 Issue 评论/标签、远端 CI、自动 GitHub Review 和旧状态流不再是日常执行动作；统一采用 [LOCAL_WORKFLOW.md](../LOCAL_WORKFLOW.md) 的本地完整验收、真实浏览器/产物要求、具名独立审核及受保护代码同步。安全、数据、硬依赖与人工验收保持有效。原有“规划待启动”限制以用户本轮授权和 state.json 为准。

# TranslateFlow 平台升级 v1

## 当前阶段与授权
**MINIMAL_PLATFORM_IN_PROGRESS · DEFAULT_BUILD_SWITCH_PENDING · PRODUCT_ACCEPTANCE_PENDING**。

2026-10-02同步读取main@b10c2b355896530f15f69ebad996afc490760ae7：#246/PR #259的opt-in WXT兼容构建已合入，#230/PR #258领域合同已合入，#228取消修复也已合入。原“全部仅规划、尚未启动”状态不再有效。**opt-in能构建不等于#248默认切换/升级通过，也不等于#235学习中心已实现。** 各任务完成/审核以实时Issue、PR、CI为准。

本次只同步方案与Reading对接，不修改平台代码、执行标签、现有owner，不扩大其他会话的开发/合并授权，不授予商店发布权限。#222未合并Skill框架不是全队列前置。

## 1. 目标与工程选择
WXT（其兼容Vite组合）+指定复杂扩展UI使用React+渐进TypeScript+Vitest；保留旧node:test和真实Chromium/MV3 Playwright回归。WXT负责入口/Manifest/构建/浏览器目标，不另建独立Vite应用、不全仓重写。

#235是第一条React/TS产品路径，独立learning-center.html扩展页；随后再迁移Popup/Settings。React不进入Content/MAIN/Worker/后台业务，少量WXT runtime helper按实际依赖闭包审核。新TS优先入口/协议/新UI，旧JS按业务需要渐进，不靠改后缀宣称升级。

Provider/Effective Config/cache/词典parser与OPFS/取消/站点注册复用。UI只管交互，Reading应用服务/持久化由#233唯一拥有，不能平台另造一套LearningRecord。复用sage/beige token，组件从#235真实界面提取，不先做空组件库/通用路由/全局Store。

版本与工具链消费#245的实际实验、lock及docs/PLATFORM_UPGRADE_V1.md；不拼装latest或强升WXT内部Vite major。实际命令/Node/npm约束以main package/CI为准。

## 2. 工程任务与完整依赖
| Issue | 结果 | 完成依赖 | 难度/角色 |
|---|---|---|---|
| #245 PF-00 | 入口/资源/数据基线、兼容组合与迁移合同 | 无代码依赖，状态按实际证据 | L3 platform-lead |
| #246 PF-01 | opt-in WXT兼容构建/入口/精确资源桥 | #245；#259已合入 | L3 build |
| #247 PF-02 | TS/Vitest、发现范围/CI/源码边界 | #246 | L2 test，L3边界审核 |
| #248 PF-03 | 真产物E2E、same-ID升级、默认切换 | #246 #247；#227修复审核闸门 | L3 QA/build |
| #249 PF-04 | en/zh_CN最小i18n/语言合同 | #246 | L2 i18n |
| #250 PF-05 | Content模块图及临时资源桥收口 | #248 #244 | L3 runtime |
| #251 PF-06 | Popup/通用Settings React迁移 | #236 #249 | L2 UI，L3权限审核 |
| #252 PF-07 | 词典/Glossary UI React迁移 | #251 | L3 dictionary-UI |
| #253 PF-08 | 当前完整UI en/zh_CN收口 | #249 #252 #244 | L2 localization |
| #254 PF-09 | Chrome/Edge可追溯产物/商店资料/受控提交 | #248 #236，发布范围另验收 | L3 release |
| #255 PF-10 | Firefox MV3/真实扩展/AMO源码包 | #250 #254，独立激活 | L3 browser |
| #256 PF-11 | Safari能力/Apple打包/实机验证 | #250 #254，独立激活，不依赖Firefox | L3 safari |

#227/#228现有修复证据已合入，#248须核验其真实审核与升级回归，不再当未合并PR空等。#247/#249可在分配文件不重叠时并行。#255/#256的外部账号/设备阻塞不阻塞Chrome产品。

## 3. Reading Loop对接（本次修订重点）
#229拥有产品总图；#230已交付初版合同；**#232.C1–C8负责现有合同的窄补丁与权限接线**，不是新的架构Epic。补丁包括消息protocolVersion=2（持久schemaVersion仍1）、有界列表与页面AI标识、分块导出、首次授权流程、站点排除、操作级计数和读写失效规则。平台不复制这些DTO/服务、不把更换构建当作它们已实现。

- #231原文映射/选区身份；#232合同/隐私；#233独立Reading repository/事务/摘要/排除/导出；#234真实查询接入。
- **#235完成依赖#233+#248+#249**，直接React+TS，不先原生再重写。有限隔离组件准备须#232新DTO及#246/#247/#249就绪并获coordinator文件分配；未满足真实repository/生产包不能标整卡完成。
- #234+#235→#236是首个真实用户交付，不能用无关工程替代。
- #236→#237→#238→#239→#240形成ABC回访闭环；#236→#241→#242→#243提供可选D；#240+#243→#244完整验收。子卡附加依赖同样有效。
- #243同时拥有Content助手与React历史继续问入口；纯数据规则可共享，组件不跨surface。#250排#244之后，不能倒挂为Reading前置。
- #233拥有精确IDB adapter例外/规则更新；#247负责类型/测试设施，不能提前放开所有background存储。

## 4. 里程碑与范围保护
M0：最小WXT构建/测试/升级/语言基础。M1：#236交付查询→授权→真实保存→学习中心回顾/暂停/删除/导出。M2：#237–#244完整回访与可选理解，旧UI迁移/发布准备只在不抢核心文件时并行。M3：#250/#253收临时桥和旧UI双语。M4：Firefox、Safari分别验证/打包/商店准备。

不把所有浏览器发布、全部JS转TS、全部旧测试改Vitest、全Settings迁移变成M1前置。不新增云同步/SRS/后台/Provider/字典格式或独立工作台Epic。

## 5. 构建、资产与数据连续性
- 后台入口在WXT构建期可被Node导入，listener及时注册；不靠fake chrome、eval、运行时动态import掩盖副作用。
- #246 legacy桥从唯一源码按精确allowlist投影Content/MAIN/Worker，保留加载顺序/路径/CSP；源→运行路径映射唯一，不把整个src/node_modules设为public，不扩大web_accessible_resources补漏。
- 当前旧默认dist/extension与opt-in .output/chrome-mv3分开。#248完成真实升级/回归后切默认build/测试/认证消费者；保留稳定用户安装路径，去掉旧build engine正式入口。旧对照用固定commit/artifact，#250后收WXT内桥，不能长期维护两份产品。
- 构建不改变旧DB/store/version/cache identity/OPFS。same-ID/profile旧→新→restart测试真实配置/cache/合成词典与权限；不新加key改变现有用户ID，不卸载/清库当升级。新ID不同origin不承诺自动偷搬数据。
- auto-sites唯一注册owner，手动activeTab/持久optional权限区分；不自动全站注入、不扩大权限/CSP。旧标签失效给刷新退路，不自动再发收费请求。
- 字典资源认证/source-lock保持，普通构建不隐式联网拉语料，缺真实发布资源诚实失败；fixture/原始语料/私有数据/Agent设置不得入安装包。

## 6. 测试、命令与能力
#259已提供opt-in构建与限定真实WXT烟测。当前默认E2E与完整消费者切换仍由#248负责；不能因一个opt-in smoke通过就宣称默认发行迁移完成。

npm ci/固定lock，validate持续作为总入口；新增typecheck/test:unit与CI接线按#247实际交付，旧node:test、新TS/组件Vitest、E2E发现范围互斥。生成目录不当源码检查；新增TS/TSX也不能漏查。TS不替代runtime验证，mock不替代真实MV3/权限/OPFS。

对未修改生产包做Manifest/资产/依赖/敏感字节审计，测试副本只能添加mock权限/fixture，不能补生产漏文件。记录准确head/hash、各runner和真实浏览器，PASS/FAIL/NOT RUN分开。最新Chromium不能冒充Edge/Firefox/Safari或最低版本。

当前Manifest最低版本与Reading的document/context安全能力分别声明：能保持旧查词兼容，不代表Reading在缺证明能力的版本也全功能。无安全身份则明确不可用，不静默升Manifest或放宽权限；最低版本提升必须另有明确决策。

## 7. UI语言与协作
browserLocale/uiLocale/targetLanguage/dictionaryLanguages分开，Manifest locale与用户运行UI覆盖分开。切UI语言不改变Prompt/cache/Artifact。新UI从#249使用en/zh_CN，旧UI全部双语须#253；资源本地，变量按文本，不把模型内容当HTML模板。

最多两条写入线+真实只读reviewer，coordinator单一协调。package/lock/WXT配置/router/constants/check/根UI/全局token指定唯一writer。独立branch/worktree，保护未提交修改，不reset/clean/force。L3负责权限/事务/生命周期/发布，L2负责冻结合同UI/测试，L1限定文案fixture；不能伪造agent模型或独立审核。

AGENTS/CONTRIBUTING/ARCHITECTURE/check随实际实施PR精确更新：批准区域开放WXT/UI编译，不解除Provider/隐私/存储/权限边界。本轮修改Issue不代表这些规则已在代码中变化。状态按CONTRIBUTING，真实合入才implemented、独立合后审核才audited；设计、CI、merge、验收、发布分别记录。

## 8. 发布与浏览器目标
#254从已审核commit生成ZIP/hash/版本/工具与资源锁/范围元数据；后续提交提升同一已验收digest，不测试A再重建B。Chrome/Edge可复用相同包但真实Edge smoke独立；商店资料/权限与隐私说明/支持链接真实，缺账号/链接是提交阻塞而非核心开发阻塞。dry-run/build/upload/商店批准/公开发布分别授权和记录，fork/untrusted PR不触secret。

Firefox显式MV3，实际扩展后台/权限/消息/OPFS/升级验证；AMO可重建源码ZIP与安装包分开。Safari保留#256两条Apple包装路径（App Store Connect packager或具备条件时Xcode工具），执行时重新核实官方要求；云打包不证明Safari实机/iOS兼容，WXT不自动完成Apple发布。Firefox/Safari互不倒挂。其它Chromium浏览器仅真实smoke后声明。

平台差异集中薄adapter，不复制业务引擎；若关键能力不足记录最小修复/降级决策，不放宽安全上传私人资产。商店回退受版本限制，以兼容向前修复/停用功能为主，不能以卸载删数据回滚。

## 9. 关闭标准与来源
M0/M1完成不关闭全部平台Epic；本期工程/浏览器任务实际完成，或用户明确调整范围后才关闭。完整Reading声明依#244，全UI双语依#253，未验证范围不宣传。

具体官方依据/版本与实测细节沿#245–#256原卡和docs/PLATFORM_UPGRADE_V1.md、docs/WXT_COMPAT_V1.md；Reading接口只沿#232及docs/READING_LOOP_V1.md。历史方案/评论保留为证据，不再用过时“全部等待启动”覆盖当前真实进度。
