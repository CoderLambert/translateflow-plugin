# startup 模块逐文件走读

导航：[阅读入口](../README.md) · [架构总览](../architecture.md) · [仓库地图](../repository-map.md) · [扩展启动功能链](../features/extension-startup.md)

> 当前c250ce9的Manifest和auto-sites已在原章节替换；其它入口保留旧固定引用。当前完整启动/POPUP/权限边界见[功能链](../features/extension-startup.md)与[证据章](real-entry.md)，不把历史optional/动态注册测试当新实现。

> 其它历史章节固定源码版本：`d5e308a709c008acf6b277d466d020f13025bdca`。
> 阅读顺序建议先看 [功能链：扩展启动](../features/extension-startup.md)，再用本页定位具体文件。
> “完整解释”仅指该文件自身全部职责、关键分支、输入/输出与副作用均已说明；不把它调用的子模块自动算作完整解释。代码/浏览器/测试执行状态均为 **NOT_RUN**。

## 覆盖索引

| 文件 | 本页锚点 | 状态 |
| --- | --- | --- |
| manifest.json | [file-manifest](#file-manifest) | 完整解释 |
| background.js | [file-background-entry](#file-background-entry) | 完整解释 |
| entrypoints/background.ts | [file-wxt-background-entry](#file-wxt-background-entry) | 完整解释 |
| src/background/index.js | [file-background-index](#file-background-index) | 完整解释 |
| src/background/commands.js | [file-commands](#file-commands) | 完整解释 |
| src/background/auto-sites.js | [file-auto-sites](#file-auto-sites) | 完整解释 |
| src/content/runtime.js | [file-content-runtime](#file-content-runtime) | 完整解释 |
| content.js | [file-content-entry](#file-content-entry) | 完整解释 |
| src/content/appearance.js | [file-content-appearance](#file-content-appearance) | 完整解释 |
| src/content/ui/host.js | [file-ui-host](#file-ui-host) | 完整解释 |
| wxt.config.mjs | [file-wxt-config](#file-wxt-config) | 完整解释（配置文件自身，不包含其 helper 实现） |
| 其他启动依赖 | [partial-files](#partial-files) | 局部解释，不能标记完整 |

<a id="file-manifest"></a>
## manifest.json：浏览器的声明入口

[完整源码 L1–L18](https://github.com/CoderLambert/translateflow-plugin/blob/c250ce91aff7eb84d1ad8acbe1d4155ad244dc24/manifest.json#L1-L18)；blob `a707543acbb3d719f79053eb36e180032b7008f1`。

这是 Chrome 读取的 JSON，不含函数：

- `manifest_version:3` 与 `background.service_worker:"background.js", type:"module"` 定义后台的加载方式。
- `name`、`description`、action title 与 commands description 使用 `__MSG_...__`；`default_locale:"en"` 是 Manifest 国际化默认值，不等同用户设置的 UI locale 或翻译目标语言。
- 版本为 `0.8.0`，最低 Chrome 为 `102`。
- `action.default_popup` 指向 `popup.html`；`options_page` 指向 `options.html`，不是 `options_ui`。
- 必需 permission 为 storage、activeTab、scripting；必需host为DeepSeek、http://*/*与https://*/*；optional_host_permissions已移除，实际访问仍受Chrome站点控制。
- commands 定义 translate-page、toggle-translations、toggle-quick-control 的默认/Mac 组合键，由后台 commands 模块解释名称。
- 根JSON没有content_scripts、WAR、额外CSP或sandbox字段；当前安装包由[唯一投影](real-entry.md#file-projection)生成静态HTTP/HTTPS document_idle Content，不能由根JSON缺字段推导无静态注入。

调用者是浏览器与两个构建路径；输出是加载入口/权限能力约束。它不保证脚本一定能注入 Chrome 保护的页面。

<a id="file-background-entry"></a>
## background.js：保留的薄 ESM 入口源码

[固定源码](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/background.js)

仅静态导入 `./src/background/index.js` 的 `initializeBackground`，随后同步调用一次。没有业务状态、异步 gate、错误包装、默认配置读写或 listener 清理逻辑。错误沿入口执行传播。

维护时不能把业务分支或另一套路由堆回根文件；WXT 并不引用根 background.js，而是复用同一个 index.js。

<a id="file-wxt-background-entry"></a>
## entrypoints/background.ts：WXT 的同源薄入口

[固定源码](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/entrypoints/background.ts)

静态导入 `defineBackground` 与既有 `initializeBackground`；默认导出 `defineBackground({type:"module", main(){...}})`。WXT 的 main 被执行时同步注册原有后台监听器，不通过 `import()` 延后注册，没有 fake chrome globals 或另一套初始化。

这是构建入口差异，不是 Provider/缓存逻辑迁移。失败与重复调用语义仍由下层决定，本文件无额外重试和幂等标记。

<a id="file-background-index"></a>
## src/background/index.js：后台组合与生命周期

[固定源码：initializeBackground](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/index.js#L11)

输入为浏览器全局 chrome；无返回值。它按如下顺序连线：

| 事件/入口 | 调用目标 | 语义 |
| --- | --- | --- |
| 立即 | registerMessageRouter / registerCommandRouter | 同步添加请求/快捷键监听器 |
| runtime.onConnect | handleReadingPort | 交 Reading 模块筛选 port |
| tabs.onUpdated | onReadingTabUpdated | 交 Reading 模块使导航旧权限/订阅失效 |
| tabs.onRemoved | onReadingTabRemoved | 清理对应 Reading tab 会话 |
| permissions.onRemoved | onReadingPermissionsRemoved | 撤销 Reading service 权限并关闭订阅 |
| runtime.onInstalled | ensureConfigDefaults → 条件 removeLegacyV1Cache → syncSiteRegistrations | 串行 await |
| runtime.onStartup | syncSiteRegistrations().catch | 启动同步失败静默处理 |

install/update 才执行 legacy 清理；其他 onInstalled reason 仍补默认与同步。这里的权限移除回调是 Reading owner，不是调用 `syncSiteRegistrations`；不要误写成“每次撤销站点权限立即同步所有动态脚本”。

模块自身没有初始化幂等或 disposer。它假定入口在当前 service-worker 上下文执行一次；普通 worker 再唤醒重新执行入口，但不是 browser onStartup 事件的同义词。initializeBackground 函数体只负责上述连线，没有直接打开翻译数据库、调用 Provider 或启动阅读采集的步骤；这不等于已审计全部传递 import 的顶层副作用。

下游 config 的具体归一化、Reading 权限验证和数据库操作只在本篇作为边界引用。

<a id="file-commands"></a>
## src/background/commands.js：可注入依赖的快捷键路由

[固定源码](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/commands.js)

### 常量与注册

`COMMANDS` 冻结三个 Chrome command 名，`COMMAND_MESSAGE` 冻结其 Content message 映射。`registerCommandRouter` 的 listener 调用已创建的 `routeCommand`，reject 被 catch 忽略；它不展示 Popup 错误。

### createCommandRouter

[源码](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/commands.js#L21) 默认依赖：
- queryActiveTab：查询 active + lastFocusedWindow；
- sendContentMessage：tabs.sendMessage；
- injectContent：私有 injectTranslateFlow；
- createTaskId：crypto.randomUUID。

工厂返回 async route，便于测试替换浏览器依赖：

1. 未知 command 返回 `{ok:false,ignored:true}`，不查询 tab。
2. 缺少 tab id 或不是合法 http/https URL，返回 `{ok:false,unsupported:true}`。
3. translate-page 建立一次 `{type,taskId}`；另外两个仅 `{type}`。
4. 先投递消息。成功直接返回 Content 结果，包括可能的业务 `ok:false`。
5. 只有投递 throw/reject 时才注入并重发同一对象；不会新生成 taskId。注入/第二次投递失败向上传播。

`routeCommand = createCommandRouter()` 在模块初始化时建立默认路由，但不会在此时查询标签页。`isSupportedPage` 用 URL parser，非法 URL 返回 false；不识别所有 Chrome 保护 https 页面。`injectTranslateFlow` 先 await insertCSS，再 executeScript，同用中央资源列表；没有 QUICK_CONTROL_SHOW 追加消息，也没有独立 STATUS handshake。

关联测试：[commands.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/commands.test.mjs)，本次 NOT_RUN。

<a id="file-auto-sites"></a>
## src/background/auto-sites.js：站点模式与旧动态注册清理

[完整源码 L1–L197](https://github.com/CoderLambert/translateflow-plugin/blob/c250ce91aff7eb84d1ad8acbe1d4155ad244dc24/src/background/auto-sites.js#L1-L197)；blob `bf45432aa9e5599b3b989c818b1d6a5f423f8b14`。

四个storage键为cacheRestoreSites、autoSites、quickControlSites、quickControlHiddenSites。rawOrigin经normalizeOrigin取scheme+hostname（省略端口），无效输入拒绝；read/write统一对数组去重排序、忽略坏项，无第二份内存事实来源。

registerAutoSite/registerCacheRestoreSite先contains校验有效访问，再read→add→write→syncOriginRegistration，回enabled:true。两个unregister移除/写入/同步，回false；不清缓存、不直接撤Chrome权限。Quick Control注册另清hidden；unregister仅移除persistent；hide同时移除persistent并加hidden；show仅移除hidden并写回，不加persistent、不执行注册同步。

syncOriginRegistration只算当前及legacy前缀的origin SHA-256前20hex稳定ID，读取实际注册后注销存在者，不再registerContentScripts。全量sync先读规范化state，将三模式按contains过滤、quick再剔hidden，读取所有注册并清除SITE_SCRIPT_PREFIX及LEGACY_SITE_SCRIPT_PREFIXES的全部ID；保留无关项。构造next，sameState的四组JSON不同才write，返回next；syncAutoSiteRegistrations为别名。

没有动态需求并集、逐站重注册或单站catch了；get/hash/permission/unregister/write任何异常均可上抛。单站操作先写偏好再清旧注册，失败不回滚；没有并发写锁/取消/重试。持久内容由Manifest负责，偏好只决定auto/cache/Quick Control行为。修改清理前缀、权限过滤、写入顺序须联动[Node测试](real-entry.md#test-sites)、实际权限和旧升级消费者；后者仍期待保留注册，见[静态不一致](real-entry.md#limitations)。本轮NOT_RUN。


<a id="file-content-runtime"></a>
## src/content/runtime.js：classic-script 的最小共享运行时

[固定源码](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/runtime.js)

IIFE 以 `globalThis.__TRANSLATE_FLOW_CONTENT__ ||= {modules:{}}` 创建唯一 app；若 runtime 已存在立即返回，不重建 state。模块没有 ESM import/export，通过 `app.modules.runtime` 导出对象。

### constants / messages / state

constants 固定：
- 正文译文 class、translated attr、扩展 UI attr 与候选段落 selector；
- batch 上限 7000 chars/18 items、最短文本 12；
- auto debounce 180ms、viewport rootMargin `900px 0px 1200px 0px`。

messages 分 content 与 background 两组冻结值，是 classic-script 与 ESM 常量契约的对应层；Content 不直接 import 共享 ESM 文件。它不是消息路由，只提供 type value，调用者还必须检查 response。

state 保存当前 document 的 manualRunning、auto/cacheRestore、autoDrainRunning、hidden、pending Set、两个 observer、autoTimer、归一化 page identity、退避/错误/prune 时间和 startupRestorePromise。初始两个模式都是 false；稍后读 local 偏好才启用。

### 工具函数全部行为

- cleanText：nullish 转空串，String 转换，连续空白变一个空格并 trim；normalizeSourceText 是其包装。
- getSiteScope：URL parser → scheme + hostname，不保留端口；非法 URL 会 throw。
- getPageIdentity：非法 URL 返回原输入；非 http(s) 也原样返回；普通 hash 清除，`#/` 与 `#!/` 保留；删除 utm_* 及固定 tracking 参数（大小写无关），query 排序，返回 URL.toString。
- isRouteLikeHash：仅识别前述两种 hash 路由前缀。
- sendRuntimeMessage：callback Chrome API 包成 Promise；callback 内有 runtime.lastError 则 reject Error，否则 resolve 原 response。业务 `ok:false` 不自动转异常。
- showToast：优先委托后加载的 uiToast.show；若尚未提供 UI toast，用 documentElement 下 `#abt-toast`，设置扩展 UI attr、kind、textContent 和 visible class；复用节点并重置 3200ms 隐藏 timer。这里不使用 innerHTML，也没有创建多套 fallback toast。

输出导出上述 constants/messages/state 与全部工具函数。runtime 没有总 destroy；重复注入保留已有 state，文档销毁才自然结束该上下文。getPageIdentity 与后台共享 URL 规则应保持一致，但这是两份加载机制下的实现，不是由同一个 ESM import 自动保证。

<a id="file-content-entry"></a>
## content.js：根 Content 组合器

[固定源码](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/content.js)

首先检查 runtime、appearance、tasks、dom、processor、auto、selectionController、quickControl、subtitleController 是否存在；缺失抛明确加载顺序错误。然后若 app.loaded 返回，否则设 true 并保存模块引用。它没有记录 module version，也没有初始化失败 rollback。

### runtime 消息全集（本文件层面）

- RICH_MDD_RESOURCES_CHANGED：可选调用 richResourceResolver.closeDictionary；同步 ok。
- TRANSLATE_PAGE / RESTORE_CACHE：委托 processPage，分别 cacheOnly false/true；前者传 taskId；异步 ok + result / error + errorCode。
- TASK_STATUS：同步 tasks.getTaskStatus；CANCEL_TASK 异步委托 tasks.cancelTask。
- QUICK_CONTROL_SHOW / TOGGLE：异步调用控制器，返回其 visible。
- ENABLE_AUTO：异步 enableAutoMode，announce:true；DISABLE_AUTO 同步 disable，返回 auto false。
- CACHE_STATUS / CLEAR_PAGE_CACHE：把 location.href 作为 pageUrl 转发到后台对应缓存消息，透传 response。
- TOGGLE_TRANSLATIONS：翻转 state.hidden 与 html 的 `abt-hide-translations` class，不删除持久缓存。
- CLEAR_TRANSLATIONS：委托 DOM 清理，返回 ok。
- STATUS：返回 running（manual 或 auto drain）、hidden、auto、cacheRestore 与当前 DOM 译文节点数。
- 未知消息返回 false，不构造错误 response。

同步 case 返回 false；异步 case 注册 Promise 回调后返回 true。各分支异常字段存在差异，不能假定所有 case 都带 errorCode。

### storage 与路由

[storage listener](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/content.js#L35) 只接受 local：
- appearance/siteProfiles → 外观 refresh；字幕模式/大小直接 setMode/setSize，persist:false。
- cacheRestoreSites/autoSites → 当前站点 membership 驱动启停。恢复初始工作以 !state.auto 决定。
- apiKey/openAICompatible 变化且 auto → 清退避；有 pending 则 120ms 调 drain。
- 翻译配置变化（provider/model/prompt/targetLanguage/openAICompatible/当前 siteProfile 翻译字段/glossary/siteGlossaries）且有增量模式 → 清退避、清 DOM 译文、更新 identity、重扫。不是清 IndexedDB。
- `siteProfileAffectsTranslation` 仅比较当前 origin 的五个字段；appearance 不包含在内。

`refreshIncrementalRoute` 在 auto/cacheRestore 都关时返回；identity 不变也返回；改变则更新 identity、清 pending、清译文、rescan。最后挂 yt-navigate-finish/popstate/hashchange，前两个额外刷新 subtitle route。

### 启动与失败

依次调用 appearance.start、quickControl.start、Selection start、maybeStartPersistentModes、subtitle.start（末者 catch）。这不是 await 串联屏障，STATUS 在异步初始化结束前即可回答。核心 UI start 的同步 throw 可中断后续 start/路由 listener 注册，且 loaded 已设 true；源码没有恢复该标记。

本文件不直接实现翻译、词典检索或字幕翻译，其全部 case 在这里解释为委托边界，不把被委托模块记为完整覆盖。

<a id="file-content-appearance"></a>
## src/content/appearance.js：异步读取、受控 CSS 应用

[固定源码](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/appearance.js)

IIFE guard 要求 runtime 且避免重复模块。内部保存 appliedVariables Set、current 摘要、refreshVersion。

- refresh：版本自增，发 EFFECTIVE_CONTEXT(pageUrl)；返回晚的旧版本在检查业务 response 前就忽略并返回 current；最新 response 非 ok 抛错误；成功 applyContext，返回 current。
- applyContext：appearanceVariables 必须是 object；删除上次应用但此次没有的变量；仅写名字匹配 `^--tf-translation-[a-z-]+$` 的键，以 String(value)、important 设置到 documentElement.style；随后更新 id/label/source 摘要，缺省 standard/Standard/default。
- start：触发 refresh，失败静默依赖 CSS fallback；没有在这里展示错误 toast。
- getState：返回 current 的浅拷贝或 null，避免调用者直接改内部摘要。
- 导出 start/refresh/getState/applyContext，无 storage listener；storage 驱动由根 content.js 拥有。

这是外观边界，不改翻译内容、不调用 Provider。它会移除自己记住的变量，但没有总 dispose 把全部变量还原。

<a id="file-ui-host"></a>
## src/content/ui/host.js：延迟建立共享 Shadow DOM

[固定源码](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/ui/host.js)

模块要求 runtime 与 uiTokens，重复装载 return。定义时合并已加载的 Quick Control、Selection AI/empty/lexical style；顺序不对会缺少当时尚未发布的可选 featureCss，因此资源列表先加载 styles 再 host。

- ensureHost：已有 connected host+shadow 则复用；否则建 `#translateflow-ui-root` div，标记扩展 UI，设置 all:initial、fixed/inset:0、最大层级、根 pointer-events:none，attach open shadow；注入 tokens+featureCss+layer CSS，再附到 documentElement，新建 layers Map。
- getLayer(name="default")：先确保 host，按名字缓存 layer；layer 为 fixed 全屏/默认不吃事件，直接子元素恢复 pointer-events:auto。
- ownsNode：先 ensureHost，再检查 Node 类型、host/后代或 getRootNode===shadow。注意这是带惰性创建副作用的查询，不是纯函数。
- getHost/getShadowRoot 都经 ensureHost，返回当前节点。
- 输出四个方法；没有总 destroy。如果外部移除 host，下次访问会建新 host 和新 Map，而不是恢复旧对象引用。

该文件负责隔离容器，不决定 Quick Control 是否应显示，也不把正文译文放进 Shadow DOM。不能将开放 shadow 描述成安全沙箱或对页面完全不可见。

<a id="file-wxt-config"></a>
## wxt.config.mjs：当前默认 WXT 接线（旧版细节以新章替换）

[固定源码](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/wxt.config.mjs)

本文件当前已全文复核到 c250ce9，旧启动版逐项说明已移交[当前完整构建配置说明](build-test-release.md#file-wxt-config)，不继续把旧 opt-in 配置当最新。当前 WXT 引擎同时服务 dist/extension 与 .output/chrome-mv3；读取 root manifest、编译 Popup/Options/后台与独立 React 学习中心、精确 raw bridge 与资源报告属于构建时行为，不在浏览器启动时扫描仓库。

<a id="partial-files"></a>
## 只在启动边界解释的文件

以下具有明确源码链接与符号，但保留 **局部解释**，不可并入上方完整文件计数：

| 文件 / 固定源码 | 本次解释点 | 尚未完整覆盖 |
| --- | --- | --- |
| [popup.html](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/popup.html) | 两个 module script、DOM 控件与样式依赖 | 全部 HTML/ARIA 布局逐项 |
| [popup.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/popup.js#L100) | 初始化刷新、getActiveSite、ensureInjected、状态/权限入口 | 完整翻译任务 UI、每个按钮与并发错误分支 |
| [popup-appearance.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/popup-appearance.js) | initialize 的 preference 读取与失败禁用 | 完整外观保存行为 |
| [src/popup/preset-ui.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/popup/preset-ui.js) | initializePresetUi / refresh → EFFECTIVE_CONTEXT | preset apply/save/重翻全部分支 |
| [src/shared/constants.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/constants.js) | 加载顺序、消息值、默认模式与前缀 | 全部业务常量契约的消费者 |
| [src/shared/url.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/url.js) | normalizeOrigin/getOriginMatchPattern 的站点 scope | 缓存 URL 规则完整回归 |
| [src/background/config.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/config.js#L108) | ensureConfigDefaults/removeLegacyV1Cache；effective context 边界 | Preset/Glossary/Provider 解析完整链 |
| [src/background/router.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/router.js#L71) | registerMessageRouter envelope、启动相关 case | 完整词典、翻译、Reading 路由与 sender 权限 |
| [src/background/reading-record/runtime.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/runtime.js) | 懒实例与 tab/permission/port 生命周期 | configure/repository ownership 全面走读 |
| [src/content/auto.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/auto.js#L31) | 持久模式启动、startupRestorePromise、observer 启停 | 批处理、错误恢复与翻译竞态完整链 |
| [src/content/quick-control.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/quick-control.js#L41) | start、show/toggle、visibility、Selection suppression | 全部交互及 view/render 实现 |
| [src/content/selection/controller.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/controller.js#L31) | start 与选择监听，不在 start 隐式查询 | 完整词典/AI/task/cancel 实现 |
| [src/content/subtitles/controller.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/subtitles/controller.js#L83) | 支持页面判定、start/stop/refreshRoute | 字幕请求/渲染/配置交互全链 |
| [src/content/subtitles/sources/youtube.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/subtitles/sources/youtube.js#L40) | source 的 install bridge 回调 | MAIN/fallback/播放器事件完整链 |
| [src/background/youtube-bridge.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/youtube-bridge.js) | sender tab 验证与专门 MAIN 注入 | 桥接协议安全与 MAIN 脚本 |
| [scripts/build-extension.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/build-extension.mjs#L40) | 默认输出与allowlist；现已有[完整构建器说明](build-test-release.md#file-build-extension) | 本表保留启动切片历史范围，全局coverage以新正文为准 |
| [package.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/package.json) | 当前入口见[命令路由](build-test-release.md#package-routing)：test:e2e→run-e2e默认WXT，dist/extension需显式TF_E2E_ARTIFACT | 词典构建/认证脚本全部含义仍局部 |

测试引用同样不自动视为逐文件完成。详见功能篇测试矩阵：Node mock/源码结构断言、真实 Chromium、WXT artifact smoke、发布认证是不同证据。本文没有执行任何运行时验证；所有命令为后续复现入口，均 **NOT_RUN**。

## 维护提示

### 11 个完整解释文件的修改影响与最近验证入口

所有条目均为 **NOT_RUN**。表中“无专门覆盖证据”仅表示本次已读测试没有证明该专项，并非断言仓库绝无其他测试。

| 文件 | 修改会影响什么 | 最近的已读测试 / 尚缺验证 |
| --- | --- | --- |
| manifest.json | 浏览器入口、权限、命令、页面身份与最低版本 | [wxt-assets.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/wxt-assets.test.mjs) 的 Manifest 等价/负例；浏览器安装仍需 smoke |
| background.js | 保留入口能否立即连上后台 listener | 现[e2e.yml](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/.github/workflows/e2e.yml)为旧历史矩阵；当前默认/显式输出均WXT，现行消费语义见构建章，本轮NOT_RUN |
| entrypoints/background.ts | WXT worker 入口、module 类型、listener 注册时序 | npm run build:extension:wxt 与 npm run test:wxt:smoke；未见专门同步时序单测证据 |
| src/background/index.js | 安装默认值、旧键清理、启动注册、Reading 生命周期接线 | [reading-runtime-storage.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-runtime-storage.test.mjs) 仅测下游懒存储；实际 onInstalled/onStartup 顺序和重复 initialize 需专门验证 |
| src/background/commands.js | 快捷键投递、首次注入、taskId 保留与保护页行为 | [commands.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/commands.test.mjs)；真实快捷键权限另需 Chromium |
| src/background/auto-sites.js | 三模式偏好、权限过滤与全部本项目旧注册清理 | [site-registration.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/site-registration.test.mjs)；真实跨会话注册/失败中断需额外验证 |
| src/content/runtime.js | 所有 Content 消息值、共享状态、页面身份、fallback toast | [translateflow.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/translateflow.spec.mjs) 间接覆盖注入后消息/缓存；重复 runtime 装载与 fallback toast 无本次专门覆盖证据 |
| content.js | 组合启动、消息响应、storage/SPA 路由和根幂等 | 同一 E2E 的手动翻译、模式切换、外观/Selection 路径；新增[wxt-injection-samples](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/e2e/wxt-injection-samples.spec.mjs)含十次cold/warm sameApp断言，但不是性能门槛；根启动异常仍需对应证据 |
| src/content/appearance.js | CSS 白名单变量、旧响应丢弃与 fallback | 同一 E2E 的 reading appearance 用例检查 DOM 保留与 Provider 次数；refreshVersion 乱序需专项验证 |
| src/content/ui/host.js | Shadow 样式隔离、layer 复用、节点归属与 host 重建 | 同一 E2E 的 Quick Control Shadow-isolated 用例；宿主节点外部删除后重建需专项验证 |
| wxt.config.mjs | entrypoint 身份、raw 资产闭包、构建 target 与审计报告 | [wxt-assets.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/wxt-assets.test.mjs) 加实际 WXT build/audit/smoke；helper 单测不能替代真实构建 hook |

当入口或监听器变化时，优先复核本页的同步注册、重复注入、缺依赖与失败恢复语义；当 CONTENT_SCRIPT_FILES 变化时同时复核手动fallback、静态Manifest投影、旧注册清理、WXT raw bridge。修改业务模块不能仅凭本启动篇更新就把该模块全量 coverage 标记完成。

事实优先级：本固定 commit 的实际代码与当前架构约束优先于旧 README 的概括或历史验收数字。本页保留未变入口的历史固定源码；默认发行现已切 WXT，当前构建配置以构建章为准。

## 后续阅读

启动后完整的查询、结果和取消流程见[划词功能章](../features/selection-and-dictionary.md)。本页局部解释的Selection controller现已有[完整文件说明](selection.md#file-controller)；全局覆盖状态以[coverage](../coverage.json)为准，不把两个章节重复计数。

网页启动后的正文任务与自动观察详见[网页翻译与缓存](../features/page-translation.md)；auto模块已有[完整说明](page-translation-cache.md#file-auto)。


当前构建/测试共享基础设施的变动、实际包选择和未合入输出安全后续见[构建完整链](../features/build-test-release.md)。本页运行时旧固定引用的blob与main86ed596一致，不能由此推导新CI或浏览器已通过。之前列为局部的Provider、字幕与Reading模块已有后续正文，全局覆盖状态以coverage为准。

