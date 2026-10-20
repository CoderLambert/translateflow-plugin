# YouTube 字幕升级的独立技术审查与实施前置条件

审查日期：2026-10-21。整体结论：**BLOCKED**。

结论针对“按当前 YT-01～YT-06 任务卡继续生产接入及将升级作为成熟产品交付”。它不要求丢弃 PR #366，也不表示所有自有代码修复必须等待许可证决策。PR 中的当前句校验、已定时 cue 回看、重叠顺序及生命周期保护有明确价值，但当前候选还不能合并或被认定为完整升级。确认本报告并修订下述前置条件后，建议先收口 YT-01/02；生产预取和 GPL 源码接入分别受技术与许可条件限制。

本轮只审查。未修改产品源码、测试、现有任务卡或 state；未提交、推送、调整 PR、合并、发布或开始后续开发。只在用户指定位置写本报告，复核脚本与日志位于一次性临时目录。审查者由本会话独立承担，未再派生审核 Agent。

## 1. 基线、规则与方法

| 对象 | 本轮实际核对结果 |
| --- | --- |
| TranslateFlow 审查范围 | `ee8b08dfd08ced762ffcb275304da6249615b718..bf37935f04ef6271ef8d3b5780142ac8d65c3600`；7 个文件、615 行新增、110 行删除 |
| PR | [#366](https://github.com/CoderLambert/translateflow-plugin/pull/366)，本轮 `gh pr view` 核对 base=`main`/`ee8b08d…`，head=`fix/youtube-subtitle-reuse-20261021`/`bf37935…`，state=`OPEN`；未查询 CI/Review 状态 |
| 远端刷新 | `git fetch origin` 成功；`origin/main=ee8b08d…`，指定远端字幕分支=`bf37935…` |
| 用户当前工作区 | 分支 `fix/chatgpt-native-host-development-setup`，HEAD=`5f8bac7453f475c551a9cb4b9f07ef03d59a436c`；开始时干净。本轮没有切换它 |
| FluentRead 固定参考 | `5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f`；原本本地 checkout 为 `83deca4…`，明确没有把该旧 checkout 当作参考候选；单独 fetch 指定提交后从 Git archive 读取固定版本 |
| 审查副本 | TF 与 FR 均使用本地临时审查副本；源码来自上述固定提交，原 checkout 不移动 HEAD |
| 用户补充证据包 | 用户提供的本地证据包（私有路径未归档）；已核对 reference 源码、SOURCE/evidence 清单、许可和历史日志，并重放独立 10 项探针；未应用其中补丁 |
| Node/npm | `v24.22.0` / `11.19.1`，满足 TF 候选的 engines；未安装依赖或使用真实 Provider 凭据 |

适用规则包括用户本轮“只审核”的明确限制、用户提供的 AGENTS.md、当前工作区根 AGENTS.md，以及固定候选根规则和 `src/background/cache/AGENTS.md`。后两者已反映缓存解耦：`cache-db.js` 是门面，`cache/storage-indexeddb.js` 才是 DB4 的直接 owner；不能按较旧根规则把存储写回门面。当前根与候选的 commit hook 规则也不同，本轮没有提交，未触发冲突。任务卡里的历史“直接实现”和 Slack 同步授权不适用于本轮。

工具会话实际为 unrestricted filesystem / approval never，覆盖了项目“工作区沙箱、按需审批”的默认值；没有调整启动器或权限设置。实际操作严格限制为读取、临时审查实验和本报告写入。

使用已安装 Superpowers 的方式：

- **brainstorming**：按只读方案审查处理，核对意图、范围、替代方案、职责与 YAGNI；不启动新设计或开发审批链。
- **writing-plans**：用 spec coverage、接口/类型一致性、review focus、任务大小与依赖自检现有任务卡；不重建大型计划。
- **requesting-code-review**：按固定 base/head、计划与实现分别评估、只读、按实际影响分级的 reviewer 合同审查 #366。当前角色就是独立 reviewer，没有套娃派生第二次审查。
- 测试环境失败按 **systematic-debugging** 追到缺失依赖/生成配置；交付按 **verification-before-completion** 核对日志与最终 diff。没有为了“通过”修改产品实现或既有断言。

下文 `TF:path:line` 均指 `bf37935…`，`FR:path:line` 均指 `5a362c6…`。关键固定源码入口：

- TF：[controller.js](https://github.com/CoderLambert/translateflow-plugin/blob/bf37935f04ef6271ef8d3b5780142ac8d65c3600/src/content/subtitles/controller.js)、[pipeline.js](https://github.com/CoderLambert/translateflow-plugin/blob/bf37935f04ef6271ef8d3b5780142ac8d65c3600/src/content/subtitles/pipeline.js)、[MAIN bridge](https://github.com/CoderLambert/translateflow-plugin/blob/bf37935f04ef6271ef8d3b5780142ac8d65c3600/src/content/subtitles/youtube-main-bridge.js)、[subtitle requests](https://github.com/CoderLambert/translateflow-plugin/blob/bf37935f04ef6271ef8d3b5780142ac8d65c3600/src/background/subtitle-requests.js)。
- 现有合同：[task.md](https://github.com/CoderLambert/translateflow-plugin/blob/bf37935f04ef6271ef8d3b5780142ac8d65c3600/docs/tasks/youtube-subtitle-reuse-v1/task.md)、[reuse-map.md](https://github.com/CoderLambert/translateflow-plugin/blob/bf37935f04ef6271ef8d3b5780142ac8d65c3600/docs/tasks/youtube-subtitle-reuse-v1/reuse-map.md)、[validation-report.md](https://github.com/CoderLambert/translateflow-plugin/blob/bf37935f04ef6271ef8d3b5780142ac8d65c3600/docs/tasks/youtube-subtitle-reuse-v1/validation-report.md)。

## 2. 严重性与发现

### P0

**没有证实的 P0。** 本轮没有发现该候选新增凭据泄露、权限扩大、破坏性迁移或可直接利用的任意后台调用。未执行真实站点验收，不将这句话扩大为全面安全认证。

### P1-01：同视频换轨时，旧 timedtext 可被标记为新轨道

**新发现；实际 MAIN 模块复现。** `TF:src/content/subtitles/youtube-main-bridge.js:124-147` 只在 videoId 改变时增加 generation；切轨仅更新 `state.track`。`:159-169` 捕获和验证的请求身份只有 videoId/generation；`:183-187` 在响应到达时把当前 `state.track` 附到旧响应正文。

复现：发起英语 timedtext → 同视频改选法语 → 英语响应迟到。R6 实际得到 `{text:"Old English body", language:"fr"}`，期望拒绝旧轨道响应。`TF:sources/youtube.js:308-321` 会接收这份被误标的正文；controller 的 scope 校验无法恢复已经丢失的原始轨道身份。结果可显示错误原文，并污染后续源语言/缓存归属。

现有 `tests/youtube-bridge.test.mjs:195-225` 覆盖视频切换及停止后的迟到响应，没有覆盖同视频切轨。PR 的换轨测试通过直接注入正确 track 的 snapshot，绕过了这个错误源头。

**修正：** 将这项纳入 YT-04 的最前段，在预取前解决请求开始时的稳定轨道身份/修订及响应匹配；覆盖同视频 A→B→A、fetch 与 XHR、同语言人工/自动轨。无需开放网络能力或保存签名 URL；保持 MAIN 的观测边界。不能把该项留在“集成验收时再看”。这是原有链路缺陷，不是 #366 新改了 MAIN。

### P1-02：取消登记晚于配置和缓存等待，关闭后仍可开始 Provider 调用

**既有文档已披露；本轮独立复现并确认前置条件。** `TF:src/background/subtitle-requests.js:27-58` 先等待 effectiveConfig、lookupCache，再调用 runTranslationRequest；真正 consumer 登记发生在 `TF:src/background/cache/translation-coordinator.js:25-27`。`:8-11` 对尚未登记的 requestId 返回 cancelled=false；`TF:src/background/router.js:128-131` 没有覆盖字幕准备阶段的另一层登记。

R5 在 cache lookup 挂起时取消：cancelled=false；释放缓存读取后 Provider 实际调用 **1 次**，期望 **0 次**。前台 task 已 cancelled 只挡住显示，不能阻止这次上传/费用。相同窗口也存在于配置读取等待期间。

**修正：** YT-02 必须让同一 requestId 的取消资格覆盖首次异步准备之前、每个 await 之后、Provider 开始及缓存写入资格。复用既有任务/取消所有者，不能在 UI 再加一个假“成功取消”状态。明确区分 off 的消费撤销与不可逆提交点；不要无差别取消同页其他业务。

### P1-03：现有 translation-client Promise 结束不代表执行资源释放，不能直接套用上游并发预算

**计划接口缺口；底层语义已实测。** FR 调度器 `translationScheduler.ts:42-50,67-83` 拒绝旧消费者但保留 active，直到注入 translate 的 Promise 真正收口。上游测试 `videoTranslationScheduler.test.ts:132-169` 特意让 producer 忽略 abort，验证 clear 后仍占三路。

TF `src/shared/cache/single-flight.js:22-25,39-54` 会在取消时立即 settle 消费者，但 loader 可继续；coordinator 返回的是该消费者 Promise。E1 使用真实 coordinator/single-flight 和忽略 abort 的执行端：取消后调用 Promise 已返回 CANCELLED，执行计数仍为 **1**，释放 producer 后才归零。`tasks.js:89-110` 的 cancelled 也仅是本地消费状态。

因此，reuse-map 的“调度器注入 translation-client”尚不能获得上游的真实 3/2 执行占用保证。`pipeline.js:353` 留住 processing 只等到 transport 收口；真实后端可更早结束 transport。不能说这段注释已经解决跨进程资源预算。

**修正：** YT-05 暂缓生产预取。先决定预算归属及可验证的执行完成边界，优先由已有后台执行所有者提供实际占用保证；若只能观察 consumer Promise，则保持当前句路径，不宣称真实执行限流。不为这个局部任务重写通用调度系统。补“快速 off/on、换视频、同 key 重试、producer 忽略 abort”跨层测试之后才能接预取。该问题不意味着当前无预取代码已经违反了一个尚未启用的 3 路上限。

### P1-04：新增内存成功结果没有有效配置/缓存失效资格

**已披露的配置缺口，本轮复现了可观察后果。** `TF:pipeline.js:206-213` 的 fingerprint 只有媒体、来源、轨道、时段和文本；`:73-75` 命中 completed 后直接交付，完全绕过后台快照和 DB4。`controller.js:55-65` 默认 refreshPreset 不 reset；`:166-172` refreshRoute 也走默认路径。`TF:content.js:43-68` 仅向字幕同步 mode/size，没有把目标语言、Prompt、术语、连接及站点翻译配置变化失效到这份 Map。

R3：用 old 配置译完 A → context/翻译端改为 new → refreshRoute → 同句仍显示 **old:A**，没有请求新结果。后台 `src/background/index.js:44-54` 已有取消和快照失效，前台 Map 仍可绕过它；这不是缺少第二套配置服务的理由。

缓存清除也只走 `content.js:35` → `cache/message-handler.js:62-67` → DB4；当前无这份字幕结果表的清理联动。写围栏能防 DB4 复活，不能自动清掉另一个内存所有者。是否清缓存后允许保留屏上结果，需要产品语义明确；至少不能将它标为新的 DB4 hit 或静默回看恢复。

另有上下文差异：`background/config.js:90-108` 的 EFFECTIVE_CONTEXT 基于页面 textMethod，而 `background/browser-translation.js:9-12` 的字幕执行独立选择 AI/本地。新菜单若直接把前者当字幕服务摘要，会显示错误服务。不要将 AI 风格预设误当作字幕 Provider。

**修正：** 在 YT-02 统一有效配置修订/结果资格、事件失效和缓存清理语义，复用 `effective-config-snapshots.js:11-25,42-43`。只将无凭据的修订标识提供 Content。明确批次配置固定、旧响应拒绝、前台 replay 失效，以及刷新后的 DB4 恢复；不提升 DB 版本，不清用户数据。

### P1-05：DOM 无时间字幕没有接入新成功结果恢复，空档后会一直空白

**当前 PR 缺陷；两个探针均复现。** `TF:pipeline.js:71-79` 的 completed 快速恢复仅处理 timed cue；无时间字幕走 `:103-107`，若与 lastUntimedText 相同就返回。无时间 fingerprint 又使用 `seq:N`（`:203-205`），不会按相同文本稳定找回旧成功结果。

与此同时 `controller.js:85-87` 正确地在空档/换帧清掉旧译文。组合结果是：DOM A 成功 → 空档 → DOM A 再出现，R1 得到 **空译文**且没有恢复回调。模式 original→bilingual 时 cancelPending 清 lastUntimedText，却保留了不能再定位的 completed 项；R2 再发请求 **2 次而非 1 次**。这不是 timed A→B→A 测试能覆盖的路径。

**修正：** 留在 YT-01 收口，明确无时间结果的显示资格与恢复键，覆盖 A→空档→A、A→B→A、模式切换、滚动修订和跨视频/轨道禁止复用。显示恢复键不必等于 DB4 的持久化位置身份；不要通过删除 DB4 cue/sequence 身份来取巧，也不增加一份独立缓存。若本切片只承诺 timed 恢复，应明确保留 DOM 原行为并修复空白退化。

### P1-06：GPL 前置条件只有说明，没有进入任务依赖和可执行决策

**任务依赖缺口；不是断言当前 PR 已侵权。** FR 固定提交 [LICENSE](https://github.com/FluentRead/FluentRead/blob/5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f/LICENSE) 为 GPL v3，README:109-111 明确 GPL-3.0。TF 候选未发现项目 LICENSE 或 package.json license 字段。reuse-map:76 已承认整体分发许可未明确，但 task.md:9-16 没有将许可决策列为 YT-03/04/05 源码接入的依赖。

**修正：** 在下一次源码移植前选择兼容 GPL 的整体组合分发方案、取得可核实的另行授权，或把该移植暂缓。中文改写、JS/TS 改写、重命名、裁剪依赖和挪到另一个文件都不自动消除许可约束；复制测试也要记录来源和许可。GPL 允许商业使用，不能误写成“不能进入商业产品”；关键是组合分发条件与授权。

这个条件阻塞 GPL 代码生产接入，不阻塞独立的 TF 原有取消/失效修复。见第 4 节。

### P2-01：失败退避和手动恢复不应拖到预取任务才处理

`TF:pipeline.js:84,311-317,363-365` 在新 ingest/flush 时解除 blockedByError，并重新放回失败批次，没有按结果键的 retryAt。R4 连续三次同句输入/flush 得到 **3 次失败请求**。这是模块边界的证明，不能据此声称真实网页已达到某个每秒请求量。

FR `translationCache.ts:63-68,94-111` 已有 2/5/15/30 秒有界退避和 `retryFailures()`；其测试 `videoTranslationCache.test.ts:55-79,92-108` 覆盖空结果、失败、人工重试和次数递增。现有任务只把“失败恢复”隐含放在 YT-05，遗漏了它对当前句产品路径的独立价值。

**修正：** 并入 YT-01/02 的当前句恢复验收；错误时保留原文、可重试，取消不累计失败；部分结果只重试缺失项，避免重发已成功项。复用行为与测试，不再复制 FR 全缓存类。

### P2-02：复用闭包、完整时间轴接口和播放器所有者尚未具体化

- task.md:13 的 YT-04 只有“已确认的纯函数闭包”；FR `subtitleLogic.ts:114-137` 和 cache `primeUpcoming` 需要完整 cues，TF `sources/youtube.js:185-192` 对外只发当前活动集合，完整 mainCues 留在 source 内。不能在 pipeline 对这个活动集合套窗口函数就称为预取。
- FR `VideoPretranslationController`（`pretranslationController.ts:7-49`）负责 120ms 合并、轨道就绪和卸载，现有 reuse-map 未列；但 TF source 已有媒体/TextTrack 监听。应复用其事件和清理语义，指定单一监听 owner，不能同时挂上两套 controller。
- FR binding 提取若只照映射中的 :51-100 / :214-370，会漏掉 `:115-198` 的 owner、clone 清理、重入保护和定位还原，也漏掉 :371-382 的 destroy。`nativeControls/place/sync` 不是可孤立复制的三个函数。
- 菜单 :16-134 只完成构造。键盘函数在 `playerMenu.ts:383-400`，模式渲染在 :404 起，开关/焦点/外部关闭在 `runtime.ts:1248-1270,1318-1338`。只提取 header/group 不会自动获得这些行为；FR light DOM 的 contains 也不能直接代表 TF Shadow composedPath。
- TF `source.js:53-68` 重新推断 autoGenerated，忽略输入的 true 和 kind。实际规范化 `{id:"yt:a.ja",kind:"asr",label:"日本語（自動生成）",autoGenerated:true}` 得到 null。YT-04“只对确认自动轨归并”的判定不能依赖当前丢失后的字段。

**修正：** 在原任务里补少量 consumes/produces：完整不可变轨道视图及修订、秒↔毫秒/原 cue 关联、同一 source 所有的 player/video target、结果键与真实文本映射、配置修订及取消/完成语义。人工轨和多条合法重叠保持现有集合语义。无需新增通用平台层或跨仓 runtime 依赖。

### 证据补充后的撤销项

用户补充参考目录后，原先“独立提取包无法复现”的疑点已消除，**不再列为问题或阻塞项**。调度器原字节、五个提取函数的签名/函数体、来源清单和 10 项探针均已核实，详见第 7 节。这使“已独立提取并验证”的结论成立，不改变“尚未生产接入”的边界，也不消除 P1-01～06 的实现或接入前置条件。

## 3. 对 YT-01～YT-06 的逐项复用裁决

“裁剪适配”均以许可条件满足为前提；当前没有一项可以无条件标记“直接合法复制进 TF 生产包”。

| 任务 | 明确裁决 | 对应成熟实现与实际边界 | 需要修正的任务内容 |
| --- | --- | --- | --- |
| YT-01 当前结果、回看、空档 | **保持现有实现** | FR cache.peek/cancelPending 和 runtime 当前句资格可作为行为参考；TF 必须保留多 cue 重叠、位置身份和现有 Task | 收口 P1-05 的 DOM 路径及 P2-01 的失败恢复；保留当前 PR 有价值的结果 Map 和 lifecycle。不要叠加 FR Cache 与另一份 inFlight/成功表 |
| YT-02 全生命周期取消、配置 | **保持现有实现** | FR 没有 TF Background/DB4/Chrome 本地模型的等价整链路实现；FR 源码不能解决 TF 的首次 await 登记窗口 | P1-02/04，明确不含凭据的有效配置修订、字幕实际服务摘要、清理和刷新恢复；P1-03 中执行释放归属也必须先决定 |
| YT-03 原生入口、四模式 | **裁剪适配** | createVideoPlayerBinding 的完整 YouTube 生命周期闭包；菜单构造加导航/选中/关闭/焦点，不能整个 runtime 搬入 | 补 source locator adapter 契约及 destroy 所有权；明确 TF off 保留入口、original 与 FR original-only 的映射，新增 translation-only 同步所有 validator/Options/i18n/source/bridge/renderer；不带 ASR/学习/导出 |
| YT-04 时间轴、滚动归并 | **裁剪适配** | 纯选择函数、normalize/helper、finalize 的完整词流闭包；上游一条 active cue 不是 TF 重叠集合替代品 | 首先修同视频轨道身份与 autoGenerated，提供完整轨道接口；保留 TF 获取/解析和预算。只对明确自动词流归并，保留人工 cue 与原 ID/修订关系 |
| YT-05 当前优先、预取 | **暂缓** | VideoTranslationScheduler 是最适合完整提取的组件；request/clear/retain/pump 及其六个测试有价值 | 等 YT-02 的释放边界、YT-04 的轨道/窗口输入、许可和消费授权明确后再接。以结果键调度，实际翻译仍传原文；晋级不能启动第二任务。取代被覆盖的 pending/batch 调度，不叠加第二队列 |
| YT-06 验收 | **保持现有实现** | 使用 TF 既有 Node/WXT/MV3 fixture；上游可复用测试行为和合成样本 | YT-06 是横跨各任务的验收工作，不单独创建产品模块，也不能等所有实现完才补关键回归。最终真实 YouTube + 本地/AI 各自证据仍不可省 |

### 可提取函数、闭包与测试清单

所有 FR 路径的前缀均为 `src/features/video-subtitle/content/`，固定提交同第 1 节。

| 文件及行号 | 实际可复用单元 | 必须随行的依赖或差异 | 已阅读的上游测试 |
| --- | --- | --- | --- |
| [translationScheduler.ts:7-86](https://github.com/FluentRead/FluentRead/blob/5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f/src/features/video-subtitle/content/translationScheduler.ts#L7-L86) | 完整 VideoTranslationScheduler 与 TranslationJob | 无运行时 import；3 总路/2 预取；注入 Promise 的释放语义必须满足 P1-03 | videoTranslationScheduler.test.ts:6-169；本轮 6 PASS |
| [subtitleLogic.ts:101-178](https://github.com/FluentRead/FluentRead/blob/5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f/src/features/video-subtitle/content/subtitleLogic.ts#L101-L178) | selectVideoSubtitleCueAtOffset、selectVideoSubtitlePretranslationCues、selectYoutubeCaptionCue | hasRollingCaptionPrefix:141-148、normalizeVideoCaptionText:324-326、VideoSubtitleCue；单 cue/文本去重与 TF 多重叠/位置缓存需要适配 | videoSubtitleLogic.test.ts，尤其 :150-218；整文件本轮 27 PASS |
| [translationCache.ts:22-115](https://github.com/FluentRead/FluentRead/blob/5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f/src/features/video-subtitle/content/translationCache.ts#L22-L115) | peek、cancelPending、retainPrefetches、primeUpcoming、退避/版本/同 Promise 清理 | 依赖 scheduler 和窗口选择；按文本缓存，不含 TF 配置/位置身份。仅作为现有 pipeline 的行为补充，不建议再引入整类 | videoTranslationCache.test.ts:17-131；本轮 11 PASS |
| [pretranslationController.ts:7-49](https://github.com/FluentRead/FluentRead/blob/5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f/src/features/video-subtitle/content/pretranslationController.ts#L7-L49) | schedule/clear/observe/destroy 的完整生命周期 | 无外部 import；TF 已有媒体和轨道 owner，优先把语义接入现有监听，避免第二套监听器 | videoPretranslationController.test.ts；本轮 3 PASS |
| [videoPlayerBinding.ts:54-383](https://github.com/FluentRead/FluentRead/blob/5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f/src/features/video-subtitle/content/videoPlayerBinding.ts#L54-L383) | nativeControls、insertionAnchor、createVideoPlayerBinding 的 YouTube 分支及完整清理闭包 | ui 标记/constants、locator 的 sync/getTarget/subscribe/destroy 合同；owner/clone/重入/定位恢复不可删。可剔除 X、进度徽标和无需求 fallback | videoPlayerBinding.test.ts:58-433,616-779,804-888 等；本轮 52 PASS。使用 linkedom 和注入 locator/Observer，非真实播放器 |
| [playerMenu.ts:16-131](https://github.com/FluentRead/FluentRead/blob/5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f/src/features/video-subtitle/content/playerMenu.ts#L16-L131)；:383-408 | 四模式、createIcon/keyedText/createButton/createHeader/createModeGroup、导航/选中渲染 | TF i18n/token/动作替换；关闭及焦点来自 runtime，对 Shadow 重新验收。保留逐节点 SVG，禁止 innerHTML | videoUiI18n.test.ts 菜单/模式/键盘测试，已阅读，未执行；不是 videoPlayerBinding 测试自动覆盖的内容 |
| [youtubeSubtitleData.ts:193-413](https://github.com/FluentRead/FluentRead/blob/5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f/src/features/video-subtitle/content/youtubeSubtitleData.ts#L193-L413)；:479-498 | collapseIncrementalCues、mergeWordStreamCues、finalizeVideoSubtitleCues | normalize/count/title/terminal/isWordStream/gap/canJoin/quote/join/prefix/run 全闭包；保留 700ms/8s/14 词及其余原阈值；merge 新建 cue 会丢自定义 ID，需明确 side-table 映射 | youtubeSubtitleData.test.ts，尤其 :340 起及 :524-553 的无效值/幂等；本轮整文件 384 PASS |
| [runtime.ts:446-503](https://github.com/FluentRead/FluentRead/blob/5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f/src/features/video-subtitle/content/runtime.ts#L446-L503) | updateProgressiveCaption 的状态/时钟/轨道版本检查作为行为参照 | 依赖运行时大量状态、UI/clock/locator/cache；不建议复制完整函数。保留 TF controller 所有者 | videoSubtitleTrackPriorityRuntime.test.ts:642-698,716-845 等，已阅读，未执行 |

已核对 Git blob：scheduler=`c7f0871d4db5499a29ec61793d6822d825aa7bbb`；logic=`f3c6f881e4fe7aedaf0814c416e2cfe3c422a9ba`；cache=`d6d22ce4fd37684df4ab90c667b2752962d880bb`；binding=`a592f258e463400c3d3fd4cbff42350565cd3f4b`；menu=`4af1530abb8db0ea29a0ce007dc52d9c72e3417f`；data=`176376301cf219c33cb6ad8b27899b1b44d9ec7a`；新增识别的 pretranslationController=`8b618ee04c7d64c6c999d1fdbddc560988e2e423`。

## 4. 许可证和依赖边界

上述 FR 函数、helper、测试和对应 fixture 的复制/改编都需要按固定版本的 GPL-3.0 条件处理，不能把 A/B/C 技术分类当成许可证豁免。没有发现这些指定文件另附可独立使用的宽松许可。这里给出的是生产接入的工程准入判断，不替所有权人决定项目许可证。

GPL 可以用于收费产品；直接把 GPL 实现组合进扩展并分发，需要落实组合程序适用许可、版权/修改声明及对应源码等要求，或者获得权利人的其他授权。仅保留致谢不足以代替这些要求。依据为 [GPL v3 条款第 4-6 节](https://www.gnu.org/licenses/gpl-3.0.en.html) 和 [GNU 关于组合进其他系统的说明](https://www.gnu.org/licenses/gpl-faq.en.html#GPLInProprietarySystem)。不应因为 TF 未声明许可，就推定它已经允许或已经禁止 GPL 组合分发。

独立参考验证包不进入生产图，不等于它自己的再分发没有许可要求；本地研究与向其他人分发参考包应分别记录。TF 的自有改动可以按自身合同继续审查，但“参考过行为”并不足以从本轮 diff 证明严格的独立创作过程；本报告既不作侵权认定，也不签发免责结论。

应继续维持的技术边界：

- 不引入 FR Config、glossary、service catalog、Vue、ASR/音频捕获、下载、学习或导出依赖。TF Provider、Chrome 本地翻译、Task、DB4 和 Effective Config 保持原 owner。
- **不可整搬 FR runtime 的获取 fallback。** FR `runtime.ts:609-632` 在没有 captured track 时构造 timedtext URL 并 `fetch(...,{credentials:'include'})`；TF 明确禁止自行重放签名字幕 URL。复制纯算法不需要这个网络闭包。
- FR `serviceProfile.ts:16-28` 的 10s/30s 窗口依赖其服务分类，不能拿来把 TF 的 AI、Chrome 本地或免费在线混为同一线路。当前 TF 字幕仍是独立 AI/本地路径。
- 不复制整套 FR VideoTranslationCache、locator、预取 controller 再保留 TF 原等价机制。只保留一份成功结果、在途任务和播放器/媒体绑定所有者。
- 不扩大 Manifest/host permissions，不把网页 bridge 变成 Provider 或存储 RPC。字幕正文和模型输出仍使用 textContent/受控 DOM。

## 5. 各可靠性问题的审查结论

| 用户要求的边界 | 实际证据与结论 |
| --- | --- |
| video/track/cue/config 身份 | controller:105-122 对规范 snapshot 有较强校验；MAIN 原轨道丢失见 P1-01；配置不在 completed 身份见 P1-04。仅修改 controller 不足以闭环 |
| 迟到译文、重叠、空档 | 现有 28 项组合回归证明 timed 当前句/重叠顺序/空档清理的局部行为。FR 选择 latest-start 的单 cue，不能替代 TF 全重叠集合。DOM 空档恢复见 P1-05 |
| 滚动字幕 | TF 保留 280ms 稳定化；FR 有已测文本/时钟匹配和词流归并。aAppend/tOffsetMs 不能宣称已完整支持：两边 JSON3 当前主要 join utf8，FR data 测试未覆盖这些字段的完整语义。先保留解析器，增加有依据的合成样本 |
| 配置/缓存读取取消 | 已证实缺口，P1-02；本地设置写入前发出取消的测试只覆盖前台，不证明此处没有 Provider 调用 |
| 消费者与实际执行释放 | 已证实不等价，P1-03；不能以 CANCELLED 或 message 完成释放物理并发名额 |
| 当前句与预取 | 上游 scheduler/窗口算法有证据；TF 尚无完整轨道/完成协议集成，生产预取 NOT IMPLEMENTED，不对其性能作结论 |
| seek、倍速、暂停、连续换片 | TF source:123-129 监听媒体事件；:169-179 用 rate 计算边界；controller:107-112 回读 seeking/时钟。seek 有模块测试，但默认稳定化延迟未测；暂停状态不阻止边界墙钟 timer 再次调度，需测稳定时钟/无多余请求，不能仅凭监听存在就判成熟；真实倍速/连续切片仍 NOT VERIFIED |
| Chrome 本地与 AI | translation-client:145-164 的本地准备/真实点击、:252-274 的字幕流程、:276-307 的本地取消/配置失效与 AI 的 background batch 不同。本轮 native-client 19 项断言通过，但执行端是 double，不能证明真实模型/下载/资源释放。预取不能主动弹准备框或下载模型 |
| 原生栏重建/全屏/SPA | FR binding 的 clone/重挂/清理有 linkedom 测试；TF 仍是 renderer:19-73 的原浮层。FR 菜单 contains/焦点要适配 Shadow；普通 DOM fullscreen 与浏览器/系统原生视频 fullscreen 不同，不引入另一套原生字幕轨以扩大范围 |
| 浏览器刷新后恢复 | controller:45-52 从 PUBLIC_SETTINGS_GET 恢复 mode/size，缓存则依赖 DB4。定时字幕位置键稳定性与本地/AI 各自配置需真实安装包验证；DOM sequence 不能保证跨刷新相同 key。L1 清空不等于 DB4 丢数据，也不应把一次本地 Map replay 算作持久化命中 |
| 权限与 MAIN 安全 | #366 没改 manifest、bridge 或后台权限。当前 bridge 仅观测且校验结构/视频 generation，页面消息不可视作认证；轨道身份修复不需要扩大权限。FR 任意 runtime/URL 获取逻辑不能自动成为授权例外 |

## 6. 对任务拆分的最小修正与最终顺序

不新增大型任务体系，也不把每个 helper 拆成独立交付。现有六个 ID 足够，修改它们的边界和依赖即可。

1. **先修订入口条件与合同。** 确认本报告；把许可分支、YT-02 取消/配置修订、YT-04 完整轨道和播放器 target、YT-05 实际执行占用明确到现有 task。对许可没有决策时仍可做 TF 自有可靠性修复，但不能进入 GPL 生产复制。
2. **YT-01/02 作为同一可靠性切片收口。** 共用 controller/pipeline/Task 调用链，合并集成验收和候选，保留两个 ID 追踪即可。修 DOM 恢复、配置/清理失效、首次 await 前取消和错误恢复；不重复开发 FR Cache。产品价值：关闭确实阻止未开始调用，当前结果不会错配，回看和失败能恢复。
3. **YT-04 先处理轨道身份和元数据，再接纯时间轴/归并。** P1-01 不能依赖下游选句修补；先保留现有获取解析，暴露单一完整轨道视图，再按许可裁剪闭包并保留原 cue 对照。产品价值：换轨与滚动字幕可信，不靠预取才有价值。
4. **YT-03 原生入口/四模式。** 在 YT-02 配置合同和播放器 target 合同稳定、许可已处理后实施；保留 off 入口、焦点与恢复路径。它不必依赖预取，也不必等待所有词流算法完成。
5. **YT-05 条件满足后单独接预取。** 明确窗口、实际引擎就绪/用户授权和执行释放，复用 scheduler 及窗口测试。未满足则维持 current-only；不能为赶进度把 consumer settle 当作 release。接入时删除/替换被覆盖的旧排队职责，保留 TF batching/Provider/DB4 的必要 owner，避免两个队列互相阻塞。
6. **YT-06 随上述切片持续补回归，最终统一验收。** 完整 validate、WXT/MV3 及真实 YouTube 绑定最终实现候选。纯报告/状态归档不重建包。

可安全并行的范围只在合同固定后出现：YT-03 的 binding/menu 与 YT-04 的纯数据 helper/fixture 可独立验证，文件所有权不重叠时才可并行；共同 controller、source 对外接口、mode validator、runtime assets 由单一集成者修改。YT-01/02 共同写 pipeline/controller，必须串行或一个实施者；YT-05 必须等 YT-02/04。YT-06 的 fixture 设计可提前，最终集成验收必须串行绑定真实候选。本轮未启动这些工作或任何并行 Agent。

PR #366 与后续方案的实际冲突点是成功 Map/在途/排队 owner，不是整个 PR 应被替换。保留它的当前性和 lifecycle 保护，修其遗漏；后续 scheduler 接入前决定被替换的职责。一次性导入 FR runtime/cache 再修 TF adapter 会增加工作量，并违反“优先成熟复用、减少复杂度”的本意。

## 7. 测试证据分层与本轮实际执行

### 上游原测试：PASS，但采用隔离审查运行环境

读取固定提交的完整源码和原测试，在 FR 临时副本用现有安装的 **Vitest 2.1.9** 执行：

```sh
node node_modules/vitest/vitest.mjs run --config review-vitest.config.mjs \
  tests/videoTranslationScheduler.test.ts tests/videoTranslationCache.test.ts \
  tests/videoSubtitleLogic.test.ts tests/youtubeSubtitleData.test.ts \
  tests/videoPlayerBinding.test.ts tests/videoPretranslationController.test.ts
```

结果：6 文件 / **483 PASS**（6 + 11 + 27 + 384 + 52 + 3），0 FAIL。原始日志保存在本地临时审查目录，未入库。

运行环境限制必须保留：现有 FR 依赖不是针对固定提交重新 pnpm install 的洁净依赖。最初六组都在收集前因 archive 无 `.wxt/tsconfig.json` 失败；仅在临时副本补最小生成配置和 alias/test runner 配置后运行，未修改原测试及产品源码。该运行不覆盖上游 WXT/Vue 构建、类型检查、完整原生配置或运行时大集成测试。

已阅读未执行：`videoSubtitleTrackPriorityRuntime.test.ts`、`videoUiI18n.test.ts`。前者通过真实 mount 入口，但使用 linkedom、fake timers、mock 配置/翻译/网络端口；不是直播站点录像或真实 Provider 证明。FR `scripts/run-youtube-subtitle-sync-test.cjs:66-94,125` 使用 mock 翻译并 route.fulfill YouTube 样式页面、注入 timedtext，也是浏览器合成 fixture，不能当真实 YouTube 验收结果。本轮未运行该脚本。

### 独立提取测试：已核对原包并重放，10 PASS

本轮读取用户提供的本地证据包中的 `README-evidence.md`、`evidence.json`、`upstream-reference/README.md`、`SOURCE.json`、源码、COPYING、探针和对应日志后完成以下核对；其私有路径未归档：

- SOURCE.json 列出的 5 个文件 SHA-256 全部匹配；evidence.json 的 9 份历史日志 SHA-256 全部匹配，7 个候选源码/测试/文档 SHA-256 均与固定 `bf37935…` 的 Git 文件一致。
- `translationScheduler.ts` 与固定上游 blob **原字节相同**。
- 用 TypeScript AST 分别提取 `normalizeVideoCaptionText`、`selectVideoSubtitleCueAtOffset`、`selectVideoSubtitlePretranslationCues`、`hasRollingCaptionPrefix`、`selectYoutubeCaptionCue`，五个函数的签名及函数体文本与固定上游完全一致；新类型/来源头和去掉无关 import 的适配与 SOURCE.json 描述一致。
- COPYING 的 GPL 正文与上游 LICENSE 相同，仅末尾空白差异；文件摘要符合随包清单。该差异不构成许可文本缺失。

在已阅读脚本、确认只有本地类型擦除与合成断言后执行：

```sh
node --test [用户提供的本地证据包]/upstream-reference/probe.test.mjs
```

结果：**10 PASS / 0 FAIL / 0 SKIP**（本轮 Node v24.22.0）。新日志保存在本地临时审查目录，未入库。原包历史日志仍是 Node22 证据，没有改写。其探针验证原字节、同 Promise/晋级、3/2 占用、忽略 abort、窗口淘汰、八条去重、时段/倍率/滚动匹配；未覆盖 TF Provider/DB4/DOM/浏览器集成，不表示生产已经获得这些保证。

这 10 项是独立提取测试，不能与 483 项上游测试混称上游全套，也不计入 TF 59 项。参考包继续独立、未加入生产模块图；没有应用 implementation.patch。

### TF 现有模块/组合测试：59 个断言 PASS，另一个文件依赖阻塞

在固定 TF 副本执行：

```sh
node --test tests/subtitle-pipeline.test.mjs \
  tests/subtitle-controller-currentness.test.mjs tests/subtitles.test.mjs \
  tests/subtitle-cache-identity.test.mjs tests/native-client.test.mjs
node --test tests/youtube-bridge.test.mjs
```

第一条产生 **53 PASS**，并有一个失败的测试文件加载：`subtitle-cache-identity.test.mjs` 导入后台链时缺少已声明的 `p-retry`（ERR_MODULE_NOT_FOUND），分类为 **BLOCKED/环境依赖**，不是该文件断言已经执行失败。未安装依赖，也未把不完整安装伪装为洁净 npm ci。第二条 **6 PASS**。日志分别是 TF 临时副本中的 `module-tests.log` / `bridge-tests.log`。

前两份原有字幕 pipeline/controller 测试共 28 项包含在 53 PASS 中，不能再加一次。四份修改的 JS/MJS 文件逐个 `node --check`：PASS。源码/fixture blob 与 validation-report 所列四个值一致。

### 独立审查反例：6 个期望行为失败，1 个边界语义探针通过

所有脚本只写在 TF 临时副本；没有新增仓库测试文件或修改已有断言。

```sh
node --experimental-vm-modules --test review-probes.mjs
node --test review-track-probe.mjs
```

| 探针 | 实际结果 | 证据范围 |
| --- | --- | --- |
| R1 DOM A→空档→A | FAIL：空串，期望 T:A | 真实 Task/source 合同/pipeline/controller；媒体与 renderer double |
| R2 DOM original→bilingual | FAIL：2 次请求，期望 1 次 | 同上；证明未复用，不声称测到真实账单 |
| R3 changed context 后 refreshRoute | FAIL：old:A，期望 new:A | 同上；证明 L1 失效缺口 |
| R4 同 cue 连续失败后重入 | FAIL：3 次请求，期望退避期间 1 次 | pipeline 行为；未测真实网页重入频率 |
| E1 consumer cancel / producer release | PASS：consumer 已 CANCELLED、producer 仍 active=1 | 真实 coordinator/single-flight；执行端故意忽略 abort |
| R5 缓存读取时取消 | FAIL：随后 Provider 计数 1，期望 0 | 真实 subtitle batch 与 coordinator；存储/配置/执行为注入端口，用 VM 保持源码原字节并隔离未安装依赖 |
| R6 同视频换轨后旧正文 | FAIL：英语正文附 fr 元数据，期望拒绝 | 真实 MAIN/protocol/parser；复用现有 bridge 测试 fixture 的合成播放器/fetch |

日志：`review-probes.log`、`review-track-probe.log`。这些 FAIL 是发现缺陷的反例，不是“修复后通过”；本轮没有修复。另运行一次 source 规范化探针，确认显式 autoGenerated=true 被转成 null（P2-02）。

### 集成、真实站点与交付门槛

- **NOT RUN**：npm ci、npm run validate、typecheck、Vitest 工程全套、WXT 构建、MV3 E2E、正式 local-task gate；本轮为只读技术审查，没有把它扩成新实现候选的交付流程。
- **NOT RUN / NOT VERIFIED**：真实 YouTube 页面、真实 AI Provider、真实 Chrome 本地模型/准备下载、全屏/Shadow 焦点和默认 280/60ms 延迟。
- 现有 TF `e2e/youtube-subtitles.spec.mjs:92-135` 在 localhost 合成播放器，强制 isSupportedPage=true，stabilityMs/batchDelayMs=0；可验证扩展组合流程，不能证明生产 host 及默认延迟兼容。
- `e2e/subtitle-pipeline.spec.mjs` 验证后台批次/DB4/位置身份，是有价值的集成测试；不能替代播放器同步。`e2e/browser-basic-translation.spec.mjs:113` 的本地字幕准备场景也不替代真实本地模型。

## 8. 必须补充的回归及所属任务

| 所属 | 必须验证的可观察结果 | 层级与现成素材 |
| --- | --- | --- |
| YT-01 | DOM A-gap-A / A-B-A / mode 恢复；文本修订不能误用旧译文；跨媒体/轨道不复用 | 增补当前 controller 组合测试；FR cache.peek/cancelPending 用例行为 |
| YT-01/02 | 401/429/空/非法/部分响应有有界恢复，手动重试合并，取消不进失败计数 | 模块 + translation-client 集成；FR cache 退避测试 |
| YT-02 | 配置准备与缓存读取前/中/后取消，cache hit/miss，Provider 前计数为零；旧配置结果不回写新显示/DB4 | background 注入端口 + 实际 runtime/临时 DB4 集成，不能只断言 CANCEL 消息数 |
| YT-02 | target/连接/端点/model/prompt/glossary/site/temporary preset 变化，L1/在途/DB4 同配置；页面与字幕方法不同时服务摘要正确；page/all clear 不复活 | 复用 effective-config-snapshots、cache fence、native-client 测试；新候选上的 MV3 |
| YT-04 | 同视频双向换轨、A-B-A、同语种人工↔ASR、迟到 fetch/XHR 不附错 metadata；autoGenerated 明确保留 | 实际 MAIN 与 source 联调；现有 bridge fixture 直接扩充 |
| YT-04 | 秒↔毫秒端点、短 cue、空档、多重叠、重复文本不同位置；原 cue ID/修订关联；人工轨不归并 | FR 纯函数/数据边界样本 + TF 模块；保留 TF 现有格式/输入预算 |
| YT-04 | 已确认自动词流的递增版本、标点/引号/中日韩、容量边界、输入不变/重复 finalize 幂等；aAppend/tOffsetMs 有明确支持或降级 | 上游 youtubeSubtitleData 样本裁剪适配；不以 parser 成功替代滚动显示正确 |
| YT-03 | 控制栏深复制/整个 host 替换后唯一活入口且点击有效；不删其他 owner；销毁还原定位、observer/listener/timer | FR binding 用例 + TF MV3 fixture |
| YT-03 | 四模式枚举贯通持久化/刷新、off 可重开；键盘/焦点/Shadow composedPath/Escape/全屏/窄屏/暗色/减少动画；不触发宿主快进/暂停 | FR menu 导航样本 + TF 实际 DOM/Chromium，真实站点补验 |
| YT-05 前置 | abort-ignoring producer 下真实 active 上限，不用消费者返回计数；同 key 预取晋级仍一任务；seek 淘汰旧窗口；大量新旧 current 不饿死当前 | FR scheduler 六组原用例 + TF coordinator/Provider 生命周期集成 |
| YT-05 | 预取不在 original/off/本地未准备时上传、弹框或下载；AI 与本地分别验，暂停/倍速/快速 seek 连续换片后无旧结果和资源积压 | 实际 translation-client + 合成 MV3，真实引擎另验 |
| YT-06 | 最终安装包在真实 YouTube 人工字幕、自动滚动、多语言切轨、seek/暂停/0.5x/2x、SPA/连续切换、刷新/全屏下正确；缓存命中与失败恢复可观察 | 用户临时 profile/明确的真实验收；AI 与 Chrome 本地分别记录版本、结果和限制 |

实现阶段应先把本轮最小反例转为仓库回归，再修实现；纯文档或最终证据归档不重复跑产品门槛。每个生产输入变化仅重验受影响项；最终集成候选再按仓库规则补一次完整门槛。

## 9. 替代方案、审查边界与开发许可建议

比较后的首选是：**保留 TF 原所有者，先完成当前句可靠性，再按许可和接口逐块复用 FR 纯函数及绑定闭包，最后接 scheduler。** 修改面最小，能保留已验证行为，也能区分上游成熟边界与 TF 特有的取消/缓存生命周期。

不选择整套 FR runtime/cache/locator 移植：它不仅带来第二份状态，还包含直接 timedtext 获取、其他平台、ASR/学习/导出和自身配置依赖；裁掉这些后仍需重新适配 TF 生命周期，不能以“成熟实现”跳过集成测试。

保守备选是暂不做预取，交付可靠的当前字幕、原生入口和滚动轨道。它不会提供 AI 延迟提前完成的收益，应明确性能边界，但比未兑现执行预算的三路预取更可验证。如果许可选择暂缓，先完成自有可靠性修复，不以逐行改写 GPL 代码充当许可方案。

有意不裁决的范围：ASR、音频采集、字幕生成、学习、导出、X/其他平台、跨浏览器工程化、商店发布以及 TF 全仓法律合规认证；均超出用户授权。它们在上游存在不构成 TF 必须实现的要求。原提取包已核实，不扩大为运行时集成结论。

**是否允许开始下一阶段：当前不建议按原任务卡直接开始；本轮也没有开始。**

开始自有可靠性修复前，需用户确认审查结果，并在原任务中落实 YT-01/02 的取消、配置/缓存失效、DOM 恢复及回归归属；后续进入持续开发队列时按现有 LOCAL_WORKFLOW 补 state.json，当前 task 目录尚无该文件，不另建状态机。生产移植还需明确 GPL 兼容分发或另行授权；YT-05 还必须满足实际执行预算及完整轨道接口。真实 YouTube 验收是完成阶段门槛，不能伪装成已通过，也不必让它阻止先编写合成回归。

PR #366 维持现状。修复后应冻结新 candidateHead，复用未受影响的有效证据并重跑相关失败项/依赖；本报告只绑定 `bf37935…`，不自动延伸到未来提交。
