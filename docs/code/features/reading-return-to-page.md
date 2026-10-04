# Reading：从学习中心回到原文

[首页](../README.md) · [保存与学习中心](reading-records.md) · [逐文件说明](../modules/reading-return-to-page.md) · [启动](extension-startup.md) · [构建](build-test-release.md)

## 固定范围与读法

本章只读固定 main `33ab3ea2a38ce591b622ba06739344858d7da403`，不以文档分支的旧业务代码作为输入。说明当前可见的 ReturnToPage、一次性交接、定位/临时卡及 classic 投影，所有运行验证 **NOT_RUN**。源码中也已有持久再访 marker 模块，见[边界](../modules/reading-return-to-page.md#file-page-markers)；源码存在不代表 #239/#240 的集成、发布或隐私验收已完成。

用户已经在[学习中心详情](reading-records.md#learning-center)查看一条保存记录。点击“Return to original page”后，后台创建一个新标签，只允许该标签当前文档消费这条记录的最小摘要；Content 再核对页面文字，能定位时滚动并显示临时框，无法定位时保留明确状态与打开历史记录的入口。普通“Open page”链接只有开网址的效果，没有这一能力交接。

## 1. 可信点击到后台的两道边界

`Detail` 将 `record`、禁用状态、client 传给 `ReturnToPage`。React click handler 要求 `event.nativeEvent.isTrusted`；组件用 `mutation.current` 防止重复启动，`busy` 反馈等待，`epoch` 阻止切换记录后的旧响应更新新 UI。页面上出现按钮、合成 click 或仅知道 recordId 都不是能力。

`ReadingClient.createHandoff(recordId, revision)` 发送 v2 `CREATE_HANDOFF`。客户端和后台各自验证 DTO/响应，后台 `access` 仍验证真实扩展页面上下文；Content 没有创建任意交接的权限。缺 origin 权限时返回 `permission-required`，用户须再次可信点击授权按钮；`permissions.request` 在该调用的第一个 await 前发起，随后才重试创建。无安全 URL、URL 身份不一致或不支持的标签接口返回 `unsupported`。删除/修订变化映射“记录已变化”，关闭记录映射 disabled，其它错误保留重试入口。

注意 UI 的 trusted-click guard 是入口约束；后台的身份、记录所有权、代数复核才是消息层的约束，不能把前者描述成后者对真实鼠标事件的独立证明。

## 2. 记录只读事务与短期内存能力

`service.dispatch → handoffs.create → repository.readHandoffTarget`：只读事务同时检查 Recording meta、站点排除、记录 revision、page generation。目标包括精确 safeReturnUrl/pageKey/siteKey 和 consent/data/site/page 代数；摘要只含 `recordId/revision/anchor/hasCompletedAssistant`，不读 artifact 正文、不增加 lookupCount/lastViewedAt。

registry 再验证 URL 可返回且重新导出的身份完全相等，检查 `${origin}/*` 权限。容量达到 128 拒绝；token TTL 为 60 秒，保存在 worker-local Map，不进 URL、不持久化。worker 重启后失效。

创建顺序是“先写 pending entry，再 tabs.create”。原生 `tabs.onUpdated` 可能先于 create promise：registry 临时保留有界事件，真实 tabId 到达后重放，提前重定向也会撤销。目标须为非隐身标签且 url/pendingUrl 不越出精确 safeReturnUrl。创建完成后再读一次目标、权限及调用上下文，阻止期间删除/授权变化后返回可用能力。创建失败会删除 entry，但源码没有在失败分支关闭已创建的标签，不能承诺自动回滚标签页。

## 3. Content 注册与唯一消费

启动顺序见[投影](../modules/reading-return-to-page.md#classic-order)。`handoff-client` 初始化时用 `selectionSourceSnapshot.documentGeneration` 注册真实文档。collector 的 register/handoff 被动证明允许没有当前划词操作；不需要重新选中旧文字，注册也不会拉取全部历史。

后台将 tabId、nativeDocumentId、Content documentGeneration、navigationGeneration 和 page/site 身份绑定到该 pending entry。Content 可能比 tabs.create promise 更快，此时最多四次等待，每次等待 pending tabReady 或 250ms；没有真实待创建标签时不轮询。普通注册只返回文档身份，无 handoffId。

仅有注册响应的 handoffId 时才发送 `CONSUME_HANDOFF`。registry 在第一个 await 前设 `busy`，并再次核对真实 tabs.get、精确 URL/非隐身/权限、记录及所有代数；消费 finally 删除 entry，成功和消费途中失败均不可重放。同标签第二次 loading、URL 更新、文档代数改变、记录删除、禁用、权限撤销或关闭标签会使对应权限/交接失效。一次性交接失败后，用户应在学习中心重新发起；卡片“重新定位”只是本地扫描，不会重新消费后台 token。

## 4. 最小摘要到定位与临时卡

`readingReturnCard.start` 等待 `readingHandoff.ready`；只有 consumed 才保存 summary、创建卡片，再调用 resolver。其余 none/error 不会自动展示历史卡。卡片与 overlay 不写进正文、不触发 Provider，也不从旧 artifact 重新翻译。

resolver 使用现有 `textProjection` 的可见正文与 UTF-16→DOM Range 映射，重新匹配 quote.exact，并核对可用 prefix/suffix 和 blockDigest；旧 position 不是直接跳转坐标。多个容器中指向同一个 Range 会去重；两个不同可信 Range 返回 ambiguous，不选第一个。先尝试 body，必要时扫描段落/列表/标题及受限父节点；预算是 1,000,000 字符、25,000 节点、250ms 统计工作时间，扫描按 projection slice/动画帧让步。具体预算与部分结果优先级见[resolver 实现](../modules/reading-return-to-page.md#file-resolver)，这些数值不是浏览器端耗时保证。

- resolved：返回 Range，滚至中心，最多 12 个可见 rect 的临时框随滚动/resize 重算。
- ambiguous：有多个匹配，不滚动或高亮任意一个。
- missing：当前投影没有匹配，历史仍可在扩展页看。
- unsupported：无可安全处理的结构/输入。
- not-loaded：预算或持续 DOM revision 变化令本次不能完成。不是网络请求的进度百分比。

单次 resolver 因 stale revision 最多尝试三轮，间隔 150ms；卡片 resolved 后另装 MutationObserver，150ms 合并并最多自动重新定位三次。显式重试先 abort 旧扫描、清 observer/overlay/timer，再扫描；Escape/关闭、pagehide、首次 popstate/hashchange 清理 UI 和恢复仍连接的旧焦点。没有证据可把这些分支称作已通过快速重复点击/跨 await abort 的真实浏览器验收。

## 5. 必须保留的隐私警告

当前实现的 `renderCard()` 在 resolver 返回前，把持久记录的 `summary.anchor.quote.exact` 写入 blockquote；`uiHost` 使用 `attachShadow({mode:"open"})`。因此用户在学习中心可信点击并成功交接后，目标网站脚本能从共享页面 DOM 的 open shadow 读取这条历史摘录，即使当前页面没有该文字、最后状态为 missing。`textContent` 防 HTML 注入，不防网站读取；样式隔离也不是保密边界。

这是当前源码可静态确认的数据流风险，不是“每次访问向页面泄露所有历史”的结论，也不是未经运行的利用成功报告。没有在本文修复代码。修复评估应围绕把历史文本保留在扩展页、仅在页面验证后暴露必要定位结果及相应回归；不能把改成 closed Shadow 单独宣传为完整安全隔离。

## 6. 证据边界与修改入口

完整说明与测试入口在[逐文件章](../modules/reading-return-to-page.md#tests)。Node registry 用例是 mock browser/repository；resolver 是 JSDOM、固定 performance.now；E2E 源码使用 mock HTTP 页面、fixture 词典与临时 profile，程序化选区后真实点击按钮，包含 unique、节点替换、ambiguous、missing、Escape、准确 deep link 和 Provider 0 次断言。读取测试源码不等于执行。

固定 main 的 `docs/tasks/238/acceptance.json` 记录旧候选 `e02b7c0` 的 validate/build/定向 E2E PASS，并记录 #289 合入 `7c97090`。这里仅引用归档，未取得并重验所有原始日志、产物或截图；更不能把它外推为当前 main #239 持久再访或 #240 全链集成 PASS。#239 的 state 仍是候选 ready_to_sync，main 已含相应模块，这两个事实应同时保留。

改变返回按钮先看 ReturnToPage/client；改变目标验证看 handoffs/handoff-target/access；改变匹配看 resolver 和 projection；改变临时 UI 看 card/host/styles；改变源码体积或启动顺序看两个 entry 与 classic generator。不要编辑生成的 reading-source.js/reading-record.js 来修源码，也不要仅因为写文档运行生成器。Oxford classic 兼容方案与本章的 Reading classic 投影不是同一项验收，本轮 Oxford/构建/测试/浏览器/发布全部 NOT_RUN。
