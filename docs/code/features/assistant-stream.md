# 显式 AI：划词流式回答、完成保存与历史追问

[首页](../README.md) · [逐文件与证据](../modules/assistant-stream.md) · [划词/词典](selection-and-dictionary.md) · [Provider/设置](providers-and-settings.md) · [Reading 保存与学习中心](reading-records.md)

固定源码 main `a4dab127c95f4f1d3b37375fc5a7b1b5241419f9`（2026-10-04），不读取文档分支旧代码来代表当前实现。#243/#244 已合入并有原候选归档；本轮只读源码和写导读，安装、构建、业务测试、浏览器全部 **NOT_RUN**。现有 PASS 的具体范围见[证据](#evidence)，不能代替下面的取消/路由边界。

<a id="flow"></a>
## 1. 用户入口与两条完成路径

**划词根回答。** 普通网页 Selection chip → 显式查询 → 本地结果/无命中卡中的“理解、分析、用法”（旧“AI 详解”按钮缺省为理解）→ controller.explainSnapshot → `selection.assistant-stream` Port → background assistant-stream → 再解析来源/本地候选 → 当次 EffectiveConfig → Provider completeText → started/delta/complete → 当前卡显示全文 → record-client 的 Reading BEGIN/APPEND → 保存 ACK。

**历史后续回答。** 学习中心打开已保存 assistant artifact → “继续追问”或根 turn 的“重新生成” → Detail/openAssistant 只发 record/revision/source/target-turn 与问题 → 同一 Port 的 history scope → service 原生学习中心身份验证 → repository 只读重读记录和站点策略 → grounding 派生历史/图关系 → 注册 assistant operation → Provider → completed artifact → service/repository APPEND 事务提交 → Port complete(saved) → App.refresh → 重新读取历史。

两者的 complete 不同：Content 的 complete 是“生成完成”，持久成功还要等 Reading ACK；history 的 complete 已包含后台持久 ACK。显示出来的半截回答不自动成为 completed artifact，也不是词典事实。

当前生产入口由 [entrypoints/content.ts](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/entrypoints/content.ts) 和 [src/entries/content.js](https://github.com/CoderLambert/translateflow-plugin/blob/a4dab127c95f4f1d3b37375fc5a7b1b5241419f9/src/entries/content.js) 交 WXT 编译成单个 ISOLATED Content bundle。被导入的 Selection 文件仍以 classic/IIFE 向同一 global registry 登记；**源码形式不是逐文件 raw 注入的生产包承诺**。#243 时代的 classic projection 归档保留原身份；本章不把旧包 fingerprint 套给 #296 后产物。MAIN/Worker 与完整升级链不在本轮全文解释范围。

<a id="content"></a>
## 2. Content 持有什么状态，怎样拦住旧结果

controller 既保留普通翻译 task，也单独持有 activeAssistant；二者不是同一个取消域。有效 Selection freeze 为 sourceCapture，snapshot/range、sourceRevision、requestVersion 和 page identity 共同决定当前性。明确 AI 动作复用仍有效的 recordContext/sourceCapture，或新建 purpose=assistant 的 Reading intent；然后创建独立 request/thread/turn/branch ID，parentTurnId 与 regenerationOf 均为 null。当前 Content UI 只暴露三个根动作，不能因 Port 接受有限 follow-up 形状就说浮层已有历史追问编辑器。

开流后只接收同 state、version、snapshot、页面、protocolVersion=1 和 requestId 的帧。delta.sequence 从零严格递增，累计到内存 partial 后用 textContent 显示；started 的 stream/unary 是请求开始时预估模式，最终 complete.mode 才可能反映 fallback。UI 不用 HTML 或 Markdown 执行模型内容。

- Stop 先设 stopping，发同 requestId cancel，保留当时 partial 并显示“正在停止，等待确认”。Content 不接受 stopping 后 complete 为成功；收到 interrupted 或断线后丢弃该 operation，显示重试。
- Retry 是新的 AI 请求/operation/turn，不是续接旧 SSE，也不是存储重试。失败前已有词典结果仍可保留。
- 新选择、关闭、Escape、源投影变化、离页等先使旧 state terminal，cancel+disconnect 并 discard 对应 Reading operation；requestVersion 阻止迟到回写。窗口 focus/visible 的记录策略重读与此分开。
- completed 帧须有 completed turn、相同 answer/text、targetLanguage 与 provenance。Content 这里没有检查 final text 必须等于累计 partial；持久 draft 还会通过共享严格 artifact 校验。不能把 UI 层的几项检查叫作完整协议验证。

ai-detail 负责 actions/loading/streaming/stopping/interrupted/success/error/cancelled 呈现；popover 负责容器、按钮和定位，controller 才持有网络会话。关闭浮层清 rich resources，不意味着全局事件监听销毁。

<a id="port"></a>
## 3. Port 的身份、消息与资源生命周期

background/index 在 onConnect 中先交 Reading invalidation handler，未消费再交 assistant handler；它不经过普通 router 的 sendMessage envelope。tab loading/URL 更新、移除及 permissions removed 触发对应/全部 assistant signal abort；Reading access 的失效另行执行。

Port 协议 v1 与 Reading 消息 v2、artifact schema v1 是三个独立版本。一个 Port 只接受一个 start；第二次 start 是 BAD_REQUEST。最多 32 个 active state；结束 finally 或断开时删除。只有创建 ctl 后的任务能被 abort；没有 start 的已接端口没有单独 idle timeout，不能把 MAX_ACTIVE 当作任意情况下都有 TTL 的队列。

Content sender 必须自身 extension ID、top frame、明确非隐身、http(s)、整数 tab ID，且存在 tab.url 时与 sender.url 完全相同；start.pageUrl 必须等于 sender.url。原生 documentId 缺失时接受 32 位十六进制 ownerToken 形状，不能把这个随机值称为 Reading 原生能力。history scope 初筛固定自身 learning-center.html、无 query、documentId，再由 Reading service 验证真实页面上下文，页面 URL 外观本身不足以授权历史写入。

Content start 限选文 2000、问题 2000、历史最多六条；图 ID 有界，root/follow-up 形状有限。history start 则要求**精确字段集合**，不收正文、URL、history 或调用方指定 thread/branch。delta 单片上限 2048、总量 24000，均是 JS 字符串 length（UTF-16 单元），并非模型 token 或 UTF-8 字节。shared artifact 另有 64KiB 总字节限制，字符合法不代表最终必能入库。

消息依次为 started、零或多条 delta、complete 或 interrupted；interrupted 仅给 code/partialChars，不回传原始错误正文。catch 后 history session 尽力 cancel；这是清理尝试，不能把吞掉的取消错误解释成持久撤回 ACK。

<a id="provider"></a>
## 4. 从来源到真正的 HTTP 请求

Content 分支重新调用 resolveSelectionRequest(explainRequested:true)，读取配置、清洗上下文、分类并在词汇路径读取本地候选；不会直接采信 UI 旧卡。该解析没有传入本次 AbortSignal，Stop 可阻止后续 Provider，但不保证取消已开始的本地 IO。history 分支只使用已保存 sourceSnapshot；selection-only 不补抓当前网页上下文，候选为空，不重新查询词典。

随后 getEffectiveConfig(pageUrl) 得到 Provider/model/凭据/endpoint/streaming 等。整个 completeText 和 readingTranslationResult 使用这一份 config；前面的 resolveSelectionRequest 另读过配置，不能称从最初点击到所有前置步骤都是原子快照。

实际请求为固定 system prompt “Explain from context. Plain text only.” 与 JSON(question,text,context,candidates,history)。没有 URL、标题或 anchor 前后缀字段。**这一新 completeText 路径没有使用旧 SELECTION_EXPLAIN 的结构化 prompt、候选 ID 响应校验或解释缓存**；虽然有效配置中有 prompt/目标语言/Glossary，本路径固定 system prompt 没有拼入它们，targetLanguage 元数据也不是实际输出语言的证明。原有 completeJson+cache 路由仍存在，但不是当前 controller 的三个流式入口。

- OpenAI-compatible 先检查 endpoint permission 与 model，可无 key。streaming=true 走 SSE；特定 HTTP status 加“stream 不支持”文案才改 unary，其他错误直接失败。completeText 不走网页翻译的 local-model 专用 batch/schema 分支。
- SSE 按 UTF-8 chunk 解码和 SSE data 事件解析，取 choices[0].delta.content，回调真实文本 delta；必须收到 [DONE] 且有非空内容。application/json 是兼容支路，直接返回 JSON，没有逐段 onTextDelta；不能把每种响应都当作一定有 delta。
- SSE 自身没有普通 HTTP 的重试循环。DeepSeek 与兼容 unary 使用 shared request 的有限失败分类/退避，DeepSeek 一直 stream:false；unary 回来后 assistant handler 一次 emitDelta 全文，再 complete。
- SSE 读流期间 linked timeout/abort 保留；普通 HTTP 的 linked cleanup 在 fetch 返回 headers 后结束，body 阶段不是同一超时覆盖。解析失败的 reader 清理、上游无界 buffer 和单片超限行为都需按实际代码看，不能泛称“全链路有界且可取消”。

根动作新请求不读写解释缓存；只有完成后生成 provenance fingerprint 会调用 cache-db 的 getCacheContext，不能把“调用 cache-db 函数”理解为写入翻译缓存。provenance 仅 provider/model/promptVersion/fingerprint，不把凭据/endpoint/prompt 发给 UI。

<a id="save"></a>
## 5. Content completed 如何成为本地历史

controller 收到完整答案后先显示，随后 records.accept(kind=assistant, operation=当次 assistant intent)。record-client 用占位 record/source 做严格 validateResultArtifact，固定 artifactId、createdAt、payload 和 provenance，再串行排队；总 draft 最多八个。未开启记录只提示邀请，开启后回到仍有效原卡必须显式保存；原本已开启或本卡已 manual 才自动 flush。

flush 等政策和前一个 ctx close 完成，REGISTER/BEGIN_QUERY 通过真实 collector/source proof 取得 token；同位置复用 ref 仍需当前摘要 revision 和 sameProvenLocation。APPEND_ASSISTANT 使用绑定 record/source/operation 的 artifact；ACK 对 artifactId/recordId 后更新 ref/revision 与 saved 状态。迟到 rich 和本地 lookup 保存不被 AI Stop 回滚。

STORAGE/QUOTA/INTERRUPTED 的“重试保存”复用同 artifact/operation，不重新调用 Provider；STALE/REVISION_CONFLICT/权限/容量类阻塞要重新明确操作。关闭 ctx 先清 drafts/撤 intent，再等迟到 token 并请求真正 CANCEL_OPERATION；ACK committed 保留已提交 ref，不能说闭卡删除了历史。底层 token/receipt/IDB 事务见[既有 Reading 章](reading-records.md#4-事务为什么要在末尾再次检查)。

<a id="history"></a>
## 6. 学习中心怎样派生 follow-up 和 regenerate

Detail 从真实 RecordDetail 展示 artifact/source/provenance，先五条再加五；每个 assistant artifact 有独立控制器。App 传 assistantDisabled=blocked 或未开启，并把 onAssistantSaved 接 refresh。单个控制器 session ref 防重复，其他 artifact 控制器不是全局互斥。

openAssistant 生成 requestId，仅带 recordId、recordRevision、sourceSnapshotId、targetTurnId、historyAction，追问才带 question。service.prepareAssistantTurn：
1. accessControl.authorize(GET_RECORD) 要求原生 extension scope；repository.readAssistantTarget 只读重读 detail、内部 siteKey/sitePolicy，不增加 lastViewedAt。
2. 校验 revision、站点未排除与实际 snapshot，再 groundLearningAssistant 校验完整 detail 图。
3. follow-up 沿目标的 parent 链向上取最多六个已完成问答，保持 thread/source/branch，parent=目标 turn，新 turnId。不是任意六条最近答案。
4. regenerate 仅根 turn 且根 action 有定义，沿用问题/action/thread/source，parent=null，regenerationOf=旧根，新 branch 与 turn；旧分支/旧追问不搬迁。
5. 从持久 source 和内部页面身份构建 assistant BEGIN，hash 指纹、operations.prepare 与 repository token检查，最后再验证原生页面仍有效。若在 prepare 检查时记录已暂停，会得到非 ready；这不保证后续任意 await 期间暂停都会立即停止 Provider。

完成后 service.commitAssistantTurn 将后台 draft 规范化为 artifact，再计算 digest，复验原生 access/operation，由 repository.mutate 进入 validatedWrite 与 append。事务核对授权/data/site/page代数、source digest、receipt、record revision、不可变快照/图和容量；只有 IDB commit 返回才产生 saved。已有记录 assistant 不增加 lookupCount；新建仅 assistant 记录的通用 append 分支仍初始化 lookupCount=1，不能把规则扩成任何 AI 记录都为零。

Detail 用 sequence/partial refs 消费流，complete 要求 text===partial、saved.recordId相同、revision上升，再 finish(saved) 和 onSaved 刷新。失败/断线保留旧已存问答，临时 partial 与新存历史分开。Stop 发 cancel；Escape 在控制区优先停止或收起，Ctrl/Cmd+Enter排除 IME composing；artifact 卸载关闭 Port。**其 stopping 不是后续 delta/complete 的拒收门：delta 可重新设 streaming，complete 仍可接受实际 saved。** 不把 Content 的 stopping gate 套到 React 实现。

<a id="boundaries"></a>
## 7. 必须保留的现有边界，不用 PASS 遮盖

### 历史来源路由为空的条件风险

Reading record 允许 safeReturnUrl=null，内部 siteKey/pageKey 仍存在。assistant-stream 却取 record.safeReturnUrl || "" 给 getEffectiveConfig，空值导致 site profile/临时站点覆盖不参与，使用全局 Provider。若该记录确实没有 safeReturnUrl、原站点覆盖不同且全局 Provider 已可调用，用户追问的保存选文/上下文可能先发到全局 Provider；其后 readingTranslationResult("",config) 经 normalizeUrl/new URL 才失败。**“最终 interrupted/未存”不证明此前零联网。** 这是条件明确的源码风险，不是所有历史追问都会错路由，更不是 null 自动选中任意第三方。修复应使用已验证的来源身份并在网络前失败封闭，不能为拿 URL 降低原本回跳隐私限制；本轮未实现。

### Stop 的信号并不等于事务提交栅栏

run 在 resolve/prepare 后以及 completeText 返回后查 signal，但随后 await provenance，之后 history commit 前没有新的 signal 检查。cancel handler 只 abort ctl，未同步 revoke history session；service 的 assertCurrent 核对原生 access/operation/generation，不读取这个 signal。因此用户在 provenance await 窗口 Stop，仍可能进入保存。导航/权限撤回另有 access 失效，不与单纯 Stop 混同。已提交后要以 committed 为准，也不能将“任何 Stop 后保存都属于已越过提交点”作为解释。

已有测试在 Provider 等待期注入 abort，并未覆盖 provenance 阻塞后 Stop→commit 窗口；文档只保留已知问题的条件与修改入口，不重新运行复现、不实施修复。建议后续验证同时分开“取消前未提交”“已 commit 再关闭”“存储失败重试”，而非只查 signal.aborted。

### 其它协议边界

unary 全文也经过 2048 单片门槛；emitDelta 超限只是 abort 后返回，而 run 紧接着的总长检查不等于重新检查 signal。JSON 响应兼容支路可以有最终文本但没有 delta；history UI 的 final==partial 校验与后台先 commit 的顺序要一起看。这里只说明代码边界，未把这些分支标作本轮运行 FAIL。Provider 请求开销、partial、完整生成、保存成功是四个不同事实。

<a id="evidence"></a>
## 8. 已有证据是什么，本轮没运行什么

[31 份文件/证据详解](../modules/assistant-stream.md)区分生产、模拟 Node 和真实 Chromium 中的合成故事。

- #243 原候选 `0d34d357777ad378cd94a5ec090a8a902b27cd83` 归档 ASSISTANT_UI_PASS；validate、WXT 与单个 assistant UI E2E PASS，合入 #294。
- #244 原候选 `9a4b137a14b04712dfffcd1bb913441d635c7b33` 归档 READING_LOOP_ABCD_PASS；组合 Chromium 10/10 PASS，合入 #295 的 `8c3ad6d8bfc528a12b4b28d3c90ab97e0e403a32`。包 fingerprint `fb72c3b24a925d755848f962822988bc68c2c13e3983ea7fe379e91bf0fa2132`；这是原候选的真实包/合成站点/mock Provider 证据，不是最新 a4dab 的运行。
- assistant UI E2E 实际覆盖一个 Understand 根动作的 partial→Stop→无 assistant artifact→retry→完整保存→学习中心 follow-up 提交。它用脚本设 consent、程序选文和显式 inject，然后点击真实 UI；不证明三个根按钮、根 regenerate、所有键盘/取消时序都经过该浏览器故事。
- Node grounding/service/stream tests 模拟 Port、Provider、repository/native browser；可检查字段派生与 ACK 设计，不能取代真实磁盘事务。独立 Port E2E 直接 ISOLATED 脚本发 start/cancel，没有真实浮层或保存。
- 归档含命令、环境、日志 hash；原始本地日志、截图、产物字节本轮未取得，未重新认证 archive。#296 后构建输入已变，旧 fingerprint 不覆盖新包。真实付费模型质量、私人词典、其它浏览器、原生 IME 候选窗、商店和发布等不因此通过。

本轮 NOT_RUN 是本次导读的运行状态，不能改写为“243/244 从未验收”；同时 archived PASS 也不代表最初任务文字的每个边界全部得到证明。

## 9. 按症状找修改入口

- 三入口/重试/旧 partial 覆盖：controller → ai-detail/popover → Port，联动 Reading operation discard。
- SSE EOF、降级、模式或 delta：openai-sse → compatible.completeText → assistant-stream → 两个 UI 消费者；不要只改 parser。
- 生成成功但没存：先区分 Content readingResult/draft/flush 与 history backend commit，再查稳定 Reading error/容量/revision。
- 历史追问错来源或跨分支：readAssistantTarget/service → grounding → artifact/record validators；不得接受 caller 正文/URL/图关系来“修好”。
- Stop/导航/关闭竞态：assistant signal、原生 access、operation、IDB commit 四层一起核对；保留已提交 ACK 语义。
- Packaging/升级：当前 owned Content graph 与 WXT 构建章待复核内容另看，不为文档运行构建或改变权限。

全仓导读仍未完成；这里只闭合本章两条用户链，未把被引用的大入口、缓存库、打包或所有历史测试计作完整解释。
