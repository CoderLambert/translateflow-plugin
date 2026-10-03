# 网页翻译、缓存恢复与重访：完整用户流程

[导读首页](../README.md) · [运行时总览](../architecture.md) · [全仓地图](../repository-map.md) · [逐文件说明](../modules/page-translation-cache.md)

源码固定于 `d5e308a709c008acf6b277d466d020f13025bdca`；静态复核2026-10-03；运行、测试、真实网页/Provider验证均 **NOT_RUN**。这章从已注入完成的网页继续，不重复[启动](extension-startup.md)、[划词与显式AI](selection-and-dictionary.md)或[MDX/MDD](local-dictionary-import.md)。

## 1. 用户入口与可观察结果

- Popup“翻译”或Quick Control“翻译 / 重翻”：清已有译文后扫描正文，先恢复命中，再为缺失组调用Provider；译文追加在原段落内，原文不替换。
- Popup“恢复缓存”：同一提取/分批/安全插入路径，但cache miss直接结束，返回暂无缓存数，不调用Provider。
- “本站自动恢复缓存”：持久cacheRestoreSites，重访先静默恢复，再观察动态内容；hit恢复，miss不翻。
- “自动增量翻译”：state.auto允许miss调用Provider；同站持久autoSites由启动章的动态注册接线，Quick Control切换本页auto并不等于保存站点。
- “隐藏译文”只切CSS class；“清译文”只删DOM；“清本页缓存”删该页所有配置版本的持久翻译，不自动等同清DOM。这三件事不能混称清缓存。

入口见[局部入口](../modules/page-translation-cache.md#partial-entry)，持久注入/权限沿用[启动模块](../modules/startup.md#file-auto-sites)。仅持久Quick Control不会自动恢复缓存。

## 2. 一次手动翻译的真实调用链

1. Popup生成taskId、发ABT_TRANSLATE_PAGE；content.js转processPage({cacheOnly:false,taskId})。Quick Control直接调用同函数，不另开翻译服务。
2. [processor](../modules/page-translation-cache.md#file-processor)等待启动恢复，再与auto drain互斥；清旧译文，调用[dom](../modules/page-translation-cache.md#file-dom)收集可见候选。无英文正文返回count=0，不建task、不调用Provider。
3. [structured](../modules/page-translation-cache.md#file-structured)保留有限行内语义为marker；[batch](../modules/page-translation-cache.md#file-batch)生成entries，按规范化含marker文本去重成groups，再按18组/7000字符阈值串行切批。
4. 建page task（queued），每批转cache_lookup，发送CACHE_LOOKUP {pageUrl,segments:[{id,text}]}。后台router解析当时有效配置，再由[cache-db](../modules/page-translation-cache.md#file-cache-db)读取IDB。
5. hit按id映射到group并插入每个对应元素。cacheOnly=true或全命中此批立即返回，网络分支位于其后。
6. miss进入translating，发送TRANSLATE_BATCH {requestId,pageUrl,segments}。router再次解析有效配置，进入[requests](../modules/page-translation-cache.md#file-requests)→[gateway](../modules/page-translation-cache.md#file-gateway)→[Provider registry](../modules/page-translation-cache.md#file-provider-index)→adapter。
7. 后台返回最终translations:[{id,text}]。Content核对页面身份与原文后插入；有效结果形成CACHE_STORE {pageUrl,pageTitle,items:[{sourceText,translation}]}。后台再解析配置并存储，完成后进度更新。各批顺序执行，最后completed；存储/查询错误则failed，已有成功插入不会回滚。
8. 新API插入后异步请求CACHE_PRUNE。Popup轮询TASK_STATUS；Quick Control通过tasks.subscribe拿同一任务快照。

重要数据并非一路传同一个对象：DOM Element和descriptors留Content；runtime消息只传文本/id/URL等；Provider收到文本（包含marker）和有效prompt，凭据只在后台adapter使用。网页翻译没有词典Worker、没有Selection本地优先分支。

## 3. 原文、marker与批次的例子

一个含strong/link/code的段落，编码为普通字符串夹⟦TF:0:S⟧…⟦TF:0:E⟧。descriptors记录原标签，link的有限属性，以及code/kbd原内容。重复段落共享一个group id；HTTP只发一份，回写多处。不同元素最终各自重新编码，用自身原链接/代码恢复，因此相同文本的链接目标不从模型输出获取。

筛选是英文阅读启发式：12–5000字符、Latin/CJK至少6字、Latin占比≥0.58；不是所有页面文字/语言都翻。main优先、否则body，排除按钮、导航、编辑区域和扩展自有内容。结构文本与plain TreeWalker过滤并不完全一致，不能把候选筛选当全页面敏感内容识别。

渲染使用createTextNode/createElement和源描述符，不解析模型HTML。marker错配降级为strip后的纯文本；合法marker的完整性并未逐项强校验，safeHref也只是三个危险scheme前缀拒绝。详见[结构模块的实际边界](../modules/page-translation-cache.md#file-structured)，不要将当前实现概括为任意不可信链接均已安全过滤。

## 4. 缓存命中与重访身份

持久键分三层：

- pageKey：规范URL的SHA-256。去tracking参数/普通锚点，保留业务query、路径、port以及#/、#!/路由；query排序。
- configHash：schema版本、Provider、model、targetLanguage、prompt；OpenAI-compatible加endpoint，有效非空glossary加identity。外观、streaming、API key不参与。
- sourceHash：规范化原文（仍带marker）的SHA-256；命中后还比较存下来的sourceText，避免只信hash。

完整cacheKey为pageKey:configHash:sourceHash。译文不跨pageKey自动复用。换preset/术语/模型可能进入新版本；切回相同有效配置与原文可复用旧版本。存的是URL/title/原文/译文明文，hash不等于加密。IDB与词典OPFS、ReadingRecord历史是不同边界。

重访时普通注入本身不触发翻译；持久恢复/auto才启动。restore-only先processPage(cacheOnly:true, silent:true, startup:true)，之后观察动态节点。无缓存节点保持未译，不隐式为用户花费API。lookup仍更新lastAccessedAt，所以“只恢复缓存”不是只读IDB事务，而是不会调用翻译Provider。

[URL](../modules/page-translation-cache.md#file-url)、[hash](../modules/page-translation-cache.md#file-hash)、[text](../modules/page-translation-cache.md#file-text)解释身份算法；[cache-db](../modules/page-translation-cache.md#file-cache-db)解释store/index、清除与LRU。

## 5. Provider、重试与不完整输出

requests按有效Provider/endpoint/model/prompt/语言和按顺序的segments合并完全相同的在途调用；没有全局跨请求持久缓存职责。marker存在时追加保留协议prompt；gateway最终返回数组，streaming capability=true也不代表页面逐token渲染。

[DeepSeek](../modules/page-translation-cache.md#file-deepseek)使用固定endpoint、JSON mode、非流式；OpenAI-compatible可用SSE或local-model专用小批路径，均返回最终结果，详见[局部HTTP依赖](../modules/page-translation-cache.md#partial-http)。

失败分层：
- 配置/权限/认证失败不做HTTP自动重试；网络/超时/429/部分HTTP暂态按[retry-policy](../modules/page-translation-cache.md#file-retry-policy)退避，默认一般最多3次尝试、畸形解析2次；多层循环不能概括为整个操作永远最多3次HTTP。
- Content收到非ok消息转errorCode并使task failed；Quick Control“重试”重新扫描/缓存优先，已缓存部分无需再次翻译。
- 默认prompt要求每id恰好一次，但通用解析器仅过滤合法id和字符串；漏项计missing，不主动补问。completed/done=总段落数表示处理结束，不代表每段已有译文。

## 6. 取消与旧响应：有保护，也有边界

[任务模块](../modules/page-translation-cache.md#file-tasks)本地立即标cancelled并通知UI，再发CANCEL_TRANSLATION。后台只移除该requestId消费者，最后一个消费者退出才abort共享Provider。Content在关键await后assertActive，阻断取消后的新插入/后续store发送。

不能因此声称取消能撤销已完成工作：cancelTask不要求后台确认cancelled:true；已经插入的译文保留；已经发送的CACHE_STORE没有绑定AbortSignal/事务撤销，仍可能完成。取消是本地不再接受后续流程的权威状态，不等于远端未收文本、未计费或存储回滚。关闭Popup也没有在这条链中自动取消保证。

每次插入还核对两条件：当前规范page identity等于请求时身份；元素还在document且重新提取原文等于group快照。不满足则不插，变文可重新观察。但没有统一generation：A→B→A回到相同身份/文本，旧结果并非必然被排除。

另一个关键边界是有效配置：lookup、translate、store用同一解析方法，但分别读取当前配置，未固定一份快照。配置在网络等待中变化可能使旧译文写进新配置分区；storage变化清DOM/重扫不构成在途配置版本隔离。以上为源码可见缺少的保证，未进行竞态复现，也未在本任务改业务逻辑。

## 7. 增量观察、路由与退出

[auto](../modules/page-translation-cache.md#file-auto)将cacheRestore/auto共用一套IntersectionObserver、MutationObserver、pending Set和timer。交叉观察提前覆盖视口上下900/1200px；新增/字符变更清失效译文再观察，翻译自身节点不会回流。默认180ms去抖，drain每轮最多取72个元素再切批；与manual互斥。

每批采样allowProvider=state.auto，false就是cacheOnly。auto失败把尚未译的元素重新入队，认证/配置/权限长退避5分钟，其余15秒；恢复错误可继续750ms重排。没有重试次数上限的auto队列不等于HTTP adapter的一次请求重试预算。

Content根监听popstate/hashchange/yt-navigate-finish；MutationObserver回调也核对URL。身份改变清pending/译文后重扫；没有在此拦截所有history.pushState，因此纯URL变化且没有相应事件/DOM mutation不能保证即时发现。仅删节点和纯属性变化不属于当前主要重译触发路径。

全关模式会disconnect observers、清timer/pending；只关auto且恢复仍开则继续cache-only观察。但关模式不主动cancel已启动请求，已启动auto批次仍可能完成。独立restore-only零Provider保证，不应扩大成切换瞬间能撤销之前auto请求。

## 8. 证据、阅读顺序与改动入口

详细[测试证据地图](../modules/page-translation-cache.md#test-boundaries)列出固定源码链接及断言。本轮所有测试 **NOT_RUN**。现有E2E描述的证据包括首译/缓存恢复、重访动态hit/miss、Quick Control错误重试/取消、增量仅发新段落、preset切回缓存；不是全网适配、所有路由竞态或真实Provider认证。

建议阅读：dom→structured→batch→processor→tasks→auto→cache-db→requests→gateway→Provider index/DeepSeek→纯URL/text/hash/retry工具。15个完整文件均在[模块索引](../modules/page-translation-cache.md#file-dom)，大依赖保留局部覆盖。

最小改动定位：
- 漏译/重复段落：dom筛选与batch key，回看rich/plain差异。
- 译文结构/链接：structured编码/渲染与requests协议，补真实浏览器安全输入。
- 缓存错误/版本：cache-db身份、router配置读取、URL/text规则，先明确兼容而非清库。
- 取消/错页回写：processor检查点、tasks、requests共享取消、auto在途生命周期。
- 动态页不更新：auto观察范围、Content路由事件与page identity。
- Provider超时/频繁请求：shared/SSE与retry-policy，区分队列重排、HTTP重试、畸形重试与用户重新操作。

未展开：OpenAI-compatible/SSE/local-model全部算法、完整配置UI、缓存管理UI、Reading、字幕和其专用缓存协议，继续后续独立功能切片。

