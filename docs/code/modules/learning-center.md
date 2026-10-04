# 学习中心：从页面到仓库的逐文件说明

> 再访续篇：[页面标记与本页历史](../features/reading-page-markers.md)接本站marker开关→最小摘要→准确学习中心deep link；#240已归档[候选ABC 9/9](reading-page-markers.md#evidence)。此结果不替代marker缺失计数/续页、AI-only和键盘等逐项合同，也不是本轮运行。

> 2026-10-04 返回原文增量：main `33ab3ea2a38ce591b622ba06739344858d7da403` 的 Detail、client/reading 与新 ReturnToPage 已在[返回原文逐文件章](reading-return-to-page.md)全文复核，新增可信返回、站点marker UI与消息；本页相应旧版本说明作为历史来源保留，其余组件不冒充本轮复核。完整用户链见[返回原文](../features/reading-return-to-page.md)。

[Reading 完整产品链](../features/reading-records.md#learning-center) · [后台与保存模块](reading-records.md) · [首页](../README.md)

本章原16文件正文固定 main `b606cfd556792d9764d0b15461b7a142fcd99575`；#286后仅 App/useLibrary 全文复读至 `345d630c0f0e0040f39fd74b8ed0457e3d193fd4`，其余未变blob保留原来源。React 仅用于学习中心；本章完整解释 16 个新增文件。本章对旧入口和构建依赖仅解释相关增量；后续构建切片已在[构建逐文件章](build-test-release.md)全文复核配置/audit/runtime-assets及相应测试，入口等剩余项以coverage为准。安装、构建、测试、浏览器及下载均 **NOT_RUN**；归档 PASS 是已有任务证据，不是本轮执行。

阅读顺序：HTML/main → App → reading/useLibrary → Library/Detail/Management → export → common/locale/styles → 测试与规范。后台沿 [access/service](reading-records.md#file-access) → [repository/query](reading-records.md#file-repository) → [management](reading-records.md#file-management) / [exports](reading-records.md#file-exports) 返回。

<a id="file-html"></a>
## entrypoints/learning-center/index.html：WXT 独立扩展页

[完整源码 L1–L3](https://github.com/CoderLambert/translateflow-plugin/blob/b606cfd556792d9764d0b15461b7a142fcd99575/entrypoints/learning-center/index.html#L1-L3)；blob `8fda6748992e87cb1b54a9112b8bbd3c35808e3a`。

普通 unlisted HTML 入口，只有 UTF-8、viewport、初始语言/标题、root 容器、设计 token 与本页 CSS，以及 module main.tsx。WXT 将目录入口输出为固定 learning-center.html；没有注入网页、远程 script、额外 host 权限或 CSP 例外。语言/标题随后由 useLocale 设置。

输入是扩展导航，输出是 React 宿主。没有数据库、业务状态或后台授权；缺资源按浏览器加载失败处理。修改 root/id、入口地址或 stylesheet 需联动 main、runtime-assets、WXT audit 和真实 Popup 打开测试，不应通过暴露源码目录修复。

<a id="file-main"></a>
## entrypoints/learning-center/main.tsx：单一 React 根

[完整源码 L1–L7](https://github.com/CoderLambert/translateflow-plugin/blob/b606cfd556792d9764d0b15461b7a142fcd99575/entrypoints/learning-center/main.tsx#L1-L7)；blob `5b2a5a06e2e076af05336e85e6ef7c56f1cd10d9`。

导入 React StrictMode、react-dom/client 的 createRoot 与 App，查找 root；缺失直接抛错，存在则渲染 StrictMode 下的 App。此处不读设置、不启用记录、不发送导出，也没有第二个 store/router。页面退出由浏览器释放根，App/hook 的 effect cleanup 负责订阅与异步结果失效。

StrictMode 可重复装卸 effect，所以不能把 mount 当用户同意。组件测试明确断言 mount/synthetic click 不发送 SET_RECORDING/EXPORT_START。改装配需维持该边界，React 不能被挪进 Content/MAIN/Worker/background。

<a id="file-app"></a>
## src/learning-center/App.tsx：产品动作与生命周期的组合点

[完整源码 L1–L159](https://github.com/CoderLambert/translateflow-plugin/blob/345d630c0f0e0040f39fd74b8ed0457e3d193fd4/src/learning-center/App.tsx#L1-L159)；blob `8bfbff95b82e7ae63ba44f8122b5b71b4b667359`。

App 可注入 ReadingClient/listen 便于测试，生产默认使用消息 client/Port。state 是后端 recording state 快照；revision 是本页刷新触发器，connection 触发重新订阅；mode/input/query/page 控制列表，id/detail 控制详情，notice/confirm/busy/exporting 控制反馈。readEpoch/detailEpoch 防旧响应回写，active 防卸载后更新；mutation ref 阻止重复管理动作，exportingRef 持有唯一 AbortController。

route 仅接受空 hash 或 #record=合法 UUID；其它返回 invalid，再经客户端合同拒绝，显示不可用/返回入口。hashchange 撤旧详情；navigate 用 pushState 设置 ID fragment，不放正文、URL、token。navigate(null)登记returnFocus意图；要等无详情ID、library.settled、后台在线、有state且detailLoading=false才尝试恢复。按原按钮保存的data-record-id在新DOM中重找按钮，否则用最近记录按钮；目标存在且未disabled才focus并清意图。断线/列表未完成时保留意图，effect依赖settled/records/offline/state/detailLoading会再尝试；不是只等setTimeout，也不是直接聚焦已移除的旧DOM。详情标题自身获焦点。没有自建全文数据仓库。

mount 建只读失效订阅：有效 revision 通知 refresh，断线使读代次失效、清 detail/state、abort 导出并断旧 Port；最多三次 250/500/750ms 重连，之后保留手动 Retry。cleanup 取消 timer、监听和导出。state/detail effect 分别发请求；每次响应必须仍 active 且代次相符。localeReady、state、在线、非导出共同控制读取，详情页不并行拉列表。网络离线与后台 Port 断线不同，前者仍可读本机库。

初次未开通显示 Enable/Not now；Not now 仅改本页状态，不持久授权。开关必须 event.isTrusted，并带 expectedConsentGeneration；成功 action 才 refresh。暂停保留历史，恢复不补写旧查询。搜索 input 与提交 query 分离，trim 且限 200 字符，IME composing Enter 不提交；切 Recent/Pages 清 query/page，选页转 recent + pageKey。列表 loading/error/empty/stale 由 hook 与视图组合。

删除先确认：单条传当前 detail.record.revision，整页传 pageKey，全清传 state.dataGeneration。成功单条/全清返回列表；失败按 revision/stale、quota/capacity 或一般错误提示并重读。action 没有假回滚。导出期间禁用主要管理/读操作，进度只存 bytes；startExport 等 exportRecords 成功后才 download，取消显示取消，其它失败提示内容变化/中断，finally 清 ref 并刷新。已成功 FINISH 与取消竞争时仍可能完成下载，不承诺撤销。

修改入口/状态转换必须连查 useLibrary、client validators、后台代次与 Port；列表与删除迟到响应由组件测试覆盖，真实权限/焦点/下载看 E2E。当前缺失/非法 detail 的通用文案不精分每种错误，不能将 UI 重试当后台任务续传。

<a id="file-client"></a>
## src/learning-center/client/reading.ts：共享合同的 typed 消息适配

[完整源码 L1–L61](https://github.com/CoderLambert/translateflow-plugin/blob/b606cfd556792d9764d0b15461b7a142fcd99575/src/learning-center/client/reading.ts#L1-L61)；blob `8837633f812b0eb8626e7370cdbcc0aeaeac5b71`。

RecordItem/PageItem/Exclusion/Detail 类型派生共享 validator 返回值；RecordingState、分页与导出 DTO 描述已校验结构。ReadingClient.request 将 protocolVersion=2/method/fields 先交 validateReadingRequest，再 await chrome.runtime.sendMessage，传输失败映射 READING_DISCONNECTED；响应按 extension scope 校验，失败抛仅带稳定 code 的 ReadingError，成功返回 data。TypeScript 泛型不替代运行时 validator。

state/recording、records/pages/getRecord、exclusions/site/setSite 是薄方法，列表固定 limit=30，分页 token 原样转发，站点修改带 expectedSitePolicyRevision。没有 IDB adapter、词典或 Provider，也不复制 DTO 语法。输入 query/pageKey/cursor 来自 hook，输出给 App/视图。

subscribe 连接 reading.invalidate，validateReadingInvalidation(extension) 后 JSON 编码去重，相同 revision 不触发刷新，避免 GET_RECORD lastViewedAt 的通知循环。非法消息/断线交 onDisconnect；返回 cleanup 标 closed、摘两个 listener 并断 Port。它不缓存记录正文、不保证消息日志完整，重连必须重读。修改消息时同步共享 request/response/invalidation 与 access scope 测试。

<a id="file-library-hook"></a>
## src/learning-center/useLibrary.ts：分页与搜索竞态

[完整源码 L1–L32](https://github.com/CoderLambert/translateflow-plugin/blob/345d630c0f0e0040f39fd74b8ed0457e3d193fd4/src/learning-center/useLibrary.ts#L1-L32)；blob `e83593a3b26b82ee98c45eb6731b4389d377bf48`。

输入 client/mode/query/pageKey/revision/enabled，持有 records/pages/cursor/loading/error/stale/settled；epoch 标识当前加载，pending 防重复 next。load 根据 mode 调 pages 或 records，首屏替换、continuation 才追加；只接当前 epoch 响应。load开始置settled=false；只有当前epoch的finally才置true。依赖变化先清数组/cursor/error/stale/settled并使旧响应失效，enabled 才发首屏；effect cleanup 再增 epoch。settled表示本次加载已结束（可含错误），不等于成功或有行；供App在空列表/失败时选择最近记录焦点退路。

continuation 收到 READING_STALE_OPERATION 时标 stale 并重新首屏 load，不能把旧下一页拼接新列表；其它失败保留可重试 UI。next 要非 pending 且 cursor 存在；retry 重新第一页。输出没有完整 artifact，也从不逐行 getRecord。每页 30 限制响应量，不意味着后台搜索恒定时间或列表无限虚拟化。改分页合并需同时验证 cursor revision、快速搜索、删除通知与 late response；组件测试覆盖旧搜索被丢弃。

<a id="file-locale"></a>
## src/learning-center/useLocale.ts：界面语言与配置读取

[完整源码 L1–L21](https://github.com/CoderLambert/translateflow-plugin/blob/b606cfd556792d9764d0b15461b7a142fcd99575/src/learning-center/useLocale.ts#L1-L21)；blob `c0eccb794605b8b1a8d117dfa394f59801ff876a`。

初始 createI18n 提供默认文案，ready=false 阻止需就绪的产品动作。effect 读 chrome.storage.local.uiLocale，并订阅 local onChanged；generation 防旧 get 覆盖较新设置事件，active 防卸载回写。读失败置 error，retry 增 attempt 重新建立读取/监听；cleanup 摘监听。另一个 effect 更新 html.lang 与文档标题。

这里只读 UI locale，是“UI 不碰 Reading 存储”之外允许的设置读取；不会改翻译目标语言、Prompt、artifact 内容。格式化数字/时间和 key fallback 交共享 i18n，不复制翻译表。当前 retry 不独立清旧 i18n，仍显示可用默认/上次文字。改 locale 行为检查 Options 实时变更和中英文 E2E；不能把 jsdom 设置模拟当浏览器系统语言实测。

<a id="file-library"></a>
## src/learning-center/views/Library.tsx：轻量记录卡与页面分组

[完整源码 L1–L24](https://github.com/CoderLambert/translateflow-plugin/blob/b606cfd556792d9764d0b15461b7a142fcd99575/src/learning-center/views/Library.tsx#L1-L24)；blob `a960289cd838345c3d66ce505b3319b8fdfdf0c7`。

无内部状态的展示组件，接收 hook 的 records/pages/loading/error/query/more 与动作回调。section aria-busy，loading 用 status，错误用 alert + Retry；非 loading/error 且当前数组空时区分无匹配/无历史。页面卡显示标题或 site、记录数；记录卡显示选文、结果/context 预览、页名/站点、最近查询时间及完成问答数量。

点击回传 recordId 或 PageItem；data-record-id 用于返回焦点定位；Load more 在禁用/加载时不可点。所有保存文本用 React 文本节点，不拼 HTML、加载 favicon 或自动打开 source。没有详情请求/过滤副本，过滤由后台负责。改卡片需同步列表 DTO/preview 限制和可访问名、搜索/分页 E2E，不能仅为展示把全库详情搬进浏览器。

<a id="file-detail"></a>
## src/learning-center/views/Detail.tsx：离线快照和按批渲染

[完整源码 L1–L35](https://github.com/CoderLambert/translateflow-plugin/blob/b606cfd556792d9764d0b15461b7a142fcd99575/src/learning-center/views/Detail.tsx#L1-L35)；blob `9282c3586c2fd2d86ccf80de56f1573a71ff179d`。

输入校验后的 record/snapshots/artifacts 和导航/删除回调。recordId 变化重置 shown=5 并聚焦标题；Escape 返回。显示选文、历史快照说明、页标题、firstSeenAt；仅 safeReturnUrl 存在才显示新标签链接，noopener noreferrer，明确不保证精确回原选区。

artifact 先渲染五个，再每次加五：assistant 显示已保存问题/答案，dictionary 显示词头/音标/词性/定义或 no-hit，其余 text 原样文本。按 sourceSnapshotId 找关联上下文，折叠 source 与 provenance diagnostics；这里的 JSON.stringify 仅单 artifact provenance，不是全库导出。React escaping 保证恶意 img 文本不成为资源请求。

五个是 DOM 正文渲染限制，不是后台 GET_RECORD 分五次；详情响应可包含全部有界 artifacts。删除只触发父确认，不自行写库。无 Provider/词典查询或流式答案恢复。修改来源关联/显示模式要查共享 record/artifact 合同和 12-artifact 组件测试；大记录 E2E 另以 canonical-row seed 验证五个 DOM。

<a id="file-management"></a>
## src/learning-center/views/Management.tsx：独立站点排除管理

[完整源码 L1–L46](https://github.com/CoderLambert/translateflow-plugin/blob/b606cfd556792d9764d0b15461b7a142fcd99575/src/learning-center/views/Management.tsx#L1-L46)；blob `889bc941d26c445834aa2c42c4a5cc15f16e9f9a`。

持有 exclusions/items/cursor、输入 site、busy/error/message 和 epoch。effect 随 client/revision 读首屏，cleanup 增 epoch，load(more) 仅当前 epoch 可更新。独立列表来自 meta 的排除项，不依赖历史记录，清历史后仍可管理。

patch 先拒 busy/disabled，以唯一 validateSiteKey 验 trim 后 origin，非法显示专门提示；先 GET_SITE_RECORDING 取得最新 revision，再 SET_SITE_RECORDING(origin,excluded,expectedRevision)，成功提示并 load。表单输入、新选中页的 selectedSite 快捷排除、逐项恢复共用此路径；后台仍执行 CAS，不能把前一步读当锁。失败给 actionError，用户可重试；没有乐观删除或复制 chrome.storage 站点偏好。

UI 用 details 展开，url input required，更多按钮受 busy 禁用；请求异步和单组件 epoch 不是后台授权。修改站点范围必须保持 origin-only 与后台 site-policy 一致，验证排除不删已有历史、恢复不补旧记录、清库后配置保留。真实 E2E覆盖添加/恢复，全面并发原子性仍由后台合同负责。

<a id="file-export"></a>
## src/learning-center/client/export.ts：单块背压与 FINISH 交付点

[完整源码 L1–L51](https://github.com/CoderLambert/translateflow-plugin/blob/b606cfd556792d9764d0b15461b7a142fcd99575/src/learning-center/client/export.ts#L1-L51)；blob `f955540160896e54836df0ee52d6c757414c59c6`。

exportRecords 接 client/AbortSignal/progress，临时 session/parts/bytes/sequence/lastChunk 全在函数闭包，不进 React state。先 EXPORT_START，逐次 await EXPORT_NEXT；每块检查 signal、同 exportRevision、连续 sequence。完全相同的重复 sequence/jsonChunk 最多接受两次且不 append；乱序/缺块/改块拒绝。raw 字符串先转 Blob，用 UTF-8 size 累加，最大共享 totalBytes+1MiB，超限丢弃。游标来自后端，不自行生成或 JSON.parse 全文。

到 nextCursor=null 后发 EXPORT_FINISH，核 exportId/sequence/revision；成功 ACK 是 commit point，置 finished 再生成 application/json Blob。此后取消不能伪造回滚。signal abort 触发 best-effort EXPORT_CANCEL；finally 清 parts/摘 listener，未 finished 还 await 一次 CANCEL 并吞传输失败。两次 cancel 是幂等清理意图，不保证断线后后台立刻回收，也不把本地丢弃碎片当服务器取消 ACK。

download 创建 Object URL 与临时 a，文件名带 UTC 日期，click 后 remove 并下个 timer revoke URL。只代表已发起下载，无法证明浏览器对话框/磁盘保存。生产不 stringify 全库、不一次大消息，但仍保留整个导出文件的有界 Blob parts，并非恒定内存的直接落盘流。修改需联动 exports/export-reader 的 TTL、sequence、revision、finish/cancel 仲裁与单元/E2E异常证据。

<a id="file-common"></a>
## src/learning-center/components/common.tsx：通用按钮、反馈和确认弹窗

[完整源码 L1–L20](https://github.com/CoderLambert/translateflow-plugin/blob/b606cfd556792d9764d0b15461b7a142fcd99575/src/learning-center/components/common.tsx#L1-L20)；blob `96cb0338ba082af68453869da45c54a64ae9faf8`。

Button 默认 type=button 并透传原生 props（显式 props 可覆盖）；避免普通动作误提交搜索表单。Notice 依 error 选 alert/status 和样式；不注入 HTML。Confirmation mount 保存原焦点并 showModal，cleanup close 后只对仍 connected 的 HTMLElement 恢复焦点；onCancel 阻止浏览器默认关闭并交父清 confirm，取消按钮 autoFocus，确认按钮交父删除。

组件不知 recordId、不写库，不承担撤销已经提交的删除；父层决定何时出现/卸载。输入 i18n 提供确认、取消、删除范围文案，dialog aria-labelledby 指标题。修改 focus/Escape 时需真实浏览器验证（现 E2E有 Escape 与焦点返回），jsdom 不能替代原生 dialog 行为。

<a id="file-styles"></a>
## src/learning-center/styles.css：页面范围内的阅读布局

[完整源码 L1–L29](https://github.com/CoderLambert/translateflow-plugin/blob/b606cfd556792d9764d0b15461b7a142fcd99575/src/learning-center/styles.css#L1-L29)；blob `fe2d870ca51a64ad01ffa99b33ae5d477f6b5952`。

仅由学习中心 HTML 引入，依赖既有 --tf-* token。设置 border-box、body 背景字体、920px 主容器、clamp 边距与标题，header/actions flex-wrap；记录列表 grid，按钮卡片、输入、consent/artifact/management/footer 面板和状态/危险文案统一样式。

focus-visible 有 3px outline，disabled 用 cursor/opacity，aria-pressed 与 primary 呈选中态；长文、pre、blockquote 可换行并保留必要空白，避免保存内容撑宽页面。dialog 限宽并设 backdrop；480px 以下表单动作改 grid/按钮扩展，reduced-motion 禁 transition/animation/平滑滚动。暗色取 token，不另存主题状态。

无网络资源、业务状态或取消逻辑。选择器是本扩展文档的全局 CSS，不能直接注入 Content 页面，否则会污染站点。修改布局需验证长文本、窄屏、焦点、暗色与 reduced motion；已有 360px E2E检查横向溢出，不能等同所有屏幕/辅助技术验收。

<a id="test-components"></a>
## tests/unit/learning-center/components.test.tsx：隔离 UI 的四条断言

[完整源码 L1–L82](https://github.com/CoderLambert/translateflow-plugin/blob/b606cfd556792d9764d0b15461b7a142fcd99575/tests/unit/learning-center/components.test.tsx#L1-L82)；blob `538df68243e1115ecc55a87bc067239ea8f3abc4`。

jsdom + Testing Library/Vitest，beforeEach 重置 hash 和 chrome locale stub，afterEach cleanup/unstub。App 接合成 ReadingClient/listen，避免真实库与网络。四条测试依次：StrictMode 重装 cleanup 且 mount/Not now/合成 Enable 不授权或导出；延迟 old 搜索被 new 搜索代次丢弃且只有 LIST_RECORDS；12 条恶意 HTML 文本 artifact 初始五个、更多十个且无 img；删除 invalidation 让迟到 detail 无法复活，disconnect 清未确认内容。

controlled promise 明确排列竞态，断言实际 DOM 与 method，不是固定 sleep。它没有正向验证真实 isTrusted 授权、native context、IDB或下载；须读真实 E2E。修改 hooks/route/cleanup 时维持这些边界，不让 synthetic events 绕过生产授权；本轮仅阅读未运行。

<a id="test-export"></a>
## tests/unit/learning-center/export.test.ts：合成协议的交付与取消次序

[完整源码 L1–L62](https://github.com/CoderLambert/translateflow-plugin/blob/b606cfd556792d9764d0b15461b7a142fcd99575/tests/unit/learning-center/export.test.ts#L1-L62)；blob `9c1471d5758ec03ab413ad1b12a0e39b66149ddb`。

构造 ReadingClient send double。首例把含中文/emoji/转义的 >1MiB JSON 按 40000 UTF-16 单位切片并避免拆代理对；模拟一次完全重复块，断言一个在途 NEXT、无重复 append、进度次数等于新块数、finish 先于 Blob、无多余 CANCEL。

参数化 missing/changed/bad-version/finish-failed/cancel 分别制造序列缺口、revision变动、协议版本错误、后台失联和 signal abort，要求 reject、发送 CANCEL且无交付 Blob。最后模拟 finish 时取消，但后台返回 finished 收据，要求结果保留，不能报告回滚。

测试用 JSON.stringify/Blob.text 比较 fixture，与生产导出不整包 stringify 的约束不冲突。覆盖协议适配和本地 Blob，不能证明浏览器实际文件保存、近容量 UI 内存或真实 service worker 重启。本轮 NOT_RUN。

<a id="test-e2e"></a>
## e2e/learning-center.spec.mjs：原生 Popup 与两条 React 产品故事

[完整源码 L1–L254](https://github.com/CoderLambert/translateflow-plugin/blob/c250ce91aff7eb84d1ad8acbe1d4155ad244dc24/e2e/learning-center.spec.mjs#L1-L254)；blob `68c31a1c93f814e3f6ce3e210a862114ffa4816f`。

依赖既有 extension-fixture 预构建 WXT 副本，select helper合成选区且产品故事显式harness.inject，并以 Playwright 真实点击 chip/按钮；message helper只发送 v2请求，trace 只记录 method。原产品故事从普通TAB形式的popup.html driver 打开实际页面、Not now 不授权、Selection 邀请新开实际学习中心，再可信 Enable、回旧卡显式保存、另一 context 同词查询保存两条。检查真实页面列表/详情、移除 Provider 设置后 offline reload 仍可读，字面搜索、页面分组、站点排除/恢复、暂停/恢复与列表不 GET_RECORD。

导出等待原生 download 并读流核 JSON/两种 context，历史路径 Provider 与词典/外部资源请求为零；再单删、页删取消/确认、已删 deep-link 的返回路径、实时中文→英文、360px 暗色/reduced motion无横向溢出。截图/JSON为测试产物；截图存在/旧报告 PASS 不能替代本轮执行。offline center.reload 是页面重载，并未关闭/重建 profile。

第二故事明确为 supplementary canonical-row seed：仅测试副本复制 fixture sourceClosure，已有文件字节必须相同；31条检查30→31分页且不逐行详情；单条64 artifacts/24000字符答案检查先五个 DOM。hold 已返回的首块来排列取消与跨标签暂停：取消不给文件，内容改变提示重试；新导出实际下载 >1MiB 并验64 artifact和 Unicode；全清先 Escape/焦点返回，再确认。大记录由种子生成，不冒充真实 Selection 生成64条答案。

两个 test 各120秒限时；不安装、不隐式构建。真实 React 部分只有这两条，不把三个 spec 合计16 PASS叫16条真实学习中心。测试不覆盖实际桌面 IME、Chrome102、全浏览器、真实付费 Provider/私有词典或文件对话框落盘；此前近64MiB与profile restart来自旧storage层；#286现另有真实产品完整profile重启和实际UI近容量导出，见[Release A六故事](reading-release-a.md#file-release-spec)。本轮 NOT_RUN。

本轮全文复读当前254行（三个故事），新首例是真实POPUP身份/开页/关闭验证，直接CDP发消息且未读取ACK，完整输入与限制见[入口证据](real-entry.md#native-popup-evidence)。原两个故事仍按上述具体断言解释，不混作新入口证明。

<a id="file-spec"></a>
## docs/LEARNING_CENTER_V1.md：面向维护者的产品合同

[完整源码 L1–L28](https://github.com/CoderLambert/translateflow-plugin/blob/b606cfd556792d9764d0b15461b7a142fcd99575/docs/LEARNING_CENTER_V1.md#L1-L28)；blob `c82297d9ee55a3f33f252a574edde845ffdaa75c`。

规范将 task235 映射到固定 unlisted page，限定 React/TS 只在此页，重申无新增权限/CSP/外部资源。依次描述 first consent与旧卡显式保存、30条分页/字面搜索、历史 detail/来源诊断、ID-only deep-link、pause/site exclusions和三个删除范围。

导出节给 START→NEXT→EOF→FINISH、背压/有界片段/取消与下载边界；验证节区分组件测试、真实创建故事与 canonical-row seed、产物 React closure审计和 task236发布认定。它是读者导航和设计约束，没有可执行状态/运行结果；当规范与源码冲突以固定实现定位并记录差异，不把意图当验收。修改产品入口/消息/错误反馈/打包边界时应同步此规范和本章，但此任务仅修改 docs/code，不改该文件。

<a id="integration-deltas"></a>
## 相邻入口与打包增量：仅局部解释

- Popup 的 popup.html 新增 learningCenter 按钮；popup.js 读 uiLocale 翻译标题，点击发送 OPEN_LEARNING_CENTER，错误显示“无法打开学习中心，请重试”。它仍是 entry scope，不能直接 LIST/导出/管理。Selection 的既有 record-client invitation 走同一个固定打开消息，开启后回旧卡仍要明确保存，见 [保存链](../features/reading-records.md#flow)。Popup 其余控制与全部代码未在本章重写，保留待复核。
- src/shared/runtime-assets.js 在 EXTENSION_PAGES 增 learningCenter 固定名，原 worker/MAIN/locale/lexicon 路径不变；src/i18n/catalog.js 增中英文快照、站点排除、确认/删除、导出进度/隐私/交付限定文案。本章只解释此次增量；runtime-assets 已在[完整路径合同](build-test-release.md#file-runtime-assets)全文说明，catalog 仍局部。
- wxt.config.mjs 开 @wxt-dev/module-react；审计 hook 从最终 writeBundle 收集 fileName/imports/dynamicImports/modules，目录 HTML 名显式映射 learning-center.html，build:before 清报告数组，build:done 写 compiled closures。原精确 raw bridge 与 staged output 保留，详见 [构建链](../features/build-test-release.md)。
- scripts/audit-wxt-extension.mjs 仍 exact Manifest/资产集合/原桥接 bytes 检查。新增从 HTML script/link 建学习页面闭包与 background/Popup/Options 闭包，沿静态+动态 import 检查 React 仅学习可达且旧运行时不可达；独占 learning bytes 从 platformCodeBytes扣除，共享 chunk仍计平台，原 1,576,595B门槛不提高。报告的另一个 compiledClosure只走静态 imports，不混淆两种统计。不是在后台“允许 React”；不能用审计报告存在证明实际打包通过。
- tests/wxt-assets.test.mjs 对固定学习页面映射加断言；tests/wxt-runtime-mapping.test.mjs 先确认旧映射可用、当前映射缺 learning-center会拒绝，再补当前资源，保持旧 frozen mapping不可回写。tests/reading-access.test.mjs 新增合法ID deep-link、sender旧hash/current native context、非法hash/query/private拒绝，以及 Content 注册前/后固定打开均可ACK但不能全库读、导航后失效。三个大测试的其它分支保留原文/待复核，新增断言不自动升级全文件覆盖。

<a id="evidence"></a>
## 如何读取已有验收而不扩大结论

#235 acceptance/review 绑定候选 e340b16c71d8a0c7d1f4a9795b4b1349963a3be4，归档记录 validate、显式 WXT包及三个spec合计16 PASS（两个学习中心故事 + Selection/权限）；review记录导出3,622,698B。当前main的#285合入身份另行确认，不能把归档中的 ready_to_sync/“未合并”当今天main尚未交付，也不能将其改写成本轮已运行。原始日志/图片为本地证据引用，本轮未下载或复跑，报告数字只按归档说明。

旧 e2e/selection-reading-record.spec.mjs 的首次同意回调是 synthetic LC，与实际 React 页不同；旧storage spec也保留synthetic LC/collector与直接源码探针。本轮已全文读其345d630版本，Popup固定OPEN现期待opened:true，旧NOT_READY断言已修正，不再是当前待验证矛盾。详见[storage双轨输入和断言](reading-release-a.md#file-storage-spec)。

#286新增不seed真实创建→完整browser/profile重启→断网且无词典/Provider配置的历史故事、实际UI近64MiB seeded导出、worker/页面中断、原生extension-origin quota拒写和0 Provider显式重试，以及Escape/焦点修复。已有证据应按[候选与复用链](reading-release-a.md#evidence-chain)解读：149 PASS为148旧PASS加唯一失败的修复项，不是新跑155项；原日志/产物本轮未独立取得。归档ready_to_sync/未合入描述属于候选阶段，不能覆盖已核实#286合入main的事实；不据此擅自补状态或发布。

[历史#235验收](https://github.com/CoderLambert/translateflow-plugin/blob/b606cfd556792d9764d0b15461b7a142fcd99575/docs/tasks/235/acceptance.json) · [当前Release A逐文件证据](reading-release-a.md)

