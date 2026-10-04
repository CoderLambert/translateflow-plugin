# selection 模块逐文件走读

> 当前controller/popover/ai-detail已改接显式AI Port，完整当前说明见[新章](assistant-stream.md#file-controller)；以下三节保留历史身份，不代表当前按钮仍经SELECTION_EXPLAIN。其它未变文件仍以coverage身份为准。

导航：[阅读入口](../README.md) · [架构总览](../architecture.md) · [仓库地图](../repository-map.md) · [完整功能链](../features/selection-and-dictionary.md) · [前置启动模块](startup.md)

> 2026-10-03 增量固定 main `d5246cae6469e4a876fc122b229a2e0ddf115709`：本轮完整复读 controller、popover、result-model、result-renderer、rich-details、ai-detail、empty-state、explain、explain-prompt、rich-mdict-lookup-controller，并新增 rich-result-renderer、translation-query、reading-result 三个完整文件节。Reading access/client/status 的完整解释在[Reading 模块](reading-records.md)。
> 其余原有完整章节保留 `d5e308a709c008acf6b277d466d020f13025bdca` 历史源码身份；本轮未逐行重读，不能当当前完整审计。各节链接明确自己的 SHA，不统一重贴 main。代码、测试、真实 MV3/页面/词典/Provider 验证全部 **NOT_RUN**。
> 完整解释按文件自身职责计算，不递归覆盖其子依赖；“读过/引用过测试名”不是测试文件完整解释。词典导入、sanitizer/CSS/资源、Provider/缓存全实现不在本章范围。

<a id="coverage-index"></a>
## 覆盖索引

| 文件 | 锚点 | 状态 |
| --- | --- | --- |
| src/content/selection/selection.js | [file-selection](#file-selection) | 历史完整解释，未重读 |
| src/content/selection/source-snapshot.js | [file-source-snapshot](#file-source-snapshot) | 历史完整解释，未重读 |
| src/content/selection/context.js | [file-context](#file-context) | 历史完整解释，未重读 |
| src/content/selection/controller.js | [file-controller](#file-controller) | 完整解释 |
| src/content/selection/popover.js | [file-popover](#file-popover) | 完整解释 |
| src/content/selection/result-model.js | [file-result-model](#file-result-model) | 完整解释 |
| src/content/selection/result-renderer.js | [file-result-renderer](#file-result-renderer) | 完整解释 |
| src/content/selection/rich-details.js | [file-rich-details](#file-rich-details) | 完整解释 |
| src/content/selection/ai-detail.js | [file-ai-detail](#file-ai-detail) | 完整解释 |
| src/content/selection/empty-state.js | [file-empty-state](#file-empty-state) | 完整解释 |
| src/content/selection/messages.js | [file-messages](#file-messages) | 历史完整解释，未重读 |
| src/content/selection/clipboard.js | [file-clipboard](#file-clipboard) | 历史完整解释，未重读 |
| src/shared/selection.js | [file-selection-contract](#file-selection-contract) | 历史完整解释，未重读 |
| src/shared/selection-explanation.js | [file-explanation-contract](#file-explanation-contract) | 历史完整解释，未重读 |
| src/background/selection/resolve.js | [file-resolve](#file-resolve) | 历史完整解释，未重读 |
| src/background/selection/explain.js | [file-explain](#file-explain) | 完整解释 |
| src/background/selection/explain-prompt.js | [file-explain-prompt](#file-explain-prompt) | 完整解释 |
| src/background/packs/rich-mdict-lookup-controller.js | [file-rich-lookup-controller](#file-rich-lookup-controller) | 完整解释 |
| 路由/pack API/manager | [partial-router](#partial-router) | 部分，仍待解释 |
| lexical 查询/排序 | [partial-lexical](#partial-lexical) | 部分，仍待解释 |
| 投影/任务 | [partial-source-and-tasks](#partial-source-and-tasks) | 部分，仍待解释 |
| 富文本安全/资源 | [partial-rich-rendering](#partial-rich-rendering) | 调用契约，仍待解释 |
| Provider/配置/缓存 | [partial-provider-cache](#partial-provider-cache) | 调用契约，仍待解释 |
| 测试证据 | [test-boundaries](#test-boundaries) | 断言主题，仍待解释 |

本轮完整文件使用 d5246ca 固定链接，未重读的历史章节继续使用 d5e308a；函数名用于在全文件行范围内定位。完整解释仅计本文件职责，引用依赖不递归升为完整。

| 本轮新增文件 | 锚点 | 状态 |
| --- | --- | --- |
| src/content/selection/rich-result-renderer.js | [file-rich-result-renderer](#file-rich-result-renderer) | 当前完整解释 |
| src/content/selection/translation-query.js | [file-translation-query](#file-translation-query) | 当前完整解释 |
| src/background/selection/reading-result.js | [file-reading-result](#file-reading-result) | 当前完整解释 |
| src/content/selection/record-access.js、record-client.js、record-status.js | [Reading 产品模块](reading-records.md#file-record-access) | 当前完整解释，跨章不重复计数 |


<a id="file-selection"></a>
## src/content/selection/selection.js

> 历史章节：以下解释绑定 d5e308a；本轮未逐行重读，不升级为 d5246ca 当前完整复核。

[固定源码 L1–L99](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/selection.js#L1-L99)。本节完整解释本文件；子依赖不随之计为完整。

**职责与入口。** classic IIFE 在 runtime 存在且尚未安装 selection 时注册 API。controller 使用 readSelection/isExtensionOwnedNode，popover 使用 refreshRect/installInteractionIsolation/clearPageSelection。它只读取浏览器选择与几何，不查询词典、不调用网络。

**算法与输入输出。** readSelection 拒绝空、collapsed、无 Range 与扩展自有 commonAncestor；cloneRange 后交 sourceSnapshot.canonicalize，并将浏览器选文的普通空白折叠。isEligibleText 经 cleanText 后要求长度 2–2000，拒绝 http(s)/www 纯 URL，至少两个拉丁字母，拉丁/(拉丁+CJK)≥0.35。有效 Range 首选 bounding rect，零尺寸再取最后 client rect，均无尺寸则 null。成功返回 text/range/rect/sourceRevision/pageUrl。

**状态、失效与安全。** 无自身持久状态；refreshRect 会就地更新传入 snapshot.rect，几何失效时保留旧 rect。isExtensionOwnedNode 沿父节点或 shadow host 向上最多 500 层查扩展标记。面板 isolation 在 pointerdown/mousedown/click 捕获阶段清选区，在 pointer/mouse/click 冒泡阶段 stopPropagation；这不是阻止网页所有 capture listener，也不是数据保密沙箱。这里只做 eligibility，敏感上下文策略在 projection policy。

**失败/取消/修改影响。** 不抛业务错误包装，返回 null 交 controller 决定隐藏；没有取消请求。调整阈值只影响入口显示，不自动改变后台 0.6 意图阈值。改 Range 或事件隔离需同时验证 snapshot/context、面板点击与复制。tests/reading-text-projection.test.mjs 涵盖下游规范化/源证据；tests/selection-ui-contract.test.mjs 只静态验证部分面板契约；本文件全部浏览器交互未据此证明。NOT_RUN。

<a id="file-source-snapshot"></a>
## src/content/selection/source-snapshot.js

> 历史章节：以下解释绑定 d5e308a；本轮未逐行重读，不升级为 d5246ca 当前完整复核。

[固定源码 L1–L105](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/source-snapshot.js#L1-L105)。本节完整解释本文件；子依赖不随之计为完整。

**职责/调用关系。** selection.readSelection 调 canonicalize；controller 点击时调用 capture，context 也可复用 capture。依赖 textProjection、policy、builder；注册 capture/contextRoot/canonicalize。只生成本地查询证据，不保存 Reading、不访问后台或 Provider。

**捕获算法。** 每文档生成 documentGeneration；contextRoot 找近邻 p/li/blockquote/dd/dt/figcaption/标题/article/section/main 或当前元素。capture 新建共享 slice budget，读 sourceRevision 与 rangePolicy。先投影局部，位置去首尾普通空白，并用折叠普通空白后的文本比对证明选区一致；上下文围绕选区中点裁至最多 900，prefix/suffix 各 120。只在局部是完整块时才尝试 document.body 全页坐标；全页对应子串一致才给 anchor.status=resolved。localProjection 遇字符/节点/时间预算失败且选区仅在一个文本节点时，用前后各 600 的 CharacterData 窗口退化，窗口≤4000，继续服从同一预算，不无界读取巨大 nodeValue。

**输出与生命周期。** capture 同步返回 sourceRevision/root/selectedText/capability/context/sourceSnapshot:null/ready。context 被 freeze；ready 对已捕获字符串计算 SHA-256，填 sourceDigest 和 blockDigest，再冻结 DTO、quote、anchor/position。DTO 包括 schemaVersion、sourceSnapshotId、projectionVersion、文档/选区代次、quote、position、capturedAt。局部窗口不能证明全页位置，capability 保持 unsupported，但 text/context 可用。随机 document 标记只证明本地实例，不能替代可信 sender。controller 不等待 ready 才发普通查询。

**失败、安全与取消。** 选文为空/超 2000/含禁用控制符时 ready 拒绝；WebCrypto digest 失败标 digest-unavailable，内部挂 catch 避免未处理拒绝，调用方仍可观察原 ready 拒绝。异步摘要不重读 DOM；旧 capture 不会由本模块自动撤销，由 controller 的 revision/generation 屏障限制使用。canonicalize 只有局部文本比对与反向 Range 映射成功才换 Range，否则原样返回。敏感/未知 root 不收集普通周边证据，后台还有二次清洗。

**测试/改动。** tests/reading-text-projection.test.mjs 明确断言同步冻结、延迟 hash 不重读 DOM、巨型节点窗口、预算、敏感/unsupported、digest 不可用及非法 DTO 退化。改投影版本、空白或坐标语义会影响源摘要和未来锚点兼容，需连同 builder/policy/controller 复核；不允许仅为了命中放宽隐私 proof。NOT_RUN。

<a id="file-context"></a>
## src/content/selection/context.js

> 历史章节：以下解释绑定 d5e308a；本轮未逐行重读，不升级为 d5246ca 当前完整复核。

[固定源码 L1–L11](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/context.js#L1-L11)。本节完整解释本文件；子依赖不随之计为完整。

**职责/API。** 极薄的 classic 兼容入口，要求 selectionSourceSnapshot 与 selection 已安装。captureSelectionContext(snapshot, options) 在无 range/text 时返回 {text:"", sensitive:false, source:"none", truncated:false}；正常优先返回 snapshot.sourceCapture.context，没有冻结捕获才现场调用 capture(snapshot,options).context。isSensitiveRange 委托 textProjectionPolicy.rangePolicy(...).sensitive。

**调用、状态与边界。** controller 的 resolve 和 explain 都调用它，冻结捕获存在时不重新读取 DOM；没有自己的缓存、网络、存储或取消状态。异常不包裹，投影策略/捕获负责界限；敏感标记不代表选文被丢弃。测试由 reading-text-projection 的证据/敏感性测试及 selection-v2 的后台清洗测试间接覆盖，不能把这两者称完整 UI 实测。

**改动影响。** 若改成始终重新 capture，会使用户触发时冻结的文本与后来上下文错配；新增选项必须与 source-snapshot 和后台 900 字符限制一致。NOT_RUN。

<a id="file-selection-contract"></a>
## src/shared/selection.js

> 历史章节：以下解释绑定 d5e308a；本轮未逐行重读，不升级为 d5246ca 当前完整复核。

[固定源码 L1–L216](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/selection.js#L1-L216)。本节完整解释本文件；子依赖不随之计为完整。

**职责与纯合同。** 导出 DEPTH(auto/concise/standard/professional)、INTENT(lexical/translation)、ROUTE(local/translation/needs-explanation/unresolved) 及深度、意图、路由和上下文纯函数，不访问 chrome/DOM。

**分类算法。** normalizeSelectionDepth 将未知值回退 auto。classifySelectionIntent 规范化选文，按 Unicode 字母数字及代码常见符号统计 token；空文本、不支持简中目标、不满足拉丁占比≥0.6/至少两字母都走 translation。长度>120、token≥7，或至少四 token 且以句末标点结束/含逗号冒号分号+空格，也走 translation；余下为 lexical-token/phrase。简中识别兼容 simplified-chinese/zh-cn/zh-hans/简体中文/简体-中文。

**路由算法。** 缺失 intent 或 translation、local unsupported、无命中多 token 分别走普通翻译，均不允许 explanation。sufficient 或 ambiguous+候选：默认 local，explainRequested 才 needs-explanation。ambiguous 无候选或单词 no-hit：默认 unresolved，显式请求才 needs-explanation。error/未知为 unresolved 且不开放解释。auto 深度对 translation/sufficient 为 concise，其他 standard，手动深度保留；深度不等于自动联网开关。

**数据、安全、失败。** sanitizeSelectionContext 将 sensitive 周边清空，否则 normalize 后 slice 至默认 900；只允许 visible-local 或 none 来源，敏感改 selection-only，合并 truncated 标志。不校验可信 sender、不保存数据、不发请求，也不取消任务；所有结果是纯对象供 resolver/explain 消费。

**测试与修改。** tests/selection-v2.test.mjs 覆盖分类、四种深度、显式解释、短语 miss、敏感裁剪及 resolver 使用；改变 token/语言阈值或路由会改变联网/费用边界，必须一起核对 controller、resolve、explain 和用户文案。NOT_RUN。

<a id="file-resolve"></a>
## src/background/selection/resolve.js

> 历史章节：以下解释绑定 d5e308a；本轮未逐行重读，不升级为 d5246ca 当前完整复核。

[固定源码 L1–L97](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/selection/resolve.js#L1-L97)。本节完整解释本文件；子依赖不随之计为完整。

**职责/API。** resolveSelectionRequest(input={},deps={}) 是 SELECTION_RESOLVE 路由目标，也是 explanation 重新判定的入口。依赖可注入 getConfig/getEffectiveConfig/runLexicalLookup/assessLexicalLookup 便于纯测试；输入 text/pageUrl/context/depth/explainRequested，输出路由和可展示/解释的数据，不带 ok 包装（router 添加）。

**步骤。** 并行读存储配置与 page EffectiveConfig；输入 depth 优先于配置，目标语言优先有效配置。先 classify 和 sanitize context。translation 意图直接 chooseSelectionRoute，不做 lexical；lexical 则以 en→zh-CN 与有界 contextText 调 gateway，再 assess、choose。response 返回 intent/route/routeReason/depth/explanationAllowed/lookup/decision/contextPolicy；只有 needs-explanation 才添加 selectionText/contextText/sensitive/depth/candidates 组成 explanationInput。

**状态与错误。** 无本地持久缓存、request Map 或 AbortSignal；SELECTION_RESOLVE 消息不携带 task id 供本模块取消。配置/未知检索错误上抛 router；typed lexical error 经 decision 路由为 unresolved。取消后的旧返回依靠 Content assertCurrent 丢弃，不能声称 resolve 内每个磁盘查询都被取消。

**边界与修改。** 这里不调用 Provider；但返回 translation 可使 controller 后续调用 Provider，因此“resolve 无网络”与“整个动作无网络”不同。pageUrl 仅用于有效配置/术语表，不加入 explanationInput。tests/selection-v2.test.mjs 验证 translation 旁路时 lexicalCalls=0、local 候选、敏感无 URL/周边、technical facts；改返回结构需一起更新 shared route、result-model 与 explain。NOT_RUN。

<a id="file-controller"></a>
## src/content/selection/controller.js

[固定源码 L1–L415](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/src/content/selection/controller.js#L1-L415)。本轮全文件复读并完整解释；子依赖不随之计为完整。

**职责/状态所有权。** selectionController.start 由 Content 组合启动；模块守卫检查 runtime/tasks/selection/context/popover/model/clipboard/messages/rich-details，只导出 start/getQuerySource。持有 started、activeSnapshot、activeTask、requestVersion、selectionTimer，以及 recordContext；可选创建 selectionRecordClient，并把其状态交 record-status。translation-query 工厂被注入 assertCurrent/showResult/onResult；旧注册列表缺新模块时只提示刷新，不偷偷走另一条翻译/记录路径。start 幂等注册 mouseup/keyup/selectionchange、外部 pointerdown、Escape、scroll/resize，并连接 projection 与 rich lifecycle；focus/visible 调 records.refresh，projection 改变和离页清 Reading reference，popstate/hashchange 还按完整 pageUrl 检查。常驻事件没有 stop API；dismiss 不是卸载模块。

**从选择到任务。** 90 ms debounce 后 readSelection；没有新有效选择但已有快照时保留浮层。same text+sameRange+同页面只更新 rect；新选择取消旧 task/rich、关闭旧 Reading context、清记录状态、增加版本、记录 selectionGeneration、watchPage，显示 chip。点击 freezeQuery 同步写 sourceCapture 与 selectedText；如果先 await 旧任务取消，再用 isFrozenCurrent 比对对象/捕获/修订，避免点击途中 DOM 改变还发新请求。beginTask 创建 total=1、surface=selection；可信 click event 原样传给 records.start，Reading 的 isCurrent 同时要求冻结 source 仍有效和完整 pageUrl 未变。只展示 chip 不 start Reading。

**主分支与消息。** translateSnapshot 默认发 SELECTION_RESOLVE，local 需有 primaryMeaning，完成 task 后显示卡并异步 loadRich；translation 调 translateSelection；no-hit-local 显示 AI/普通翻译双动作空态并 loadRich；其他 unresolved 以 messages 显示错误，只有 lexical intent 才启动 rich。forceTranslation 直接普通翻译。translateSelection 已提取到下述 translation-query，保留 cache→Provider→store 顺序。local/no-hit 分支在结果可用后把 model.readingDictionary 交 records.accept；ordinary translation 由 query 模块回调接入，基础查询与 Reading 保存互不冒充成功。loadRich 的 onDisplay 回调经 model.readingRich 后，以 rich:dictionaryId 为 key 追加。

**AI 与复制。** explainSnapshot 若当前 recordContext 与已冻结 source 仍匹配则复用 capture，否则重新冻结；建立 task、增加版本，取 context；baseCard 有 primaryMeaning 时只开 AI 附加区。SELECTION_EXPLAIN 返回 local/translation 且无 baseCard 时可显示对应结果；有 baseCard 时拒绝这种不再适配的增强。explained 必须有 generated.explanation；带 baseCard 仅合并 generatedMeaning/explanation 并更新复制动作，本地卡不覆写。已有卡由 records.assistant 用该次可信点击新建 assistant operation；无卡则 start(purpose=assistant)。只有真正 explained completion 才 model.readingAssistant→accept(APPEND)，本地结果和翻译回退不会伪装 assistant；之后 render 记录状态。copyAction 只在用户点击时 writeText，成功/失败 toast；结果出现不自动复制。

**过期、取消与错误。** 每次后台 await 后 assertCurrent 先 tasks.assertActive，再验证 version、snapshot 引用、projection.revision 和页面身份；SelectionSupersededError 静默丢弃。explain catch 用完整 isCurrentSelection，主查询 catch 检查 snapshot 引用后显示失败。dismiss 取消 task/rich、close Reading context/清 record-status、清 activeSnapshot、watchPage(null)、递增版本、hide、恢复 quick-control。cancelActiveTask/cancelAiDetail 发取消但不等待返回就更新本地取消 UI；底层任务采取本地权威状态，不能据文案断言 Provider/缓存已回滚。rich 查询另有 session/request 屏障。

**测试/改动。** selection-ui-contract 是源码模式断言，selection-multi-dictionary 是独立 rich 的 fake runtime，不能拼成整 controller 已浏览器通过。reading-text-projection 覆盖它依赖的源冻结/修订基础。改按钮触发、await 次序、版本号必须联动 task、projection、rich lifecycle；尤其 AI 增加 requestVersion 后旧 rich callback 也会过期。缺 record client 时正常结果仍可显示，但状态提示阅读记录暂不可用；records.close 的保存取消 ACK 与普通 task 本地取消 UI 是独立语义。NOT_RUN。

<a id="file-result-model"></a>
## src/content/selection/result-model.js

[固定源码 L1–L244](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/src/content/selection/result-model.js#L1-L244)。本轮全文件复读并完整解释；子依赖不随之计为完整。

**职责/API。** 纯数据适配 classic 模块，导出 buildLocalResult/buildExplainedResult/buildTranslationResult/copyTextForCard，以及 readingDictionary/readingTranslation/readingAssistant/readingRich；controller 消费，renderer 不负责挑选候选。

**本地转换。** 优先 decision.candidates，否则 lookup.candidates；topCandidateId 只前移该候选，其余保持次序。无候选返回 null；本地 primary 从首 translation、最多两个 typeLabels、headword 依次退化。保留提供的 pronunciation/词性/domains/typeLabels 与其余 senses；最多五个 dictionaryEntries，每条保留 id/kind/事实/来源与 primary，moreEntryCount 记录余项。technical-concept/entity 标 technical。provenanceLabel 是简化显示标签（技术词条/本地词典/词典包 ID），不是新事实或信任认证。

**AI/翻译转换。** explained 优先 generated 所选 ID 对应的本地 candidate，再 topCandidateId，再首项；无候选用空 explained 底座。本地意义优先，生成 translation 仅作缺省 primary 或不同的 generatedMeaning，explanation 与 AI 辅助 badge 独立。buildTranslationResult 只做 trim 与翻译 badge。模型不解析 HTML、不调用 Provider、不持久化。

**复制与边界。** 多 dictionaryEntries 输出编号、词性/来源/领域/类型和逐条译法；单卡输出 primary+senses；随后附余项提示、generatedMeaning、explanation。uniqueText 去空去重，dedupeBadges 按 label 去重。没有异步/取消；输入缺失宽松退化，业务空卡错误由 controller 处理。

**Reading artifact 适配。** readingDictionary 对明确 no-hit 保存 outcome=no-hit、空 definitions/provenance；hit 只取排名首候选，最多八条定义各240字符和四条 sourceRefs，要求 definitions/provenance 均非空。它不把 UI 最多五个候选全部存成同一权威结果。readingTranslation 只接受实际非空显示译文及后台 readingResult.provenance；没有结果来源则 null。readingAssistant 只取显示的 generatedMeaning/必要时 primaryMeaning 与 explanation，preserveLocal 避免把本地释义抄成 AI；固定 completed，新的 thread/turn/branch UUID、parent/regeneration=null，真实 userQuestion/action/targetLanguage/provenance 来自后台。这不是多轮 assistant 产品。

readingRich 只消费 renderer 的实际已显示纯文本投影，要求 id 与 dictionary 相同、存在查询返回的 packVersion 和 string text。空摘要、仅词头、可疑 HTML/样式占位、file/sound/entry/http(s) 资源引用、Windows 路径或 /home/ 字样返回 null；最多八行×240字符，provenance 是 local-rich-mdict、dictionary.id、实际 packVersion、headword。不存 rawRecord/MDD/CSS/私有文件路径；这层模式过滤是有限防御，不能称全面 PII 检测。最后仍由 record-client 的 artifact validator 检查严格字段/容量。

**测试/改动。** tests/selection-result-model.test.mjs 验证独立 senses、Core/Technical 分界、保留所给元数据、五项上限且不改排序。修改字段同时改 renderer/复制和解释合并逻辑，不能把 AI provenance 混入本地 badge。NOT_RUN。

<a id="file-result-renderer"></a>
## src/content/selection/result-renderer.js

[固定源码 L1–L205](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/src/content/selection/result-renderer.js#L1-L205)。2026-10-03 全文件复读并完整解释；子依赖不随之计为完整，所有运行 **NOT_RUN**。

**职责/输出。** 注册 render/appendRichDictionaryDetails/appendRichDictionaryCards，由 popover 调用。render 清容器、接受字符串或结构化卡，设置 resultKind，先词头/发音/词性，再多候选或 compact meaning、最后来源 badges，返回 generatedMeaning/explanation 给独立 AI 区。普通字段全用 textContent；无内容时显示暂无结果。compact senses 最多五个，facts 最多六个，多候选保持编号、primary/kind、独立来源和未展开数量；uniqueText 去空去重。无请求、存储或异步状态。

**rich 分离与升级退化。** 两个 append 方法现在委托 selectionRichResultRenderer，不再拥有 rich card/sanitizer/viewer 逻辑。旧注册列表加载新字节但缺新 rich renderer 时，保留原结果并追加“扩展已更新，请刷新网页后查看详细词典释义”，分别返回 false/[]；不触碰 rawRecord，不自动请求词典，也不因缺模块使整个 Content 注册失败。

**错误/清理/改动。** 缺 render 容器抛明确错误；容器清空负责释放当前 DOM，资源 closeAll 和请求取消归 popover/controller。不能把这个门面称为 sanitizer 全实现。selection-upgrade-registration 的 JSDOM 断言老列表/新字节与新列表两种能力窗口，selection-ui-contract 仍是源码模式；本轮 NOT_RUN。改字段同时复核 model、popover、split renderer 与新旧注入列表。

<a id="file-popover"></a>
## src/content/selection/popover.js

[固定源码 L1–L399](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/src/content/selection/popover.js#L1-L399)。本轮全文件复读并完整解释；子依赖不随之计为完整。

**职责/依赖。** selectionPopover 管扩展自有 selection layer 的 DOM、按钮回调和位置；依赖 uiHost/uiPrimitives、selection、AiDetail、EmptyState、ResultRenderer。不是请求协调器。ensureUi 按需创建 chip 与非模态 role=dialog 面板，aria-modal=false；source/status/result/actions 分区，status/result aria-live=polite，close 将控制交给 controller。chip/explain/retry click 将原 event 交上层，Reading 才能验证 isTrusted 与 UI 归属；chip pointerdown.preventDefault 保住点击前选区；panel 安装交互隔离。

**状态迁移。** showChip 绑定 translateHandler 并隐藏 panel；showLoading 清页面选区、清结果/AI/empty、显示 cancel、定位并下一帧 focus close；setLoadingStatus 只更新已有可见 panel。showResult 清旧动作，绑定 copy/可选 explain，调用结构化渲染，再交 AI 部分展示生成字段。showError 清结果、显示 retry/可选 explain；showEmpty 清按钮并委托 emptyState。showAiDetailLoading/Result/Error/Cancelled 只操作附加区，隐藏主 explain 按钮；成功可更新复制 handler，不重绘本地主卡。

**布局/清理。** updateSource 以 NFKC、折叠空白和不区分大小写比较词头，lexical/local/technical/explained 同词头时隐藏重复 source。position 读 refreshRect，rAF 后读取元素尺寸，以 10px margin 限制横向，优先选区下方、溢出改上方或顶部。reposition 用当前 panel 或 chip。contains 实际委托 uiHost.ownsNode，范围不只某个按钮。hide 移除 root、reset AI/empty、置空节点/snapshot/动作；closeHandler 保留供重建。多个切换/销毁入口调用 richResourceResolver.closeAll，函数存在性用可选调用；本模块不直接释放 backend request。

**失败/安全/测试/改动。** 没有网络或持久化，展示数据经 renderer/textContent；没有自有业务重试，仅保存调用者回调。源码含未被调用的 uniqueText helper，无隐藏副作用。selection-ui-contract 验证非模态、ARIA、方法/样式契约，但真实焦点恢复、窄屏、滚动位置需浏览器验证；本轮 NOT_RUN。改 UI 生命周期须保留 callback 清理、closeAll、isolation 和 controller stale 屏障，不能让隐藏面板仍绑定旧任务。

<a id="file-rich-details"></a>
## src/content/selection/rich-details.js

[固定源码 L1–L317](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/src/content/selection/rich-details.js#L1-L317)。本轮全文件复读并完整解释；子依赖不随之计为完整。

**职责与状态。** 导出冻结的 load/cancel/dispose(cancel 别名)/bindLifecycle。持有模块级 lookupQueue、runningLookups（上限 3）、activeSession、文档 owner token、路由 watcher。session 包含 snapshot/version/expectedPage/isCurrentSelection/onResult、cancelled/cancelPromise、每词典 lookupStates 和 queued/inFlight/pending 集合。controller 在主结果完成后调用 load；新 session 先取消旧 session。

**列表/延迟读取。** load 发 VIEWER_LIST，只在 isLiveSession（当前引用、未取消、外层选择仍有效）且 ok 时交 popover 建卡，失败静默以免覆盖主结果。card 展开调用 lookupDictionary：非 ready 的元数据立即独立报有限错误码；正常每词典 inFlight/settled 去重，显式 retry 可重新查。每次新 requestId，派发 LOOKUP 携带本次选文、dictionaryId 与固定 Content 文档 token。返回必须 ok/无 errors、found 且 dictionary record ID 对卡；不匹配报错，无命中 empty，异常可重试。每次 await 后再次检查 live。成功 card.setResult 的 onDisplay 再查 live，只有卡片真正展示后才把 displayed projection 与 dictionary 元数据交 session.onResult；后台响应到达、折叠卡预备完成都不是可保存显示结果。

**队列与取消。** scheduleLookup 创建 Promise/job 并登记，drainLookups 只在全模块运行数<3时派发；旧 session 排队项直接 settle null。slot 在真正 action Promise finally 才递减，cancel 不伪造空闲槽。cancelSession 幂等：标 cancelled、清 active 与路由 timer，移除队列、settle 全部待处理 Promise，卡片标停止，再对 inFlight requestIds 发 LOOKUP_CANCEL(ownerToken)。allSettled 后返回 cancelled=requestIds.length>0；它没有检查后台确认值，故这是本地失效/尝试取消的结果，不是每个底层 read 已被 abort 的证明。旧底层返回也无法再写 live 卡。

**导航与身份。** bindLifecycle 注册 popstate/hashchange/pagehide，支持 Navigation API 时用 navigate destination URL，否则仅 active rich session 期间 50ms 定时比页面身份；离页触发 controller dismiss。listener 保留至文档结束，没有全局解绑 API。request ID 用 16 随机字节前缀，ownerToken 为文档内稳定 32 hex；crypto 缺失仅测试/旧 harness 有 Math.random fallback，后台可信 documentId 优先。safeErrorCode 清控制符、限 64；状态文本限 48，不展示完整原始错误。

**测试/改动。** selection-multi-dictionary 断言并发上限、旧队列丢弃、独立错误/重试接口、旧结果不入卡、cancel request IDs 与 ownerToken；selection-content-owner 测后台 identity。修改 session/key 或取消顺序须联动 router 与 lookup controller，UI 关闭与真实 I/O 停止分别验收。NOT_RUN。

<a id="file-ai-detail"></a>
## src/content/selection/ai-detail.js

[固定源码 L1–L143](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/src/content/selection/ai-detail.js#L1-L143)。本轮全文件复读并完整解释；子依赖不随之计为完整。

**职责/API。** create({container,onResize}) 缺 container 抛错；返回 reset/ensure/loading/success/error/cancelled，供 popover 管局部 AI 区，保留本地主卡。闭包只持有当前 section node；ensureNode 在旧节点已断开时重建，reset 移除并清引用。

**展示。** render 每次 replaceChildren，dataset.state 与 aria-busy 标加载，idle 隐藏；固定“AI 详解”标题，success 增 AI 辅助 badge，并将 generatedMeaning/explanation trim 后以 textContent 展示。loading/error/cancelled 用状态文字，可根据函数参数生成“重试”/“取消”按钮及明确 aria label；重试保留原 click event，每次结束调用 onResize。没有 Provider、缓存或词典写入；状态由外层驱动，不确认取消是否实际完成。

**测试/修改。** selection-ui-contract 仅从源代码确认 controller 保留本地卡、AI 方法及 aria-busy/按钮标签。异常/空文字宽松退化，无内部 retry 次数/异步请求。调整 AI DOM 不应修改本地主卡的来源或 copy 内容，须联动 popover/controller/result-model；真实键盘与布局 NOT_RUN。

<a id="file-empty-state"></a>
## src/content/selection/empty-state.js

[固定源码 L1–L60](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/src/content/selection/empty-state.js#L1-L60)。本轮全文件复读并完整解释；子依赖不随之计为完整。

**职责/API。** create 要求 container，返回 reset/show；popover 用它区别“未收录”与错误。show 先 reset、设置 container.dataset.resultKind=empty，新建 section、标题和消息，缺省为本地暂未收录；只有传入函数才生成 AI 详解/普通翻译按钮。均用 textContent 与 uiPrimitives.button，click 回调转发原 event，由 controller/access 执行可信动作校验。

**状态/失败/安全。** 唯一 node 随 reset 移除，reset 同时删除 resultKind；show 最后 onResize。无后台、存储、自动 fallback、取消或自行重试。缺 container 抛错，缺动作时仍可显示中性解释；不能把 storage/corrupt 错误交这里装成 miss。

**测试/改动。** selection-ui-contract 对 empty data/文案/两动作 label 作静态断言；selection-v2 验证哪些 miss 能到此分支。改空态动作需复核单词 miss vs 多词 phrase 翻译区别，确保按钮才发起显式 AI。NOT_RUN。

<a id="file-messages"></a>
## src/content/selection/messages.js

> 历史章节：以下解释绑定 d5e308a；本轮未逐行重读，不升级为 d5246ca 当前完整复核。

[固定源码 L1–L27](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/messages.js#L1-L27)。本节完整解释本文件；子依赖不随之计为完整。

**职责/API。** 纯 unresolvedMessage(resolved) 给 controller 稳定用户文案。ambiguous-local-unresolved 提示可点击 AI；local-error 按 decision.error.code 区分 LEXICON_STORAGE（缺失/不可读）、LEXICON_CORRUPT（校验失败）、LEXICON_INCOMPATIBLE（版本不兼容，建议更新/重装），统一指向设置>本地词典；未知 local error 提示重试，其他为无法确定含义。

**状态/安全/改动。** 无状态、DOM、I/O、取消或持久化，不把原始 error.message/path 直接拼给用户，也不自动开设置/联网。no-hit-local 已在 controller 独立空态处理。selection-ui-contract 对错误码/文案的静态断言是相关证据；改错误码需同步 reader/gateway/ranking，勿把不同故障收敛成无命中。NOT_RUN。

<a id="file-clipboard"></a>
## src/content/selection/clipboard.js

> 历史章节：以下解释绑定 d5e308a；本轮未逐行重读，不升级为 d5246ca 当前完整复核。

[固定源码 L1–L26](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/clipboard.js#L1-L26)。本节完整解释本文件；子依赖不随之计为完整。

**职责/API。** writeText(text) 是 controller 点击“复制”后的 async adapter。navigator.clipboard.writeText 存在时直接 await；该 API 拒绝会向上抛，不再尝试 fallback。仅当 API 不存在才创建 readonly、fixed、透明 textarea，标 data-tf-extension-ui=selection-copy，插入 documentElement、select、execCommand("copy")、移除，返回 false 则抛“浏览器拒绝复制操作”。

**状态/安全/失败。** 不缓存选文、不自动复制；临时 textarea 标记使扩展选择/投影排除它。fallback 正常返回路径移除节点，但不是 try/finally，若 execCommand 本身抛异常，源码不保证移除；这是实现边界，不在本轮改业务。取消不适用，用户回调执行时的浏览器剪贴板权限/焦点可能失败，controller 以 toast 报告。

**测试/改动。** 已读 selection-ui-contract 仅确认 controller 使用 copyTextForCard，不覆盖真实剪贴板权限或上述异常清理；不能宣称测试通过。改 fallback 要联动 selection isolation/projection exclusion，复制格式在 result-model 而非本文件。NOT_RUN。

<a id="file-explanation-contract"></a>
## src/shared/selection-explanation.js

> 历史章节：以下解释绑定 d5e308a；本轮未逐行重读，不升级为 d5246ca 当前完整复核。

[固定源码 L1–L193](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/selection-explanation.js#L1-L193)。本节完整解释本文件；子依赖不随之计为完整。

**职责/API。** 纯协议/缓存身份模块，导出三个版本常量、LIMITS、buildSelectionExplainPayload、parseSelectionExplainResult、buildSelectionExplainCacheIdentity。依赖 hash.sha256 与纯规范化函数，不调用 chrome 或写库。

**输入限制。** payload 选文必填≤2000，context≤900，sensitive 时先清周边，depth 规范化，target 默认 Simplified Chinese≤80；候选最多八。candidate/provenance/sourceRef 都需对象并检查允许键；每事实字段≤六条、每条≤240，来源引用≤四。只输出结构化 id/kind/headword/matchedBy/词性/sense或entity ID/translations/domains/typeLabels/provenance；aliases/queryForm/exactCase/sense prior 等允许输入但不原样传播，ranking.score 必须有限并变为 rankScore。错误 code 为 SELECTION_EXPLAIN_PROTOCOL，而不是偷偷截断超限事实。

**模型输出。** 支持对象、JSON 字符串、去围栏或首尾花括号段，但最终只允许 selectedCandidateIds/explanation/translation。ID 必须来自调用者提供集合、去重后最多三，explanation 必填≤1600，translation 可空≤600；输出及 selected IDs freeze。不会接受模型新增来源或任意 HTML 字段；文字最终由 UI textContent 渲染。

**缓存身份与生命周期。** 对规范化 payload 生成 selection/context/candidate 摘要，词典 packId/version/fingerprint 去重排序；身份含协议/prompt/schema、provider/model/endpoint/目标语言/depth，再 hash 为 selection-explain: 前缀 key，返回 key/identity/payload。没有本地 Map 或持久化；是否允许缓存由 explain 根据 sensitive 决定，此 identity 不代替那道 gate。

**测试/修改。** selection-explanation.test.mjs 断言有界字段、敏感剥离、未知/超限拒绝、已知 ID 与字段、provider/depth/context/pack fingerprint 改变身份；explain-runtime 检查读写调用。改 schema/prompt/候选摘要需审缓存版本与旧结果重校验，避免解释串用。NOT_RUN。

<a id="file-explain-prompt"></a>
## src/background/selection/explain-prompt.js

[固定源码 L1–L36](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/src/background/selection/explain-prompt.js#L1-L36)。本轮全文件复读并完整解释；子依赖不随之计为完整。

**职责/API。** 导出固定问题 SELECTION_EXPLAIN_QUESTION="这里是什么意思？"、SELECTION_READING_PROMPT_VERSION="selection-explain-reading-v2"，buildSelectionExplainPrompt({targetLanguage,depth}) 返回系统 prompt 字符串；explain.runCompletion 使用。目标语言 String/trim 后回退 Simplified Chinese，depth 由 shared normalize，depthRule 分别给 professional/standard/concise/auto 的长短与歧义解释要求。

**信任边界。** 明确输入 JSON 只作引用数据，不能改变规则；明确回答 payload.userQuestion 的固定 understand 问题；只解释所选词/短语和有界上下文/本地候选，禁止伪造 ID、词义、source/provenance，要求 explanation 与 translation 分离，保留技术标识；只输出协议三个字段，ID 可空但不得新增。不是执行页面指令，也不使用页面翻译 config.prompt。

**状态/错误/测试/改动。** 纯函数无状态、缓存/取消/网络，不自行验证模型结果，严格验证在 shared selection-explanation。selection-explain-runtime 断言专用 prompt 且不含页面 prompt；文本变化可能改变生成语义，必须同时审共享解释身份和 SELECTION_READING_PROMPT_VERSION/cache identity，不能只改文案而忘记缓存。NOT_RUN。

<a id="file-explain"></a>
## src/background/selection/explain.js

[固定源码 L1–L157](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/src/background/selection/explain.js#L1-L157)。本轮全文件复读并完整解释；子依赖不随之计为完整。

**职责/状态。** runSelectionExplanationRequest 为 SELECTION_EXPLAIN handler，cancelSelectionExplanationRequest 被 CANCEL_TRANSLATION 共用路由调用。模块 requestsById Map 持 AbortController；输入 requestId 缺省 UUID，同 ID 新请求先 abort 旧请求；finally 仅在 Map 仍指本 controller 时删除，防旧请求清掉新请求。支持依赖注入 resolver/config/completion/cache 做测试。

**请求链。** 先 resolve({explainRequested:true}) 再 assertActive；不需要 explanation 则返回 route/resolved/cacheHit:false/generated:null，不调用 Provider。否则取得页面 EffectiveConfig，用其 provider/model/apiBaseUrl/targetLanguage 和 resolver explanationInput 构造规范 payload/cache identity。当前还以 [selection-explain-reading-v2, 固定实际问题, 旧 cacheKey] 再 SHA-256，避免旧 prompt 结果冒充固定问题答案；把 userQuestion 真正放入发给 Provider 的 payload。构造专用 systemPrompt 后以该 prompt 替换 config.prompt 计算 readingTranslationResult，附 action=understand、真实问题、sourceLanguage，并将 promptVersion 改为 selection-explain-reading-v2。candidateIds 来自最终 payload。

**缓存与 Provider。** !payload.sensitive 才 lookupCache；命中也 parseSelectionExplainResult 重新校验 ID。miss 或 sensitive 调 completeJson({systemPrompt,payload,parseResult}, config,{signal})，成功后只缓存 selectedCandidateIds/explanation/translation，不写本地词典事实/provenance。response 把 generated、cacheHit/key、local decision/candidates、contextPolicy 和 readingResult 分开；cache hit 也返回同一当次配置计算的 Reading provenance。任何配置/缓存/协议/Provider错误上抛 router；无此层自动重试，不能把缓存损坏擅自当 miss。外部 HTTP/重试和 IndexedDB 细节留给相邻模块。

**取消与提交边界。** await resolver/config/cache lookup/Provider/store 后检查 AbortSignal；cancel 找不到 id 返回 false，找到则 abort、删 Map 返回 true。store 已开始后再 abort 不能撤销写入；assertActive 可阻止成功回包，但不是事务回滚。sensitive 禁止本解释缓存读写，却仍允许显式请求发送选文与有限候选；后台清周边，不把全部请求都称无敏感数据。

**测试/修改。** selection-explain-runtime 检验显式重算、本地 sufficient 增强、专用 prompt、只存 generated、cache hit 绕 Provider、sensitive 不查不存、signal abort；selection-explanation 检验协议身份。改请求 Map/key/cache gate 须复核 controller/task/router，共享 ID 的取消不能误伤新请求。NOT_RUN。

<a id="file-rich-lookup-controller"></a>
## src/background/packs/rich-mdict-lookup-controller.js

[固定源码 L1–L147](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/src/background/packs/rich-mdict-lookup-controller.js#L1-L147)。本轮全文件复读并完整解释；子依赖不随之计为完整。

**职责/注入。** createRichMdictLookupController 接收 stateStore、lookup、assertSourceSize、loadIndex、sourceReader、clampUtf8Text，返回 lookupText/cancelLookup；rich-mdict manager 将其暴露为 lookup/lookupDictionary/cancelLookup。完整解释的是查询协调器，不含注入的 MDX 索引、解压、OPFS 实现。

**检索与输出。** lookupText 规范 query/可选 dictionaryId，有 lookupIdentity 才 beginOperation 得 signal。read state 前后检查 abort；指定词典非 rich source 返回 NOT_INSTALLED，非 healthy 返回 UNAVAILABLE。遍历健康 rich packs，核对 snapshot、源大小、加载索引，再以 sourceReader(...signal)、index、text、signal 调 lookup，每步检查 abort。found 记录从 active snapshot 带出 packVersion，并返回限长 title/headword/text 与 richRecord(rawRecord 按 UTF-8 字节限额、format、styleSheetRules)，可带 aliasTarget、受限 metrics。单本异常收集为 errors 而不抹去其他结果；AbortError/已 abort 立即传播，最终 found 由 dictionaries 是否非空决定。

**状态与竞态。** operationsByRequest 存 requestId/ownerKey/controller；重复活跃 ID 报 BUSY，ownerKey 不能为空、≤512、不能含控制符。cancel active 只允许 owner 相等并 abort；尚未派发时记录 tombstone，15 秒 TTL、最多 128，后续同 ID/owner beginOperation 消耗 tombstone 并 AbortError，不匹配 owner 拒绝。prune 在 begin/cancel 时执行，无后台 timer。finally 仅移除仍为本 operation 的 Map 项。

**安全/取消范围。** 无 lookupIdentity 的旧调用仍可查但没有 request 级 controller；面板正常指定 dictionaryId 路径带可信路由派生 owner。rawRecord 限长不等于 sanitize，必须走 Content sanitizer/viewer；此层无 Provider 或远程资源请求。取消是 signal 协议，底层是否及时停止取决于被注入 reader/decompressor 的合作；不能只凭 cancelled:true 推断所有 I/O 已终止。

**测试/修改。** rich-mdict-lookup-cancellation.test.mjs 包含 owner 隔离、cancel-before-dispatch、key range、decompression reader 与 OPFS Blob stream abort 测试；selection-content-owner 验证上游 owner。改 TTL/ID/owner 或 abort 检查位置需联动队列、router/API 和 range read，尤其取消结果不可作为删除词典/回滚导入授权。NOT_RUN。



<a id="file-rich-result-renderer"></a>
## src/content/selection/rich-result-renderer.js

[固定源码 L1–L239](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/src/content/selection/rich-result-renderer.js#L1-L239)。2026-10-03 全文件复读并完整解释；子依赖不随之计为完整，所有运行 **NOT_RUN**。

**职责/入口。** classic 模块独立注册两个 append 方法。旧批量 details 入口最多展示五本和三个错误，正常 controller 经 appendRichDictionaryCards 创建逐词典卡。按有限 order、再原位置稳定排序；每张 details 显示顺序、title、个人首选、trustLabel 与 format，preferred/expandedByDefault 默认展开。文字用 textContent，不把偏好当信任证明。

**局部状态与延迟展示。** card 暴露 isOpen/setLoading/setError/setEmpty/setResult；dataset.state 和 aria-live 描述 idle/loading/error/empty/success。错误可生成独立 retry，并阻止事件冒泡。setResult 只保存 pendingResult；折叠时显示已就绪提示，展开时 renderPendingResult，resultDisplayed 保证一次构建和一次 onDisplay。toggle 仅打开时触发 onLookup，去重归 rich-details；收起不自行取消后台读取。闭包随父容器清理，不持有全局请求状态。

**安全树与实际投影。** renderRichDictionaryRecord 先展示 headword；若有 richRecord/sanitizer/viewer，sanitize 得未 truncated safeTree 才 viewer.render，传 dictionaryId 和 text 格式 preserveNewlines。失败/异常退回 viewer.renderPlainText 或 textContent fallback。完成后读 body.shadowRoot 中 `.tf-rich-viewer` 的 textContent；无富文本成功展示时可用纯文本 bodyText。返回 {id,headword,packVersion,text} 给 onDisplay，绝不把 rawRecord 直接交 Reading。成功 rich 但拿不到 viewport 时 text=""，后续 adapter 拒绝保存，不能猜正文。

**数据边界/测试/改动。** 此处不直接截成 Reading 字段，最终八行×240字符及风险过滤在 model.readingRich、严格 DTO 在 record-client；因此“已显示投影→有界存档”是跨文件链。packVersion 来自 lookup 返回的 active pack，而不是 UI 偏好元数据猜测。appendRichDictionaryDetails 兼容入口没有 onDisplay，不据其存在宣称必然记录。rich-viewer-contract 新增显示时机/投影断言（本轮只读相关部分），upgrade-registration 与 Selection Reading E2E 覆盖新模块装配和实际 rich summary。全部运行 NOT_RUN；sanitizer、CSS、MDD/Blob 内部仍由相邻章解释。

<a id="file-translation-query"></a>
## src/content/selection/translation-query.js

[固定源码 L1–L64](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/src/content/selection/translation-query.js#L1-L64)。2026-10-03 全文件复读并完整解释；子依赖不随之计为完整，所有运行 **NOT_RUN**。

**职责/依赖。** classic 模块要求 runtime/tasks/result-model，create 注入 assertCurrent、showResult、onResult，返回 translateSelection(snapshot,task,version,expectedPage,queryRecord)。它是从 controller 提出的普通翻译路径，不新增第二套任务系统；任务、UI 状态及取消由既有调用方负责。

**顺序和数据。** 状态 cache_lookup→CACHE_LOOKUP 单项 id=selection；命中 trim 后 completeTask(cacheHits=1)，构造/展示实际译文，再 onResult(queryRecord,readingTranslation(cached,lookup.readingResult))。miss 切 translating，TRANSLATE_BATCH 带 task.id；找到非空对应译文才切 storing，CACHE_STORE 原文/译文和当时 document.title。缓存写 ACK 后 completeTask(apiTranslated=1)，显示，再用 translated.readingResult 保存 artifact 来源；不会拿后来 CACHE_STORE 的配置替换已生成答案 provenance。

**过期/失败/取消。** 每次消息 await 后注入 assertCurrent，响应错误抛 tasks.responseError；无译文也抛错。旧选区、缓存提交失败时既不展示完成也不发 Reading completion。模块没有内部 Map、自动重试、AbortController 或 Reading 开关，更不因保存失败再调用 Provider；外层捕获并控制 UI，Reading 接收之后有独立队列。selection-translation-query 的 fake runtime 三场景覆盖缓存命中、miss 顺序与 stale/写失败；本轮仅读源码、NOT_RUN。

<a id="file-reading-result"></a>
## src/background/selection/reading-result.js

[固定源码 L1–L9](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/src/background/selection/reading-result.js#L1-L9)。2026-10-03 全文件复读并完整解释；子依赖不随之计为完整，所有运行 **NOT_RUN**。

**职责/输入输出。** readingTranslationResult(pageUrl,config) 调缓存模块 getCacheContext，取 configHash，返回 targetLanguage 与 {provider,model,promptVersion:"translation-prompt-v1",providerConfigFingerprint:configHash}。router 在同次 translation/cache lookup 使用同一 EffectiveConfig；explain 传入专用 system prompt 后再改 promptVersion。

**边界/失败/影响。** 不返回 endpoint、prompt、API key，不接触 Reading IDB、不发 Provider 请求、无自有状态/取消/容错；配置身份计算失败直接上抛调用链。fingerprint 是关联配置的摘要，不是答案真实性签名。reading-result-provenance 测试断言私密设置值不出现在 JSON 且 prompt 变化会改摘要；本轮 NOT_RUN。改字段必须联动 artifact 的 provider provenance 合同，不能把 URL 或原始配置当便于调试的附加字段。

<a id="partial-router"></a>
## 部分：消息、pack API 与 rich manager

本轮只补读 [router.js 的 TRANSLATE_BATCH/CACHE_LOOKUP 分支](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/src/background/router.js#L90-L156)：每个分支先取一份 config，同一 config 用于实际翻译/缓存查找和 readingTranslationResult；回包包含 readingResult。CACHE_STORE 仍另取配置，不承诺跨消息配置原子冻结。router 的其余职责和下列 pack API/manager 保留历史局部说明，整文件仍 partial。

- [src/background/router.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/router.js)
- [src/background/packs/api.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/api.js)
- [src/background/packs/rich-mdict.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdict.js)

- router 的普通包装为 `{ok:true,...result}`，异常为 `{ok:false,error,errorCode}`；Reading 消息另有 envelope，不能混用。SELECTION_RESOLVE/EXPLAIN 分别转到本章完整模块；CANCEL_TRANSLATION 同时取消普通翻译和 Selection explanation。
- VIEWER_LIST、指定 dictionaryId 的 LOOKUP、LOOKUP_CANCEL、MDD resource/cancel 验证 sender 为本扩展、含整数 tabId 且 URL 为 http(s)。ownerKey 包含 tab/frame、优先 Chrome documentId，无 documentId 才接受 32 hex ownerToken。same-document URL 改动不改变 token 身份，URL 不是 request owner 的唯一依据。
- 不要把该检查概括为 router 所有消息共同 gate：未指定 dictionaryId 的旧 RICH_MDICT_LOOKUP 走旧整批路径，没有同一 assertSelectionContentSender 分支。当前 Selection 面板用明确 dictionaryId；其他旧调用需另行检查。
- API 的 viewer lister 调 manager.listMetadata 与 preference reconciliation，过滤无效 ID/停用词典，导出 title/order/expanded/trust/format/status/有限 errorCode，不带词典正文。排序第一本派生 preferred=true，并保留其余用户主动 expanded；这是偏好排序，不是“可信词典排名”。读取列表可能触发偏好 reconcile，不可泛称绝无后台状态调整。
- API 指定词典查询还检查 preferences.enabled，禁用返回 RICH_MDICT_DISABLED，随后把 requestId+ownerKey 转给 manager.lookupDictionary；manager 注入 stateStore/source size/index/source reader，并将本章完整 lookup controller 暴露为 lookup/lookupDictionary/cancelLookup。未覆盖 manager 的导入提交、配额、卸载与序列化。
- 修改 sender、字段、状态或 manager cache 必须联动 selection-content-owner、selection-multi-dictionary、rich-mdict-lookup-cancellation；运行 NOT_RUN。此三文件还有大量其他路由/生命周期职责，不能标完整。

<a id="partial-lexical"></a>
## 部分：结构化本地词典

- [src/background/lexical/index.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/lexical/index.js)
- [src/background/lexical/gateway.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/lexical/gateway.js)
- [src/background/lexical/ranking.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/lexical/ranking.js)
- [src/background/lexical/context-phrase.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/lexical/context-phrase.js)

- index 在后台模块生命周期构建 Core/Technical TFLex readers 与 active OPFS reader，gateway 使用 getEffectiveGlossary；bundled reader 缓存配置为四项/2 MiB。runLexicalLookup 转发 lookup；status 对每包 inspect 再用固定健康 probe 检查，区分 unavailable/corrupt/incompatible/unhealthy/error，不能把包存在当 ready。
- gateway 只接受 en→zh-CN，unsupported 和 no-hit 分开；enabled 术语表按大小写策略先覆盖，保留 user-glossary 来源。显式多词短语先 exact/normalized，再收集最多四 token evidence 返回 no-hit；不会拼释义。单词先尝试上下文短语，再 exact/normalized/保守 morphology。每 reader lookupAll 或 lookup 结果按每个 sense/entity 展开，保留 pack/version/fingerprint/sourceRefs 和可选 sense priors。
- 已知 lexical error 转为 typed error 结果，其他异常上抛；这里不调用 Provider。reader 的范围读取、存储健康、校验与 LRU 内部仍待下一章，不能从 gateway 无 Provider 依赖推出所有下层与所有 UI 路由都“无网络”。
- ranking 使用规则而非模型：match 类基础分+大小写/译文/小幅 sense prior/候选元数据与上下文交集；技术 marker 还需候选自身事实呼应，单个泛技术词不会提升所有 technical candidate。按分数、ID、原稳定顺序排序；override sufficient，单候选阈值55，多候选 top≥80 且 gap≥18 才 decisive；单个缺结构化技术义项的普通 lexical candidate 仍可 ambiguous。这些阈值是当前实现，不代表概率或准确率证明。
- context-phrase 是 gateway 的来源支持扩展边界；本章没有逐分支展开其所有 token/window 算法。此组仍全部 partial，避免误把功能链摘要当独立完整算法章。
- 已读 tests/lexical-gateway.test.mjs 的断言涉及 attributable senses/alias/术语表/短语不拼接/无 Provider 依赖/通用 morphology/typed corruption；ranking/context-phrase 的完整测试文件未在本章展开。改变匹配或阈值须同看 lexical 规范化、source provenance、selection route 和质量样本，NOT_RUN。

<a id="partial-source-and-tasks"></a>
## 部分：投影、隐私 proof 与通用任务

- [src/content/text-projection.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/text-projection.js)
- [src/content/text-projection-policy.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/text-projection-policy.js)
- [src/content/text-projection-builder.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/text-projection-builder.js)
- [src/content/tasks.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/tasks.js)

- projection 将可接受 DOM 投影为 UTF-16 文本与可反查 Range 的 mapping；revision 会消耗未处理 mutation records，源变化递增版本并通知 controller。watchPage 的页面身份来自既有 runtime，Navigation API 不可用时才活动期轮询；自有 UI/翻译节点变化被 policy 排除，避免每次浮层更新自取消。
- policy 的当前 slice 上限 16000 字符、500 节点、8 ms；公开 totals 不等于 capture 每次可用全部额度。它检查祖先/Range 内部、编辑/敏感/隐藏、shadow/custom host 与 closed-root proof，未知失败关闭周边捕获能力，不把未知当安全。builder 的逐字符映射与空白规则不在本章完整解释。
- tasks Map 的 create/transition/assertActive/fail/complete 提供所有 surface 通用状态；cancelTask 先标本地 cancelled 再发 CANCEL_TRANSLATION，吞掉发消息错误，以本地状态禁止旧写入。取消并不回滚已发送 CACHE_STORE；terminal 任务五分钟后在入口调用 prune，而非后台永久 timer。
- 本章 source-snapshot 解释的是这组能力的调用方，不是完整 DOM 投影规范、跨场景 task API 或 Reading 存储。改 sourceRevision、mutation exclusion 或取消状态会同时影响网页翻译/源证据/划词；相关 reading-text-projection 断言已静态阅读，所有运行 NOT_RUN。

<a id="partial-rich-rendering"></a>
## 部分：sanitizer、viewer 与资源

- [src/content/selection/rich-sanitizer.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-sanitizer.js)
- [src/content/selection/rich-viewer.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-viewer.js)
- [src/content/selection/rich-resource-resolver.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-resource-resolver.js)

本章只通过已读 result-renderer/popover/rich-details 说明调用契约：不可信 richRecord → sanitize → 未截断 safeTree → viewer.render；失败退回纯文本；资源始终带 dictionaryId，浮层清理调用 closeAll。没有对这三个大文件及其 tokenizer/style/path/MDD helper 做完整内部审计，因此不宣称所有 HTML/CSS/资源类型已安全或所有实际词典完整兼容。它们保持 partial；未读的 helper 也不能因被概述而升 coverage。

需要继续解释的具体责任包括允许标签/属性、CSS URL/选择器限制、容量和解压预算、远程/脚本禁止、MDD 路径验证、resource cache/Blob URL 回收、资源变更失效、音频与取消。改外观不能绕过这些边界。富文本单元安全、真实 Chromium 和真实词典证据分开取得；本轮 NOT_RUN。

<a id="partial-provider-cache"></a>
## 部分：Provider、配置和缓存

- [src/background/providers/index.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/providers/index.js)
- [src/background/cache-db.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/cache-db.js)
- [src/background/config.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/config.js)

本章仅确认调用接口：explain 读取同次 EffectiveConfig 构建 AI identity 与调用 completeJson；普通翻译 router 对各消息获取有效配置；解释缓存使用独立 lookup/store 接口，只存生成字段。外部 HTTP/超时/重试/凭据、IndexedDB schema/迁移/prune、站点覆盖/术语表优先级尚待完整模块章，不能算已解释。普通翻译跨多个消息重新读配置，不应额外声称一次点击的配置已原子冻结。

修改 provider identity、endpoint 或 prompt 版本需同步缓存身份；变更 schema 不靠清空用户数据掩盖兼容性。词典 OPFS、解释/翻译缓存、ReadingRecord 持久化是独立边界。NOT_RUN。

<a id="test-boundaries"></a>
## 测试证据的计数边界

功能章区分历史断言主题与当前新增测试；所有运行 NOT_RUN。旧链接保留原 SHA，不代表本轮重新完整阅读。这些文件的 harness、fixture 构造、mock 范围与全部断言还没有各自完整说明，覆盖清单应保留待解释/局部说明：

- [tests/selection-v2.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/selection-v2.test.mjs)
- [tests/reading-text-projection.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-text-projection.test.mjs)
- [tests/selection-result-model.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/selection-result-model.test.mjs)
- [tests/selection-ui-contract.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/selection-ui-contract.test.mjs)
- [tests/selection-multi-dictionary.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/selection-multi-dictionary.test.mjs)
- [tests/selection-content-owner.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/selection-content-owner.test.mjs)
- [tests/rich-mdict-lookup-cancellation.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/rich-mdict-lookup-cancellation.test.mjs)
- [tests/selection-explanation.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/selection-explanation.test.mjs)
- [tests/selection-explain-runtime.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/selection-explain-runtime.test.mjs)
- [tests/lexical-gateway.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/lexical-gateway.test.mjs)

源码模式断言不能代替用户交互；fake DOM 不能代替真实 Shadow DOM/CSP；合成字典不能替代私有真实词典；已存在测试不能代替本次执行。下一章继续导入、MDX/MDD 范围读取与安全资源，不回头重做启动，也不把 Oxford10 规划 commit `e525729` 算作当前 main 实现。


## 后续详细说明

本页局部引用的rich-sanitizer、rich-viewer、rich-resource-resolver已在[导入与展示模块](dictionary-import-render.md)提供完整文件说明；其他大型依赖仍以coverage状态为准。

共用task、缓存库、Provider注册与请求取消的完整解释已接入[网页翻译与缓存模块](page-translation-cache.md)，Selection分支仍以本章为准。


## 当前 #234 证据补充（仍为局部测试说明）

已读完整的 [selection-record-client](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/tests/selection-record-client.test.mjs)、[selection-translation-query](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/tests/selection-translation-query.test.mjs)、[reading-result-provenance](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/tests/reading-result-provenance.test.mjs)、[selection-upgrade-registration](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/tests/selection-upgrade-registration.test.mjs)、[reading-classic-contract](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/tests/reading-classic-contract.test.mjs) 与 [selection-reading-record E2E](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/e2e/selection-reading-record.spec.mjs)，但这里未逐文件解释全部 fixture/harness，coverage 不升级为完整。rich-viewer-contract 只读新增显示回调相关部分。

VM/fake runtime、JSDOM 与真实 Chromium/原生 IDB 是不同证据：classic test 比对生成桥和 canonical validators；upgrade test 覆盖旧列表加载新字节时提示刷新，新列表注册 split modules；E2E 使用生产 collector/UI/后台，但学习中心 consent callback、词典和 localhost 权限是合成夹具。既有 #234 acceptance PASS 绑定 72fc8cdd，不能冒充本轮 d5246ca 运行。详见[Reading 测试边界](reading-records.md#test-boundaries)。
