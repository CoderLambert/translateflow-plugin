# Reading 返回原文：逐文件与投影说明

[完整用户旅程](../features/reading-return-to-page.md) · [Reading 数据库/保存](reading-records.md) · [学习中心](learning-center.md) · [构建](build-test-release.md) · [清单](../coverage.json)

本章所有新说明固定于 `33ab3ea2a38ce591b622ba06739344858d7da403`。下面有完整小节的 20 个文件均全文阅读；关联大文件只解释本切片边界，不提升为完整覆盖。所有测试、构建、生成、浏览器及产品验收 **NOT_RUN**。链接指向固定源码，不把 docs 分支代码当 main。

<a id="file-return-view"></a>
## 1. ReturnToPage.tsx：用户动作与异步 UI

源码：[src/learning-center/views/ReturnToPage.tsx](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/learning-center/views/ReturnToPage.tsx)。调用方 Detail；依赖 React、i18n、公共 Button/Notice、ReadingClient。

输入是已验证的 detail.record、禁用标记和可注入 client；输出为动作按钮、状态提示、站点 marker 开关和普通 URL 链接，不存历史。origin 从 safeReturnUrl 导出，effect 随 client/origin/recordId 更换增加 epoch，清 markers/status/error/busy，重新读取站点 marker 状态；cleanup 增加 epoch，使旧 promise 只能结束自己的工作而不能更新当前 UI。

returnToPage 的 mutation ref 是同步互斥，busy 是渲染状态。普通可信点击先创建 handoff；只有权限不足的二次授权点击先调用 requestSitePermission。返回 ready/permission-required/unsupported；ReadingError.DISABLED 映射 disabled，revision/stale/not-found 映射 changed，其余 error。finally 释放 mutation，只有 epoch 未变才清 busy。epoch 不取消后台 tabs.create，因此切换记录可抑制旧提示，但不能称作撤销已提交开页。

toggleMarkers 同用互斥：开启前请求 origin 权限，拒绝保留 enabled 的原值并显示 permission-required；成功通过 client.setMarkers 更新。marker 读取失败解锁按钮供用户重试，而不是把失败伪装为 disabled。所有这两类按钮的 handler 都检查 nativeEvent.isTrusted。普通 a 标签含 noopener/noreferrer，只导航安全 URL，没有 token 或自动定位。

修改影响：异步状态应一起核对组件切换记录、拒绝权限、revision 冲突和 marker 设置；返回路径由定向 E2E 实际点击，本轮未运行。站点 marker 的产品验证独立于临时返回卡。

<a id="file-client"></a>
## 2. client/reading.ts：扩展页面唯一消息客户端

源码：[src/learning-center/client/reading.ts](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/learning-center/client/reading.ts)。整个文件负责类型投影、读取/管理/返回消息包装及失效订阅，不访问 IDB。

RecordItem/PageItem/Exclusion/Detail 从 shared validators 推导；RecordingState/Page/Export 与 SiteMarkers/ReturnHandoff 描述对应响应。ReadingClient.request 先 validateReadingRequest，再 send（可注入便于测试）；transport throw 转 READING_DISCONNECTED，validateReadingResponse 使用 extension scope，失败响应变为 ReadingError，成功返回 data。`as T` 只是 TypeScript 断言，真正运行边界仍在 shared validator。

state/recording、records/pages/getRecord、exclusions/site/setSite 保持现有后台职责，列表固定每页 30 条；markers/setMarkers 发送站点配置，createHandoff 发送 recordId 与 expectedRevision。requestSitePermission 对 origin 请求 `${origin}/*`，本身不创建后台授权令牌，必须由可信事件直接触发。

subscribe 连接 reading.invalidate，验证 extension scope 的 invalidation，对 JSON 相同消息去重；格式错误走 onDisconnect，端口断开同样通知。返回 cleanup 设置 closed、拆 listener 并 disconnect，不由客户端自动后台重连；具体恢复由学习中心 hook 管。修改任一方法同步 shared DTO/response、后台 dispatch 与学习中心消费，测试入口见旧组件章与本章 E2E；没有本轮运行通过结论。

<a id="file-detail"></a>
## 3. Detail.tsx：历史正文始终在扩展页

源码：[src/learning-center/views/Detail.tsx](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/learning-center/views/Detail.tsx)。输入 detail 的 record/snapshots/artifacts、back/delete 回调、client/i18n。组件不请求 Provider 或存储。

recordId 变化重置 shown=5 并聚焦标题；Escape 冒泡到 section 调 onBack，返回按钮同路。标题/时间/页名后嵌入 ReturnToPage；每个 artifact 按 sourceSnapshotId 找关联快照，assistant 显示问答，definitions 显示 headword/phonetic/part-of-speech 与无命中/释义，text 显示翻译。上下文和 provenance 在 details 中，React 文本渲染不当 HTML 执行。更多按钮每次增 5；删除仅调用父回调且服从 disabled。输入已经过 client validation，分支不是原始不可信 HTML renderer。

修改关系：artifact union 或 snapshot 关联改变需同时校验 shared schema 和列表/详情数据；返回入口改变需保留 disabled、可信点击及焦点语义。旧组件测试与准确记录 deep-link E2E 是相邻验证范围，均未执行。

<a id="file-handoff-target"></a>
## 4. handoff-target.js：同一只读事务的持久化事实

源码：[src/background/reading-record/handoff-target.js](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/background/reading-record/handoff-target.js)。repository 的只读 transaction runner 驱动 generator `readHandoffTarget(store, context)`，yield* state/pageState 复用 storage-state，不自己开数据库。

先 policy(meta, context) 检查当前 authority/consent/data，再拒绝 meta.enabled=false；recordId 从 expected handoffTarget 或 CREATE request 得到。records.get 不存在报 NOT_FOUND；site.excluded 报 DISABLED；revision 不同报 REVISION_CONFLICT；Content 的 pageKey/siteKey 与记录不符报 FORBIDDEN。读取 page state 后构造目标及最小 summary（recordId/revision/anchor/hasCompletedAssistant）。

复读时逐项比较 recordId/revision/page/site/safeReturnUrl 与 consentGeneration/dataGeneration/sitePolicyRevision/pageGeneration，任何变化报 STALE_OPERATION。不读取 artifact bodies，也不更改 lastViewedAt/lookupCount。这个函数无持久副作用、无自己的缓存；是否仍有效依赖 runner/context.assertCurrent 与整个只读事务。修改摘要字段必须同步 shared response 和 Content 消费，扩大字段尤其会改变页面数据暴露范围。registry 单测用 readTarget double，不等同真实 IDB 事务实测；本轮亦未执行 repository 测试。

<a id="file-handoffs"></a>
## 5. handoffs.js：能力生命周期与开页竞态

源码：[src/background/reading-record/handoffs.js](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/background/reading-record/handoffs.js)。createHandoffRegistry 注入 browser/readTarget/clock/randomId，service 持有实例；返回 create/consume/bindDocument/onTabUpdated/revoke。状态只在 worker-local entries、earlyUpdates 和递增 generation 中，重启全失效。

prune 删除到期及时间倒退的 entry；current 要求 Map 仍指向同一个对象。permission 使用 permissions.contains 检查 origin pattern。create 先读目标和 assertCurrent，再拒绝敏感/无 URL/缺 tabs API 或重新 derive 的 page/site/URL 不一致。权限未授予直接返回 permission-required，不创建标签。entries 超 operationsGlobal=128 报 CAPACITY；新 entry 有 handoffId、目标、null tab/document、60s TTL、busy=false 及 tabReady promise。

onTabUpdated 只收 loading/url；已绑定文档、不同 URL 或第二次 loading 会删 entry。tabs.create 未返回时，全局 earlyUpdates 只在真实 pending 存在期间记录；不同 tab 数上限 128，超量撤销 pending，每 tab 最多存 5 项，溢出以 url:null 保守失效。create 的 await 返回后检查 tabId/非隐身/url/pendingUrl，赋真实 tabId、唤醒等待者、重放早到事件，重新读目标和权限后返回经 validateHandoff 的 DTO。pending:handoffId 是返回 DTO 的占位 documentGeneration，不能代替绑定后的真实文档。

bindCurrentDocument 要求 nativeDocumentId、page/site 与真实 tab 一致；第一次绑定写 documentGeneration/nativeDocumentId/navigationGeneration，后续不一致删 entry。bindDocument 仅对仍 pending 的 create 最多等四轮，每轮 tabReady 或 250ms；无 pending 即结束，不为普通页面注册做定时查询。

consume 先 prune，缺失或 busy 返回 HANDOFF_EXPIRED。tab/site/page/三重文档身份/非隐身不一致返回 FORBIDDEN；通过后同步 busy=true，再 tabs.get 和权限检查、readTarget 代数复核、二次权限/上下文检查，返回 summary。进入消费 try 后无论成功失败，finally 删除 entry；并发请求不能获得第二份摘要。revoke 按谓词清理，没 pending 时清早到事件。

失败清 entry 不等于 tabs.remove：用户可能看到已开但无卡片的页。有效期不是浏览器后台保证唤醒的 timer，访问 registry 时 prune；TTL 过期不会被当作可继续消费。修改此文件优先验证早到注册/重定向、双消费、权限中途撤销、删除、worker restart；详见 handoff 单测，运行 NOT_RUN。

<a id="file-runtime"></a>
## 6. runtime.js：生命周期接入

源码：[src/background/reading-record/runtime.js](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/background/reading-record/runtime.js)。模块持有 current singleton，lazy runtime 创建 repository/service/subscriptions 并打开学习中心能力；repository factory 不直接开 native DB，授权操作才进入存储。

createRuntime 把 repository invalidation publisher 绑定到 subscriptions.publish，并记录是否自己拥有 repository。configureReadingRuntime 先 close subscriptions、service.revoke、解绑 publisher；只关闭旧自有 repository，然后创建注入或自有新实例，默认 learningCenterAvailable=false 供测试/组合层显式控制。

isReadingMessage 只做 reading. 前缀路由，不是 DTO 验证；handleReadingMessage 委托 service，handleReadingPort 只接受固定 reading.invalidate。原生 loading/url 更新先 service.onTabUpdated 再 closeTab，移除标签 forgetTab 并关闭订阅；权限移除 revoke 全部与关闭 ports。runtime 自己不吞掉权限错误或重建被消费的 handoff。修改事件桥要一起检查 background 路由、session/operations/exports/handoffs 失效，单测 service 不能证明真实 tabs 事件时序，本轮未运行。

<a id="file-handoff-client"></a>
## 7. handoff-client.js：一次注册与显式重注册

源码：[src/content/selection/handoff-client.js](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/content/selection/handoff-client.js)。classic IIFE 要求 runtime/sourceSnapshot/readingContract，已存在 readingHandoff 则返回；缺依赖不会稍后自动补装。

send 走 runtime、验证 v2 request 与 content response；业务失败抛带 code Error。consumePending 注册自身 documentGeneration；无 handoffId 返回 none，有则消费并返回 consumed/summary。register 把所有拒绝转成 error/code（未知用 INTERRUPTED），初始化 ready 立即开始一次 register，并将 ready/register 冻结公开。ready 不是将来所有重注册的总状态；marker 模块可单独调用 register，临时卡只等待初始 ready。不读 URL token、不请求任意记录、不存储摘要到磁盘。

修改时一起核对 source snapshot document identity、后端 bound response、重复注入；VM 测试覆盖 no-handoff 与有界消费消息序列，不证明真实浏览器权限或 page lifecycle。

<a id="file-resolver"></a>
## 8. reading-anchor-resolver.js：现页文字核对与 Range

源码：[src/content/reading-anchor-resolver.js](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/content/reading-anchor-resolver.js)。IIFE 只依赖已有 textProjection/policy，导出 resolve 和 resolvePage。输入是旧 anchor 或记录摘要列表及 AbortSignal；输出状态、Range/null，单条还带 stats/retries。它没有后台、Provider 或持久化 I/O。

rangeKey 用临时 Node→id Map 和起止 offset 去重；exactOffsets 枚举 exact 子串，contextMatches 同时检查 prefix/suffix（空则不限制）。validateCandidate 核对 projection revision、映射 Range 的 text 恰等 exact 和两端仍连接；保留的 position 不直接用来定位。blockDigest 存在时先对整个候选投影做 SHA-256，相同才考虑候选。

单条 attempt 先投影 body，统计 projection 节点/字符/工作时间。body 不可投影或有 blockDigest 时，TreeWalker 收集 ROOTS 中的段落、列表、标题、article/section/main 等；文本节点向上最多四层补候选。遍历按 policy sliceNodes/sliceMs 让给下一帧，候选 root 间也 yield；总上限本文件的 TOTAL=1M chars/25k nodes/250ms，且 digest/candidate 工作计入时间。边界不是完整 wall-clock 时间，exactOffsets 创建数组和浏览器调度亦不能据此宣称长页成本已验收。

多个不同可信 Range 立即 ambiguous；revision 改变返回 stale。最终结果优先级是 >1 ambiguous、1 resolved、无匹配且 stopped/limited 为 not-loaded，之后依据是否有可投影内容得 missing/unsupported。重要：实现即使因预算停止但已经找到 1 个候选，也会先返回 resolved；不要把该状态描述成数学上已穷尽全页后证明唯一。本章保留这一源码顺序，不虚构性能/唯一性实测。

resolve 缺 exact/body 返回 unsupported，start projection 后最多尝试三次；只对 stale revision 重试，150ms delay 支持 abort，不是 missing 自动等待页面加载。循环与扫描多处检查 signal，AbortError 交给调用方；不能从“有 abort 检查”推断每个 await 之后都不存在竞态。

resolvePage 先共享 body 投影；不可投影时所有记录记 not-loaded 或 unsupported。对各 exact offset 映射 Range，按 contextRoot 局部投影和 digest（roots Map 缓存），核对局部 context；每条独立判 ambiguous/resolved/missing。全局预算超量把余下未处理记录设 not-loaded。revision 改变整批最多三次，尽量不返回混版集合。它与单条的逐 root 全扫描不同，修改一条路径不能假定另一条等价。临时 ranges 只由 UI 持有，刷新/关闭要释放。

JSDOM 测试覆盖跨 inline、节点替换、旧 position、上下文/摘要、歧义、missing、unsupported、budget、revision retry、预先 abort 和共享 page projection。performance.now 被固定为 0，不能证明真实 250ms 性能；没有将快速手动重试/扫描中 abort 视为已覆盖。

<a id="file-return-card"></a>
## 9. reading-return-card.js：临时定位 UI 所有者

源码：[src/content/reading-return-card.js](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/content/reading-return-card.js)。依赖 handoff/resolver/contract/runtime/uiHost/uiPrimitives；导出 ready/close。状态 card/summary/Range/overlays/controller/RAF/observer/timer/automaticRetries/previousFocus 全是当前 Content 内存。

start 等待初始 handoff，只有 consumed 才保存 summary，先 renderCard 再 locate。renderCard 创建 dialog、quote/status/retry/open-record，记录旧焦点，聚焦关闭按钮；quote 用历史 anchor.exact 的 textContent，定位前已经进入 open shadow，隐私风险见[功能章](../features/reading-return-to-page.md#5-必须保留的隐私警告)。retry/open-record 要求可信 click；后者仅发固定 OPEN_LEARNING_CENTER+recordId，失败在卡内报错。关闭按钮、Escape 不发存储删除。

locate 先 cleanup abort 旧 controller、清 overlay/observer/timer/RAF/scroll/resize，再设置 locating 并 await resolve。结果更新 card.dataset.state 和状态色，resolved 才保存 Range、滚动、画框并观察 body mutation。DOM 更新按 150ms 合并，automaticRetries 最大 scanRetryCount=3；该计数不会因显式重试归零。ambiguous/missing/not-loaded 不装此自动 observer，用户可显式重试。

updateOverlays 再校验 Range 连通与 exact 文字，失效清框改 missing；最多 12 个正面积 rect，在固定层绘制，不包裹/改写原文。滚动/resize 通过 RAF 合并。减少动画选择 auto scroll，否则 smooth。close 清资源、拆 keydown、移 card、恢复仍连接的焦点；summary 仍在模块内存，没有持久删除。pagehide/popstate/hashchange 的 once listener 调 close；临时卡没有独立 Navigation API navigate listener，不能用 marker 的路由支持替它背书。

待验证：locate 的 controller 是共享变量，完成检查使用当前 controller，快速重试/关闭跨 await 的结果需要专门验证；不能把源码中 abort 的存在当成已证明无旧响应覆盖。host 通用层对子元素的 pointer-events 规则与 highlight none 的实际命中亦需浏览器验证，本文没有定性为已复现缺陷。相关 E2E 的节点替换/关闭成功断言不自动覆盖这些时序。

<a id="file-host"></a>
## 10. ui/host.js：样式与层级，不是秘密容器

源码：[src/content/ui/host.js](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/content/ui/host.js)。IIFE 初始化时依赖 runtime/uiTokens，读取当时已有的五组 featureCss（含 ReadingReturnStyles），不是后续动态收集。ensureHost 惰性建 documentElement 下固定全屏容器，最高 z-index、all:initial/pointer-events:none；open shadow 的 style 含 tokens/features 与通用 layer 规则。

getLayer 按名称用 Map 复用 fixed/inset:0 层；host 被移除时重建 host/shadow/layers。getHost/getShadowRoot 提供内部访问；ownsNode 接受 host、light 子节点或 getRootNode===shadow，供可信扩展控件判断。没有移除 API 或独立 dispose，feature 应删除自己节点/事件。默认 layer 子元素 pointer-events:auto 与特色样式共同决定命中，真实 hit testing 本轮未测。

open shadow 能阻止普通外层 CSS 穿透，却能被网站通过 DOM 读取；它不是 isolated-world 数据存储，更不是 closed-shadow 安全承诺。改变 mode、selector 或 CSS 顺序会影响所有 Selection/快捷控件/Reading 层及自动化 locator，需一并核验。

<a id="file-styles"></a>
## 11. ui/reading-return-styles.js：两种 UI 共用样式

源码：[src/content/ui/reading-return-styles.js](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/content/ui/reading-return-styles.js)。无 DOM I/O 的幂等 IIFE，仅注册冻结 css 字符串，供 host 初始化时收集。包含右下临时卡/quote/actions、fixed 高亮边框/背景/阴影，480px 窄屏布局与 prefers-reduced-motion；同时含左下历史 toggle/panel、grid 行、省略 quote、圆形 marker。

样式不改变 location status 或权限，Range 到坐标由控制器给出。没有网络资源和用户输入插值；颜色依赖全局 UI token。修改布局会影响卡片可见性、长 quote、滚动 panel、暗色和 overlay 命中，需真实窄屏/缩放/键盘/鼠标核验，不能用静态 CSS 阅读宣称可访问性完成。

<a id="file-page-markers"></a>
## 12. reading-page-markers.js：相邻持久再访路径的当前源码

源码：[src/content/reading-page-markers.js](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/content/reading-page-markers.js)。这不是一次性卡的续命机制，而是 independently gated 的本站标记功能；必须先 GET_SITE_MARKERS=ready/enabled，才按当前 Content 身份 GET_PAGE_SUMMARY，不带任意 page/site 参数。

load 增 generation，abort 旧扫描、断 observer/timer、清 UI；首次等 handoff.ready，register=true 时显式重新注册。摘要按每页 100 取至无 cursor 或累积达到 pageMarkers=200，最后 slice 200，保留 pageRecordCount 提示总量。resolvePage 得每条位置；generation 检查防旧 load 覆盖。空数据/权限不就绪直接无 UI，异常只清 UI，没有假成功 toast。

render 为每条建立 quote/status/查看记录，并仅为 resolved 保存 Range 和圆点；点击 quote 只在 Range 起点仍连接时 scrollIntoView，查看记录须可信事件，toggle/close 管 aria-expanded/hidden 与焦点。marker 点击展开对应行；Range rect 第一个正面积框定位到右侧，scroll/resize 重算，没 rect 隐藏。历史 quote/label 同样进入 open shadow，不能据此声称持久历史对站点保密，完整隐私评估仍待后续任务。

成功渲染后观察 body mutation，以 debounce 调 load；此模块没有卡片的三次自动重试计数。connect 接 invalidation port，任意消息重载，断开 cleanup；focus 时重新 connect+register/load。popstate/hashchange/Navigation API navigate 先 cleanup，再 debounce 重注册；pagehide once cleanup。cleanup 增 generation、abort、断 observer、清 timer/scroll/resize/UI/ranges，但不会主动 disconnect port 或拆长期路由/focus listeners；不能把它描述成卸载整个模块。重复注入由模块存在 guard 防止。

修改范围必须同时检查权限开关、service 当前页面隔离、分页/200上限、SPA/失效/DOM 高频更新及共享 UI 隐私。此文件全文解释只表示源码理解；#239 归档 ready_to_sync 与 main 中代码存在并列记录，#240 集成、持久 marker 性能/保密和全链验收未由本章判定 PASS。

<a id="classic-order"></a>
## 13. classic 投影与加载顺序

本小节三个完整源文件与一个完整防漂移测试独立计数；两个生成输出和 shared/constants 只登记来源与本切片关系，不冒充其闭包内所有源码已在本轮完整解读。

<a id="file-classic-builder"></a>
### scripts/reading-content-classic.mjs

源码：[生成器](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/scripts/reading-content-classic.mjs)。导入 vite build、fs promises、URL/path；root 从脚本自身 URL 推导，固定两份 projections（entry/output/global name），没有扫描整个 src。

source 关闭用户 config、silent、write:false，target chrome102/minify esbuild/sourcemap:false，library formats=[iife]。输出统一拉平 chunk，只允许一块且 imports/dynamicImports 都空，否则抛错；返回生成注释+代码。checkReadingContentClassic 逐一比较受版本管理输出的完整字节，不一致报 stale 并提示命令；writeReadingContentClassic 才写两份输出。直接执行时 --check 走比较，否则写入，import 不自动运行。这是构建时模块打包，运行时仍 classic self-contained IIFE，chrome102 是编译目标不是该浏览器的实测认证。

生成器无回滚两文件事务，任何读取/build/write 失败按 exception 传播；不在写文档时执行它。改变依赖闭包、Vite/esbuild/目标会改变字节/预算，需重新生成、check、包清单及对应真实入口验证，不能手改 minified 输出绕过漂移检查。

<a id="file-source-entry"></a>
### scripts/reading-source-entry.mjs

源码：[source entry](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/scripts/reading-source-entry.mjs)。仅按顺序 side-effect import `selection/source-snapshot.js`、`reading-anchor-resolver.js`，使二者在 ReadingSource IIFE 内装配。它没有状态/export/错误恢复，底层依赖必须由前序 Content script 准备。输出是 [reading-source.js](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/content/reading-source.js)；修改 capture/resolver 要改 owned source 再生成，不能增加运行时 ESM import。

<a id="file-record-entry"></a>
### scripts/reading-record-entry.mjs

源码：[record entry](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/scripts/reading-record-entry.mjs)。依次导入 record-access、record-client、handoff-client、reading-return-card、reading-page-markers、record-status、selection/controller。无业务状态，import 次序表达启动依赖：collector/client 先在，handoff.ready 在 card/markers 之前，Selection controller 最后看到完整模块。输出 [reading-record.js](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/content/reading-record.js)。任何源 IIFE 因缺依赖返回不会被 entry 自动重试。

实际加载由 [src/shared/constants.js](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/shared/constants.js#L55-L67) 的 CONTENT_SCRIPT_FILES 所有：reading-return-styles 在 host 前；text-projection-policy/builder/text-projection 在 reading-source 前，再 reading-contract；Selection 各 UI 依赖（特别是 rich-details）在 reading-record 前。两个 entry 内的 owned 源文件不再逐个进入该生产列表，避免重复初始化/增大资源清单。WXT raw bridge/manifest 沿该列表保持 classic 加载；参见[构建职责](build-test-release.md)。

<a id="tests"></a>
## 14. 测试文件：实际断言与不能推出的结论

以下四个文件全文读取并解释，执行结果均 NOT_RUN。每个文件的 fixture/清理是测试所有者自己的职责，不是生产回退逻辑。

<a id="test-handoffs"></a>
### tests/reading-handoff.test.mjs

源码：[registry/service tests](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/tests/reading-handoff.test.mjs)。target 从合成 record+derivePageIdentity 得合法目标；setup 注入固定 clock/randomId、可变 permission/target 与模拟 tabs。断言一标签、真实身份绑定、一次消费；gate 延迟 tabs.create，验证早到 bind 等待；权限拒绝/无安全 URL不开页；redirect、权限撤销、dataGeneration 变化、60s expiry 拒绝。

最后用真实 createReadingService 配 nativeBrowser/repositoryDouble/collector，验证只有学习中心 create、绑定 Content consume，扩展页 consume 与 Content create 禁止，worker restart 重建 registry 后注册无 handoffId。该测试没有 native Chrome 的所有 onUpdated 排序、真实权限提示或 IDB，不能从 mock 通过推出产品安全闭环。修改 registry/access/service 时重验本文件及真实交接 E2E。

<a id="test-handoff-client"></a>
### tests/reading-handoff-content.test.mjs

源码：[Content VM tests](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/tests/reading-handoff-content.test.mjs)。读取生成 reading-contract 和源 handoff-client，在独立 vm realm 装假的 runtime；JSON 经 realm 内 parse 保持 DTO 原型语义。无 handoffId 仅 REGISTER_DOCUMENT，ready=none；有时依次 REGISTER/CONSUME 且 token 与注册一致，ready=consumed。没有 DOM、权限、真实 tabs 或异常重试覆盖，不能拿这一条测试当定位卡验收。

<a id="test-resolver"></a>
### tests/reading-anchor-resolver.test.mjs

源码：[resolver DOM tests](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/tests/reading-anchor-resolver.test.mjs)。fixture 装真实 projection policy/builder/projection/resolver 到 JSDOM outside-only；注入 webcrypto、rAF timer、固定 performance.now=0，补 display/visibility 等 style，t.after close window。

anchorFor 先投影目标块并生成 digest。七类测试依次验证跨 inline 后节点替换且忽略 stale position；两个完整块 ambiguous；missing/unsupported/超预算 not-loaded；digest 不符 missing；一次 revision retry + 预先 aborted Signal 拒绝；20k text node 在读取 nodeValue 前按 length 拒绝（getter 计数0）；resolvePage 对两个摘要共享投影、各自判歧义/唯一。fixture 化渲染和时钟不代表真实 layout、滚动或时间预算通过，预先 abort 也不是扫描中的快速 retry 竞态。

<a id="test-classic"></a>
### tests/reading-content-classic.test.mjs

源码：[classic drift test](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/tests/reading-content-classic.test.mjs)。唯一 async test 先 checkReadingContentClassic，再断言两个输出在 CONTENT_SCRIPT_FILES，九个 owned 输入不在该列表。check 会真正调用 Vite 构建到内存，不是简单 grep。它不单独断言 rich-details 相对位置，也不执行浏览器 UI；改列表仍须读依赖顺序、跑相关入口/构建检查，本轮未执行该 test。

<a id="test-return-e2e"></a>
## 15. e2e/reading-return-location.spec.mjs：可观察用户旅程

源码：[return location E2E](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/e2e/reading-return-location.spec.mjs)。这是第 20 个完整文件。创建一次性 extension/profile，使用 prepareExtensionTestCopy 的 fixture 词典、mock HTTP server 和实际 Chromium persistent context；finally 关闭 context/server 并删除自己创建的临时目录。

测试用普通 TAB popup.html driver 设 UI locale/站点配置，不模拟原生工具栏点击。学习中心真实点击 Enable；网页程序化 Range+selectionchange 构造选区，再点击真实 Selection chip 等 saved，断言 Provider calls=0。通过 extension 消息读取 recordId，再 reload 学习中心并点击该条详情；返回按钮是 locator.click 的可信浏览器事件。

openTarget 换 mock HTML，点击返回等待新页，断言卡片 expected state 与 quote。unique 场景正文在1800px后，要求高亮、scrollY>1000、首个框在 viewport；替换 inline 节点后仍有 resolved 与框；截图写测试输出；Escape 后卡和框都消失。ambiguous 场景两个相同块无高亮、有提示；missing 换掉文字仍显示历史 quote 和 missing，正说明 quote 展示不以当前匹配成功为前提。最后 open-record 新页必须是准确 learning-center.html#record=... 且标题匹配，再断言 Provider0。

限制：该故事不是真实 HTTPS 网站、权限拒绝/重定向/TTL/restart/全站兼容/长期 marker、快速重试/中途关闭竞态或页面脚本读 quote 的安全用例。曾有 task238 归档结果也不等于本轮执行，更不自动成为 #239/#240 PASS。

<a id="partial-adjacent"></a>
## 16. 关联文件的局部复核与后续范围

- [access.js](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/background/reading-record/access.js)：真实 sender、top frame、非隐身、nativeDocumentId、collector nonce、document session/navigation authority；REGISTER 允许没有当前 query，被动 page/handoff 不要求 save intent。session/navigation 有 128 上限，这是代码事实；当前未复现“普通网页累计注册必然造成用户可见失败”，不把 P2 假设写作验收结论。
- [service.js](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/background/reading-record/service.js)：CREATE/CONSUME/REGISTER 分派、scope限制、权限/代数后校验；管理删除/禁用撤销目标 handoff；site marker disable 也撤销对应站点。整个 service 旧保存/导出路径仍按原固定说明，当前全文件标待复核。
- [repository.js](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/background/reading-record/repository.js)：readHandoffTarget 走 readonly runner，不新增 DB/store/index；其余写入/export 未本轮重做全文说明。
- [record-access.js](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/content/selection/record-access.js)：register/handoff/page 在无当前 operation 时可返回 documentGeneration 的被动证明，保存仍受 trusted owned event/token/current capture 约束。
- [shared reading constants](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/shared/reading/constants.js)、[dto](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/shared/reading/dto.js)、[response](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/shared/reading/response.js)：共享协议仍 v2，新增 handoff 和 marker 方法/受限响应不是任意 IDB 通道。生成 reading-contract 属于另一生成器，不与本章两个业务 IIFE 混淆。
- [auto-sites.js](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/src/background/auto-sites.js)：站点 marker 开关与 origin 权限属于页面再访边界；此处不替代已有启动章全文复核。
- [#238归档](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/docs/tasks/238/acceptance.json)、[#239状态](https://github.com/CoderLambert/translateflow-plugin/blob/33ab3ea2a38ce591b622ba06739344858d7da403/docs/tasks/239/state.json)：历史候选证据与当前源码分开。没有修改任务状态、业务实现或发布结论。

全仓增量中的其它代码、测试、规范与归档未在本切片完整复核，只同步清单准确 blob/待复核状态。下一步应从仍未解释的相关测试/持久再访证据接续，而不是重复本章或把所有关联文件升为完整。
