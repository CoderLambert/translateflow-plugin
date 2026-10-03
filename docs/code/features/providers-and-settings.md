# Provider 与设置：从保存到真实翻译

[首页](../README.md) · [运行时地图](../architecture.md) · [逐文件说明](../modules/providers-and-settings.md) · [网页请求与缓存](../modules/page-translation-cache.md)

源码固定为 `d5e308a709c008acf6b277d466d020f13025bdca`，2026-10-03 重读 main 确认未变。本章只做静态源码走读，安装、构建、测试、浏览器、真实 Provider 请求全部 **NOT_RUN**。这里的“测试连接”指产品中的按钮，不是本轮执行记录。


> 2026-10-03 增量说明：本章运行时固定源码在main 86ed596中的blob未变。共享浏览器测试基础设施已切为复制预构建的明确产物，不再隐式构建；默认构建与默认本地E2E选择不同，实际运行请先读[构建与测试链](build-test-release.md)。旧测试链接只说明固定版本断言，不作为当前产物PASS；本轮运行NOT_RUN。

## 1. 用户有三个不同动作

- Options 保存全局配置：写 `chrome.storage.local`；兼容 Provider 需要先申请 endpoint host permission。保存没有发送测试翻译，也没有证明模型可用。
- Options 测试默认 Provider：**先保存当前表单，再发 TEST_API**。错误不会回滚已保存配置；成功也只表示测试请求返回了可读取结果。
- Popup 选择 Preset：临时应用写 `storage.session`，保存到本站写 `siteProfiles` 并清该站点临时覆盖；有效 Preset 变化时另调用当前页翻译。这里选的是风格，Provider/Model 的覆盖在 Options。

[Options L84–107、L204–248](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/options.js#L84-L248)和[Popup Preset L61–101](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/popup/preset-ui.js#L61-L101)是最容易混淆的入口。测试消息不带 pageUrl，因此解析的是全局默认 Provider，不是当前网页的站点覆盖。

## 2. 完整调用链

1. Options 从 local storage 填表；保存规范化 Base URL、默认字段与缓存容量，再写全局配置。站点编辑器只写 provider/model/prompt/targetLanguage/preset/appearance 等覆盖值，不复制凭据。
2. Popup 以当前 tab URL 发 EFFECTIVE_CONTEXT，后台返回可展示的站点、模型、风格和外观摘要，不返回 API Key。
3. TEMP_PRESET_SET / SITE_PRESET_SAVE 经 router 调用 session/config，再返回新 context；Popup 更新文案与缓存状态，必要时 `runPageTranslation()`。
4. 网页 TRANSLATE_BATCH、字幕 SUBTITLE_TRANSLATE_BATCH 或显式 Selection AI 进入各自已有请求协调边界。后台 `getEffectiveConfig(pageUrl)` 组合本轮实际配置。
5. Provider registry 根据 provider id 分派 DeepSeek 或 OpenAI-compatible。普通翻译输出统一 `{id,text}[]`；显式 AI 走 `completeJson` 和业务结构验证；连接测试走 `test`。
6. adapter 构造请求、检查兼容 endpoint 权限、选择普通 JSON / SSE / 本地专用模型策略；shared 层处理 HTTP、错误和相应重试。最终结果交回请求协调器、缓存和原 UI，模型内容不在此当 HTML 执行。
7. 失败经 router `{ok:false,error,errorCode}` 返回；Options/Popup 用 textContent 和 error 样式展示。网页任务的进度、失败与取消复用已有 task，不由设置页另建网络队列。

[router L90–124、L193–207](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/router.js#L90-L207)；[共享 registry、DeepSeek、requestId/合并/取消](../modules/page-translation-cache.md)已完整解释，本章不重复计数。字幕的单批快照与页面的分消息读取见[字幕链](youtube-subtitles.md)和[网页链](page-translation.md)。

## 3. 配置优先级必须分字段看

[resolveTranslationConfig L48–106](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/provider-config.js#L48-L106)：

- Provider：匹配站点覆盖，否则全局，最后默认 DeepSeek。所选 Provider 决定从哪个全局字段拿 key、endpoint 和默认 model。
- Model / targetLanguage：站点非空覆盖优先；兼容 model 为空会在调用时 CONFIG 失败。站点没有自己的 API Key / Base URL / streaming。
- Prompt：本站非空显式 prompt 直接胜出，禁用有效 Preset，但保留 selectedPresetId 便于解释 UI；没有本站 prompt 时，用全局/default prompt 作底，再附加临时 Preset 或已保存 Preset。
- 临时 `none` 表示 active=true、presetId 空，覆盖已保存 Preset；`inherit` 删除临时条目。它以规范化 scheme+hostname 为键，忽略端口，跨同站标签页共享，不是单 tab 私有状态。
- Glossary 最后合成：启用的站点同 key 术语覆盖全局；key 含大小写敏感标记，敏感/不敏感两条可并存。停用站点条目不会屏蔽启用的全局同词条，因为停用项在合并前过滤。
- appearance 属于显示 context，不进入翻译 runtime config；UI 语言也不是翻译目标语言。不要把所有设置一起塞入 Provider body 或缓存身份。

空有效 glossary 保持原 prompt/旧身份；非空 glossary 同时提供确定性 identity 和 prompt 后缀。Preset 通过最终 prompt 影响缓存，而非另设一个独立 Preset 分区。API Key 与 streaming 开关不应被当作语义缓存维度；具体键计算复用[缓存模块](../modules/page-translation-cache.md)。

## 4. 保存、授权与持久化的边界

OpenAI Base URL 仅允许 http/https，去 query/hash/尾斜线，已是 `/chat/completions` 就不再追加；权限 pattern 是 scheme+hostname+`/*`，没有 path/port 隔离。Manifest 固定允许 DeepSeek，其他 http/https 主机需 optional 授权。[规范化 L21–46](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/provider-config.js#L21-L46)；[manifest](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/manifest.json#L7-L9)

兼容 adapter 每次实际调用前 `permissions.contains`；权限撤回产生 PERMISSION，不会在后台弹授权对话框。全局保存仅在默认 Provider 为 compatible 且 requestPermission=true 时请求；站点保存也会按编辑器当前 Base URL 请求，但**不会顺便保存全局 Base URL/model/key**。若表单 endpoint 尚未全局保存，获准的 endpoint 与运行读取的 endpoint 可能不同，需先核对两个保存动作；这是静态可推导边界，未作浏览器复现。

`saveSitePreset` 是 local 写入、session 清理、context 重读的顺序操作，没有跨存储事务；后一步失败不能称前一步回滚。Options 直接编辑 siteProfiles 不调用该清临时方法，所以已有临时 Preset 可继续压过新保存的站点 Preset。多页面读改写整个 profiles/glossary/session map 没有 CAS，不能保证并发编辑不丢更新。

API Key 只在配置存储/后台请求使用；password 输入的显示切换不是存储加密。Effective Context 省略 key，但不能据此称所有 storage/legacy 消息都完成了细粒度授权审计。Provider/设置消息没有复用词典生命周期专用 `assertOptionsSender`。

## 5. 两种传输和本地模型不是同一条重试路径

- DeepSeek：固定 endpoint，要求 key，非流式 JSON；详见[既有 adapter](../modules/page-translation-cache.md#file-deepseek)。
- generic compatible：可空 key，要求 model，默认非流式；开启 streaming 后 SSE 在后台聚合，进度只有字符/事件计数，不把 token 逐段写网页。必须收到 `[DONE]` 且非空内容，再解析最终翻译数组。
- SSE 请求返回 application/json 时兼容按 JSON 读取；只有特定 HTTP status 加“stream 不支持”文案才回退非流式，其他错误不会一概降级。
- 模型名含 hy-mt / translate-gemma 等约定子串时，进入本地专用模型策略，不是检测 endpoint 是否 localhost。按最多8段、约3200 JS字符分批串行；单个超长段不截断。此分支始终非流式，user-only prompt，优先 json_schema，明确拒绝结构输出时去掉 response_format 后重试。
- `completeJson` 为显式 AI 服务，generic 用 system+user，本地模型合并为 user；都非流式，先 json_object，结构能力拒绝后去掉该字段。业务 parseResult 不通过另算畸形响应重试。

普通 HTTP 的 shared 重试与解析重试嵌套，不存在“整个用户动作最多3次HTTP”的统一保证。SSE 本身没有普通 HTTP 的429/网络 backoff循环；外层只对 MALFORMED_RESPONSE 做解析重试，明确不支持才走非流式回退。详见[HTTP](../modules/providers-and-settings.md#file-http)、[SSE](../modules/providers-and-settings.md#file-sse)、[本地格式](../modules/providers-and-settings.md#file-local)。

## 6. 错误、取消和“连接成功”能证明什么

CONFIG / PERMISSION 要修配置或授权；AUTH 不自动重试；429/暂态/网络/超时在普通 HTTP 按 retry policy处理。服务商错误 detail 可进入 UI，但只用 textContent，不等于已脱敏：不得把包含私密内容的错误全文随意记录或公开。

普通 HTTP 的 linked timer 在 fetch 返回 Response 时就 cleanup，后面的 `response.text()` 不在该45秒/外部信号连接的完整保护范围内；SSE 的 cleanup 则在整次读取结束的 finally。SSE 仍把累计内容保存在内存，代码没有独立帧/总响应字节限额，45秒不等于内存配额。取消不能撤销远端已收到的文本或费用；连接测试不接 requestId/用户取消信号，关闭 Options 不能解释为测试已被后台取消。

两种 adapter 的 `test()` 都取首条 message.content.trim，缺失时回退字符串 `OK`，不严格断言模型回答恰好 OK，也不验证真实翻译 id 完整性、站点配置、流式能力、长文本、缓存或 DOM。成功测试不是真实 Provider 端到端翻译验收。

通用翻译 parser 过滤未知 id/非字符串 text，允许缺失/重复 id；本地 parser 则拒绝未知/重复/缺失 id并按输入次序输出。prompt 中“每 id 恰好一次”是要求，不能当作所有 adapter 已强制校验的事实。

## 7. 配置变化如何回到页面

Popup 显式调用翻译只比较旧/新有效 presetId；本站 prompt 覆盖时只解释“已记录但行为不变”。成功保存后翻译失败，会显示后续错误，配置仍已写入。按钮 finally 恢复可操作，不提供配置回滚。

Content 的 local storage listener 只在 auto/cacheRestore 已开时清理并重扫相关翻译配置；普通手动页面不因此统一自动重译。session 变化不会通过这个 local listener广播重译所有同站页面。术语保存提示“相关网页重新翻译”须按这层条件理解。[content L35–67](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/content.js#L35-L67)

解析规则一致不等于整个页面动作冻结了同一对象。网页 lookup/translate/store 分别解析，配置在网络期间改变的旧结果缓存归属风险仍未修复；字幕后台每批一次读取并复用，但不等于跨批冻结或取消可回滚。本轮只记录，不修改业务。

## 8. 阅读与修改入口

推荐顺序：Options/Popup局部入口 → provider-config → preset-session/config → glossary/presets → compatible/shared → SSE/local → 原请求/缓存章节。11个新增整文件正文见[模块章](../modules/providers-and-settings.md)，大入口、测试及页面合同仍按局部覆盖。

修改字段优先改纯配置解析与对应测试，再检查 Options保存、Popup context、Content失效和 cache identity；修改 endpoint/model协议需同时查权限、取消、错误与兼容 fallback；修改 Preset/glossary文案会改变最终 prompt，需核对缓存复用。真实验证需要 mock HTTP、权限拒绝/撤回、保存失败、测试失败后持久值、同站多tab临时覆盖、切回配置缓存复用及真实 Provider 有限验收。现有测试断言与缺口见[证据地图](../modules/providers-and-settings.md#test-boundaries)，全部 **NOT_RUN**。
