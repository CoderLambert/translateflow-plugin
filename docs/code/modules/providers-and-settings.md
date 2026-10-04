# Provider 与设置：逐文件说明

> 当前AI版本的index/DeepSeek/compatible/SSE已在[新章](assistant-stream.md#file-provider-index)全文复核。以下旧源码身份保留，SSE增加onTextDelta、adapter增加completeText；不要把旧“仅计数”应用于当前assistant文本流。未变config/shared/local等正文继续按blob身份复用。

[功能链](../features/providers-and-settings.md) · [首页](../README.md) · [已解释请求/缓存/DeepSeek](page-translation-cache.md)

全部源码固定 `d5e308a709c008acf6b277d466d020f13025bdca`；2026-10-03 复核。以下11个生产文件读过完整内容；大入口与测试仍标局部。无运行证据，所有测试/安装/构建/浏览器/真实服务验证 **NOT_RUN**。blob 供逐文件增量比较，不代表测试结果。

<a id="file-provider-config"></a>
## src/shared/provider-config.js：纯有效配置与站点覆盖

blob `e3da406d26fb881cafed340d0a6c124d2209a892`。[完整源码 L1–187](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/provider-config.js#L1-L187)

**职责/输入输出。** Options 使用规范化函数；background/config 使用 resolveTranslationConfig。输入全局config、可选pageUrl和临时覆盖，输出 provider/apiKey/apiBaseUrl/model/prompt/targetLanguage及解释风格来源的字段；无浏览器、存储、网络或可取消资源。

**实现。** normalizeProviderId 只接受两种id，未知抛错。normalizeOpenAIBaseUrl trim、去尾斜线，new URL限定http/https并删query/hash；buildChatCompletionsUrl保留已带/chat/completions的地址，否则追加；permission pattern只留scheme/hostname。resolver浅合并默认值，单独合并openAICompatible；getSiteProfile用normalizeOrigin找到并白名单化覆盖。先选provider拿其全局凭据，再应用站点model/语言。显式站点prompt禁用有效preset；无站点prompt时临时active优先站点preset，在全局/default prompt后compose。selectedPresetId与presetId有意区分“选了”与“生效”。

**其余导出。** normalizeSiteProfile只留下有效provider、非空model/prompt/targetLanguage、合法appearance/preset。updateSiteProfileAppearance/Preset克隆外层map和规范化profile，inherit/空删除字段，preset的none也删除；合法字段仍保留，空profile整项删除；未知显式值抛错。getSiteProfile非法URL返回null，但合法URL中的非法provider仍可抛错，不是所有损坏数据都静默默认。

**边界/修改影响。** URL规范化不是隐私清洗或本地服务证明；http被允许，代码也未主动剥除URL userinfo。站点键与权限pattern忽略port，endpoint本身保留port/path。新增Provider、字段或规范化规则需联动UI、权限、registry、cache身份/迁移；不能把API Key复制进siteProfile。provider-config测试覆盖继承、凭据选择、优先级、appearance排除与streaming默认，未覆盖所有畸形URL和并发写入；NOT_RUN。

<a id="file-config"></a>
## src/background/config.js：持久配置与安全展示摘要

blob `67f9fc3d846b04d0e539247b7a8e4cf5672d2b9f`。[完整源码 L1–156](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/config.js#L1-L156)

**调用与流程。** router、selection和字幕业务读取它。getConfig按CONFIG_KEYS取local，默认值合并后规范化openAI子对象、appearance、selection深度、siteProfiles和两类glossary。resolveBaseConfig每次先读local，再safeTemporaryPreset读session；空pageUrl或session异常视作无临时覆盖。getEffectiveConfig解析base后合并有效术语，空术语直接返回resolved，非空加glossaryIdentity并改prompt。getEffectiveGlossary只做术语解析。

**context合同。** getEffectiveContext要求有效pageUrl，返回origin/hostname/provider/model/语言、有效/选择/保存/临时preset、site-prompt标志、术语数与appearance及可选列表。它不返回API Key、完整prompt或endpoint；UI无须拿凭据展示。但storage自身仍有凭据，不是加密保险库。

**写入和生命周期。** saveSiteAppearance只改local并重读context；saveSitePreset先写local，再清session，最后重读。ensureConfigDefaults只写undefined的顶层缺省，不覆盖现有值；嵌套缺字段可在内存合并，并非逐项持久迁移。removeLegacyV1Cache读取local键并删abt-cache-v1:前缀，不删除当前IDB缓存。没有内存配置cache、监听或请求取消器，每次调用可能看到新值。

**失败/性能/测试。** local失败自然reject；只有临时读取失败被吞并降为inactive。多步写入无事务，后续失败不撤销已写值；每次context也读配置/术语，不能当固定翻译快照。纯resolver/glossary测试及E2E context间接覆盖；真实storage失败/并发/session清理未由本轮验证。改此文件要检查启动defaults、所有翻译/cache调用方、Popup、外观与Selection，不扩大旧缓存清理范围。

<a id="file-session"></a>
## src/background/preset-session.js：按站点的会话 Preset

blob `1571ee805b653b1c3421e246e8e1332c06af80d7`。[完整源码 L1–55](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/preset-session.js#L1-L55)

getTemporaryPresetOverride规范化origin，读session键temporaryPresetOverrides，hasOwn区分不存在与空字符串：前者active=false，后者active=true且无preset。set把空/inherit删除，none写空串，合法id写值，未知值抛错；map空则remove键，非空set，随后重新读取返回。clear只是set inherit。normalizeOverrides仅排除非对象/数组并浅克隆，不逐项清理未知origin/value；读取时id规范化。

后台router/config调用；输入URL/value，输出{active,presetId,origin}。session跨service-worker重建保留、浏览器会话结束清除，不是popup内存或tab级覆盖。无timer、网络、abort、主动页面广播。整个map读改写无并发保护，失败reject；clear不能撤销已保存local preset。现有resolver测试传入模拟override，并不等于真实session存储与跨tab生命周期验收。修改需同步Popup的inherit/none语义、config fallback和同站缓存行为；NOT_RUN。

<a id="file-presets"></a>
## src/shared/presets.js：风格数据与稳定组合

blob `f72382eb4277ef25be41d328940a475ecbfd0bdb`。[完整源码 L1–79](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/presets.js#L1-L79)

冻结四类定义technical/academic/news/natural及其instructions：技术保留标识符，学术保留确定性与引用，新闻中性归因，自然风格流畅但不添信息。私有Map查找；normalizePresetId trim+lowercase后白名单，否则空；isPresetId/getPreset/getPresetLabel分别返回布尔/对象或null/标签或空。

composePresetPrompt未知id直接String(prompt||"")，不trim；已知id trim底prompt后追加标题及各条规则，过滤空块，以换行拼接。无Provider/model/key、IO、可变会话状态或取消；Options/Popup/config共享同一定义。presets测试验证id、未知保持、确定性与先preset后glossary。改指令会改变最终prompt/cache分区；改id还影响持久值和UI选项，不能只改标签后宣称行为未变。NOT_RUN。

<a id="file-glossary"></a>
## src/shared/glossary.js：术语规范化、合并与身份

blob `48368af7d5bf45f359fd7ba415cdcfa289e557a6`。[完整源码 L1–135](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/glossary.js#L1-L135)

normalizeGlossaryEntry trim source/target，空项null；id默认source，caseSensitive布尔，enabled仅显式false停用。normalizeGlossary用“敏感位:原词或小写词”作Map key，后项胜出，再按key/target稳定排序。全局store兼容旧数组，统一version；站点store接受versioned sites或无version旧map，忽略非法origin和空列表。这里只规范形状，没有未知版本拒绝机制。

upsert删除同id或同effective key旧项再加入，非法新条目抛错；remove按id过滤再规范化。resolveEffectiveGlossary先过滤启用项，合并全局和匹配站点，因此停用站点词不遮蔽全局；非法pageUrl只用全局。compose用JSON.stringify表示词对，追加规则，并非在本地对正文执行字符串替换；全部有效术语均进入prompt，不按本段出现与否过滤。identity只含排序后的source/target/caseSensitive，排除id、停用项；空术语原prompt不变。

这是纯函数，数据由Options/config持有；没有网络、持久副作用或abort，反复规范化/排序随术语数增长，未设总词数/字符硬限。JSON转义防止破坏字符串表示，不证明能消除LLM指令干扰；用户术语可能被发给Provider。glossary测试覆盖旧格式、去重、站点覆盖、敏感性与identity稳定。修改key/排序/组合需评估缓存兼容、词典gateway和编辑器迁移；NOT_RUN。

<a id="file-glossary-ui"></a>
## src/options/glossary-ui.js：术语编辑器的读改写

blob `43ac502cb583a98126cc70facba2ff00a71b9b15`。[完整源码 L1–227](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/glossary-ui.js#L1-L227)

initializeGlossaryUi由Options传setStatus；任一必需DOM缺失则不初始化。闭包editing仅保存id/scope/origin，新增用UUID。saveEntry禁用保存，规范化新词，读取并规范化两种store；跨站点移动删旧origin条目，global→site删全局，site→global删旧站点。一个local.set同时写两种store后清编辑器、刷新列表、提示成功；finally恢复按钮。无Provider调用，后续页面响应交Content listener。

refresh先loading，读后构建全局/站点rows，空则中性文本；createRow用textContent构造来源、词对和启停状态，编辑回填并focus。toggle/delete走mutateItem再读当前store；删除正在编辑的id清editor。actionButton包装异步错误到status；scope切换只控制origin输入是否可编辑。监听随Options文档销毁，没有单独dispose/abort或跨窗口storage刷新监听。

保存异常给错误；删除/启停不是事务回滚，写成功后refresh自身捕获读取错误也可继续显示动作成功。按钮并非所有动作全局互斥；多窗口读改写无锁。textContent避免词条HTML执行，但术语明文存local，后续合成prompt有网络隐私影响。glossary纯函数与mock E2E覆盖数据规则/实际翻译行为，不覆盖整个编辑器手势、并发和失败矩阵。改此处联动shared store、Content变化通知和Options DOM；NOT_RUN。

<a id="file-preset-ui"></a>
## src/popup/preset-ui.js：有效上下文与两种应用动作

blob `697e67062e3ead421d3901d9625356af7b30b842`。[完整源码 L1–181](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/popup/preset-ui.js#L1-L181)

initialize接getActiveSite/translateCurrentPage/refreshCacheStatus/setStatus，缺DOM返回no-op refresh/setDisabled。创建inherit、none与四Preset选项。refresh取当前tab URL发EFFECTIVE_CONTEXT，成功显示卡片，失败隐藏并更新hint。renderContext用textContent显示站点/provider/model；site prompt显示Custom Prompt；选项优先临时(active空用none)、saved、inherit。describeContext解释被覆盖、会话期限和术语数。

applyPreset禁用三控件，先readContext，再按persist发SITE_PRESET_SAVE或TEMP_PRESET_SET；收到成功更新context、刷新cache status；前后有效presetId变化才调用translateCurrentPage。site prompt覆盖时只提示不重译。readContext的ok=false返回null，因而可能把后续值视为变化；传输异常走catch。finally恢复控件，无本地generation或AbortController，关闭Popup不代表取消后台保存/翻译。

状态归后台storage，Popup只显示快照；不展示API Key、不直接HTTP。多await期间活跃tab与runPageTranslation重新选择目标的竞态未被本轮运行验证。仅比较presetId，不是比较完整config fingerprint；成功保存后翻译失败不能说保存失败或已回滚。现有E2E通过消息/storage设置验证preset效果，未独立覆盖所有按钮/会话边界。修改需联动router/config、Popup任务busy与当前tab策略；NOT_RUN。

<a id="file-http"></a>
## src/background/providers/shared.js：普通 HTTP、解析与可取消等待

blob `22ed2a65b5d1dc367a916a4c0d9770131d7331e1`。[完整源码 L1–313](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/providers/shared.js#L1-L313)

ProviderRequestError携带code/status/retryAfterMs/cause。buildTranslationPrompt先选config/fallback并trim；若含内置固定英文目标句替换成实际target，否则已包含目标语言字符串就不重复追加，最后加Target language。它是文本启发式，不是语言语义解析。

requestChatCompletions校验必须key，创建JSON headers，有token才加Bearer；循环performRequest，按既有retry-policy分类/上限/Retry-After等待，外部abort或CANCELLED立即终止。performRequest预abort不fetch；新controller链接外部signal+timeout，POST JSON；fetch异常区分取消/超时/网络。注意finally紧随fetch，清timer/外部listener后才response.text，所以不覆盖整个body读取。JSON解析失败按成功状态给MALFORMED_RESPONSE，否则HTTP_ERROR；JSON错误响应401/403 AUTH、429 RATE_LIMIT，其余HTTP_ERROR并取retry-after。

requestParsedTranslation另循环request+parseResult，只重试MALFORMED_RESPONSE，默认两轮。通用parseTranslationResult要求content和translations数组，过滤不在输入集合的id/非字符串text，再trim；不保证全覆盖/唯一。parseJsonObject先去代码围栏，失败再截首{至末}尝试，不执行文本。

requestParsedJson优先message.parsed否则content，拒绝缺失/空，字符串经同一JSON解析；调用业务parseResult，普通验证异常包成MALFORMED_RESPONSE，已有ProviderRequestError原样保留，再走畸形预算。该默认解析器本身不保证对象形状，业务validator负责。normalizeProviderError保留typed错误、把AbortError转CANCELLED，其他未知异常转NETWORK；sleep使用timer和abort listener，结束/取消均清理。

无存储或页面状态；调用方持有config/body，单次请求有controller/timer，重试保留敏感payload在内存。普通HTTP重试与解析重试可叠加，不是总共三次。response/error正文无独立大小上限，服务detail可能含敏感信息，不应当日志脱敏器。provider-retry、structured-json、providers测试分别覆盖429/401/预abort、业务schema两次、语言prompt；正文超时、完整费用上界未证实。修改需联动两个adapter、SSE错误类、retry-policy和gateway；NOT_RUN。

<a id="file-compatible"></a>
## src/background/providers/openai-compatible.js：兼容服务策略分派

blob `db2c7f7fdc58247fa8289096fe31245351269010`。[完整源码 L1–277](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/providers/openai-compatible.js#L1-L277)

冻结对象提供translateBatch/completeJson/test。空segments直接[]，否则先assertEndpointPermission再requireModel；前者只contains现有授权，不request，缺URL CONFIG、缺权限PERMISSION；后者trim空model CONFIG。所有HTTP都允许无key。

generic翻译将{id,text}字符串化置入user JSON，system用buildTranslationPrompt，temperature .2；非流式走shared请求，streaming走SSE。SSE仅isUnsupportedStreamingError命中后通知streaming-fallback并非流式重发；外层requestParsedTranslation负责最终数组与畸形重试。不会将进度片段作为最终翻译返回。

本地专用模型按splitLocalTranslationBatches串行，每批前检查abort；使用local request body/schema和严格parser。structuredOutputSupported只在这次调用中记忆，拒绝结构输出一次后余批不用schema；下一次用户请求重新尝试。无跨服务能力缓存或并行小批。

completeJson独立非流式，local model合并prompt和Input JSON进user，generic system+user；优先json_object，命中特定拒绝错误后退到无response_format，再交requestParsedJson和业务parseResult。test同样检查权限/model，local用user-only“Reply with exactly: OK”，generic另带Connection test；temperature0，返回trim内容或OK，不验证翻译合同也不测试streaming。test没有signal入口。

状态全在调用闭包，配置不在adapter读取storage；endpoint授权不是语义验收，模型名启发式也不是本机证明。错误原样交router，取消不能撤回远端数据。local/sse测试以fetch/permissions stub证明分派与fallback，真实第三方协议未运行。改策略须复核cache endpoint身份、结构validator、重试费用和设置保存/撤权路径；NOT_RUN。

<a id="file-sse"></a>
## src/background/providers/openai-sse.js：后台聚合完整事件流

blob `838aa21d5aa52000495b65a3d4afe1db478afcd8`。[完整源码 L1–278](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/providers/openai-sse.js#L1-L278)

requestChatCompletionsStream校验key/预abort，加Accept:text/event-stream并强制body.stream=true。linked signal贯穿fetch及整个读取的try/finally；非2xx先读取错误正文构造typed错误，2xx application/json直接JSON.parse兼容，不要求[DONE]。其余交reader；无getReader时把response.text作为一个chunk消费。

TextDecoder流式解UTF-8；state拥有buffer/dataLines/content/eventCount/done。按LF拆行，去尾CR，忽略冒号注释和非data字段，空行dispatch；多data行用换行连接。data为[DONE]置done，否则JSON.parse并取choices[0].delta.content追加；event.error转HTTP_ERROR。notify只给冻结计数事件，吞observer异常。finish要求DONE和非空累计内容，提前EOF是MALFORMED_RESPONSE；没有末尾空行的未dispatch事件不能当已完成。结果包装为普通choices.message.content，仍需上层translation parser。

reader循环在新块后查外部abort，state.push/finish也检查；done时finally尝试reader.cancel。异常时只有state.done才显式cancel，代码并未对所有parse错误都cancel reader/releaseLock。linked finally清timeout/外部listener；未知异常分外部取消、timeout、NETWORK；已有typed错误保留。没有自身429/网络backoff循环，不能套用普通shared请求“三次”的概括。

isUnsupportedStreamingError要求HTTP_ERROR、400/404/405/415/422/501和stream相关拒绝文案，避免把invalid model也吞成fallback。buildHttpError从JSON或raw取detail，映射AUTH/RATE_LIMIT并读Retry-After；只负责信息，不实施重试。buffer/content无硬大小限，慢流有时间限制但不等于内存配额。SSE测试覆盖分块/多事件、畸形/EOF、response后abort、JSON兼容、fallback/local非流式；未证明恶意大流/所有资源释放。修改需联动compatible、HTTP typed错误、gateway进度合同；NOT_RUN。

<a id="file-local"></a>
## src/background/providers/local-translation.js：专用模型请求与严格 id 合同

blob `b9801db660ed8f8dc78d74c65b61354fcc5f9555`。[完整源码 L1–230](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/providers/local-translation.js#L1-L230)

isLocalTranslationModel只看lowercase模型名包含hy-mt/hy_mt/hy.mt/translate-gemma/translate_gemma/translategemma；不探测HTTP服务。split规范化id/text，当前批非空且即将超8项或3200 text.length就切批，单长段保留；这是近似JS字符，非token、UTF8字节或严格单段上限。

encode/decode在⟦TF:n:S/E⟧与[[TF_n_S/E]]之间替换。buildLocalTranslationRequestBody把prompt中的marker模板也转换；全部指令、marker约束、输入JSON放单user消息，非流式/.2温度。可选strict json_schema只允许translations对象，properties/required以输入ids生成，拒绝额外字段；这只是对服务的要求，parser仍独立检查。

parseLocalTranslationResult优先message.parsed，字符串去围栏或截最早{/[到末对应括号尝试JSON。接受直接数组、translations数组/map、segments数组/map；map值可字符串或.text。以expectedSet校验未知id、Map检查重复、要求text字符串并trim/decode，最后拒绝missing，按输入顺序输出。空字符串译文允许；重复输入id不是这里独立校验项。错误统一MALFORMED_RESPONSE，交外层畸形预算重试。

isUnsupportedStructuredOutputError要求HTTP_ERROR、400/404/415/422，文案匹配response_format/schema/structured或unsupported等；比SSE classifier宽，不证明服务永久无此能力。纯构造/解析，无网络/存储/abort，调用方逐批负责signal。local测试覆盖检测、切批、marker回环、user-only schema、多格式、id拒绝和schema降级；超长单段/真实模型质量未运行。修改需同步marker安全重建、adapter/local测试和cache prompt身份；NOT_RUN。

<a id="partial-entry-router"></a>
## Options / Popup / router / constants：本轮局部边界

- [options.js L84–173、L204–248](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/options.js#L84-L248)：保存/测试/站点写入。saveGlobalConfig先规范化Base URL和20–2048MB容量，即使当前DeepSeek，非法兼容URL仍可能使保存失败；请求权限后才local.set。test先保存再发TEST_API，无回滚。站点保存只写profiles，权限却取表单endpoint，不顺带保存全局endpoint；也不清session临时Preset。导入、缓存、导航、i18n等不在本轮完整解释范围。
- [popup.js L36–41、L99–190](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/popup.js#L36-L190)：把Preset UI接到当前tab、runPageTranslation与status；settings按钮openOptionsPage；网页任务轮询和取消已有网页章，其他模式/权限UI仍局部。
- [router.js L73–124、L193–207](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/router.js#L73-L207)：TEST_API解析message.pageUrl或空，调用testProvider；context/temp/save消息委派对应后台方法，统一成功/错误envelope。不同消息族权限不同；本段没有词典专用assertOptionsSender。未完整覆盖Reading/词典路由。
- [constants.js L1–34](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/constants.js#L1-L34)：默认DeepSeek/deepseek-flash、目标Simplified Chinese、兼容空key/url/model与streaming false、glossary version1及相关消息。CONTENT_SCRIPT_FILES和其他合同不在本轮重新计完整。

Content storage反应、Manifest与url函数复用已有启动/网页章，不重复增加完整记录；Options/Popup HTML/CSS本轮不推定整文件已讲解。

<a id="test-boundaries"></a>
## 测试证据地图：全部 NOT_RUN

以下读取源码断言，仍只按依赖局部覆盖，不计测试文件完整。没有安装依赖、执行仓库脚本或使用真实key。

- [provider-config](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/provider-config.test.mjs)：纯函数测试endpoint拼接/host忽略port、两类凭据、站点继承、临时none、site prompt胜出、保留其它profile字段、appearance排除、streaming默认。没有真实permissions请求。
- [presets](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/presets.test.mjs)与[glossary](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/glossary.test.mjs)：稳定id、组合顺序、旧store、去重、站点覆盖和identity；不测storage并发。
- [local-translation](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/local-translation.test.mjs)：纯解析+stub fetch/permissions，schema拒绝后两请求且第二次无response_format，非真实本地模型测试。
- [openai-sse](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/openai-sse.test.mjs)：合成ReadableStream、分片、多事件、EOF/畸形、response后abort、JSON兼容、stream拒绝fallback及local忽略开关；stub不会验证真实浏览器权限/代理缓冲。
- [provider-structured-json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/provider-structured-json.test.mjs)：模拟request第一次缺业务字段第二次成功，及两次均不合法停止；不接真实Selection UI。
- [provider-retry](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/provider-retry.test.mjs)、[providers](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/providers.test.mjs)：429后恢复、401不重试、预abort无fetch与目标语言prompt。既有证据详见网页章。
- [E2E context L306–312](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/translateflow.spec.mjs#L306-L312)：harness直接setStorage/sendMessage验证context。并非Options保存/授权完整手势。
- [E2E glossary/preset L622–649](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/translateflow.spec.mjs#L622-L649)：mock翻译随preset/术语变化，切回technical复用旧缓存，API调用保持两次。不能据此证明网络中途换配置、session多tab、权限拒绝/撤回或真实翻译质量。

建议后续实现/验收时补：设置保存与测试失败后真实持久值、local/session跨存储失败、临时override压过Options保存、SSE畸形后资源释放和大小上限、普通body阶段超时/取消、整条重试HTTP次数。这里是静态边界/建议，未宣称已复现缺陷、测试失败或本轮修复。
