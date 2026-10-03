# 划词、本地词典与显式 AI 详解

导航：[阅读入口](../README.md) · [架构总览](../architecture.md) · [仓库地图](../repository-map.md) · [逐文件说明](../modules/selection.md) · [前置：扩展启动](extension-startup.md)

> 本轮固定 main `d5246cae6469e4a876fc122b229a2e0ddf115709`，2026-10-03。当前完整复读了 controller/result/model/拆出的 query、rich renderer、Reading client 链与 AI provenance；其余分类、source projection 与底层算法沿用 `d5e308a709c008acf6b277d466d020f13025bdca` 的历史章节，在逐文件页明确标注，不冒充全部当前复审。项目、浏览器、真实词典、Provider 和测试运行均为 **NOT_RUN**。
> #234 的保存切片已实现；真实学习中心可用性与首同意完整产品仍分开判断。预构建产物选择及默认 WXT 路径见[构建与测试链](build-test-release.md)。

## 先知道用户会看到什么

用户在页面选择符合条件的文字，先看到“译”按钮；**仅选择文字不会调用 Provider，也不会自动查询全部词典**。点击后才冻结此次查询的源文本/上下文，发起 `SELECTION_RESOLVE`。对于适合英→简中本地检索的单词或短语，先用结构化词典候选生成主卡片，再独立展示可展开的富文本词典卡。AI 详解需再次明确点击。

“本地优先”不是“所有划词都只在本地处理”：
- 句子、长文本、不支持的本地源/目标语言先分类为普通翻译，跳过词典检索。
- 本地多词短语无命中也进入普通翻译；不拼接各单词释义。
- 单词无命中显示中性空态，可选择 AI 详解或普通翻译。
- 本地资源缺失、损坏、不兼容是错误态，不伪装成未收录，也不会偷偷以 AI 详解兜底。
- 普通翻译有缓存查询；缓存未命中时可进入 Provider。初次点击“译”是这条普通翻译路径的用户动作，并不要求另外点击 AI 详解。

分支的精确规则见 [shared/selection.js](../modules/selection.md#file-selection-contract)。

## 1. 选择有效性、源文本与上下文

[selection.js](../modules/selection.md#file-selection) 从 Selection/Range 取快照，排除扩展自有节点，规范化可证明的 Range，要求 2–2000 字符、至少两个拉丁字母、拉丁占拉丁+CJK 字母的比例至少 0.35，拒绝纯 URL，并要求有效矩形。这是“是否显示入口”的条件，后台本地词典意图使用更严格的 0.6 比例和句长/标点规则，两层不能合并理解。

[controller.js](../modules/selection.md#file-controller) 用 90 ms 定时器合并鼠标、键盘与 selectionchange；相同文字、相同 Range/源修订和相同页面身份只更新位置。新选择取消旧任务与 rich session，增加 requestVersion，并显示 chip。由于操作面板会清除页面的视觉选区，读不到新 Selection 时不会立即撤销已有 activeSnapshot。

真正点击时，[source-snapshot.js](../modules/selection.md#file-source-snapshot) 同步获取源修订、选词、可证明的局部上下文、quote prefix/suffix 和位置；异步 SHA-256 只处理已经冻结的字符串，不在 await 后重读 DOM。局部上下文最多 900 字符，prefix/suffix 各最多 120 字符；投影预算不足时，可对同一文本节点使用有界窗口退化。全页位置不能证明时，anchor 可为 unsupported，但普通查询仍可用。

隐私策略由 text-projection-policy 判断可编辑区、敏感标记、隐藏节点、shadow/custom host、frame 与预算等条件。未知不当成安全。后台 `sanitizeSelectionContext` 再次清掉敏感周边文字；这**不等于禁止用户明确选中的文字被处理或发送**。SourceSnapshot 的文档随机标记是本地证据，不是可信发送者身份。

这里已经接入 #234 Reading 保存：controller 将可信 click event、snapshot/capture 交 record-client，production record-access 安装 readingAccessCollector；sourceSnapshot 自身仍只是冻结证据，持久化通过独立后台协议。仅选词不记录，已启用且本站未排除时，明确查询的完成结果进入保存队列。未启用只留当前有界卡并显示邀请；政策开启后仍须本卡明确“保存本次结果”，不重新调用 Provider。当前 fixed learning-center 仍 NOT_READY，首同意 E2E 的 synthetic callback 不能当生产开通 UI。见[Reading 完整链](reading-records.md)。

## 2. 主查询：Content → 路由 → 本地 gateway → 主卡

调用链：
1. `translateSnapshot` 建立 surface=selection 的 task，发送 text/pageUrl/context。
2. [router.js](../modules/selection.md#partial-router) 将 `SELECTION_RESOLVE` 转给 [resolve.js](../modules/selection.md#file-resolve)，外层统一包装 ok/error/errorCode。
3. resolver 并行读取存储配置和页面有效配置，归一化解释深度与上下文，再分类意图；translation 分支此时直接返回，不调用 lexical。
4. lexical 分支调用 [lexical/index.js → gateway.js → ranking.js](../modules/selection.md#partial-lexical)：有效术语表优先，随后内置 Core/Technical 与激活 OPFS 结构化包；按可追溯候选排序，而不是调用模型选择事实。
5. `chooseSelectionRoute` 给出 local/translation/unresolved 或仅显式请求时的 needs-explanation。
6. Content 在每次 await 后检查 task、requestVersion、snapshot 对象、sourceRevision 与页面身份，才将返回值写到 UI。

本地检索本身的顺序也影响结果：显式选中的短语保持权威，先查精确/规范化短语；短语未命中只收集少量 token evidence，不把它们合成短语答案。单词先尝试有来源支持的局部上下文短语，再精确、规范化、保守形态变化。大小写、alias、sense 与 pack provenance 被保留。ranking 再比较候选与上下文元数据，保留 ambiguous 与 sufficient 区别；ambiguous 且有候选仍可以显示本地主卡，用户自行要求 AI。

[result-model.js](../modules/selection.md#file-result-model) 保留候选边界，优先展示 topCandidateId，最多五项，记录剩余数量；[result-renderer.js](../modules/selection.md#file-result-renderer) 用 DOM/textContent 展示词头、义项、事实和来源。AI 标识与词典来源不混为同一个权威来源。

## 3. 富文本详情：另一条本地查询支路

主卡/单词空态完成后，或 lexical 错误分支允许显示详情时，controller 调用 [rich-details.js](../modules/selection.md#file-rich-details)。该支路不延迟主结果，也不把词典读取失败替换成主结果失败：

1. `RICH_MDICT_VIEWER_LIST` 读取元数据及用户偏好，过滤停用词典，保留状态/有限错误码；排序第一本衍生为 preferred 并默认展开。这是个人偏好，不是质量认证。
2. 新拆出的 [rich-result-renderer](../modules/selection.md#file-rich-result-renderer) 按 order 稳定排序建立独立 details 卡；默认展开的卡立即触发读取，其他卡在用户展开时才查。重新打开已完成卡不会重复发请求。
3. 每本词典独立发送 `RICH_MDICT_LOOKUP { requestId, ownerToken, text, dictionaryId }`，共享队列最多三个后台读取同时运行。
4. router 验证扩展自身、tab 与 http(s) sender，优先用 Chrome documentId，否则使用 Content 文档 token，构成 tab/frame/document ownerKey。pack API 再检查词典是否停用。
5. [rich-mdict-lookup-controller.js](../modules/selection.md#file-rich-lookup-controller) 核对已安装/healthy 元数据、源文件大小、索引，再调用有界 lookup；返回实际 active packVersion、纯文本 fallback 与受长度限制的 rawRecord、格式和样式表规则。**此时 rawRecord 仍不可信，不是安全 HTML。**
6. renderer 先经过 sanitizer，再由 viewer 构建展示；缺少能力、异常、截断或不支持时用纯文本。MDD 资源按 dictionaryId 交给既有受控 resolver，不允许为了显示而执行词典 JS 或自动加载词典远程资源。
7. 只有真正展示之后 onDisplay 才把安全 viewer 的 textContent/纯文本 fallback 与实际 packVersion 交 model.readingRich；按八行×240字符和有限风险过滤生成 dictionary draft，再经 Reading 校验。折叠 pendingResult、rawRecord、CSS/MDD/路径不是可存摘要；迟到 rich 与基础 artifact 同 lookup operation、不同 artifactId，按词典 key 去重。

本章完整解释卡片/请求生命周期和 lookup controller；sanitizer tokenizer/CSS、viewer、MDD 资源路径/资源句柄、MDX 解压/索引以及导入提交算法仍只解释边界，留待下一完整切片。当前源码不能据此宣称真实 Oxford10 已完整支持；规划 `e525729` 不属于本章绑定 main 的已实现能力。

## 4. 用户点击 AI 详解后才发生什么

本地有主卡时，`explainSnapshot(snapshot, depth, baseCard)` 在卡内新增 AI 区，保留词典释义与来源；无本地主卡时使用整个 loading/result 区。[explain.js](../modules/selection.md#file-explain) 的链是：

`SELECTION_EXPLAIN → 重新 resolve(explainRequested:true) → EffectiveConfig → 有界 payload/cache identity → 独立解释缓存 → completeJson → 严格解析 → 只存 generated 字段 → 返回 UI`

重新 resolve 不是直接相信 Content 的旧候选。若此刻已不适合解释，可返回 local/translation；带 baseCard 的 Content 会拒绝把这种返回当作成功增强，提示重新选择/无可用详解。

[解释协议](../modules/selection.md#file-explanation-contract) 限制选文 2000、上下文 900、候选八个、每事实字段六项，模型只能返回已知候选 ID（去重后最多三个）、非空 explanation 和可选 translation；拒绝新增 provenance 等字段。[专用 prompt](../modules/selection.md#file-explain-prompt) 将所有 JSON 值作为引用资料，禁止伪造来源，不复用网页翻译 prompt。

当前后台真正发送固定 userQuestion="这里是什么意思？"，action=understand；以 selection-explain-reading-v2 + 实际固定问题 + 原 cacheKey 再 hash，隔离旧 prompt 答案。Reading assistant 只保存用户看到的完成解释、固定问题及当次配置的 provider/model/promptVersion/fingerprint，不带 endpoint、prompt 或凭据。保留本地卡时不会把本地释义重标为 AI。

解释缓存身份包含协议/prompt/schema 版本、provider/model/endpoint、目标语言、深度、selection/context/candidate 摘要和 pack 身份。命中后也重新验证候选 ID；命中不调用 Provider。敏感上下文时 payload.contextText 为空，且整个解释缓存读写被跳过；用户选词和有限结构化候选仍可能进入显式 AI 请求。原始页面 URL、不受限页面正文、MDX/MDD 文件/原文全文不是这条 payload 的内容。

说明边界：HTTP、重试与 Provider adapter 在 providers 模块；IndexedDB 在 cache-db.js；本章不宣称覆盖它们完整实现。解释缓存不是词典事实库，也不是 Reading 历史。

## 5. 普通翻译、复制与关闭

[translation-query.js](../modules/selection.md#file-translation-query) 已承接普通翻译编排，使用 id=selection 的单 segment：
`CACHE_LOOKUP → 命中直接显示 / TRANSLATE_BATCH → CACHE_STORE → 显示`。每步都检查当前选择与 task；缓存存储失败仍作为失败，不报告整个流程完成。后台分别用页面 EffectiveConfig 做缓存读、Provider 调用与写入；本章不把多次消息之间配置必然不变当作额外保证。每次 CACHE_LOOKUP/TRANSLATE_BATCH 回包的 readingResult 用同次 config 派生，不泄漏 endpoint/prompt/key；只有当前选择仍有效且结果已展示，才把实际译文交 Reading。旧注册列表缺 translation-query 时提示刷新，不退回隐藏的新路径。

“复制”是用户按钮回调，显示结果并不自动写剪贴板。result-model（结果模型）负责整理复制文本，clipboard 优先用 navigator.clipboard，否则临时 textarea+execCommand；失败 toast，不影响词典结果。

Escape、外部 pointerdown、关闭按钮、源投影修订、页面离开/pagehide 都可 dismiss：取消任务、取消 rich session、移除浮层、停止相关活动页面监视并增加 requestVersion。Popover 关闭/重置时通知 richResourceResolver.closeAll 清理显示资源；全生命周期 listener 由常驻模块保留，不宣称每次 dismiss 都移除了全局 listener。

取消与保存有四个不同边界，不能混用：
- task 先标记本地 cancelled，再尝试 `CANCEL_TRANSLATION`，该消息也会 abort AI explanation。UI 的“已取消”是本地状态，不能证明已提交的缓存写入回滚。
- rich session 先失效、移除排队项、settle 等待者，保证旧回复不再写卡；in-flight 槽位直到原 Promise finally 才释放，不伪造即时释放。
- 后台 rich lookup 用 requestId+ownerKey 的 AbortController；cancel-before-dispatch 用 15 秒、最多 128 项 tombstone 处理竞态。Content 的 cancelPromise 使用 allSettled，不检查每条后台 cancelled 返回，所以其 cancelled=true 仅表示尝试取消过在途 request IDs，不能作全部底层读取停止的证据。

- Reading close 先让本地 intent 失效，再等待 token 并请求 CANCEL_OPERATION；只有真实 ACK 才能区分 cancelled 与 committed，关闭不能撤回已提交历史。保存失败可复制原结果；仅 STORAGE/QUOTA/INTERRUPTED 提供存储重试，复用 operation/artifact，不重新查询 Provider。

## 6. 静态测试证据与验证缺口

以下旧链接保留历史测试断言身份，并非本轮全量重新阅读；运行状态统一 **NOT_RUN**：
- [selection-v2.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/selection-v2.test.mjs)：分类、显式解释路由、本地错误/无命中、未知多词短语翻译、敏感周边剥离。
- [reading-text-projection.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-text-projection.test.mjs)：投影 UTF-16/空白、预算、隐藏/敏感/closed-root 边界、同步冻结与摘要不可用退化。该历史投影测试本身不证明保存链；当前保存实现由独立 #234 源码和测试解释。
- [selection-result-model.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/selection-result-model.test.mjs)：候选边界、排序与五项展示上限。
- [selection-ui-contract.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/selection-ui-contract.test.mjs)：主要为源码模式断言，确认非模态 UI、AI 区保留本地卡、空态和错误文案；不等价于真实焦点/布局验收。
- [selection-multi-dictionary.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/selection-multi-dictionary.test.mjs)：fake DOM/消息环境验证偏好展开、逐词典请求、三路并发、旧队列丢弃、sanitizer/viewer 调用边界。
- [selection-content-owner.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/selection-content-owner.test.mjs) 与 [rich-mdict-lookup-cancellation.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/rich-mdict-lookup-cancellation.test.mjs)：owner 隔离、先取消后派发、range/decompression/Blob stream 的 abort 传播。
- [selection-explanation.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/selection-explanation.test.mjs)、[selection-explain-runtime.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/selection-explain-runtime.test.mjs)：payload/输出字段、缓存身份、cache hit 不调 Provider、敏感数据不进持久缓存、Provider signal 取消。

当前新增的 selection-record-client/translation-query/reading-result-provenance/selection-upgrade-registration 与 selection-reading-record E2E 已静态读取，覆盖真实结果来源、可信动作、存储 ACK/重试、旧列表缺新模块退化及实际 rich 展示。E2E 是生产 UI/collector/后台加合成 LC consent、词典与 localhost 权限；不是完整 React LC 或跨页闭环验收。详见[Reading 边界](../modules/reading-records.md#test-boundaries)。

这些测试未在本轮执行；也不能替代实际 MV3、真实页面、私有大型词典兼容性、资源安全或真实 Provider 验收。测试文件本身尚未逐文件完整解释，不因在这里引用就计入完整覆盖。

## 推荐阅读与最小改动入口

1. 入口显示/选区判断：selection → controller → source-snapshot/context。
2. 本地/普通翻译/显式 AI 的政策：shared/selection → resolve；检索质量再到 gateway/ranking，不能用 UI 分支硬编码释义。
3. 结果结构/层级/复制：result-model → result-renderer/rich-result-renderer → popover；新增事实不要让 AI 伪装 provenance。
4. 多词典延迟读取/竞态：rich-details → router 边界 → rich lookup controller；同时检查取消测试与资源清理。
5. Reading 结果/保存状态：record-access → record-client → record-status；保留明确动作、实际展示、原 token/artifact 重试和 ACK 边界。
6. AI schema/缓存：selection-explanation → explain-prompt → explain；改变身份字段须一起复核旧缓存兼容与 Provider 参数。

完整文件与部分边界的精确列表见 [selection 模块覆盖索引](../modules/selection.md#coverage-index)。下一切片应从 MDX/MDD 导入与安全渲染展开，不能仅凭本章把整个词典系统标成已解释。

## 后续导读

导入、AST/CSS、viewer与MDD资源生命周期已接续为[本地MDX/MDD导入与安全展示](local-dictionary-import.md)，沿用本篇查询与取消接口。

