# AI 流与历史后续：逐文件及证据

[完整用户链](../features/assistant-stream.md) · [首页](../README.md) · [Provider前章](providers-and-settings.md) · [Reading前章](reading-records.md)

31份全文解释绑定main `a4dab127c95f4f1d3b37375fc5a7b1b5241419f9`，2026-10-04复核。既有章节旧身份保留但相应当前说明以下文为准。运行/构建/业务测试/浏览器 **NOT_RUN**；243/244归档PASS不因此抹掉，亦不证明所有取消/路由时序。

<a id="file-controller"></a>
## src/content/selection/controller.js：选择、普通查询和 assistant 会话所有者

[完整源码 L1–L384](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/content/selection/controller.js#L1-L384)；blob `010f4d20be0a50794da90aa7c2a9e09bc49df256`。

start 幂等注册 mouseup/keyup/selectionchange 的90ms刷新、外点/Escape关闭、scroll/resize定位、focus/visible政策重读以及源投影/路由/pagehide失效。refreshSelectionUi 保留同文字、同range、同页面的活动 snapshot，仅更新位置；新选择取消 task、assistant、rich、Reading ctx，增加 requestVersion 后显示 chip。没有有效新选区但已有卡时不立即销毁原卡。

translateSnapshot 冻结 source，取消旧非终态 task 后复验，创建 task 和 Reading ctx；SELECTION_RESOLVE 返回 local 则建本地主卡，translation 委托 translation-query，no-hit 则给中性空态/普通翻译/AI，其他路由显示错误。可展示本地/no-hit与迟到 rich 分别交 records.accept；普通翻译调用共享回调。捕获 SelectionSupersededError 静默退出，其他错误进入 task失败和当前卡重试。copyAction 是明确剪贴板操作，失败 toast，不自动复制。

explainSnapshot 只允许 understand/analyze/usage，复用当前 capture/ctx 或创建 assistant ctx/operation；取消普通在途任务并 abandon 旧 assistant，再建独立 Port state。请求含冻结 selectedText、清洗上下文入口、depth、ownerToken及新根图 ID。handleAssistantMessage 先验证 state/page/version/protocol/request；delta按序累计，complete 校验 completed/answer/text/provenance 后先显示再 records.accept，持久状态另由 Reading 回调呈现。

stop 仅置 stopping 并发 cancel，等待确认；abandon terminal+断口+discard；interrupt 保留 partial 且用新的 explainSnapshot重试。assistantLive依赖本地代数，不是后台交易锁。dismiss 清活动数据、watchPage、status、UI，常驻监听保留。相关测试见下文 stream/UI，未运行；修改须同时验证三个动作、换选择/源mutation/导航、普通查询与独立保存，不把旧 task.cancel 当作新 Port 取消。

<a id="file-popover"></a>
## src/content/selection/popover.js：展示容器、动作接线与位置

[完整源码 L1–L416](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/content/selection/popover.js#L1-L416)；blob `17491aba559bca3aea6b5719fec67d61204683b0`。

模块依赖 uiHost/primitives、selection、ai-detail、empty-state、result-renderer；ensureUi惰性创建chip与非modal dialog、来源/status/result、复制/AI/重试/取消/关闭按钮，挂到统一Selection layer并隔离页面交互。handler和activeSnapshot是本模块状态，没有Provider、Port或数据库。

showChip/showLoading/showResult/showError/showEmpty 切面板/结果/按钮，必要时重置子view并closeAll rich资源。结构化卡去除重复词头来源行（NFKC/空白/lowercase），有解释callback时补三个AI choices；无命中同时保留普通翻译。appendRich卡/详情只在可见面板追加，不替换AI网络state。

streaming/stopping/interrupted方法确保result区显示，隐藏旧AI/取消入口，把模型字符串交ai-detail；success更新copyHandler，隐藏AI按钮，保存状态由独立record-status处理。旧loading/error/cancelled API仍导出，不证明controller都使用。位置基于刷新range矩形、viewport边界和requestAnimationFrame；无空间上移或贴margin，不自行重选源。showLoading清页面selection并下一帧聚焦关闭按钮，hide销毁节点/handler/snapshot与子view并回收rich资源。修改须联动controller、empty-state、ai-detail、result-renderer和窄屏/focus；不是把模型HTML插入网页的入口。

<a id="file-ai-detail"></a>
## src/content/selection/ai-detail.js：三入口与部分回答的纯 UI

[完整源码 L1–L177](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/content/selection/ai-detail.js#L1-L177)；blob `586dc5b0299664f9a2e940dc2f968cd5b6b856d1`。

create必须有container，闭包只持一个section node；ensure可在node失联后重建，reset移除。choices生成understand/analyze/usage三按钮和原event；loading、streaming、stopping、interrupted、success、error、cancelled统一进入render。stopping不给onCancel，保留answer并提示等确认；interrupted保留answer并提供retry；success仅generatedMeaning/explanation加AI辅助徽标，不显示停止。

每次render replaceChildren并设置data-state、aria-busy、aria-live，纯textContent写状态/答案；按钮callback传递可信点击event供上层Reading intent判断（取消callback不带event）。变化后onResize触发popover定位。无持久化、网络或abort能力，文案“未保存”取决于上层语义，并非此view查询数据库所得。修改输出类型/状态时同步popover、controller、UI契约/E2E；旧success兼容generatedMeaning仍保留。

<a id="file-record-client"></a>
## src/content/selection/record-client.js：Reading intent、draft、队列与 ACK

[完整源码 L1–L296](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/content/selection/record-client.js#L1-L296)；blob `e1fee45ef5a5427a0d192d6965ca2983ea68d19e`。

send先严格校验v2请求，再校验content scope响应；运输失败归INTERRUPTED，错误只传稳定code。create持current/declined/invalidation Port/lastSaved/referenceGeneration；live要求同ctx、未closed和source仍current。policy等capture.ready→REGISTER_DOCUMENT→并行state/site读取并视站点连接只读通知；ctx.policyPromise决定auto，失败进入可恢复或blocked状态。

start通过record-access建立可信intent，前ctx close成为previousDone；assistant另建同source的purpose=assistant operation。discard取消本地intent、等preparing迟到token、若有token发CANCEL，再forget；错误吞掉只表示不能将不完整turn提升为draft，不保证已存数据撤销。prepare串行/coalesce同operation，重查live/policy，按sameProvenLocation和page summary复用旧ref，BEGIN用collector ready source与safety，service才决定native URL/title；迟到token即使卡已关也保留供取消。

accept最多八个不同key，先通过共享artifact严格校验、冻结UUID/时间/正文，再串入ctx.queue；未启用显示invite/manual/disabled，不暗开记录。flush逐draft准备token、绑定record/sourceSnapshot，assistant用APPEND，其它用SAVE；匹配artifactId/recordId的ACK后标saved并更新revision/ref。错误STORAGE/QUOTA/INTERRUPTED允许重试同保存，不重发Provider；其余blocked。普通auto、首次回卡manual和重试是不同分支。

refresh重读政策和可选record摘要；代数/站点变化revoke，viewed-only revision可前移但仍要求位置证据，不凭unsupported anchor获得追加权。invalidateReference只撤可复用引用。可信save首次manual替换旧intent，retry只flush；close立即关闭ctx/清draft，取消所有intent，等token与真正CANCEL ACK，committed保留更高revision，未确认错误不改新卡。最后无current才断invalidation Port。open/decline要求trusted；open只打开固定学习中心。改此文件联动record-access、shared DTO和后台receipt，不能把AI请求重试与存储重试合并。

<a id="file-stream"></a>
## src/background/selection/assistant-stream.js：一个 Port、一轮生成、两种完成合同

[完整源码 L1–L126](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/background/selection/assistant-stream.js#L1-L126)；blob `a2035d08003605612d5496fbae94ea9f4458bc4d`。

handle仅消费固定name；senderScope先分content/history，active Set最多32。state持sender scope/tab、ctl/id/started/closed、sequence/chars；disconnect置closed、abort、移除。cancel须匹配id，只abort；第一次有效start才创建ctl和run，重复/非法start发BAD_REQUEST。abortSelectionAssistantStreams按tab或全部遍历，后台index在导航/撤权等调用；尚未start的state没有ctl或独立TTL。

run的content支路重新resolve选文/上下文/候选，构造根或有限follow-up turn；history支路由service.prepare派生可信来源/历史/turn，并持historySession等待提交/清理。准备后查signal→getEffectiveConfig→started→固定system+JSON prompt→completeText回调emitDelta。Provider返回后查signal；unary一次发全文delta；最终非空且≤24000才组completed turn，await readingTranslationResult并改promptVersion为selection-assistant-v1。Content回complete(readingResult)由UI后续保存；history先commit带完整artifact再complete(saved)，成功置session=null。

emitDelta拒空/单片>2048/累积>24000时只abort返回；正常更新计数和sequence。post不向closed端发，发送异常abort。catch回interrupted(code/partialChars)，finally尽力cancel尚在session并移除active。没有cache lookup/store、重连续流、idle清理或把signal接进IDB。provenance之后无cancel检查、null safeReturnUrl配置路由、unary单片与JSON无delta等限制见[功能章](../features/assistant-stream.md#boundaries)。

validStart的history要求精确字段、UUID recordId、正revision、bounded ids、follow-up问题；content要求原生pageUrl一致、text≤2000、documentId或ownerToken形状及validTurn。content history是调用方有界输入；与真正history repository-grounding不可混称。root parent=null，follow-up必须parent且无regeneration，有限history≤6；该形状校验不是持久图授权。相关7个Node场景和两种E2E在本章逐项解释；所有运行NOT_RUN。

<a id="file-grounding"></a>
## src/background/selection/assistant-grounding.js：从已保存图派生新 turn

[完整源码 L1–L50](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/background/selection/assistant-grounding.js#L1-L50)；blob `e918a41f9953940d115d632fc414fab3045fce0e`。

导出冻结的三个中文根问题和groundLearningAssistant。输入真实detail、record/revision/source/target/historyAction及可注入randomId；先validateRecordDetail，再校验目标记录/revision、completed target与存在的snapshot。返回只含sourceSnapshotId、history、question、派生turn，不访问chrome、HTTP、storage或当前网页。

follow-up规范化问题，parent=target，沿parent链倒序收最多六个问答，继承thread/branch；不会跨regenerationOf去吸入旧支追问。regenerate仅目标parent=null且action是根动作，复用根问题/action/thread，parent=null，regenerationOf=目标，创建未使用branch。两种均新建未使用turn。unique最多八次重试，返回120字符规则内id，否则CAPACITY。完整图已先做同source/thread/时间/branch/无环验证，遍历不靠caller图信息。

没有修改旧artifact或迁移追问；不负责原生sender/同意、配置来源或commit取消。修改问题会影响实际prompt，应联动UI文案、provenance版本和grounding/record tests。测试用合成root+follow、确定性ID，覆盖派生和非法目标，非真实浏览器。

<a id="file-reading-result"></a>
## src/background/selection/reading-result.js：有界来源元数据，不是缓存保存

[完整源码 L1–L9](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/background/selection/reading-result.js#L1-L9)；blob `44495bce13f84a47ee0512f31af88b276664eef1`。

readingTranslationResult(pageUrl,config)把同次有效config交getCacheContext取configHash，返回targetLanguage与provider/model、translation-prompt-v1、fingerprint；assistant-stream再覆盖promptVersion为selection-assistant-v1。调用者含普通翻译/旧解释/新assistant；不重新读取配置，不包含key/endpoint/prompt，不写Reading或cache条目。

getCacheContext先规范化URL再hash，因而空pageUrl会reject；它不是与URL无关的纯config fingerprint API。history null回跳问题发生在Provider之后调用这里，不能把这个异常解释成网络前拒绝。无独立资源或cancel；修改身份应联动cache contract和Reading provenance，不以新造假URL绕过来源判断。

<a id="file-provider-index"></a>
## src/background/providers/index.js：共享适配器路由

[完整源码 L1–L35](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/background/providers/index.js#L1-L35)；blob `18073b7b5b21f3db64039dc9eb7c5154f96e340e`。

固定Map仅DeepSeek与OpenAI-compatible。getProvider规范化config.provider，缺省DeepSeek，未知抛错。translateBatch/testProvider直接委派；completeJson先检查方法存在，completeText直接委派。只接收config/options，不读取storage、不持cache/queue/abort，取消信号由调用者透传。

网页批译、旧结构化解释、新纯文本assistant共用这个选择点，但请求与解析合同各自不同；completeText不因此获得旧explanation缓存或JSON校验。改Provider能力须同时核对配置解析、adapter、对应消费者/测试；不在Content添加Provider分支。

<a id="file-deepseek"></a>
## src/background/providers/deepseek.js：固定 endpoint 的 unary adapter

[完整源码 L1–L99](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/background/providers/deepseek.js#L1-L99)；blob `4cf2f6ef428b2192e3f46db914c77661fa2e2d4d`。

导出冻结deepSeekProvider。translateBatch空输入直接[]，把segments转字符串id/text，system用buildTranslationPrompt，用户JSON；completeJson用调用方system/payload并走requestParsedJson/parseResult。两者要求key，固定API_URL、model缺省deepseek-flash、thinking disabled、stream:false，分别.2/.1温度；畸形结果可走共享解析预算。

新增completeText只把systemPrompt/prompt变成两条消息，.2、非流式，经requestChatCompletions取choices[0].message.content，返回{text,mode:"unary"}；不走translation或structured parser，空输出由assistant上层拒绝。test发固定OK提示，返回trim内容或OK，不证明真实翻译或历史保存。

adapter无持久状态/缓存，signal透传普通HTTP；该请求的headers后取消/timeout范围见既有shared说明。固定endpoint不需要兼容端点permission分支；未读取真实凭据或执行服务。改model/请求字段影响所有使用者，须分批译、JSON、text三合同验证。

<a id="file-compatible"></a>
## src/background/providers/openai-compatible.js：text 与批译/结构化完成分域

[完整源码 L1–L292](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/background/providers/openai-compatible.js#L1-L292)；blob `0704804444f8fcf486229820a68baafc1822b177`。

translateBatch先空输入短路，否则assertEndpointPermission、requireModel；local模型交splitLocalTranslationBatches，generic交translateGenericBatch。generic构造JSON segments和buildTranslationPrompt，streaming开关决定SSE或普通HTTP，最终requestParsedTranslation。local串行有界batch，逐批查signal，用专用user-only/schema请求；仅识别不支持structured错误后在本次调用降级，解析仍校验id。completeJson同样支持local模型消息形状、structuredOutputSupported状态和受限fallback，并由requestParsedJson校验。

completeText是独立短路径：先permission/model，再固定两条调用方字符串消息、temperature=.2；streaming开时requestChatCompletionsStream(onTextDelta=onDelta)，返回mode=stream；只有isUnsupportedStreamingError才fall through到stream:false普通HTTP并返回unary。没有local模型专用分支、response_format、translation parser或自动补目标语言。application/json兼容仍标stream，不由此产生delta。

test可按local模型改为单user，固定OK/temperature0，不用stream。assertEndpointPermission只检查contains，不申请授权；无有效Base URL为CONFIG、未授权PERMISSION、空model CONFIG。所有外部HTTP经shared/SSE，key可空，失败由调用者处理，未保存配置或答案。修改需联动SSE、local parser、Provider配置/权限和两个assistant UI的模式/partial合同；不把普通翻译进度事件等同文本delta。

<a id="file-sse"></a>
## src/background/providers/openai-sse.js：SSE 解码、真实文本回调与失败边界

[完整源码 L1–L288](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/background/providers/openai-sse.js#L1-L288)；blob `2c2af5a696b70bf8be944a448c5d11eaac97d3d9`。

requestChatCompletionsStream校验必需key与预abort，构造JSON/Accept headers，强制body.stream=true；linked controller把外部abort与最少1秒timeout连接，try/finally覆盖fetch、读取和清理。非2xx读取正文、解析typed HTTP错误（401/403 AUTH、429 RATE_LIMIT、其它HTTP_ERROR与Retry-After）；2xx application/json直接JSON.parse；其余读取body reader或整response.text fallback。

reader用TextDecoder流式UTF-8；state持buffer/dataLines/content/count/done。按LF分行、去CR，忽略注释/非data字段，空行dispatch多data，JSON choices[0].delta.content累积；同时notify冻结进度与notifyText真实文本，listener异常吞掉。只有[DONE]结束，finish检查signal、DONE及非空；提前EOF或未dispatch尾事件不是成功，event.error也报错。返回普通choices.message.content供adapter。

reader在DONE时尝试cancel，未对所有parse错误显式cancel/releaseLock；buffer/content本层无大小硬限，上层delta限制不能代替这里全部内存限额。typed错误原样保留，其它按外部abort/timeout/NETWORK区分。isUnsupportedStreamingError只接受特定HTTP状态和stream拒绝文案，无自身网络/429退避。JSON支路没有notifyText，[DONE]只属于SSE支路。修改需覆盖分片Unicode、事件边界、EOF、abort/timeout与text/UI聚合，旧SSE测试按历史说明，本轮未重跑。

<a id="file-history-client"></a>
## src/learning-center/client/assistant.ts：薄 Port 客户端

[完整源码 L1–L25](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/learning-center/client/assistant.ts#L1-L25)；blob `0937e0223d6644f957404ab1c19cabc0300fef79`。

定义AssistantTarget和事件TypeScript联合类型；openAssistant生成history-requestId并connect固定Port，监听仅过滤object/protocolVersion/requestId，然后把断言后的对象交onEvent。类型声明不是运行时DTO校验，不能声称此客户端严格验证complete所有字段。

start把target铺入v1 envelope，没有读库或发调用方源正文；stop发cancel但不置closed/terminal，close幂等撤message/disconnect listener并断Port，主动close不再调用失败回调。端口异常未统一捕获，UI持有终态/sequence。它不持久保存或重试，调用方新建会话；修改字段需同步history精确白名单、Detail和service。

<a id="file-detail"></a>
## src/learning-center/views/Detail.tsx：历史快照和每个 turn 的交互

[完整源码 L1–L111](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/learning-center/views/Detail.tsx#L1-L111)；blob `42db41664c3d5413fee4e3affc3dd7c86b81b994`。

Detail接RecordDetail/i18n/client与onBack/onDelete/onAssistantSaved。切recordId重置shown=5并聚焦heading；文本展示record标题/时间、ReturnToPage、artifact和匹配source、provenance折叠，每次更多加五，不代表后台只取五条。普通词典/no-hit/translation和assistant问题/答案走React文本节点；模型HTML不会成为DOM资源。顶层Escape回列表，删除交父组件确认。

AssistantControls每artifact独立expanded/question/answer/phase/lastAction，session/sequence/partial/terminal由ref持有。start拒disabled、已有session或空follow-up；只发持久目标ID/revision和问题。started切streaming，delta按序累计，interrupted按CANCELLED分stopped/failed；complete要求text等于partial且saved record相同、revision更高，随后close并onSaved刷新。没有把TypeScript类型当运行时检查，未校验turn全文图。

stop设stopping并发cancel，后续delta可再设streaming，complete仍可能saved；这与Content明确拒stopping complete不同。失败/停止允许按lastAction重试新请求，旧问答仍保留；新的临时answer不是已存artifact。根parent=null才显示regenerate，追问textarea≤2000，Ctrl/Cmd+Enter避开composing，局部Escape停止/收起且不冒泡。effect按artifactId卸载关闭Port；每artifact有独立session，非整页单flight。修改与App refresh/invalidation、client、backend commit取消一起验；E2E只覆盖一个根与follow-up，不泛称全部键盘/分支通过。

<a id="file-runtime"></a>
## src/background/reading-record/runtime.js：唯一服务与订阅的惰性装配

[完整源码 L1–L45](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/background/reading-record/runtime.js#L1-L45)；blob `81c91042b8c81043093eeb4e950dc35ebcf17675`。

current惰性createReadingRepository→createReadingService→createReadingSubscriptions，默认learningCenterAvailable=true；repository publisher接publishInvalidation。factory本身不打开IDB。configure先关旧subscriptions/revoke旧service/拆publisher，仅在ownsRepository时close旧库；外部注入repository所有权仍属于调用者，注入默认learningCenterAvailable=false与生产默认不同。

isReadingMessage检查reading.前缀，handle委派service；新增prepare/commit/cancelLearningAssistantTurn直接走同一service，未创建第二个历史库或公共v2任意写消息。固定invalidation Port异步connect，其它name返回false交assistant handler。tab loading/url更新、移除和权限撤回分别使service access/operations/handoff/订阅失效；assistant-stream的AbortController由background/index另行终止。修改须协调测试注入、service生命周期和两个Port，不能以重配runtime暗清用户历史。

<a id="file-service"></a>
## src/background/reading-record/service.js：原生身份、操作登记和历史 assistant 提交

[完整源码 L1–L205](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/background/reading-record/service.js#L1-L205)；blob `9936c04f10ed9916b8cbfe02dbfa9d953871d32f`。

createReadingService装配accessControl、operations、assistantSessions、exports、handoffs，repositoryMethod缺失NOT_READY，没有假成功存储。handle严格校验v2请求，原生authorize；Content按政策读取siteExcluded并限定content-only消息；dispatch后除固定OPEN外再次validateCurrent，统一错误为稳定Reading code，非合同错误STORAGE，不返原URL/正文/stack。

dispatch：OPEN只创建固定LC/ID片段；REGISTER绑定handoff；site-marker读写区分scope与siteKey并委派站点设置；handoff委派registry。READS委派repository并核对GET_RECORD页归属。BEGIN用native safeURL/title覆盖请求，对collector source/safety逐值相同，hash source fingerprint后operations.prepare；SAVE/APPEND要求注册token/source严格相同，hash artifact并向repository提供assertCurrent。CANCEL等repository ACK再撤注册。MANAGE提交后按记录/页面/站点或全部撤operations/handoffs并撤exports；export四阶段委派。普通v2 extension仍不能直接BEGIN/APPEND绕过专用history流程。

prepareAssistantTurn走原生GET_RECORD extension access，readonly readAssistantTarget，复验revision/siteExcluded，ground完整detail后找实际snapshot；从存储record/siteKey/snapshot派生access和BEGIN，生成后台operationId和fingerprint，再operations.prepare与原生当前性复查。session含access、注册operation、grounded和active，返回给assistant协调器；客户端不能指定操作token或正文。

commit要求session在Set且active，规范化draft并强制token record/operation/source，validateCurrent→hash→assertAccess+operations.assertCurrent→repository.mutate。resolve代表IDB已commit，不因提交后页面刚关就反转为错误；finally标session失效并撤operation。cancel先撤session再写cancel receipt，finally撤operation。signal没有传入这些assertCurrent，Stop/provenance竞态见功能章；取消错误不可当ACK。

invalidate/forget/tabUpdated撤原生access、对应operations/exports并处理handoff；revoke还清assistantSessions。政策、事务代数/容量仍由repository/write复核，不在这里自造配置路由。修改须联动native access、operation registry、真实IDB以及Port端，不能用“extension URL”代替真实授权。

<a id="file-repository"></a>
## src/background/reading-record/repository.js：短事务和只读历史来源入口

[完整源码 L1–L91](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/background/reading-record/repository.js#L1-L91)；blob `08c977d5c084ce8b7f98805f75b9ad4fd4c7c81d`。

惰性database、opaque cursors Map与publisher为实例状态。run只经idb adapter。readContext先prune无busy且过期cursor；LIST/summary/exclusions链预留槽并同步busy防并发叉链，cursor绑定queryIdentity。GET_RECORD以readwrite更新viewed；仅QUOTA/CAPACITY降只读。成功提交通知publisher；分页消费旧token、返回新的opaque token并保留原过期时间，失败恢复旧有效cursor或删除新reservation。

readAssistantTarget新入口用readonly事务：读取meta并policy授权，按recordId取row，缺失NOT_FOUND，再detail校验完整snapshot/artifact图，返回内部siteKey/documentGeneration/siteExcluded；不调用普通GET_RECORD的viewed写。目标revision由service核对。内部siteKey存在并不表示assistant-stream已用它选Provider，当前仍使用safeReturnUrl。

其它门面：readHandoffTarget、readPolicy、prepareOperation（事务前新candidateId）、mutate（先validatedWrite/hash再短readwrite append或manage）、cancelOperation（事务前token摘要）、readInvalidationState（按scope仅page/catalog revision与代数）、export open/check/chunk/finish/cancel。mutate只有非duplicate发布，publisher错误吞掉不反转commit；close清cursor/拆publisher/关闭database，没有删历史。

所有存储由idb唯一owner执行，UI不直接导入。修改需保留await/hash在事务外、原生请求generator、current guard和幂等receipt，相关底层正文见既有Reading章；本轮不再计write/idb为新完整覆盖。

<a id="file-artifact"></a>
## src/shared/reading/artifact.js：严格结果对象与 completed-only 合同

[完整源码 L1–L63](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/shared/reading/artifact.js#L1-L63)；blob `18353fe9063e70388a8e2f6057b63926349cffe4`。

validateResultArtifact先校验完整UTF-8 JSON字节≤artifactBytes，再要求精确字段集合和schema/version、bounded id/recordId/language/time。按kind分三种payload：dictionary限定hit/no-hit，headword/phonetic/POS与有界definitions，hit需定义和来源、no-hit不得有定义；translation只允许非空text；assistant只允许问题/答案/action/图ID/completionStatus。

assistant禁止parent或regeneration自指、二者同时有值，follow-up必须parent且无regeneration，根action不得parent；completionStatus只接completed，问题≤2000、答案≤24000。这里不验证外部turn存在/同thread/source/branch，交record detail整图。dictionary provenance为有界sourceId/packId/packVersion/sourceEntryId数组；Provider来源只允许provider/model/promptVersion/fingerprint，拒额外endpoint/key等字段。

纯函数创建规范化返回对象，无IO/副作用/取消；字节上限和字符上限独立，转义或多字节内容可提前达64KiB。Content draft占位校验与service最终hash都用它，修改顺序或字段必须联动digest/receipt和旧记录兼容，不能只改UI声明。

<a id="file-record"></a>
## src/shared/reading/record.js：记录、引用图与导出验证

[完整源码 L1–L92](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/shared/reading/record.js#L1-L92)；blob `48e8cbd49aa71b2f539d9de5337bee3a0e88a4aa`。

validateReadingRecord要求精确schema字段；itemKey必须等于纯identity规则，itemText与anchor.quote.exact一致，sourceLanguage有界，revision/lookupCount正数，时间有firstSeen下界，pageKey格式正确，safeReturnUrl可null。sourceSnapshot与safe URL是不同证据，不要求所有记录可回跳。

validateRecordDetail严格record/snapshots/artifacts集合并逐项验证，必须非空，所有snapshot选文等record.itemText，snapshot/artifact ID唯一，artifact record/source引用存在。assistant turns唯一；同thread必须同source和同根action。parent/regeneration目标存在、同thread/source且不晚于当前createdAt；regeneration限root→root、换branch，follow-up parent必须同branch。DFS visiting/visited拒绝parent/regeneration形成的环；它检查持久图一致性，不向Provider请求。

validateReadingExport先总JSON字节门槛、格式/schema/time和≤10000详情，record ID唯一，canonical applicationBytes≤64MiB；返回规范化records。没有保存、网络或取消行为，图检查成本有256 snapshots/artifacts等上界。修改graph/source或export格式需兼容历史并联动grounding/write/export消费；TypeScript断言不能替代这个运行校验。

<a id="test-stream"></a>
## tests/selection-assistant-stream.test.mjs：七个注入依赖的 Port 场景

[完整源码 L1–L109](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/tests/selection-assistant-stream.test.mjs#L1-L109)；blob `15d8d2cabd0f15664e700a54b494ea02b240e4db`。

Node test以自建Port捕捉listeners/sent，global chrome只设runtime.id；deps替换resolve/config/provenance/completeText，非真实HTTP或IDB。七场景分别断言：有序真实文本形状与重复start拒绝；content侧有限follow-up/root-regeneration形状及非法graph拒绝；Provider挂起时cancel触发signal且无complete；非法id/frame/incognito/extension path在工作前拒绝；unary标记与tab导航abort；history prepare返回可信源且complete含commit ACK；history Provider等待期Stop取消session且零commit。

history成功/取消的prepare/commit全为stub，成功保留原生url形状但不证明service真实授权。null safeReturnUrl只在挂起Provider取消场景，provenance亦被stub，因此不覆盖null→全局配置→真实provenance失败；Stop注入点也不是provenance之后或IDB commit前。没有真实socket/backpressure/资源压力，测试本身只是现有断言证据，本轮NOT_RUN。修改应新增对应边界而非把此文件标题当所有cancel时序已通过。

<a id="test-grounding"></a>
## tests/assistant-grounding.test.mjs：持久图派生的纯合同样例

[完整源码 L1–L35](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/tests/assistant-grounding.test.mjs#L1-L35)；blob `51f9202f691136c67a9550e58dd365cdcfe58b38`。

合成detail用contract fixtures构造dictionary、root和follow，revision=3；确定性randomId让新turn/branch可断言。第一测试沿root→follow得到按时序历史，继承thread/branch且parent=目标，断言输出没有示例forged body文字（输入本身并未实际注入该正文，这条检查不是完整伪造矩阵）。第二测试root regenerate保留action、parent=null、regenerationOf旧根、新branch，并拒旧revision、伪source和对follow-up regenerate。

不测真实access/policy、六条截断的长链、八次ID碰撞耗尽、配置和提交/停止；完整图其它限制由shared tests另行承担。本轮只全文阅读，未运行，不能凭两例证明所有历史图输入安全。

<a id="test-history-service"></a>
## tests/assistant-history-service.test.mjs：专用 service 与规范化摘要

[完整源码 L1–L46](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/tests/assistant-history-service.test.mjs#L1-L46)；blob `3b457d9b27225ad2e46174102adc752b73d643cc`。

使用nativeBrowser、extensionSender、repositoryDouble合成环境，真实createReadingService+groundLearningAssistant。第一测试readAssistantTarget返回合成detail/site，mutate检查assertCurrent与规范化artifact SHA一致，捕捉APPEND请求，再模拟native contexts消失并返回saved；断言已commit语义不因随后关闭反转，record/source/parent绑定正确。第二测试旧revision在prepareOperation前被拒，计数为零。

这些是service/摘要/ACK顺序测试，不实际打开IndexedDB，不证明browser native contexts实现或事务持久化；未测Stop信号桥接、permission撤回所有await点及空safe URL路由。修改与operations/access/write真实存储验证相互补充，不把double成功当最终磁盘证据。

<a id="test-ui"></a>
## e2e/selection-assistant-ui.spec.mjs：实际 Content 与学习中心的一个故事

[完整源码 L1–L58](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/e2e/selection-assistant-ui.spec.mjs#L1-L58)；blob `df334f2f64fd2157751bd766760256f6d764e22d`。

复用extension-fixture，reset并storage设中文和本地mock兼容endpoint/streaming；学习中心真实页面由代码直接发GET_STATE/SET_RECORDING开启，Content为本地/selection合成网页并显式harness.inject。select用DOM Range与合成selectionchange选词，随后Playwright点击真实chip与“解释这里是什么意思”。断言已有base记录saved、真实SSE部分文本可见→Stop→interrupted/未保存，再通过v2 LIST/GET确认一条record中assistant为零。

真实重试按钮→success/Reading saved后读取root，断言understand/null parent/regeneration/completed与全文。进入真实LC record fragment，点击follow-up、填问题/发送，等待新问题与两条答案显示，读取两assistant并核对parent/thread/branch，最后检查mock prompt JSON没有url字段。此故事把产品UI、后台、真实IDB和mockHTTP串起，不是仅Port驱动。

局限：只一个root动作和一次follow-up；无根regenerate/LC Stop/provenance延迟/无safe URL/三按钮全路径，未做真实站点/paid Provider质量或原生IME。consent与选择部分为脚本，显式inject不能用来证明静态启动。#243归档1/1以及#244组合中的这一例均有PASS记录，本轮不重跑。

<a id="test-port-e2e"></a>
## e2e/selection-assistant-stream.spec.mjs：ISOLATED 脚本的底层流测试

[完整源码 L1–L34](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/e2e/selection-assistant-stream.spec.mjs#L1-L34)；blob `9a0ef744753dc4a0cf96bfacbea0d0dcceae989b`。

自行准备审计后的临时扩展副本、fixture pack/本地权限、持久Chromium profile和mock server；popup.html作为普通driver TAB写兼容Provider配置，用chrome.scripting.executeScript在目标ISOLATED直接connect/start/cancel，事件保存在该world测试对象。

先等delta、cancel、等interrupted，再400ms观察无complete/turn；第二次start等complete，拼delta等streamed answer并核根turn字段。finally关闭browser/server并删一次性临时目录。此文件是Port+HTTP浏览器验证，不点产品浮层、不做Reading consent/保存或学习中心图；400ms观察也不代表所有迟到事件无限期不发生。当前#244组合命令并未列这个spec，不能把其断言数量并入10/10。本轮NOT_RUN。

<a id="evidence-243-task"></a>
## docs/tasks/243/task.md：UI 实现的有限合同

[完整源码 L1–L10](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/docs/tasks/243/task.md#L1-L10)；blob `d9d44fc6665aba42f3283bba4d6568038279de25`。

任务依赖242/235，范围为Content三个根动作、真实partial/Stop/重试/完成保存和LC基于真实RecordDetail的follow-up/root regenerate；要求过期隔离、键盘/IME/布局、失败保留旧问答，不新增Provider/DB/Manifest/通用bus。验收列Node/React与WXT Chromium、validate/build/focused E2E。此文件说明应达目标，不是每项都已由浏览器执行的证据；例如唯一assistant UI故事不含root regenerate。只读此合同，不修改任务状态或启动实现。

<a id="evidence-243-state"></a>
## docs/tasks/243/state.json：候选、同步与合入身份

[完整源码 L1–L16](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/docs/tasks/243/state.json#L1-L16)；blob `c4c8c6954acd559cbf15567ee4ec901d26da0946`。

schema1任务243为completed，dependencies242/235，branch main、owner main、无worktree；candidate=0d34d357777ad378cd94a5ec090a8a902b27cd83，sync=6da34a4641bdb57bbe1b408b43e58386553826bc，merge=8de22f6c56d28a2b32f56729030a612ed88338f5，PR294。validationCommands是validate、显式WXT和单assistant UI E2E，artifactRequired=true；nextAction是当时可推进244的历史接续，不授予本轮新代码任务。state不是运行日志，须与acceptance/review与源码输入相互核对。

<a id="evidence-243-acceptance"></a>
## docs/tasks/243/acceptance.json：准确候选的三条归档记录

[完整源码 L1–L71](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/docs/tasks/243/acceptance.json#L1-L71)；blob `3b3aef517c426d04319060dfc193146475c07815`。

schema1/task243绑定candidate 0d34d357、tree be830cc63fcc8c0e3c635eab333576664e05fe77、inputTree 196c95cb…6a29与冻结时间；环境Node24.21.0/npm11.19.0/Chromium153.0.8010.12。三checks分别validate、WXT、selection-assistant-ui E2E，记录同candidate、PASS/exit0、起始时间、耗时、相对本地log与sha256。artifact指向.output/chrome-mv3，fingerprint fb72c3b24a925d755848f962822988bc68c2c13e3983ea7fe379e91bf0fa2132。

decision为ASSISTANT_UI_PASS，limitations保留其它浏览器/隐身/商店未跑及已有audit告警。文件不附原始log或包字节，本轮只读记录、未下载日志或重算包hash；归档PASS不等于当前main新运行。修改此证据需独立授权，本轮仅在导读解释其用途。

<a id="evidence-243-review"></a>
## docs/tasks/243/review.md：主 Agent 自查的证据层级

[完整源码 L1–L11](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/docs/tasks/243/review.md#L1-L11)；blob `e2500f16e1237f2d59e93a076961174c6fb74f09`。

绑定0d34d357相对1304166，陈述Content状态、LC仓库重读/图派生与commit ACK、React/交互、无新增权限等；记录validate含1066 Node/16 Vitest、strict/default build，WXT155文件/1,815,834B与单E2E1/1。这是主Agent自查，不是独立安全审计；“partial/cancel/fail不保存”等概括要按测试注入点和当前Stop/provenance窗口限定。

文中ai-detail/popover/rich-details并入classic projection是243时的产物策略。当前a4dab已改为WXT编译Content graph，不能原样当最新包结构。自查写明其它浏览器/隐身/商店未验；本轮保留其原候选身份，不替它补造截图或失败结论。

<a id="evidence-244-task"></a>
## docs/tasks/244/task.md：A–D 组合验收的合同

[完整源码 L1–L31](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/docs/tasks/244/task.md#L1-L31)；blob `b240b1efa69f30f997a585133bd845cc9fc099a2`。

依赖240/243，仅以同一WXT production artifact进行QA、不新增业务或商店发布。目标为A保存/重启离线、B回访定位、Cmarker/SPA、D真实partial/Stop/retry/ACK/history follow-up，历史读取零Provider/lookupCount；列五个spec及Node/Vitest/typecheck/build各自任务。完成标准是validate、WXT、一次明确组合命令、准确candidate/package fingerprint和逐项证据，合入另需本地gate/远端头/tree事实。

合同中root regeneration/六条历史等部分由Node/React矩阵承接，不能把十个浏览器场景改称每项需求皆已独立端到端验收。该任务合同只解释历史授权范围，不授权本轮运行或发布。

<a id="evidence-244-state"></a>
## docs/tasks/244/state.json：最终验收的三种提交

[完整源码 L1–L20](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/docs/tasks/244/state.json#L1-L20)；blob `5898116d4b722d73a3abbca1e4eb3036c1c5b413`。

completed/owner main/dependencies240/243，candidate=9a4b137a14b04712dfffcd1bb913441d635c7b33，sync=38916bcd4746d5bc96cefab9674a6438c39f43c8，merge=8c3ad6d8bfc528a12b4b28d3c90ab97e0e403a32，PR295；validationCommands精确列validate、build及五spec组合，artifactRequired=true。nextAction是平台250已解锁的当时记录，不是当前本文的待办或执行许可。文件提供身份与阶段，没有raw results，不能仅凭completed推断商店发布或全部历史问题已修。

<a id="evidence-244-acceptance"></a>
## docs/tasks/244/acceptance.json：10/10 所属候选与包

[完整源码 L1–L76](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/docs/tasks/244/acceptance.json#L1-L76)；blob `42254b43fd3f5475ba286ebb2be1bd65bc1a2da0`。

绑定9a4b137a、tree cf56a30ae8711198c8f1067cd9c14235dce5a238、inputTree edfafe95…707d及冻结时间；环境同243。三checks记录validate、显式WXT、五spec组合E2E，同candidate/exit0/PASS及时间、耗时、相对本地日志与hash；artifact仍fb72c3b…2132，decision READING_LOOP_ABCD_PASS。10/10数量来自配套review/唯一接受文档，不是该JSON逐例日志。

limitations明确其它浏览器/隐身/真实付费模型和私人词典/原生IME候选窗/浏览器UI缩放/文件落盘未跑，商店/外部部署/遥测/云同步/SRS未授权或未做，原依赖audit告警保留。本轮不取得raw log、包或截图，不能把归档读取叫复跑成功；#296编译输入变化后此fingerprint不覆盖新包。

<a id="evidence-244-review"></a>
## docs/tasks/244/review.md：组合 PASS 不覆盖全部竞态

[完整源码 L1–L9](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/docs/tasks/244/review.md#L1-L9)；blob `7cd0aad6b947bb4e082b00805d4aeb078fa39862`。

绑定9a4b137a相对8de22f6，说明候选不改生产/测试/权限/依赖/构建，只把A–D置于同一包组合验收并更新接受文档。记录validate1066/16/strict/default WXT，显式包155文件/1,815,834B、同fingerprint与Chromium10/10；自查不是独立人工审核。

来源/revision/图约束和已提交ACK描述可作为设计/证据导航，但“未完成/取消不保存”等总体结论须与实际spec和已知provenance等待窗口分开。真实模型质量/私人词典等仍无证据；本轮只解释原候选，不抹掉PASS、不将该自查外推到所有边界或后续main。

<a id="partial-adjacent"></a>
## 相邻来源、配置、事务与打包：局部接线，不新增完整覆盖

- [src/background/index.js](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/background/index.js) 的initializeBackground同步装配message/command与两个Port；tab loading/url/remove、permissions removed分别调用Reading失效与assistant abort。原启动章仍解释其余初始化，这里只更新新接线。
- [src/background/selection/resolve.js](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/background/selection/resolve.js) 与 [src/background/config.js](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/background/config.js) 解释为什么先重新解析来源再读一次config；[src/shared/provider-config.js](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/shared/provider-config.js) 的getSiteProfile空URL返回null。现有全文未变时沿用[Provider章](providers-and-settings.md)，不重复增加计数。
- [src/background/cache-db.js](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/background/cache-db.js) getCacheContext先normalizeUrl再hash；[src/shared/url.js](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/shared/url.js) new URL("")会失败。这里只复核provenance路径，不将缓存库全文件再次声称完成。
- [src/background/reading-record/write.js](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/background/reading-record/write.js) 的validatedWrite/append和 [src/background/reading-record/storage-state.js](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/background/reading-record/storage-state.js) tokenCurrent维持source/token/digest/revision/代数及容量；与[旧Reading完整正文](reading-records.md)同blob部分可复用。assertCurrent不是本次assistant AbortSignal的别名。
- [src/learning-center/App.tsx](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/learning-center/App.tsx) 给Detail传onAssistantSaved=refresh、assistantDisabled=blocked||!state.enabled，refresh/invalidation清旧detail重读。App其它recent/export/management/focus状态仍待复核，本章不借这一prop把整个App算完成。
- [src/shared/reading/constants.js](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/shared/reading/constants.js) 是v2方法、limits与v1 schema；assistant Port名字/v1 envelope仍在流模块与消费者内。64KiB artifact与24000 answer长度门槛独立。
- [entrypoints/content.ts](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/entrypoints/content.ts) 导入唯一Content source entry与CSS，http/https document_idle，由WXT生成；[src/entries/content.js](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/entries/content.js) 按有序side-effect imports把runtime/registry、共享Reading contract、selection各依赖、controller/quickcontrol和最后content.js相连；[scripts/content-runtime.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/scripts/content-runtime.mjs) 从图抽取唯一文件，Vite chrome102目标生成单一无外部import的IIFE用于fallback。只解释本章装配，不把完整构建、平台预算或升级重新计为完整。\
当前Content生产包是编译bundle；旧raw/classic投影章保留历史身份并明确待复核，修改源码仍应改authored module，不改生成物。
- [upgrade-expectations 当前注册期望](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/e2e/support/upgrade-expectations.mjs#L14-L25) 已在native update校验旧mapping后返回空数组，符合静态Content下清旧动态注册；[前章第1项](real-entry.md#limitations)是c250旧基线冲突，不再当当前缺陷。完整同ID/Reload/重启与真实版本更新/用户权限弹窗仍需分别读准确候选证据，本轮不重跑。
- [docs/READING_LOOP_ACCEPTANCE.md](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/docs/READING_LOOP_ACCEPTANCE.md) 当前是244 A–D接受汇总。其“PASS”应限定9a4b候选、合成页面、mock服务和指定组合；章节中的通用取消/包结构文字不能代替当前源边界。本文件整篇已经读取，但本轮仅解释assistant/证据接线，仍保守待复核。

<a id="evidence"></a>
## 如何使用本章的证据

前23份为18生产+5测试文件完整说明，后8份为243/244任务/状态/验收/自查逐文件说明；共31份。源码内容由固定commit获取，返回blob逐项与完整tree一致。测试“有哪些断言”是静态事实，归档“PASS”绑定原候选；本轮未执行任何项目命令。原始本地日志/产物不可由归档hash单独恢复，不冒称本轮已验真。

[功能章的完整两条链与限制](../features/assistant-stream.md#evidence)给出读者可用结论。未变依赖复用既有正文；changed但未全文解释的文件一律在coverage待复核，新文件无全文则待解释。特别是#296构建/升级和#297离线词典任务卡不能因在最新tree中出现就变成本轮已讲解或业务已交付。
