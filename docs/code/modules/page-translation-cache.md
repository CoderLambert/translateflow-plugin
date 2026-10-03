# 网页翻译与缓存：逐文件说明

[导读首页](../README.md) · [运行时总览](../architecture.md) · [全仓地图](../repository-map.md) · [完整功能流程](../features/page-translation.md)

源码基线：`d5e308a709c008acf6b277d466d020f13025bdca`；最近静态复核：2026-10-03。运行/测试：**NOT_RUN**。本轮15个文件完整解释；根入口/运行时/站点注册复用启动章，其余大型依赖仅说明本链边界。完整解释指各导出和主要内部职责均有说明，不表示行为已通过运行验证。

## 阅读索引

- [src/content/dom.js：候选正文与最终插入](#file-dom)
- [src/content/structured.js：结构标记与受控 DOM 重建](#file-structured)
- [src/content/batch.js：原文去重与有界批次](#file-batch)
- [src/content/processor.js：一次操作的缓存优先编排](#file-processor)
- [src/content/tasks.js：页面内任务与本地取消](#file-tasks)
- [src/content/auto.js：恢复与自动翻译共用增量观察](#file-auto)
- [src/background/cache-db.js：翻译缓存与共享解释存储](#file-cache-db)
- [src/background/translation-requests.js：在途合并与消费者取消](#file-requests)
- [src/background/translation-gateway.js：最终结果式 Provider 门面](#file-gateway)
- [src/background/providers/index.js：统一 Provider 分派](#file-provider-index)
- [src/background/providers/deepseek.js：固定 DeepSeek HTTP 适配器](#file-deepseek)
- [src/shared/retry-policy.js：纯重试分类与延迟](#file-retry-policy)
- [src/shared/url.js：缓存 URL 与站点作用域](#file-url)
- [src/shared/hash.js：缓存摘要与 UTF-8 大小](#file-hash)
- [src/shared/text.js：持久缓存原文规范化](#file-text)

<a id="file-dom"></a>
## src/content/dom.js：候选正文与最终插入

源码 blob：`8131a6c6f35a0e0c202d674f8fae4e1240ede82f`；固定commit同本章。

**职责与调用者。** batch 调用提取/筛选，processor 调用收集与插入，auto 调用识别、失效与清理。classic IIFE 依赖 runtime/structured，重复加载直接返回；不联网、不访问持久库。[源码 L1–71](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/dom.js#L1-L71)

**算法与 I/O。** collectElements 选第一个 main/[role=main]，否则 body，只查其后代的候选标签。isCandidateElement 检查 computed style 与非零矩形，排除扩展节点、编辑区、导航/页眉页脚、代码/表单容器，排除含子列表/段落的 LI、含 p/li 的 BLOCKQUOTE，以及直属孩子超过18的节点。extractSourceText 用 TreeWalker 跳过扩展译文和 script/style/code/pre/textarea，再合并空白；extractSourceSegment 先 structured.encodeElement，有富文本时直接使用其结果，否则使用纯文本提取。shouldTranslate 只接受12–5000字符、非 URL 开头、至少6个 Latin/CJK 字符且 Latin 占比≥0.58的文本；这是英文正文启发式，不是通用语言检测。

**结果与状态。** insertTranslation 对空译文或已有 data-abt-translated 返回 false；新建 span.abt-translation，重新编码当前原文再受控 render，追加到原元素并打标，返回 true。removeTranslationFromElement 仅删直属译文孩子；clearTranslations 全页删译文与标记、清隐藏 class 并将 state.hidden=false。isTranslationNode 同时识别扩展自有 UI，避免观察者把自己的输出当新原文。[源码 L73–117](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/dom.js#L73-L117)

**失败/取消与安全边界。** 此文件没有异步任务或取消；页面身份/源文本复核在 processor。可见性检查不保证屏幕内、没有遍历 Shadow Root/iframe，也没有逐个排除纯文本后代的隐藏内容。rich 路径的过滤规则不同于 TreeWalker，不能宣称所有后代 script/style 文本都由这里统一过滤。渲染避免模型 HTML 注入，但正文译文仍在网页 DOM，受页面 CSS 影响。

**测试与修改影响。** structured 单测和 E2E article/增量流程间接覆盖，未见本轮单独 DOM 筛选测试；全部 NOT_RUN。改候选/规范化会改变提交给 Provider 的范围、缓存命中、重复段落与自动观察行为，需一起检查 batch、structured、processor、auto。

<a id="file-structured"></a>
## src/content/structured.js：结构标记与受控 DOM 重建

源码 blob：`0ba9e5c6c2e6aec0d12cabc533f2177dcf7fcfc1`；固定commit同本章。

**职责/输入输出。** encodeElement(Element) 输出 {text, rich, descriptors}；renderTranslation(字符串, source) 输出 Text 或 DocumentFragment。dom 是主调用者。仅允许 A、STRONG/B、EM/I、CODE、KBD、MARK，并将 B/I 规范成 strong/em；不支持标签只递归其孩子，扩展译文/UI 被跳过。[源码 L7–37](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/structured.js#L7-L37)

**编码。** 按前序 descriptors 下标分配 id，把原标签内文本包进 ⟦TF:id:S⟧/⟦TF:id:E⟧。链接只保留经过 safeHref 的 href 与截断500字符的 title；code/kbd 保存 protectedText。rich 文本只折叠 tab/CR/LF/普通空格，plain 使用 runtime.cleanText。描述符留在 Content，不随 batch 发往 Provider；批次只带含标记文本。

**还原/错误。** renderMarked 用 fragment+栈验证结束标记与栈顶 id，一边 createTextNode，一边按原描述符 createElement；闭合 code/kbd 时替换为原 protectedText。未知 id、交错/未闭合或残留畸形 marker 抛错，由 renderTranslation 捕获并 stripMarkers 后返回纯文本。模型返回的 HTML 字面量永远是文本。无 rich 描述符时也直接返回 Text。MARKER_RE 在每次解析前重置 lastIndex。[源码 L39–94](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/structured.js#L39-L94)

**真实保证。** 检查平衡不等于检查每个原始 marker 恰好出现一次：完全遗漏/重复合法标记未被整体校验；降级纯文本也不会恢复 code 原字串。safeHref 仅 trim 后拒绝开头 javascript/data/vbscript，不是完整 URL 协议 allowlist，也没有标准化控制字符混淆；因此只应称“受控重建”，不能称链接安全已被全面证明。原有 class/style/事件处理器不会复制。

**状态/取消/影响/测试。** descriptors 每次编码临时创建，函数无网络/持久化/取消。tests/structured.test.mjs 使用最小 DOM stub 断言 deterministic marker、原链接/code 保留、javascript 链接和畸形标记降级；E2E article 检查真实 a/code 和无 marker 残留。NOT_RUN。修改协议须联动 requests 的 prompt、batch/cache identity、provider 解析和浏览器测试，不能仅改渲染器。

<a id="file-batch"></a>
## src/content/batch.js：原文去重与有界批次

源码 blob：`cde25b26a16aeb081ee95badbdf99cfb61eba657`；固定commit同本章。

**调用与数据。** processor/auto 给 buildEntries 一组 Element；它跳过离开 document 或已翻译节点，extractSourceSegment 后去掉 marker 仅用于 shouldTranslate，生成 {id,el,text,rich,normalizedText}，id 每次调用从字符串1开始。normalizedText 仍包含结构 marker。[源码 L1–27](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/batch.js#L1-L27)

**分组/切批。** groupEntriesByText 按 normalizedText 建 Map，保留首次 text/rich 和所有 elements，重新给 group id；同段落多处只发一个 segment，返回后向每个元素插入。makeBatches 保持顺序，累计 text.length；加入下一组前若当前已有18项或总字符将超过7000则切批。单个超限组不会被拆分，因此7000是组装阈值，rich marker 膨胀后不是绝对上限。[源码 L29–68](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/batch.js#L29-L68)

**生命周期/错误/安全。** 只持有调用局部数组/Map 与 DOM 引用，没有存储/HTTP/重试/取消；源 DOM 可在等待期间变化，processor 必须复核。相同文本但不同原链接 href 可共用译文，因为 descriptor 不在 key 中，最终按各自原 DOM 重建属性。没有语义相似合并或跨页持久去重。

**测试/影响。** article/增量 E2E 间接覆盖；本轮未发现独立 batch 测试，NOT_RUN。改 key/id/批大小影响 Provider 请求数、结果对齐、任务段落计数、cache 命中，需配合 processor、structured、requests 验证。

<a id="file-processor"></a>
## src/content/processor.js：一次操作的缓存优先编排

源码 blob：`5b71c455ae960f3707fd8d1ff6fec41c28d170c9`；固定commit同本章。

**入口与状态。** processPage({cacheOnly,taskId,silent,startup}) 供 content.js/Quick Control/auto 启动恢复调用；非 startup 等待 startupRestorePromise，然后以 manualRunning/autoDrainRunning 互斥。先 clearTranslations 再扫描；无候选返回 count=0 提示，只有非 cacheOnly 创建 page task。group→batch 后串行处理，进度按 elements 而非去重 group 数累计。[源码 L17–120](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/processor.js#L17-L120)

**批处理消息。** processGroupBatch 捕获 page identity/title，task 进入 cache_lookup，发送 CACHE_LOOKUP {pageUrl,segments:[{id,text}]}。用 hits 的 id→text 填已命中组；cacheOnly 或全命中在此返回。miss 才进入 translating，发送 TRANSLATE_BATCH {requestId,pageUrl,segments}，仅接收最终 translations。空/遗漏译文计 missing，不自动逐项重试。新译文先插 DOM，再发 CACHE_STORE {pageUrl,pageTitle,items:[{sourceText,translation}]}，storing 后检查响应；任一消息 !ok 转成带 errorCode 的 Error。[源码 L122–205](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/processor.js#L122-L205)

**过期保护与计数。** cache 和 Provider 结果只有当前 getPageIdentity 等于捕获身份才插入；insertGroupTranslation 再要求 document.contains、当前重新提取/规范化文本等于 group.normalizedText、未打翻译标记。变文时交 auto.invalidateAndObserve。cacheHits/apiTranslated 是实际插入次数，processed 是输入元素数；completed 的 done=entries.length，并不证明每段都有译文。页面已变化时仍可把旧原文结果写到原 pageUrl 的缓存。[源码 L207–221](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/processor.js#L207-L221)

**结束/错误/取消。** 非 cacheOnly API 插入>0时异步 CACHE_PRUNE；auto 的 prune 最多每5分钟触发一次。cache-only 返回 missing 与恢复提示，不建任务；手动完成返回 task snapshot。catch 把 task 标 failed/cancelled，取消返回正常 envelope 中的 cancelled；其他异常交上层显示。finally 总释放 manualRunning，有 pending 再调度。await 后 assertActive 阻断取消后的后续 DOM/消息，但不能撤销先前插入或已发送的 CACHE_STORE；因此存储失败可留下当前可见译文，取消不是事务回滚。

**安全/影响/验证。** 此层无直接 HTTP/IDB，只有序列化文本消息；没有跨 lookup/translate/store 的配置快照或 generation。改此层要同时验证 tasks/auto/router/cache-db 以及“无 API 的恢复”。E2E article、restore-only、Quick Control、incremental 和 preset/cache 回切有相关断言，全部 NOT_RUN；取消存储竞态、A→B→A 导航竞态未由这些断言证明。

<a id="file-tasks"></a>
## src/content/tasks.js：页面内任务与本地取消

源码 blob：`4cd5e6b946c77ffbf575b244c5378039f1f8307e`；固定commit同本章。

**所有者与 I/O。** IIFE 内 Map tasks/Set listeners 是 Content 文档生命周期的内存，不写 chrome.storage。createTask 接 id/surface/pageUrl/total，无 id 生成 UUID，写 queued、时间戳、done/cacheHits/apiTranslated/error 字段并通知。page、auto、selection 等复用该服务。[源码 L6–79](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/tasks.js#L6-L79)

**操作。** transition/updateProgress 直接合并 patch 并更新时间，不验证完整状态迁移图；仅不允许 cancelled 改到其他状态。completeTask/failTask 包装 completed/failed/cancelled；AbortError、TaskCancelledError、code=CANCELLED 同算取消。assertActive 只拒绝缺失/已取消对象，不保证 running；resolveTask 可直接接收对象，不必仍在 Map。getTaskStatus 返回字段白名单快照；getLatestTask 按 updatedAt 和可选 surface 取最近；isTerminal 查三终态。[源码 L105–187](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/tasks.js#L105-L187)

**取消真实语义。** cancelTask 对缺失/终态返回 cancelled:false，否则先本地标 cancelled 再发 CANCEL_TRANSLATION requestId；无论后台返回 cancelled:false 或消息异常均返回本地 cancelled:true。它保证本地后续 assertActive 失败，不证明远端网络已停止/没有计费/IDB回滚。responseError 从后台 envelope 复制 error/errorCode；不在此重试。[源码 L81–103](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/tasks.js#L81-L103)

**释放/订阅。** subscribe 返回 unsubscribe；notify 克隆快照并吞 listener 异常。releaseTask 从 Map 删除并发 released，但对象引用仍可用。pruneTerminalTasks 在 create/getStatus 时删超过5分钟终态，无后台计时器；auto 显式 release，页面任务通常靠惰性 prune。[源码 L189–221](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/tasks.js#L189-L221)

**测试/影响。** tasks 单测断言生命周期字段、即时本地取消/后台消息、订阅更新及 unsubscribe；requests 单测验证共享消费者取消。全部 NOT_RUN。修改状态或取消语义须同步 Popup 轮询、Quick Control WORKING_STATES、Selection、processor/auto；不可宣称此文件实现持久任务恢复或严格状态机。

<a id="file-auto"></a>
## src/content/auto.js：恢复与自动翻译共用增量观察

源码 blob：`73c2a92491cf22a75897c5e4b79d16a98054ca92`；固定commit同本章。

**模式/入口。** maybeStartPersistentModes 读本 origin 的 cacheRestoreSites/autoSites；恢复独开，auto 优先。enableCacheRestoreMode 先设 cacheRestore，首次且无 auto 可跑 silent startup cacheOnly processPage，把 Promise 放 startupRestorePromise，错误吞为 null，finally 清同一 Promise；然后观察/重扫。maybeStartAutoMode 是只读 autoSites 的兼容入口。enableAutoMode 等待启动恢复，再设 auto 和观察；两者都不自行持久化设置或申请站点权限。[源码 L27–127](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/auto.js#L27-L127)

**资源状态。** observer/timer/pending/backoff 存 runtime.state。isIncrementalActive=auto||cacheRestore。关一个模式时另一个仍开则清 pending 重扫；全关 stopIncrementalObservers 清 pending/timer 并 disconnect+置空两 observer。disableAutoMode 还清 backoff，但没有 cancel 当前 auto task。[源码 L129–160](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/auto.js#L129-L160)

**发现与变更。** IntersectionObserver 使用上下扩展900/1200px和 threshold .01，命中先 unobserve 再 enqueue；MutationObserver 只看 subtree childList/characterData，不看 attributes。先查页面身份；字符变化定位最近候选并删旧译文重观察；childList 只处理有 addedNodes 且不是全为译文/UI 的记录，再扫描新增节点。仅移除节点、纯样式/属性变化可能不触发重新翻译；不是全量 DOM diff。observe 校验连接/候选/未译；enqueue 再用纯文本启发式筛选，pending Set 去重。[源码 L162–239](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/auto.js#L162-L239)

**调度与任务。** debounce默认180ms；auto backoff 生效，restore-only不等待该 backoff。drain 遇 manual/autoDrain 正忙350ms后再排；每次最多取72个 pending 元素，再 build/group/batch。逐批捕获 allowProvider=state.auto，true 才建 surface:auto task，否则 task=null+cacheOnly:true。完成/失败后 releaseTask；失败把仍连接、未译的 entries 放回 pending，finally 有待办120ms调度。CONFIG/AUTH/PERMISSION 或 API Key错误暂停5分钟，其余15秒，toast最多每5秒一次；restore-only错误750ms再试，不显示 auto 错误 toast。[源码 L240–354](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/auto.js#L240-L354)

**导航/取消/隐私。** checkPageIdentityChange 更新身份、清 pending/译文，microtask重扫；Content 根补 popstate/hashchange/YouTube事件。drain 只在循环/批边界检查身份/模式，在途 Provider不被主动 abort。关闭自动翻译后其已启动批次仍可能完成插入/缓存；“restore-only 不联网”指没有已启动 auto 请求的独立恢复路径。没有统一 generation，A→B→A相同身份+相同文本仍可能接受旧结果。

**测试/修改影响。** cache-restore-mode 是源码结构断言；E2E 60–128验证重访恢复/动态 hit/miss/禁用，283–304验证只发新增段落。NOT_RUN。修改节流、观察、模式互转需测无费用恢复、DOM自触发回环、关闭中在途结果、配置变化和路由；不能用静态正则测试代替这些浏览器行为。

<a id="file-cache-db"></a>
## src/background/cache-db.js：翻译缓存与共享解释存储

源码 blob：`857771b2863e5c550611e985581541afd9ca52e1`；固定commit同本章。

**唯一持久化边界。** router 调用网页 lookup/store/status/clear/stats/prune；Selection explain 复用同库独立 store。DB ai_bilingual_translator、DB_VERSION=2，translations 主键 cacheKey，索引 pageKey/pageConfigKey/lastAccessedAt；pages 主键 pageKey；selection_explanations 主键 cacheKey/lastAccessedAt。openDb 模块级 Promise 复用连接，upgrade 只补缺少的 store，不删除数据。blocked/error 拒绝，失败 Promise 未清除，也未注册 versionchange 关闭句柄。[源码 L301–327](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/cache-db.js#L301-L327)

**身份。** getCacheContext 对 normalizeUrl 做 SHA-256→pageKey；configHash 为 cacheSchema、provider（缺省deepseek）、model/targetLanguage/prompt，OpenAI-compatible另加规范化 endpoint，有效非空 glossaryIdentity 才加入。pageConfigKey=pageKey:configHash，再加规范化原文 SHA-256 成 cacheKey。凭据不入身份，外观/streaming不入身份；不是跨页面翻译记忆，也不是加密。[源码 L16–23](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/cache-db.js#L16-L23) [源码 L266–285](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/cache-db.js#L266-L285)

**读写。** lookupTranslations 空 segments 返回空 hits；先异步计算所有 hash，再开 translations/pages readwrite 事务读取，非空 translation 且规范化 sourceText 完全相等才命中（除 hash 外再校验原文）；命中更新访问时间。storeTranslations 预计算 {sourceText,translation,bytes}，trim译文，跳过空项，upsert保留 createdAt，页面 URL/title（最多500字符）另存，事务完成后返回 stored。bytes 是 UTF-8文本+key+256 的估算，不是 IndexedDB真实磁盘占用。即使没有有效 item，非空输入数组路径仍可创建 pages 行。[源码 L25–122](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/cache-db.js#L25-L122)

**独立 Selection store。** lookupSelectionExplanation 空 key 返回 null，命中更新时间并返回 result/createdAt；storeSelectionExplanation 要求 key+非数组对象，JSON.stringify计算大小并upsert，之后按 lastAccessedAt 裁到256条。失败向调用者抛，不做 Provider 或 UI 决策。本章只补足其库内行为，AI解释调用链复用前章。[源码 L124–166](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/cache-db.js#L124-L166) [源码 L329–345](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/cache-db.js#L329-L345)

**管理接口。** getPageCacheStatus 分当前 pageConfigKey count 与所有配置 totalCount；clearPageCache 按 pageKey 删所有版本 translations+page，不删 Selection；clearAllCache 清三 store。stats count三个store并遍历 translation/explanation累计估算bytes。pruneCache 最低5MiB，超限按 translations.lastAccessedAt最旧优先删除，再检查受影响页是否孤儿；它不按此字节上限删 explanations，解释另有256数量上限，所以不能承诺总 bytes 一定降到limit。[源码 L168–264](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/cache-db.js#L168-L264) [源码 L287–299](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/cache-db.js#L287-L299)

**错误、取消、安全与兼容。** requestAsPromise/transactionDone/iterateCursor 把 IDB request、事务 abort/error、游标错误传出；cursor callback false提前结束。没有 AbortSignal、取消登记或外层 task事务绑定，CACHE_STORE一旦送出不能靠取消 Provider回滚。存储包括页面URL/title、原文、译文，hash key不隐藏这些内容。修改 URL/text/hash/schema须评估旧缓存兼容；改 eviction要连解释store核对。[源码 L347–373](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/cache-db.js#L347-L373)

**测试。** cache-context 单测覆盖默认provider兼容、endpoint/语言/glossary/preset分区及外观/stream不分区；article/revisit E2E涵盖基本IDB链，NOT_RUN。它们不等于迁移、quota/blocked、连接恢复、事务取消竞态或LRU容量真实性验证。

<a id="file-requests"></a>
## src/background/translation-requests.js：在途合并与消费者取消

源码 blob：`89166444edae1e7e730edb70cbd09cb4638e3fb5`；固定commit同本章。

**调用与状态。** router、字幕请求等给 runTranslationRequest({requestId,segments,config})；模块 Map inflightByKey共享在途entry，requestsById定位消费者。缺id造UUID，扫描文本是否有合法marker；有则克隆config追加保留marker嵌套及code/kbd指令，再计算key。[源码 L1–44](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/translation-requests.js#L1-L44) [源码 L81–92](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/translation-requests.js#L81-L92)

**合并与结果。** key JSON包含 provider/apiBaseUrl/model/prompt/targetLanguage 和按原顺序的{id,text}；不包括 pageUrl、API key、streaming，也不单列glossaryIdentity（有效glossary已合进prompt）。相同key新消费者加入同一Promise，第一位决定实际请求config/controller。entry finally 标settled并删inflight；各消费者 await 后检查自己是否仍在Set再返回，finally删自己和匹配的requestId登记。它不是缓存，settle后下一次会新调用Provider。[源码 L60–72](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/translation-requests.js#L60-L72)

**取消。** cancelTranslationRequest 无登记返回false，有登记删消费者；只有未settled且消费者清空才controller.abort。取消一个共享消费者不会取消其他人，该消费者仍等共享Promise settle后抛CANCELLED。请求id应唯一；此处没有sender/tab owner绑定，也没有重复id防护。marker指令是prompt约束，语义/完整性最终仍需解析/渲染防护。[源码 L46–78](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/translation-requests.js#L46-L78)

**错误/性能/影响/测试。** Provider错误沿共享Promise抛出，不在此重试；合并降低相同请求重复费用，但不同分组顺序/id不合并。translation-requests 单测覆盖model改key、两请求一次fetch、只取消一个消费者；gateway测试补signal路径。NOT_RUN。改key需考虑凭据变更期间复用、请求隔离、marker协议和取消竞态，不能把去重key当持久缓存key。

<a id="file-gateway"></a>
## src/background/translation-gateway.js：最终结果式 Provider 门面

源码 blob：`231ea1e225c954dafa6d235de9ee77ea67bb2f92`；固定commit同本章。

**合同。** getTranslationGatewayCapabilities 返回冻结 {completionMode:"final",streaming:true,partialResults:false}。executeTranslation 接 segments/config/signal/onProgress，非数组或空数组直接[]，否则先started→providers.translateBatch→completed 返回数组，错误发failed或signal.aborted时cancelled再抛。[源码 L1–52](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/translation-gateway.js#L1-L52)

**状态/观察。** 所有状态是调用局部；emitProgress复制冻结event，吞观察者错误，不让日志/UI观察改变翻译语义。Provider事件附completionMode后转交；没有缓存/IDB/DOM，也没有自己的重试、请求Map或权限申请。streaming能力不表示逐token写页面，requests当前没有传onProgress，页面等待最终数组。[源码 L54–61](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/translation-gateway.js#L54-L61)

**测试/影响。** translation-gateway 单测 mock fetch 检查能力、生命周期、observer抛错无影响、AbortSignal，以及SSE累计字符进度没有chunk、最终结果。测试名称含“without streaming”但实际断言streaming:true，以断言为准。NOT_RUN。修改返回形状/事件需协调所有Provider、requests、Selection/字幕，不得以gateway成功替代真实网络可用性证明。

<a id="file-provider-index"></a>
## src/background/providers/index.js：统一 Provider 分派

源码 blob：`6a661a38a52c7e820d21566fcf91da3e8d9885d6`；固定commit同本章。

**入口与算法。** 固定Map注册deepSeekProvider/openAICompatibleProvider；getProvider从config.provider取值，缺省DeepSeek，trim+lowercase后查询，未知id抛普通Error。translateBatch/completeJson/testProvider分别委派adapter.translateBatch/completeJson/test；completeJson额外检查方法存在。[源码 L1–31](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/providers/index.js#L1-L31)

**边界。** 输入config/segments/options不在此验证或克隆；信号与进度通过options原样传递；无持久状态、缓存、重试或网络实现。adapter决定空输入、凭据、权限、超时及输出解析。它是页面/字幕与显式Selection AI的共享分派点，不能改成Content直接fetch。

**测试/影响。** gateway测试经DeepSeek和OpenAI-compatible stub覆盖分派，providers.test只测prompt helper而非完整registry，NOT_RUN。新增/改Provider还须同步constants、配置解析、缓存身份、host权限、设置页与adapter测试；不能只改这个Map。

<a id="file-deepseek"></a>
## src/background/providers/deepseek.js：固定 DeepSeek HTTP 适配器

源码 blob：`e09434cf835f45c727e0de90eab67d1a2f6286f7`；固定commit同本章。

**对象与请求。** 冻结deepSeekProvider id=deepseek。translateBatch空输入[]；segments映射字符串id/text放JSON user payload，system用buildTranslationPrompt，model trim后默认deepseek-flash，固定 https://api.deepseek.com/chat/completions，requireApiKey:true，response_format=json_object、thinking disabled、stream:false、temperature .2。传外部signal到shared HTTP，再requestParsedTranslation对结果解析/畸形重试。[源码 L1–44](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/providers/deepseek.js#L1-L44)

**其余接口。** completeJson接受systemPrompt/payload/parseResult，同endpoint/key/model，temperature .1，requestParsedJson验证业务结构；服务显式AI而非此处自动触发。test发送“Reply with exactly: OK”与Connection test、temperature0，不带signal参数；取首条content.trim或回退OK，并没有强制返回必须等于OK。[源码 L46–92](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/providers/deepseek.js#L46-L92)

**状态/失败/安全。** 不保留连接级Map、不写缓存；凭据和文本只在后台HTTP使用，缺key/config、网络/auth/格式错误交shared。signal取消只保证受支持阶段可中断，不能撤销远端已收到的请求。它不消费onProgress，也不是流式adapter。测试gateway/provider-retry和article E2E间接涵盖翻译，NOT_RUN；真实DeepSeek连通/计费未验证。修改body/model/prompt要核对config/cache身份、shared解析、mock与真实接口兼容。

<a id="file-retry-policy"></a>
## src/shared/retry-policy.js：纯重试分类与延迟

源码 blob：`4d1d93514a6a183a08912bd9cabc1b4c5f3ccedc`；固定commit同本章。

**职责/导出。** shared HTTP/SSE使用DEFAULT_RETRY_POLICY：maxAttempts3、malformedMaxAttempts2、base500ms/max4000ms、requestTimeout45000ms。classifyProviderFailure优先code：CANCELLED不重试，CONFIG/AUTH/PERMISSION不重试，MALFORMED_RESPONSE可重试，NETWORK/TIMEOUT可重试；再看408/425/429/≥500暂态，401/403认证，其余≥400永久，其他unknown不重试。[源码 L1–37](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/retry-policy.js#L1-L37)

**计算。** getMaxAttemptsForFailure按分类返回1/畸形上限/一般上限。computeRetryDelayMs优先使用任何正retryAfterMs，不套maxDelay上限；否则base×2^(attempt−1)且截max，无jitter。parseRetryAfterMs接受秒数或HTTP日期，负/过期截0，不可解析0。[源码 L39–68](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/retry-policy.js#L39-L68)

**状态/错误/取消/测试/影响。** 纯函数无timer或网络；真正sleep和abort由Provider实现，自动模式15秒/5分钟另在auto。retry-policy单测覆盖分类、畸形默认两次、指数/Retry-After优先、秒与日期，provider-retry测HTTP429/401/预取消，NOT_RUN。改策略影响请求次数、等待及费用，不保证整个多层parse+HTTP调用总共最多3次；修改须联动shared和SSE。

<a id="file-url"></a>
## src/shared/url.js：缓存 URL 与站点作用域

源码 blob：`e7d0267bc979dcb2a39e82a31cac33fa04496c34`；固定commit同本章。

**导出与调用。** cache-db用normalizeUrl：new URL解析，仅http/https，普通hash去掉，#/与#!/保留；删大小写不敏感utm_*与固定tracking键，searchParams排序，URL序列化返回。不同业务query、path、port仍区分缓存；锚点/跟踪参数不同可命中同页。[源码 L1–19](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/url.js#L1-L19)

**站点方法。** normalizeOrigin仅http/https，返回protocol//hostname故意不带port；getOriginMatchPattern返回protocol//hostname/*；isRouteLikeHash是上述纯regex。auto-sites/config用站点作用域，不能和完整pageUrl身份混用。Content runtime有classic版同算法，异常时原样返回而这里抛错。[源码 L21–34](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/url.js#L21-L34)

**状态/安全/测试/影响。** 无存储/网络/取消，非法URL或协议由调用方处理；URL规范化不是隐私脱敏，保留业务query可能含个人内容。url.test覆盖tracking、排序、hash路由、站点忽略port，NOT_RUN。改此规则会改变pageKey与旧缓存可达性、站点配置/权限匹配和路由失效，必须同步runtime并评估迁移。

<a id="file-hash"></a>
## src/shared/hash.js：缓存摘要与 UTF-8 大小

源码 blob：`da7cd46de718ac44e7737d343bff77efa6098158`；固定commit同本章。

**完整行为。** sha256(value)将String(value)用TextEncoder编码，await crypto.subtle.digest("SHA-256")，把Uint8Array转两位补零小写hex；返回64字符摘要。byteLength(value)将null/undefined按空串处理后取UTF-8 byteLength。cache-db用前者计算URL/config/source身份，用后者估算占用。[源码 L1–11](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/hash.js#L1-L11)

**边界。** 无自有状态/副作用/重试/取消；crypto错误自然reject；sha256(undefined)和byteLength(undefined)的转换不同。摘要不是加密或匿名化，而且cache记录仍保存明文。cache-context通过真实hash间接断言身份，未见本轮独立hash测试，NOT_RUN。改字符串编码/摘要表示会整体影响缓存键；字节估算不是浏览器实际配额测量。

<a id="file-text"></a>
## src/shared/text.js：持久缓存原文规范化

源码 blob：`de6a124986cbd2e8f6a805a5b3684e8d416c1701`；固定commit同本章。

**完整行为。** normalizeSourceText接受unknown，nullish为空串，String后把连续正则\\s折成一个普通空格，trim返回；不做大小写折叠、Unicode归一化、标点删除、marker剥离。cache-db在hash前及命中二次原文核验使用，Content runtime等价cleanText用于本地分组和写回检查。[源码 L1–4](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/text.js#L1-L4)

**状态/错误/影响/测试。** 纯同步，无网络/存储/取消；空文本产生空串，异常String转换不会被吞掉。tests/text.test.mjs只断言空白折叠，NOT_RUN。规则变更会破坏旧缓存可达性或扩大不同原文合并范围，需同时调整runtime、batch、cache-context/结构标记测试。

<a id="partial-entry"></a>
## 既有入口与 Quick Control（本轮局部）

[popup.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/popup.js#L84-L191) 的runPageTranslation生成taskId、注入后发ABT_TRANSLATE_PAGE，100ms后开始、再250ms TASK_STATUS轮询；取消走CANCEL_TASK。手动恢复发送ABT_RESTORE_CACHE。[src/content/quick-control.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/quick-control.js#L137-L168) 的翻译/重试都走runTranslation→processPage，新UUID，并订阅page task；重试是清译文后重新缓存优先扫描，不是只补旧失败batch。本轮不展开整个Popup/视图。

content.js/runtime/auto-sites已完整见[启动模块](startup.md#file-content-entry)、[运行时](startup.md#file-content-runtime)、[站点注入](startup.md#file-auto-sites)，本轮不重复算覆盖。根content转发消息及storage/route变化；重访只有持久注册的恢复/自动模式才自行处理，仅Quick Control注册不恢复。

<a id="partial-router-config"></a>
## router / 有效配置（本轮局部）

[src/background/router.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/router.js#L90-L167) 的TRANSLATE_BATCH、CACHE_LOOKUP、CACHE_STORE、CACHE_PAGE_STATUS各自getEffectiveConfig(pageUrl)，clear按页删除、prune读取cacheMaxMB。网页分支没有rich viewer式sender owner绑定；并非普通网页JS天然可发chrome.runtime消息，但不能把富词典校验当成所有消息共同保证。

[src/background/config.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/config.js#L37-L53) 经resolveBaseConfig拿storage+temporary preset，再按glossary合成prompt/glossaryIdentity；[src/shared/provider-config.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/provider-config.js#L47-L116)处理站点覆盖、Provider统一凭据、站点prompt优先preset。[src/shared/constants.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/constants.js#L4-L23)默认prompt要求每id恰好一次、cacheSchema=2。这里只解释网页相关边界。

各消息用相同解析函数，却没有由lookup传到translate/store的同一个快照。等待中配置改动，旧结果可能按新配置存储。requests为marker追加的prompt也不是cache-db当次直接哈希的prompt。不能称全链已有配置快照一致性。

<a id="partial-http"></a>
## Provider shared / OpenAI-compatible（本轮局部）

[src/background/providers/shared.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/providers/shared.js#L44-L114) 缺key标CONFIG，HTTP暂态按retry-policy重试并可abort sleep；requestParsedTranslation另重试MALFORMED_RESPONSE。[src/background/providers/shared.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/providers/shared.js#L154-L173)只保留输入合法id和字符串text再trim，未强制“一次且全覆盖”；重复id到Content Map被后项覆盖，漏id成为missing，空数组可正常结束。

[src/background/providers/shared.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/providers/shared.js#L175-L232) 的POST用linked signal，但finally在fetch返回Response后cleanup，response.text在后面。所以45秒计时/外部abort连接不是整个body读取阶段的硬上限。非JSON成功响应为MALFORMED_RESPONSE、401/403为AUTH、429为RATE_LIMIT并取Retry-After。此处不完整展开Selection JSON路径。

[src/background/providers/openai-compatible.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/providers/openai-compatible.js) 先查endpoint host permission和model；generic可选SSE，不支持时回退；local model另切小批，结构输出不支持时降级，最终仍返回整数组。[src/background/providers/openai-sse.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/providers/openai-sse.js)和[src/background/providers/local-translation.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/providers/local-translation.js)仅说明此依赖边界，帧解析/本地模型检测及多格式解析留后章，不宣称所有兼容服务全面支持。

<a id="test-boundaries"></a>
## 测试证据地图：全部 NOT_RUN

本轮只读源码/断言、制作文档；没有项目脚本、Node/Vitest、构建、浏览器E2E或真实Provider运行。以下是测试意图，不是PASS；测试文件不计完整解释。

- [tests/structured.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/structured.test.mjs)：VM+自造DOM测plain/rich marker、a/code复建、scheme/畸形降级；非完整浏览器URL安全认证。
- [tests/tasks.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/tasks.test.mjs)：任务字段迁移、立即本地取消/后台消息、订阅；不覆盖IDB撤销。
- [tests/translation-requests.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/translation-requests.test.mjs)：model改key、两请求一次fetch、单消费者取消不影响另一个。
- [tests/translation-gateway.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/translation-gateway.test.mjs)：最终合同、observer隔离、AbortSignal、SSE进度无chunk。
- [tests/cache-context.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/cache-context.test.mjs)：身份兼容/分区，不操作真实IDB。
- [tests/cache-restore-mode.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/cache-restore-mode.test.mjs)：配置/UI/源码正则allowProvider与cacheOnly，不能独立证明浏览器无网络。
- [tests/retry-policy.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/retry-policy.test.mjs)、[tests/provider-retry.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/provider-retry.test.mjs)：分类/delay/Retry-After、429恢复/401不重试/预abort不fetch。
- [tests/providers.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/providers.test.mjs)：target language prompt；[tests/url.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/url.test.mjs)、[tests/text.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/text.test.mjs)：tracking/query/hash/site scope/空白。
- [e2e/translateflow.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/translateflow.spec.mjs#L8-L128)：mock下首译3段/一次调用、a/code保留、手动恢复零新增调用；Quick-Control-only不恢复；重访restore-only动态hit、miss不翻、禁用不处理新增。
- 同E2E [e2e/translateflow.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/translateflow.spec.mjs#L210-L304)：Quick Control错误/用户重试/取消，auto只发新段落；[e2e/translateflow.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/translateflow.spec.mjs#L622-L649)：glossary/preset改行为、切回缓存。
- 上述相关断言未证明配置中途改变的缓存分区、已送store取消、A→B→A generation、仅remove/attribute失效、IDB blocked恢复、scheme控制字符混淆。它们是未验证边界，不是已运行失败。

