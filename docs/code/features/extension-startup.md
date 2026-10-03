# 扩展启动：从浏览器入口到可交互页面

导航：[阅读入口](../README.md) · [架构总览](../architecture.md) · [仓库地图](../repository-map.md) · [startup 逐文件说明](../modules/startup.md)

> 源码基线：`d5e308a709c008acf6b277d466d020f13025bdca`。本文是该版本的静态源码走读，运行验证统一为 **NOT_RUN**。它不宣称完整翻译、词典或发布验收已经完成。
>
> 逐文件说明与覆盖边界见 [startup 模块](../modules/startup.md)。


> 2026-10-03 增量说明：本章保留旧入口源码说明；当前 d5246ca 的构建和 Reading 接线已变化，以下第2节与 Reading 提示已更新。共享浏览器测试基础设施已切为复制预构建的明确产物，不再隐式构建；默认构建与默认本地E2E选择不同，实际运行请先读[构建与测试链](build-test-release.md)。旧测试链接只说明固定版本断言，不作为当前产物PASS；本轮运行NOT_RUN。

## 1. 先分清三个不同的“启动”

1. **后台 worker 被浏览器装载**：注册消息、快捷键、Reading 会话与生命周期监听器。安装/更新事件另做默认配置与旧缓存清理。
2. **Popup 被打开**：创建独立扩展页，绑定按钮并读取站点状态；读取缓存状态的路径会尝试把 Content 注入当前标签页。
3. **Content 被注入网页**：按固定顺序装配 classic-script 模块，然后根 `content.js` 注册网页消息监听器、启动外观、Quick Control、Selection、持久模式与适用的字幕控制器。

这三者不是一个同步的全局初始化 Promise。后台没有“等所有配置/缓存/词典预热完再注册监听器”的步骤；Content 的 `STATUS.ok` 也只表示消息监听器可响应，不代表每个异步 UI/持久模式已完成。

## 2. 构建路径决定入口，不改变运行时职责

### 当前默认 WXT 包

main `d5246cae6469e4a876fc122b229a2e0ddf115709` 的 `build:extension` 与 `validate` 输出 `dist/extension/`；`build:extension:wxt` 通过同一构建器输出 `.output/chrome-mv3/`。两者均为 WXT，不再是 legacy/WXT 双引擎。脚本先生成 staging、审计精确资源闭包与 Manifest，再安全复检并复制到目标。完整算法与命令见[构建链](build-test-release.md)。E2E 默认选择 `.output/chrome-mv3`，测试 `dist/extension` 必须显式 `TF_E2E_ARTIFACT`。

[entrypoints/background.ts](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/entrypoints/background.ts) 仍调用 `defineBackground({type:"module",main(){initializeBackground();}})`，没有延迟 import 或另一套业务初始化。根 `background.js` 保留薄入口源码，但不能把它当当前默认产物的复制入口。WXT 编译根 Popup/Options HTML；Content、YouTube MAIN、module Worker 通过精确 raw bridge 保留相应运行边界，Content 不因此变成 ESM。

Manifest 来源仍声明 MV3、国际化 action/commands、Options 与 Chrome102 下限，无静态 content_scripts；实际产物 Manifest 经 WXT 与审计约束。安装扩展不等于立即对所有网页注入，React 依赖也不意味着 Content 已 React 化。历史兼容证据不能当本轮执行 PASS。

## 3. 后台：先把事件接好，再响应具体事件

核心是 [initializeBackground](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/index.js#L11)：

1. `registerMessageRouter()` 注册 runtime onMessage。
2. `registerCommandRouter()` 注册 commands onCommand。
3. 注册 Reading port、tab update/remove、permission remove 回调。
4. 注册 `onInstalled` 和 `onStartup`。

以上 listener 注册发生在函数同步执行期。没有先 await `ensureConfigDefaults`，也没有为每次 worker 唤醒自动调用一遍 `syncSiteRegistrations`。

### 安装、更新、浏览器启动

- `onInstalled`：先 `ensureConfigDefaults()`，仅为存储中值为 `undefined` 的键补默认值；若 reason 为 `install` 或 `update`，删除 `chrome.storage.local` 中 `abt-cache-v1:` 前缀键；最后同步站点脚本注册。它不会清空当前翻译 IndexedDB、Reading 历史或词典存储。
- `onStartup`：仅调用 `syncSiteRegistrations().catch(() => {})`。同步失败被吞掉，不产生用户界面错误。
- install callback 没有同样的顶层 catch。若默认配置或旧键清理失败，后面的同步不会执行；不能描述为“每一步独立失败仍继续”。
- `initializeBackground` 没有自身幂等标记或统一 unregister。正常依赖每次 worker 上下文只通过一个入口初始化；人为重复调用会重复添加 listener。

配置细节见 [config.js 的启动函数](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/config.js#L108)。`getConfig()` 读取时也合并默认值，因此读配置不以安装回调已完成为前提。

### Reading 为什么出现在启动里

[Reading runtime](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/runtime.js) 的单例是懒创建；收到 Reading 请求/认可的 port 或相关浏览器事件才取得 service/subscriptions/repository。导航 invalidates tab，tab 删除 forgets tab，权限移除 revokes service 并关闭订阅。仅注册这些回调不等于开启阅读采集或创建学习中心；旧注释不是当前产品接线依据：d5246ca 已接通 production collector 与显式保存，学习中心仍不可用；见[Reading当前完整链](reading-records.md)。这里仅解释未变的后台生命周期。

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
- 未授权其他站点的持久访问不会凭空出现：Popup 临时操作依靠 activeTab，持久注入另走 origin 权限。

`popup-appearance.js` 独立读取 appearance/siteProfiles，建立“跟随默认”选项；失败禁用 select。Preset UI 通过 `EFFECTIVE_CONTEXT` 读后台解析后的站点/provider/model，失败隐藏卡片。两者不是 Provider API 预热。

## 5. 第二个手动入口：快捷键先发消息，失败再注入

[commands.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/commands.js) 将三个 command 映射到 Content 消息。它使用 lastFocusedWindow 的 active tab，与 Popup 的 currentWindow 查询有区别。

`createCommandRouter` 拒绝未知 command，验证 tab/id/http(s)，为正文翻译建立一次 taskId，然后先发送业务消息。只有发送 Promise reject 才注入 CSS + 同一组 Content JS，并重发原消息；翻译重试仍用同一 taskId。收到 `{ok:false}` 不会触发注入。第二次失败向上传播，而注册 listener 的外层 catch 将其忽略。

所以它不是 Popup 的“先 STATUS、再 QUICK_CONTROL_SHOW”算法，也没有无限重试。Content 启动成功和业务操作成功必须分别判断。

## 6. 持久入口：三个站点偏好共享一个注册项

[auto-sites.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/auto-sites.js#L88) 是动态注册唯一 owner。用户在 Popup 开启自动翻译、缓存恢复或持久 Quick Control 时：

1. UI 在用户操作中请求站点 match pattern 权限；
2. 后台 register 函数再次 `permissions.contains`；
3. 写入对应 local 列表；
4. `syncOriginRegistration` 计算三种需求并集，决定保留或删除注册；
5. 当前已打开的标签页仍由 Popup `ensureInjected` 接通；动态注册用于匹配文档。

持久注册的标识为 `tf_site_` + origin SHA-256 前 20 个 hex 字符。script 配置使用完整 `CONTENT_SCRIPT_FILES`、`content.css`、`document_idle`、`persistAcrossSessions:true`，不设 allFrames 或 MAIN world。三种偏好不是三份 script。

全量同步会规范化/去重/排序站点，过滤没有权限的站点，排除隐藏的 Quick Control 站点，逐站先撤销旧同 ID 再注册；最后删掉不再需要的本项目新旧前缀 ID，并在状态变化时回写规范化列表。单站注册失败被捕获，但该 ID 不加入 desiredIds，后续可能成为 stale；并非事务或无损 upsert。全局读取/权限/注销错误仍可能使同步 reject。

`showQuickControlSite` 只移除 hidden 偏好，不把站点添加回 persistent 列表。关闭其中一项也不会误删另两项仍需要的 registration。Popup 释放 origin 权限前还检查其他模式与 OpenAI-compatible provider 是否仍使用该 match pattern。

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

## 10. 如何验证这条链（本次全部 NOT_RUN）

本次只读取固定 commit 源码和测试，不执行 npm、扩展、浏览器或付费 Provider。以下是可复现的验证入口与测试实际覆盖的区别：

| 验证对象 | 已读证据 | 后续执行入口 | 本次状态 |
| --- | --- | --- | --- |
| 无权限拒绝、三模式共用注册、hide/show 不破坏 auto | [site-registration.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/site-registration.test.mjs) | `node --test tests/site-registration.test.mjs` | NOT_RUN |
| 快捷键正常投递、首次失败注入一次/同 taskId 重发、拒绝保护协议 | [commands.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/commands.test.mjs) | `node --test tests/commands.test.mjs` | NOT_RUN |
| cache restore 独立偏好与 Provider 禁止结构 | [cache-restore-mode.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/cache-restore-mode.test.mjs) | `node --test tests/cache-restore-mode.test.mjs` | NOT_RUN；主要是源码结构断言 |
| Popup 控件、ARIA 与外观字段保留 | [popup-ux.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/popup-ux.test.mjs) | `node --test tests/popup-ux.test.mjs` | NOT_RUN；不是点击浏览器 |
| WXT raw 顺序/路径、Manifest 拒绝额外权限与静态注入 | [wxt-assets.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/wxt-assets.test.mjs) | `node --test tests/wxt-assets.test.mjs` | NOT_RUN |
| Reading 工厂/无效授权不打开 IDB | [reading-runtime-storage.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-runtime-storage.test.mjs) | 对应 Node test | NOT_RUN |
| Quick-Control-only 不恢复；restore-only 命中/动态 miss；Shadow UI | [translateflow.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/translateflow.spec.mjs#L35) | 先 WXT build，再 `npm run test:e2e` | NOT_RUN；测试中显式 harness.inject，不证明浏览器持久注册本身 |
| 聚合与 WXT 包 smoke | [package.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/package.json) | `npm run validate`；`npm run build:extension:wxt`；`npm run test:wxt:smoke` | NOT_RUN；validate 不含 E2E |

建议启动验收还要单独观察：首次安装与普通 worker 再唤醒、Popup 打开不点击、同文档两次注入、站点权限撤回后重启、Chrome 拒绝注入、UI start 中途失败、扩展更新后旧 tab 与新 tab 的区别。这是待验证检查表，不是已存在测试或已通过结论。

