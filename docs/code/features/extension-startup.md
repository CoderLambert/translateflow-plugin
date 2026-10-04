# 扩展启动：从浏览器入口到可交互页面

> 2026-10-04 返回原文增量：增量到 main `33ab3ea2a38ce591b622ba06739344858d7da403`：Reading source-snapshot/resolver 被编入 reading-source.js，record-access/client/handoff/card/markers/status/controller 被编入 reading-record.js；CONTENT_SCRIPT_FILES 不再逐个列这些owned源，rich-details 必须先于 reading-record。见[准确投影与顺序](../modules/reading-return-to-page.md#classic-order)。启动后注册文档可能消费学习中心发起的一次性交接，[完整返回链](reading-return-to-page.md)接续本文。下面未改段落仍绑定其原版本，不把旧逐个script列举当当前打包清单。

导航：[阅读入口](../README.md) · [架构总览](../architecture.md) · [仓库地图](../repository-map.md) · [startup 逐文件说明](../modules/startup.md)

> 当前入口基线：`c250ce91aff7eb84d1ad8acbe1d4155ad244dc24`。2026-10-03 完整复核当前 Manifest投影、站点模式、Reading access/service，并修正真实入口链。其余未变入口沿用旧固定源码，coverage区分本轮全文/历史相同blob/局部；运行统一 **NOT_RUN**。
>
> 逐文件说明与覆盖边界见 [startup 模块](../modules/startup.md)。


> 当前#287入口和证据见[真实入口逐文件章](../modules/real-entry.md)。默认构建与默认E2E产物选择不同，见[构建链](build-test-release.md)。历史验收不认证本轮新权限或升级。

## 1. 先分清三个不同的“启动”

1. **后台 worker 被浏览器装载**：注册消息、快捷键、Reading 会话与生命周期监听器。安装/更新事件另做默认配置与旧缓存清理。
2. **Popup 被打开**：创建独立扩展页，绑定按钮并读取站点状态；读取缓存状态的路径会尝试把 Content 注入当前标签页。
3. **普通网页自动装载 Content**：有效HTTP/HTTPS访问允许时，安装包Manifest在document_idle静态注入；无需先打开Popup。按固定顺序装配 classic-script 模块，然后根 `content.js` 注册网页消息监听器、启动外观、Quick Control、Selection、持久模式与适用的字幕控制器。

这三者不是一个同步的全局初始化 Promise。后台没有“等所有配置/缓存/词典预热完再注册监听器”的步骤；Content 的 `STATUS.ok` 也只表示消息监听器可响应，不代表每个异步 UI/持久模式已完成。

## 2. 构建路径决定入口，不改变运行时职责

### 当前默认 WXT 包

main `d5246cae6469e4a876fc122b229a2e0ddf115709` 的 `build:extension` 与 `validate` 输出 `dist/extension/`；`build:extension:wxt` 通过同一构建器输出 `.output/chrome-mv3/`。两者均为 WXT，不再是 legacy/WXT 双引擎。脚本先生成 staging、审计精确资源闭包与 Manifest，再安全复检并复制到目标。完整算法与命令见[构建链](build-test-release.md)。E2E 默认选择 `.output/chrome-mv3`，测试 `dist/extension` 必须显式 `TF_E2E_ARTIFACT`。

[entrypoints/background.ts](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/entrypoints/background.ts) 仍调用 `defineBackground({type:"module",main(){initializeBackground();}})`，没有延迟 import 或另一套业务初始化。根 `background.js` 保留薄入口源码，但不能把它当当前默认产物的复制入口。WXT 编译根 Popup/Options HTML；Content、YouTube MAIN、module Worker 通过精确 raw bridge 保留相应运行边界，Content 不因此变成 ESM。

当前根Manifest声明MV3、action/commands、Options、Chrome102下限，required host为DeepSeek加http://*/*、https://*/*，不再声明optional_host_permissions。根JSON未写content_scripts；[production-manifest投影](../modules/real-entry.md#file-projection)由WXT加上完整有序JS/CSS的HTTP/HTTPS document_idle静态项，audit精确检查该投影。Chrome可保留/撤回站点访问、拒绝受保护页面，安装不代表所有已有文档已热更新。React仍仅独立学习中心。这里描述代码现状，不替权限扩大或升级背书。

## 3. 后台：先把事件接好，再响应具体事件

核心是 [initializeBackground](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/index.js#L11)：

1. `registerMessageRouter()` 注册 runtime onMessage。
2. `registerCommandRouter()` 注册 commands onCommand。
3. 注册 Reading port、tab update/remove、permission remove 回调。
4. 注册 `onInstalled` 和 `onStartup`。

以上 listener 注册发生在函数同步执行期。没有先 await `ensureConfigDefaults`，也没有为每次 worker 唤醒自动调用一遍 `syncSiteRegistrations`。

### 安装、更新、浏览器启动

- `onInstalled`：先 `ensureConfigDefaults()`，仅为存储中值为 `undefined` 的键补默认值；若 reason 为 `install` 或 `update`，删除 `chrome.storage.local` 中 `abt-cache-v1:` 前缀键；最后清理旧动态注册并规范化有权限的站点偏好。它不会清空当前翻译 IndexedDB、Reading 历史或词典存储。
- `onStartup`：仅调用 `syncSiteRegistrations().catch(() => {})`。同步失败被吞掉，不产生用户界面错误。
- install callback 没有同样的顶层 catch。若默认配置或旧键清理失败，后面的同步不会执行；不能描述为“每一步独立失败仍继续”。
- `initializeBackground` 没有自身幂等标记或统一 unregister。正常依赖每次 worker 上下文只通过一个入口初始化；人为重复调用会重复添加 listener。

配置细节见 [config.js 的启动函数](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/config.js#L108)。`getConfig()` 读取时也合并默认值，因此读配置不以安装回调已完成为前提。

### Reading 为什么出现在启动里

[Reading runtime](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/runtime.js) 的单例是懒创建；收到 Reading 请求/认可的 port 或相关浏览器事件才取得 service/subscriptions/repository。导航 invalidates tab，tab 删除 forgets tab，权限移除 revokes service 并关闭订阅。仅注册这些回调不等于开启阅读采集或创建学习中心；旧注释不是当前产品接线依据：当前main已接通production collector、显式保存和实际React学习中心；见[Reading当前完整链](reading-records.md)。这里仅解释未变的后台生命周期。

## 4. 手动入口：打开 Popup 已经可能注入 Content

[popup.html](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/popup.html) 底部加载两个 module scripts：`popup.js` 与 `popup-appearance.js`。HTML 提供按钮、有效配置卡、状态 live region 和外观 select；页面自身的样式来自 tokens、components、popup 三层 CSS。

`popup.js` 首先取 DOM 引用、构造 preset UI、绑定操作，然后 [Promise.allSettled](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/popup.js#L100) 并行刷新缓存、自动模式、缓存恢复、Quick Control 和 preset。单项失败不会由 allSettled 阻断其余刷新。

关键调用链：

```text
打开 popup.html
  → refreshCacheStatus()
  → sendToActiveTab(CACHE_STATUS)
  → getActiveSite()
  → ensureInjected(tabId)
      → tabs.sendMessage(STATUS)
      → 若无 ok：insertCSS → executeScript(CONTENT_SCRIPT_FILES)
      → 尝试发送 QUICK_CONTROL_SHOW
  → tabs.sendMessage(CACHE_STATUS)
  → content 的 sendRuntimeMessage(CACHE_PAGE_STATUS, location.href)
  → background router → getEffectiveConfig → getPageCacheStatus
  → Popup 展示当前配置/历史配置缓存数量
```

[ensureInjected](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/popup.js#L419) 先用 `STATUS` 探测，异常视为未注入；只有未得到 `ok` 才注入 CSS 和完整 JS 列表。最后的 Quick Control show 异常被忽略。因此：

- 打开 Popup 不是纯本地 DOM 操作，会启动页面交互能力；不必先点“翻译”。
- `STATUS.ok` 是已加载检测，不是版本比较；它不会把旧模块强制换成新版。
- 受保护页面先由 `getActiveSite` 的 http/https 判定拦住一部分；Chrome Web Store 等也可能是 https，最终仍由 Chrome 拒绝注入。不能说正则已识别所有受保护页面。
- 当前Manifest具有required普通HTTP/HTTPS访问；Chrome withholding仍能阻止注入。activeTab手势及手动fallback与静态入口并存，不能再说持久页面只靠optional-origin动态注册。

`popup-appearance.js` 独立读取 appearance/siteProfiles，建立“跟随默认”选项；失败禁用 select。Preset UI 通过 `EFFECTIVE_CONTEXT` 读后台解析后的站点/provider/model，失败隐藏卡片。两者不是 Provider API 预热。

## 5. 第二个手动入口：快捷键先发消息，失败再注入

[commands.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/commands.js) 将三个 command 映射到 Content 消息。它使用 lastFocusedWindow 的 active tab，与 Popup 的 currentWindow 查询有区别。

`createCommandRouter` 拒绝未知 command，验证 tab/id/http(s)，为正文翻译建立一次 taskId，然后先发送业务消息。只有发送 Promise reject 才注入 CSS + 同一组 Content JS，并重发原消息；翻译重试仍用同一 taskId。收到 `{ok:false}` 不会触发注入。第二次失败向上传播，而注册 listener 的外层 catch 将其忽略。

所以它不是 Popup 的“先 STATUS、再 QUICK_CONTROL_SHOW”算法，也没有无限重试。Content 启动成功和业务操作成功必须分别判断。

## 6. 静态入口与三个显式站点偏好分开

普通页面 → 浏览器匹配产物Manifest → document_idle加载有序Content CSS/JS → runtime模块表 → 根content.js幂等组合 → Selection.start → projection/listener → 有效选区chip → 用户点击后进入[词典/翻译/显式AI链](selection-and-dictionary.md)。静态声明本身不是Provider调用或Reading开启；但已启用的auto/cache/subtitle模式仍按各自路径工作，不能笼统承诺整个启动绝无Provider。

用户在Popup开启auto/cache restore/persistent Quick Control时，现有UI仍执行permissions.request，后台仍contains校验；在有效required访问下，这不是每站新获optional权限的模型。后台写对应storage列表后，只注销该origin的旧动态ID，不创建新注册。全量sync按权限过滤偏好、去掉hidden Quick Control，再删所有本项目tf_site_/legacy前缀旧注册，保留无关注册；失败仍可能发生在storage写入之后，非事务回滚。showQuickControl只撤hidden，不重新开启persistent。

根Content读这些偏好决定模式与可见性。关闭auto/restore/Quick Control不撤销生产Manifestrequired访问，也不卸载已注入Content；Chrome自己的站点访问设置是另一层。Popup旧remove逻辑不是新权限撤回保证。完整操作顺序见[auto-sites逐文件](../modules/startup.md#file-auto-sites)。

<a id="popup-reading-access"></a>
### 工具栏 Popup → 固定学习中心 → Reading 权限

正文learningCenter按钮 → popup.js的v2 OPEN_LEARNING_CENTER → background router → 懒Reading runtime（learningCenterAvailable=true）→ service.validateRequest → access.authorize → lifecycle scope规则 → tabs.create固定learning-center.html → {opened:true}。它不经过getActiveSite/ensureInjected，不要求当前网页先建立collector；Popup的其它状态刷新仍可能走网页注入。

真实工具栏sender可能同时缺documentId/tab/frameId。当前access只对固定popup.html的OPEN消息走getContexts({contextTypes:["POPUP"]})窄分支：核extension id、精确origin、无query/hash、唯一实际POPUP、UUID contextId、有效documentId及incognito=false，授予entry/nativeEntryOnly、tabId=-1。不能由请求自报context、不能以TAB driver冒充该fallback，也不给LIST/保存/导出权限。普通有documentId的Popup/Options及学习中心仍走原documentId校验；学习中心须TAB并有extension scope。

创建新tab会自然关闭工具栏Popup，service只对这一个固定OPEN省略dispatch后的validateCurrent，避免已成功开页被解释成旧sender消失错误；其它读写仍复验、持久事务仍有自己的身份/代次检查。失败回稳定Reading错误码，Popup只显示无法打开/重试。Content邀请也只固定开页；开启记录必须学习中心内明确动作，返回仍有效旧卡另点保存。详见[access/service](../modules/reading-records.md#file-access)、[完整Reading链](reading-records.md)。

## 7. Content：固定顺序装配，不使用模块 import

[CONTENT_SCRIPT_FILES](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/constants.js#L56) 是加载顺序事实来源：

- runtime 首先创建 `globalThis.__TRANSLATE_FLOW_CONTENT__ = { modules: {} }`；
- UI token/style/host/primitives/toast；
- appearance、tasks、DOM/structured/batch/processor/auto；
- subtitle source/protocol/pipeline/renderer/controller；
- text projection 与 Selection 模块；
- Quick Control view/controller；
- 最后根 `content.js`。

具体列表以固定源码链接为准，不拿早期 WXT 文档的旧文件数作常量。每个 classic script 通过 app.modules 发布能力，根入口才组合这些能力。常见模块 guard 在依赖缺失或已有模块时直接 return；根入口对关键模块缺失明确 throw。

[content.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/content.js) 先检查九类必要模块，再检查 `app.loaded`；首次把 loaded 设为 true，注册消息/storage/route listener，然后启动各功能。重复执行不会再次注册根 listener，runtime 也不会覆盖已有 state。这保护同文档重复注入，但不是完整失败回滚：loaded 在实际 UI start 前已经为 true；后面的同步异常可能留下部分初始化状态，重注入会直接返回。

### Content 启动的并发与实际可见结果

[启动段](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/content.js#L79) 按顺序调用，但不等待所有异步过程：

- `appearance.start()`：后台读取 effective context，只应用白名单 CSS variables；失败用 CSS fallback，refreshVersion 防旧响应覆盖新请求。
- `quickControl.start()`：只启动一次，订阅 page task、监听 pointer/key/storage，异步读 persistent/hidden 偏好。可见条件为 `(tabVisible || persistentVisible) && !hiddenForSite`，并非“Content 一注入就一定显示面板”。Popup 的 show 会设置 tabVisible。
- Selection `start()`：只启动一次，接入 projection、selection/mouse/key/pointer/scroll/resize 与相关关闭生命周期。启动阶段没有直接发起词典/AI 查询；有效选择产生 chip 后由用户操作进入业务链。
- `maybeStartPersistentModes()`：读两个列表；只开恢复则初次 `processPage({cacheOnly:true,silent:true,startup:true})`，并记录 startupRestorePromise；两者都开时跳过独立全页恢复，让自动模式走缓存优先增量；auto 开启会等已有 startup restore 完成。
- 字幕 `start().catch(...)`：只有控制器认定的 youtube.com watch/shorts 页面启动。读取模式/尺寸/context，挂载 renderer，创建 pipeline/source，再 start source。source 可请求后台注入专门的 MAIN bridge；不是把全部 Content 放到网页 MAIN world。

因此“启动绝不会调用 Provider”过于宽泛：普通外观/状态读取不会主动做翻译，但已授权自动模式或适用字幕 pipeline 后续可能触发翻译。只开 cache restore 的增量路径以 `allowProvider = state.auto`、`cacheOnly: !allowProvider` 保持 miss 不调用 Provider；只开 Quick Control 不自动恢复正文。

## 8. 消息、状态与安全边界

[registerMessageRouter](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/router.js#L71) 将 Reading method 单独交给 v2 handler，保留其 envelope；旧消息链 Promise 成功包装 `{ok:true,...result}`，错误包装 `{ok:false,error,errorCode}`，listener 返回 true 保持异步响应通道。未知旧消息抛“未知扩展消息”。不要把所有消息都描述成相同 envelope 或同一种 sender 校验。

Content 的 handler 则逐 case 决定同步响应/返回 false，或 Promise 回调响应/返回 true；runtime.sendRuntimeMessage 只把 Chrome lastError 变成 reject，业务 `ok:false` 由调用者检查。

启动相关数据分工：

| 所在位置 | 存什么/做什么 | 不应被误读为 |
| --- | --- | --- |
| Content runtime.state | 当前文档 running/hidden、模式、pending Set、observer/timer、page identity | 跨页面/跨 worker 的可靠持久状态 |
| chrome.storage.local | 默认与用户配置、站点模式、外观等 | 翻译 IndexedDB 或 Reading 历史 |
| chrome.storage.session | 临时 preset（由后台解析链使用） | 永久站点配置 |
| background config/router | 解析有效配置、把缓存与请求路由到 owner | Popup 自行复制 Provider 解析 |
| cache-db / providers | 翻译持久缓存 / 外部 HTTP 的 owner | Content 直接 fetch 或直连 IndexedDB |

以上 ownership 与 [ARCHITECTURE.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/ARCHITECTURE.md) 一致；本篇仅跟到这些接口，不宣称已逐行解释其实现。YouTube 的 MAIN 安装由后台根据 sender tab 校验目标，并使用三文件专门闭包；页面桥接不能因此获得任意后台能力。

## 9. 更新、路由、退出：哪些被清理，哪些没有

- local storage 改变时，根 Content 更新外观/字幕设置，按站点列表启停 auto/cache restore；配置影响翻译时清理页面译文、更新 identity 并 rescan。siteProfiles 仅比较当前站点 provider/model/prompt/targetLanguage/preset，外观改变不因此重翻。
- API key / OpenAI-compatible 变更在 auto 中重置退避，pending 非空则安排 drain。单独 apiKey 不包含在清理译文的 translationConfigChanged 布尔式中。
- `yt-navigate-finish`、`popstate` 触发增量 route 检查与字幕 route refresh；`hashchange` 只触发增量检查。一般 SPA 的 pushState 没有在根入口被统一 monkey-patch；auto 的 DOM mutation 也会检查 page identity。
- 两种增量模式都关闭时，auto 清空 pending/timer，disconnect 两个 observer；仍保留另一种模式时重扫。关闭模式不等于在这个函数里取消所有已在途请求。
- 字幕离开支持路由时 stop source/pipeline、清理 mediaId 并 unmount。其 start catch 设置 started=false 并报状态，但没有统一 rollback 已创建对象；不能称为完整启动事务。
- Quick Control 的 view.destroy 隐藏界面，不移除 start 注册的所有全局监听器。Selection dismiss 清理当前选择/任务语义，不等于撤销整个 Content。
- 根入口没有总 dispose，runtime/app.loaded 随文档生命周期存在。重复注入保护不是热更新协议，扩展重载后的已有标签页应单独验证。

## 10. 当前入口证据与最小改动路径

- 新Selection spec在共享HTTP新页面不调用harness.inject，检查静态Manifest、STATUS与可见chip、零动态注册；不测点击后的业务，也不是独立HTTPS网站，见[准确输入](../modules/real-entry.md#test-selection)。
- 新真实POPUP故事经action.openPopup建立原生上下文，CDP直接发送OPEN；检查center出现/Popup关闭，没点击可见学习中心按钮，也没消费CDP ACK。Node mock另验证闭合后成功ACK；旧TAB driver按钮故事仍有价值，边界见[证据对照](../modules/real-entry.md#native-popup-evidence)。
- 改启动声明应联动production-manifest、wxt config/audit、中央资源列表与Selection/native permission测试；改固定打开应联动access/service/DTO/lifecycle及真实sender故事，不扩大读取权限。
- 旧升级helper仍要求保留动态注册，和当前清理实现存在静态合同冲突；required权限旧用户商店升级重确认/恢复、全站observer成本未实测，见[限制](../modules/real-entry.md#limitations)。

全部命令/安装/构建/浏览器验证 **NOT_RUN**。本章解释入口可达性与安全边界，不认证全网站、商店升级、付费Provider或Oxford输入。

