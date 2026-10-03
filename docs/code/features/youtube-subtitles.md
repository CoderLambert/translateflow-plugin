# YouTube 字幕：从播放器响应到双语浮层

[返回首页](../README.md) · [运行时地图](../architecture.md) · [逐文件说明](../modules/youtube-subtitles.md) · [共享缓存与 Provider](../modules/page-translation-cache.md)

源码固定在 `d5e308a709c008acf6b277d466d020f13025bdca`，2026-10-03 重新读取 main 确认未变。本章是静态源码走读；安装、构建、单测、浏览器及真实 YouTube 验证均 **NOT_RUN**。主流程实现已存在，不表示以下限制已经修复。


> 2026-10-03 增量说明：本章运行时固定源码在main 86ed596中的blob未变。共享浏览器测试基础设施已切为复制预构建的明确产物，不再隐式构建；默认构建与默认本地E2E选择不同，实际运行请先读[构建与测试链](build-test-release.md)。旧测试链接只说明固定版本断言，不作为当前产物PASS；本轮运行NOT_RUN。

## 1. 用户入口及结果

已注入的 Content 在启动时调用字幕 controller。默认 controller 只在 youtube.com 子域的 watch/shorts 路径启动；读取 `youtubeSubtitleMode`、`youtubeSubtitleSize`，默认 bilingual/standard，并查询当前有效 Preset。播放器内出现原字幕、译文、状态以及模式/Preset/字号控件。它不是网页正文翻译的 DOM 插入分支，也不是下载全片字幕后一次性翻译。

入口见 [content.js L75–91](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/content.js#L75-L91)，配置、启动与入口范围见 [controller L10–98](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/subtitles/controller.js#L10-L98)。注入前的 activeTab、脚本顺序与两种构建路径复用[启动章](extension-startup.md)。后台 installer 的 live/embed/youtu.be URL 校验范围比默认 controller 更宽，不能仅凭 installer 支持某 URL 就宣称该产品入口已启用。

## 2. 一条字幕经过哪些边界

1. controller 创建 renderer、pipeline 和 YouTube source。
2. ISOLATED source 发送 `YOUTUBE_BRIDGE_INSTALL`。后台从真实 sender.tab 取 tabId/url，按固定顺序把 protocol、timedtext、MAIN bridge 注入 MAIN。
3. MAIN 观察播放器原本发出的 fetch/XHR timedtext 响应，解析为带时间的 cues，通过版本化 `window.postMessage` 送回 ISOLATED。
4. ISOLATED 验证 envelope 和视频身份，在当前代 MAIN timedtext、实际 active TextTrack、caption DOM 之间仲裁，输出当前 active cues 的 normalized snapshot。
5. pipeline 等文本稳定，将 snapshot 转成有媒体、轨道、cue 位置的 units，去重、限队列、串行分批。
6. `SUBTITLE_TRANSLATE_BATCH` 到后台后一次解析 config；查缓存，只把缺失 unit.text 送共享 Provider 请求层，再以同一 config 写缓存。
7. pipeline 校验任务取消及自身 generation，再按 unit.id 回调；controller 校验 mediaId，renderer 用 textContent 展示原文/译文。

后台路由见 [router L102–112](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/router.js#L102-L112)。[模块章](../modules/youtube-subtitles.md)给出11个字幕专属生产文件的职责，既有 tasks、请求合并、Provider、IDB 不复制成另一套字幕实现。

## 3. MAIN：观察播放器请求，不能重放签名 URL

[MAIN L120–259](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/subtitles/youtube-main-bridge.js#L120-L259)维护 videoId 与递增 generation。fetch wrapper 返回原始 Promise，异步 clone 响应读取；XHR wrapper 保留原 open/send 返回值，在 loadend 观察正文。捕获请求时冻结视频身份，处理响应前后重新确认同一身份且 active。旧视频响应因此有明确丢弃条件。

轨道来自播放器选择、audio track 和 ytInitialPlayerResponse，规范化身份不带签名 baseUrl。若尚未捕获字幕，HELLO 后约1秒执行一次受限 nudge：让播放器 loadModule("captions")，setOption 只带 languageCode 和必要的 kind:"asr"，不自行 fetch baseUrl。已有选择优先；没有选择时，在首个推断语言中优先人类字幕。[nudge L281–335](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/subtitles/youtube-main-bridge.js#L281-L335)

Resource Timing 只保存观察到的 URL、触发状态刷新，不能据此读取过去的响应正文。重复注入同版本 bridge 调用 reannounce，不堆叠网络 wrapper。停止时只恢复仍由自己占有的 hooks，以免覆盖其他页面代码后来安装的 wrapper。

## 4. ISOLATED：协议有效不等于页面可信

[协议](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/subtitles/youtube-bridge-protocol.js#L31-L134)验证 source/version/direction/type、非负 generation、videoId 长度、observedAt、payload 白名单形状及2MiB序列化上限。cue 文本上限10000字符，轨道最多64项，TIMEDTEXT最多100000 cues；同时受总字节限额约束。监听方先检查 event.source 等于本窗口。

这些检查是数据合同与降错边界，不是页面代码无法伪造的认证。消息使用公开常量和 postMessage("*")；MAIN 不暴露任意扩展后台操作。签名 requestUrl 在 envelope 中仍可存在，但 source 不把它作为翻译/持久缓存输入；不能记录完整 URL、token 或字幕正文到日志。本章没有进行渗透测试。

[仲裁 L154–244、L284–327](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/subtitles/sources/youtube.js#L154-L327)的精确顺序：

- 接受当前视频/current mainGeneration 的有效 MAIN 数据后，用 start ≤ currentTime < end 取 active cues。即使当前没有 cue，也保留 MAIN 为首选，不混入 DOM 陈旧文本。
- MAIN 不可用时，只有 TextTrack snapshot 真有 active cues 才选择它；“存在 enabled track”本身不足以压过 DOM。
- 最后读取 YouTube caption 容器纯文本。DOM cue 没有可靠开始/结束时间。
- MAIN ERROR 或轨道 id 改变会使现有 MAIN cues 失效，重新走 fallback。
- 播放/seek/ratechange/timeupdate 和下一个 cue 边界 timer 刷新。此实现每次扫描 cues/边界，不是预建时间索引。

native caption 的 visibility 会暂存并设 hidden，避免原生层和扩展原文重复；off/stop/视频身份重置恢复原值。它不删除字幕节点，不修改 TextTrack 的 disabled 状态；MAIN nudge 是另一层播放器操作。

## 5. 从滚动文本到有界批次

[pipeline L47–215](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/subtitles/pipeline.js#L47-L215)区分：

- 有时间 cue：按开始/结束（3位小数）和 cue slot/id 建候选；相同文本不延长稳定期。
- 无时间 DOM：合成一个 rolling 候选。前后互为前缀视为继续增长；不连续新句先结算旧句。空 cues 也会结算已有 rolling。
- 默认稳定280ms；结算后通常再等60ms组成最多6项批次；待发队列默认最多24项，超出丢最旧项，而非保证全片不丢字幕。
- unit 带 mediaId/source/track/cue/sequence/text 和内存 fingerprint；completed 去重集合按媒体切换清空。无时间位置用 sequence，不保证不同观看过程都产生相同缓存位置。
- 只有当前出现过的 cues 被 ingest；获得整段 timedtext 不意味着全片预翻译或预取未来 cue。

后台另设硬上限：截取前12个输入、单项/批次文本总计12000字符，并要求 id/text/mediaId。超长项跳过，总量满时结束。[后台规范化 L109–149](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/subtitle-requests.js#L109-L149) 因此 Content 批大小和后台接收能力是两层限制。

## 6. 缓存与 Provider：单批配置快照的实际范围

[subtitle-requests L10–106](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/subtitle-requests.js#L10-L106)将持久 sourceText 编成 `tf-subtitle:v1:` 加 JSON，含媒体、来源、轨道 id/kind/language/autoGenerated、cue id/时间及规范化文本。定时 cue 忽略 queue sequence，无时间 cue 包含 sequence；同一句在不同时间、视频或语言下不共享该 source 身份。外层仍由共享缓存加规范化 pageUrl 和有效 Provider/prompt/target 等配置身份，详见[缓存文件](../modules/page-translation-cache.md#file-cache-db)。

后台一次 getEffectiveConfig 得到 config，并传给 lookupTranslations、runTranslationRequest、storeTranslations。Provider 只收到缺失 unit 的 id/text 与后台配置，不收到 `tf-subtitle:v1:` 元数据包装。结果按 id 合并，返回 translations/cacheHits/apiTranslated/missing。不返回译文的项不写缓存；pipeline 对缺失结果不会标 completed。

这与普通网页 lookup/translate/store 三条消息分别重读设置不同，但只保证**这一后台批次**的配置来源一致。后续批次可用新设置；Content 的 completed 集合没有配置身份。外部设置变化也没有通用字幕 pipeline 重置监听，见下节。共享 Provider 重试、合并与取消详见[请求协调](../modules/page-translation-cache.md#file-requests)及[HTTP 局部边界](../modules/page-translation-cache.md#partial-http)。

## 7. 返回界面、模式与 Preset

[renderer L17–129](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/subtitles/renderer.js#L17-L129)在播放器内挂 absolute host 和 open ShadowRoot，复用 UI token/select；所有字幕与选项文字都通过 textContent，而非模型 HTML。bilingual 显原文+译文，original 隐藏译文，off 隐藏扩展字幕并由 source 恢复原生层。字号15/18/22px，仅译文有效；非 bilingual 时字号控件 disabled。

必须区分显示模式与任务状态：[controller L65–77、L114–142](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/subtitles/controller.js#L65-L142)只在 mode !== "off" 时 ingest，所以 **original 仍会调用翻译链，可能产生 Provider 请求**。off 不调用 pipeline.stop，不清已有 timer/队列，也不取消在途请求。控件名“关闭”不能被文档扩大解释为所有费用/网络立即停止。

本控件的 setPreset 经 TEMP_PRESET_SET 更新 session Preset，清译文、stop 旧 pipeline、创建新 pipeline并强制刷新当前 source，因此当前 cue 可按新配置重译。refreshPreset 默认只更新展示；只有显式 retranslate:true 才重建。content.js storage 监听同步 mode/size，却未把一般 Provider/prompt/target/glossary 变化接成字幕重译。这些都是固定版本实现，不是本轮新增行为。

## 8. 视频切换、停止、错误与重试

- source 的视频变化清 MAIN 数据和去重签名，恢复原生层，重新绑定播放器/视频。
- pipeline 在 mediaId 改变时递增自身 generation，清 candidates/completed/pending/rolling/sequence 和 timers，并尝试 tasks.cancelTask。MAIN generation 与 pipeline generation 不是同一字段，也不跨消息直接传递。
- controller 在新 mediaId 时 clear renderer；消费译文还核对 unit.mediaId。离开支持路径时 stop source/pipeline，再 unmount。
- Provider 普通失败：失败 batch 放回队首，blockedByError 阻止立即死循环重发；新 ingest 或显式 flush 可解除。没有单独 Retry 按钮；相同 snapshot 被 emitter 去重时也可能没有新的 ingest。底层 HTTP 的有限 retry/backoff 与这里的重入不同。
- Provider 失败仍保留扩展原文，并展示“Translation unavailable — original captions remain visible”。MAIN 获取失败则走 fallback，完全无 cue 显示 Captions unavailable。[pipeline L243–361](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/subtitles/pipeline.js#L243-L361)

### 不能由局部 guard 推导出的保证

1. 后台 requestId 仅在 runTranslationRequest 内登记。config/cache lookup 前取消可能找不到请求，且后台字幕协调器没有取消 tombstone；Provider 返回后 store 阶段也没有单独取消检查。因此本地拒绝旧 UI 结果，不等于整批网络/缓存写入撤销。[request registry](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/translation-requests.js#L6-L57)
2. 同视频同代的旧 cue 译文返回时，controller 只核对 mediaId，不检查当前 cue id/时间；原文变化也不总清旧译文。completed 去重只保存 fingerprint，不保存可重放译文。同视频 seek/revisit/延迟响应的严格同步不能据此宣称通过。
3. MAIN captureContext 冻结 videoId/generation，但未冻结轨道 id；TIMEDTEXT 使用响应处理时的 state.track。连续切轨的迟到响应与同视频代内响应乱序仍需专项验证。
4. source 接受 READY/VIDEO_CHANGED 时没有“同视频 generation 只能增加”的独立比较。正常 MAIN 的 generation 单调，与对任意构造消息的完整防回放认证不是一回事。
5. 2MiB parser/protocol 限制在响应 clone 正文读取后检查，不是流式读取预算；cue 边界扫描、completed 集合的长视频增长和 observer 生命周期仍有性能核验空间。

这些是静态边界/待验证场景，不是已复现故障、攻击成功或新修复；不因此扩展本轮文档任务。

## 9. 测试证据及最小改动入口

[测试地图](../modules/youtube-subtitles.md#test-boundaries)列出7个测试文件。Node fixture 可检查 parser、协议、nudge、fallback、generation、rolling、缓存身份；E2E 用合成播放器和本地 mock Provider，覆盖 DOM/MAIN 传输、模式、Preset、缓存次数、视频切换和错误原文。它们不是当前真实 YouTube 网站、任意长片、所有切轨竞态或真实 Provider 的证据。本轮全部 **NOT_RUN**，不引用旧测试数量作为新验收。

推荐修改顺序：
- 获取不到字幕：installer → MAIN hooks/parser → source 仲裁；不能新增 signed URL 重放。
- 重复/错位/慢字幕：source active cue → pipeline 稳定/去重 → controller 返回时序，避免只改 renderer。
- 缓存错用：subtitle source identity + 单批 config + 共享 cache-db，必须分析兼容性。
- 模式、Preset 和取消：controller/source/pipeline/后台请求全过程一起核验；仅隐藏 DOM 不算取消。
- 修改 MAIN 文件需遵循架构中固定源码 hash 审核约束和适用回归，不以更新 hash 绕过检查。

