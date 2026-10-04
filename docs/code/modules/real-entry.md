# 真实网页与工具栏入口：源码和证据的边界

> 当前a4dab127已经改为WXT单Content bundle；[当前upgrade helper](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/e2e/support/upgrade-expectations.mjs#L14-L25)对native update返回空注册数组。下方“尚未覆盖”第1项是c250时期已消除的源码冲突，不能继续当作当前缺陷。完整新构建/升级章仍待复核；同版本替换/Reload/重启不等于真实版本号更新或用户权限确认UI证据。

[启动完整链](../features/extension-startup.md) · [Reading 用户链](../features/reading-records.md) · [构建链](../features/build-test-release.md) · [覆盖清单](../coverage.json)

固定 main `c250ce91aff7eb84d1ad8acbe1d4155ad244dc24`，tree `0f733f269639f2dc1368eecfa2bf96379d59f94c`；#287 已合入。这里解释当前实现，不替权限扩大背书，也不将 PR 描述的 PASS 当成本轮验证。所有安装、构建、业务测试、浏览器、商店升级与 Oxford 实测均 **NOT_RUN**。

<a id="file-projection"></a>
## scripts/production-manifest.mjs：唯一静态 Content 投影

[完整源码 L1–L20](https://github.com/CoderLambert/translateflow-plugin/blob/c250ce91aff7eb84d1ad8acbe1d4155ad244dc24/scripts/production-manifest.mjs#L1-L20)；blob `0c0e1203402fd5aaa913990c039f8d9d33032b1f`。

输入源 Manifest，输出浅展开 baseline 并覆盖 content_scripts 的新对象。GLOBAL_CONTENT_SCRIPT 冻结普通 HTTP/HTTPS matches，引用 shared constants 的有序 JS/CSS，run_at 固定 document_idle；projectProductionManifest 为三列表逐项复制，避免返回列表直接成为常量数组。无 browser API、IO、持久状态、异步、取消或降级；不自行判断权限是否获准，也不打开任何页面。

wxt.config 在读根 Manifest 后调用它，audit 的 assertProductionManifest 以同一投影作严格 deepEqual，而非要求产物字节/字段等同未投影根 JSON。根 Manifest 本身没有 content_scripts，不代表最终安装包没有。没有 all_frames/world 设置，不能讲成全 frame 或 MAIN-world 注入。改中央列表、matches 或时机同时影响静态启动、手动 fallback、raw bridge、审计与升级期望；对应 wxt-assets 单测及 Selection/permission spec 仍须对准确产物运行。

<a id="file-popup-html"></a>
## popup.html：学习中心进入正文导航

[完整源码 L1–L109](https://github.com/CoderLambert/translateflow-plugin/blob/c250ce91aff7eb84d1ad8acbe1d4155ad244dc24/popup.html#L1-L109)；blob `5e0f18f1aa1761ec1b74b11c814f535e0cc33c09`。

唯一原生 HTML 模板由 WXT 编译，依赖 tokens/components/popup CSS，底部启动 popup.js 与 popup-appearance.js 两个 module。header 只保留品牌、就绪标识与设置按钮；learning-center-nav 在 effectiveContext 卡之后、主翻译操作之前，learningCenter 按钮不再挤入 header-actions。按钮自身不授权、不读库，事件逻辑由 popup.js 绑定。

effectiveContext 起初 hidden，供 preset UI 显示站点/模式/Provider/model。主区域含翻译、初始隐藏的取消按钮及 role=status/aria-live=polite；页面偏好含初始禁用的自动模式 switch/aria-checked 与外观 select。两个 details 折叠容器分别放 preset 临时/本站保存、显隐/移除，以及 Quick Control、缓存恢复和清缓存。重复出现的说明和按钮用不同 ID，供 JS 更新 disabled/状态。HTML 无请求、存储或清理生命周期；关闭实际 Popup 销毁这个文档，后台已提交开页不能据此判失败。

学习中心标题由 JS 根据 uiLocale 异步替换；失败仍保留初始中文。按钮语义/ID、焦点顺序或正文位置变化应联动 popup.js、popup.css 以及 release-gate layout 与真实 POPUP 用例。CSS 和 Popup 其余业务未全文解释，仍为局部；源码布局不冒充桌面截图或原生按钮点击验收。

<a id="test-selection"></a>
## e2e/selection-auto-sites.spec.mjs：新页面不调用 inject 的 chip 证明

[完整源码 L1–L29](https://github.com/CoderLambert/translateflow-plugin/blob/c250ce91aff7eb84d1ad8acbe1d4155ad244dc24/e2e/selection-auto-sites.spec.mjs#L1-L29)；blob `731578c8d62df5d3d258496139cb8c857b43ef7e`。

从共享 fixture 取得预构建测试副本，先读 runtime Manifest 检查 required HTTP/HTTPS 和唯一静态 document_idle 项。harness.open('/selection') 创建新 page 并 goto mock server，随后轮询 ABT_STATUS 可响应；合成 Range 选中 technical-competition 全文并派发 mouseup，断言 chip 可见、动态 registrations 为空。没有 harness.inject，也没有点击 chip/词典/Provider/Reading 存储断言。状态查询的 tabId 解析可能执行只读 token 探针，不能把“无生产注入助手”夸成“无任何 scripting API”。资源由共享 fixture 关闭。

准确输入：[extension-fixture L61–L62、L103–L151](https://github.com/CoderLambert/translateflow-plugin/blob/c250ce91aff7eb84d1ad8acbe1d4155ad244dc24/e2e/support/extension-fixture.mjs#L61-L151) 仍先把 popup.html 打开为普通 TAB driver；mock-server 使用 node:http 与 127.0.0.1。因此此故事证明无用户工具栏 Popup 手势、无生产 bundle 手动注入的新 HTTP fixture 页面启动，不是独立 HTTPS/真实网站或“扩展从未打开任何页面”的证明。修改启动时机、chip选择策略、Manifest或fixture须一起核对。

<a id="test-sites"></a>
## tests/site-registration.test.mjs：偏好和旧注册清理

[完整源码 L1–L145](https://github.com/CoderLambert/translateflow-plugin/blob/c250ce91aff7eb84d1ad8acbe1d4155ad244dc24/tests/site-registration.test.mjs#L1-L145)；blob `a2b074d710d9ddf1e0378ed80a8ef92a1462182f`。

createChromeMock 拥有四个 storage 数组、registered Map 和可切的 contains 布尔值，get/set用结构化复制；动态 import 加随机 query 隔离模块，global chrome 指向当前 mock。两个拒绝故事检查恢复/Quick Control 无权限时不写偏好、零注册；共享模式故事逐步启用三模式再关闭，验证对应规范化 origin 偏好与始终零注册；hide/show 检查 hidden/persistent 转换且 auto 不受影响。末例手工种 tf_site_selection_all_sites、tf_auto_legacy 与 unrelated_registration，全量同步只留 unrelated，auto 偏好仍在。

断言的是 mock 调用/状态，不是 Chrome 静态脚本或商店升级。旧测试名称仍提 registration，实际期望已经是零；不能沿用“三模式一个动态注册”的正文。测试无真实浏览器或长期资源，未测 API 抛错/并发写覆盖/所有 legacy 前缀。修改 auto-sites 的清理范围、normalize、permission 顺序或 storage 键需同步这些断言及原生权限/升级消费者。

<a id="test-access"></a>
## tests/reading-access.test.mjs：原生身份边界的 Node 双轨

[完整源码 L1–L195](https://github.com/CoderLambert/translateflow-plugin/blob/c250ce91aff7eb84d1ad8acbe1d4155ad244dc24/tests/reading-access.test.mjs#L1-L195)；blob `3cb8225353481910ed937dce3ea1eeb0684fbb77`。

setup 使用 nativeBrowser/collector/repositoryDouble 和固定 now，先注册 Content，再取真实 policy 的页面 digest；request/response/snapshot 来自纯合成合同 fixture。测试验证扩展 getContexts 唯一性、document/context/type/非隐身/tab/frame 身份，缺 getContexts 的 CAPABILITY_LIMITED；无 repository/collector 不伪造成功。页面 query/hash 区分、顺序归一与不安全 safeReturnUrl=null；跨页 detail、caller safety、私密/未知 sender、任意固定开页 URL 均拒绝。导航/重启、缺 intent、snapshot 不符、大小写不同的128bit documentId、legacy frame0会话也不能越权。

collector 专项检查 ISOLATED target/document、JSON 字符串保留 null、malformed challenge 映射 FORBIDDEN 且不泄露内容；finally 恢复临时 global collector。新的 toolbar 分支删除 sender.documentId/frameId，origin与唯一POPUP上下文相符且tabId=-1；mock tabs.create令context消失，service仍回ok。相同sender请求LIST不能沿此窄入口放权；关闭后validateCurrent拒绝。deep-link只容record UUID、保留原生非隐身身份，sender旧hash与context新hash可对应同一学习页；Content固定打开在注册前后都可，但不授予LIST，导航后旧access失效。

这是完整文件的断言说明，并非真实浏览器；无真实IDB/Provider，合成接口不能证明原生消息字段或可见按钮。测试改变需联动 access/service/lifecycle/DTO和实际POPUP故事；其它并发/事务文件不由本篇补算覆盖。

<a id="native-popup-evidence"></a>
## 新旧学习中心证据怎样衔接

[当前 learning-center spec L24–L66](https://github.com/CoderLambert/translateflow-plugin/blob/c250ce91aff7eb84d1ad8acbe1d4155ad244dc24/e2e/learning-center.spec.mjs#L24-L66) 新建真实 action Popup：先由 driver 上临时按钮的可信点击调用 chrome.action.openPopup，确认 getContexts 的 POPUP唯一，经 CDP 找到/附着 popup target，再在该原生文档 Runtime.evaluate发送固定 OPEN消息。断言真实 center tab出现、原生sender无documentId/frameId/tab（记录tab为null）、POPUP关闭。它没有点击原生Popup中可见“学习中心”按钮，也未消费 Runtime.evaluate 的完成响应来断言 ACK；成功ACK的针对性断言在上述 Node测试。不能仅凭测试标题写“真实工具栏按钮已点击且ACK实测成功”。

该文件其余两个完整故事沿用[学习中心逐文件说明](learning-center.md#test-e2e)：真实React保存/管理/offline reload与合成大语料分页/导出/取消。原普通TAB driver点击学习中心仍检验产品按钮接线；Selection创建故事仍显式harness.inject。#286 Release A likewise 的 Popup driver与openContent注入证明下游业务，不补作原生工具栏/新页面零注入入口证明。旧149项历史汇总保留原候选/产物身份，不扩大到#287新required权限与新入口。

<a id="limitations"></a>
## 尚未覆盖的升级与全站成本

1. [upgrade-expectations L15–L25](https://github.com/CoderLambert/translateflow-plugin/blob/c250ce91aff7eb84d1ad8acbe1d4155ad244dc24/e2e/support/upgrade-expectations.mjs#L15-L25) 仍将before每个旧动态注册保留，仅替换js/css；[wxt-upgrade L220–L225](https://github.com/CoderLambert/translateflow-plugin/blob/c250ce91aff7eb84d1ad8acbe1d4155ad244dc24/e2e/wxt-upgrade.spec.mjs#L220-L225)拿它核实际activated快照。当前auto-sites同步会清本项目旧前缀全部注册，两份源码期望不一致。这是已核实的静态合同冲突；本轮没有执行升级，不声称观察到运行FAIL，也不把旧升级PASS挪到新Manifest。
2. required HTTP/HTTPS替代optional是实际权限模型扩大。旧用户同ID商店更新的重新确认、可能停用与恢复路径未由unpacked reload证明；[PR审查](https://github.com/CoderLambert/translateflow-plugin/pull/287#discussion_r4175033580)提示此风险，本轮未观察真实用户停用或验证商店流程。现有Chrome102构建target也不证明getContexts/openPopup在该浏览器可用。
3. [controller.start L40–L44](https://github.com/CoderLambert/translateflow-plugin/blob/c250ce91aff7eb84d1ad8acbe1d4155ad244dc24/src/content/selection/controller.js#L40-L44)立即启动[projection observer L13–L23](https://github.com/CoderLambert/translateflow-plugin/blob/c250ce91aff7eb84d1ad8acbe1d4155ad244dc24/src/content/text-projection.js#L13-L23)，监听documentElement的subtree/childList/characterData和限定属性。静态全站加载扩大此监听的触达范围；本轮没有测CPU、内存或用户卡顿，不能把潜在持续成本写成已复现性能故障。
4. [原生权限spec](https://github.com/CoderLambert/translateflow-plugin/blob/c250ce91aff7eb84d1ad8acbe1d4155ad244dc24/e2e/wxt-platform-permissions.spec.mjs)现用Chrome管理API把required访问切为specific sites、grant/revoke并reload；hard-denied/withheld/revoked均在一秒窗口允许PENDING或REJECTED且零marker/receiver，grant在新文档要求FULFILLED，三偏好零动态注册，重启剪除无权限偏好、Provider0。用户实际权限弹窗和pending consent completion仍NOT RUN。末尾productionManifestChanged:false是该临时测试的报告字段，不能解读成#287未改变产品权限。大型spec保持局部覆盖。

以上差异只记录证据和后续核验边界，不在导读任务改实现、测试、权限、版本或发布状态。
