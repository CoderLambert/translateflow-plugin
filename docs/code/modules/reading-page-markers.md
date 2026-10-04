# Reading 页面再访：逐文件、状态与证据

[完整用户链](../features/reading-page-markers.md) · [单次返回](reading-return-to-page.md) · [后台保存](reading-records.md) · [覆盖清单](../coverage.json)

固定 main `13041666b253ecf9aa86b3ff5edfa677dde01c05`。本章完整说明 20 个文件：8 个运行/共享文件、1 个 E2E、1 个 DTO 测量记录、#239/#240 各四份归档，以及两个更新后的 classic entry/防漂移测试。其中 marker/resolver/entry/test 是既有说明的全文复核，不重复计算新增覆盖；其它相关文件仅解释本切片接口，coverage 不冒充全文件完成。本轮无项目脚本/构建/测试/浏览器运行。

<a id="file-marker"></a>
## 1. reading-page-markers.js：单页面控制器与 UI

[src/content/reading-page-markers.js L1–L65](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/content/reading-page-markers.js#L1-L65)；blob `31064bad7a40962aabe6223b259240a5fa487d37`。

IIFE 依赖 handoff/resolver/contract/runtime/uiHost/uiPrimitives，已有 readingPageMarkers 时不再初始化；导出 ready、refresh:load、cleanup。状态 generation/controller/root/panel/markerNodes/ranges/observer/timer/port 都在当前 Content 内存，未写历史库，也未取 artifact 正文。

send 每次校验 v2 request、content response，业务失败抛 code。load 先增 generation、abort 旧 resolver、disconnect observer、清 timer/UI；register 参数决定重新注册或等初始 ready。GET_SITE_MARKERS 通过后循环 GET_PAGE_SUMMARY(limit=100)，累计至无 cursor 或 200，再截取 200 调 resolvePage。源码仅在 marker 状态请求后、摘要循环后和 resolver 后检查 generation；不是每个 await 都取消，AbortSignal 只传 resolver。空列表/关闭意图直接无 UI，catch 对仍当前代数清 UI，不区分 loading/error/empty 文案，也不自动重试错误。

render 重建 root/panel/行与点：总数来自 pageRecordCount，超候选数才显示“定位前 K 条”。每行读 anchor.quote.exact、location.status，quote 点击仅检查 Range 起点仍连接就滚父元素；查看记录必须 isTrusted，只发固定 OPEN_LEARNING_CENTER(recordId)，openRecord 吞异常。每个 resolved item 保存 Range 并造圆点，不过滤 hasCompletedAssistant，不按位置合并记录。marker click 打开 panel 并 focus 对应 quote；toggle/关闭更新 hidden/aria-expanded，不实现 Escape/关闭焦点返回。positionMarkers 同步遍历所有点、取首个正面积 rect，坐标仅 clamp right/top；无 rect 设 hidden，不用 CSS Highlight API。

成功渲染后 body MutationObserver 对 childList/characterData/attributes 全量触发，150ms 合并后重新 load；observer 无三次上限，不按 sourceMutation 或受影响 root 过滤。每次 load 的 resolvePage 预算独立，不能称为整个页面的终身工作预算。scroll/resize 直接 positionMarkers，不是 RAF。cleanup 增 generation、abort/断 observer/清 timer、拆两个位置监听器、移 DOM/清 ranges；长期 route/focus listener 与 port 不主动移除。

connect 只订阅 reading.invalidate，任意消息 load，断开置 port=null 并 cleanup；本客户端不校验 invalidation DTO，而后续读取仍各自校验。route cleanup 后 debounce register/load；popstate/hashchange/navigation.navigate 均接入。pagehide 只订一次；focus 尝试 connect+register/load。断开不立刻自动重连，route/load 完成也没有独立 connect，首次 ready.finally(connect) 与 focus 是连接入口。BFCache/pageshow、频繁导航、旧 load 仍拉摘要需另验。

修改影响：消息/分页需同步 service/query/contracts；定位需 resolver/projection；生命周期需 subscriptions/native runtime；UI 需 host/tokens/styles 与真实交互。完整故事只有本章 E2E 的单条 fixture，不能外推大页、AI-only、201+、权限即时撤销、长期 CPU 或 Escape。历史数据对宿主页的既有风险见[前章](../features/reading-return-to-page.md#5-必须保留的隐私警告)。

<a id="file-resolver"></a>
## 2. reading-anchor-resolver.js：两个入口并不等价

[src/content/reading-anchor-resolver.js L1–L173](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/content/reading-anchor-resolver.js#L1-L173)；blob `de5181e1af6749f3dfa9d2a31b1081a6de5b9850`。

无后台或 Provider I/O，依赖 textProjection/policy；resolve(anchor,{signal}) 返回 status/range/stats/retries，resolvePage(items,{signal}) 返回 recordId→status/range Map。TOTAL 为1M chars、25k nodes、250ms、三次 revision retry、150ms delay。rangeKey 临时 Node→id Map 去重；exactOffsets 枚举子串；contextMatches 校验 exact/prefix/suffix；SHA-256 核对可选 blockDigest，Range 文字必须仍等 exact，旧 anchor.position 不直接定位。

单条 resolve 缺 body/exact 返回 unsupported，start projection 后最多三轮 attempt；每轮先 body，必要时 collectRoots 遍历 ROOTS 与文本父节点（最多上溯四层）。walker 按 sliceNodes/sliceMs yield 到下一动画帧，节点/root/digest/candidate 工作纳入 totals；abort 多处检查。多个不同 Range ambiguous；最终若恰一个先 resolved，再考虑 stopped/limited 的 not-loaded，最后 missing/unsupported。因此预算停止后单个候选优先不是穷尽唯一证明。stale 才 delay 重试，不是 missing 自动等加载；总统计也不是含所有浏览器调度的 wall-clock SLA。

批量 resolvePage 先 project(body)。底层单次 16k UTF-16/500 nodes/8ms 失败即整批 not-loaded（预算原因）或 unsupported，**不会执行 collectRoots fallback**。body 成功后才开始 started 计时并共享 body/roots/digest Map；各 exact 候选映射 Range，再用 contextRoot 局部投影校验上下文/digest。同一个 root 只投影/计算 digest 一次。每条>1 ambiguous、=1 resolved、无匹配按 limited/missing；超总预算其余项 not-loaded。revision 检查在匹配路径内，变化则整批递归，三轮后整批 not-loaded；不能宣称每个失败/无候选出口都有同等复核。

批量 started 在 body 完成之后，body 的耗时没有直接加回这个后续计时器；单条与批量的 stats/调度也不同。每次 revision 递归重新开预算，marker mutation 又会重新调用。两层数值不能压成“整页必在250ms内处理1M字符”。保守拒绝预算外文本是正确退路，但普通文章全 not-loaded 仍可能不可用，不能拿退路充当性能通过。

测试 [tests/reading-anchor-resolver.test.mjs L1–L100](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/tests/reading-anchor-resolver.test.mjs#L1-L100) 已按同 blob 全文复核：跨 inline/节点替换、歧义、missing/unsupported、digest变化、revision一次重试、预先 abort、20k 单节点不读 nodeValue、两条批量分别歧义/成功。performance.now=0，最后批量测试是小页；无大 body 批量成功/201条/预算外重复/扫描中 abort 的实测证据。修改两入口需分别验证，不用单条测试替代批量。

<a id="file-record-access"></a>
## 3. record-access.js：被动页面证明不等于保存授权

[src/content/selection/record-access.js L1–L71](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/content/selection/record-access.js#L1-L71)；blob `82f041b5cfa3d526c4ba83f134f7b51cdd4d6d94`。

IIFE 依赖 projection/uiHost，读取 readingContract limits；导出给后台 executeScript 调用的 readingAccessCollector.read，以及 Selection 的 create/live/safety/bindToken/cancel/forget/trusted。operations Map/current 只存当前文档可信操作，不持久化。trusted 要求 isTrusted 且 uiHost.ownsNode(event.target)，create 先 prune，最多16个 owner operation，随机 id、10分钟过期，捕获 snapshot/capture/isCurrent/purpose/可选已有 recordId/revision。

live 要求 Map 同对象、未cancel、未过期、调用方 isCurrent、sourceRevision 未变、Range 两端未脱离。safety 根据 capture.root 与 sensitive 投影成 safe/sensitive/unknown、light-dom/unsupported。read 先验 nonce 字符串，inspect/register/handoff/page 为 passive，使用 current；没有 operation 时只有 register/handoff/page 可返回 documentGeneration、selectionGeneration=1、安全占位、null sourceSnapshot/intent。后台仍需真实 sender/policy/session，不能由此绕过页面隔离或允许详情/写入。

有 operation 时，除已取消的 cancel 证明外都要 live；begin 的期望 recordId 来自 operation，save/cancel 来自 token。非被动只接受 begin/save/cancel、对应 recordId，save 必须 token；await capture.ready 后再校验 live，返回 proof 与精确 intent。detail 不属于允许的非被动分支，因此无查询的 page proof 不能自动升级成任意 GET_RECORD。

bindToken 校验 live/operationId 后接过后台 expiresAt；cancel 仅设本地 cancelled，forget 才删 Map，并回退 current 到最新仍活操作；prune 只按到期清。不能把本地 cancel flag 当后台未提交证明，Selection client 仍需 CANCEL_OPERATION ACK。改变被动动作集合要同时验 access challenge、service scope、Reading access/contract 反例；无运行结果新增。

<a id="file-repository"></a>
## 4. repository.js：cursor 所有权与事务边界

[src/background/reading-record/repository.js L1–L84](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/background/reading-record/repository.js#L1-L84)；blob `2601c96799e3e130919cb7c6d749ef364651873a`。

createReadingRepository 惰性创建 database adapter、cursor Map 与 publisher；唯一数据库 I/O 仍经 idb.run，不访问翻译 cache/OPFS/chrome.storage。run 接 context.assertCurrent 驱动 generator；read/mutate/export 等具体内容委托 query/write/management/export-reader/handoff-target，本文件拥有事务模式、cursor token 和提交后通知。

readContext 对四种列表复用 queryIdentity；cursor 缺失、busy 或身份不符报 STALE_OPERATION。新链最多128个、随机 opaque token、10分钟 TTL，在首个 await 前保留 busy。GET_RECORD 用 readwrite 更新 lastViewedAt；若 QUOTA/CAPACITY，降 readonly 再读且 viewed=false，让旧历史仍可打开，其它错误不伪装成功。committed 才通知 publisher。

成功列表页消耗旧 token；有 more 时新 token 继承原 expiresAt，不无限续期，一条链仍一个槽。失败新reservation删除；已有cursor若未过期释放busy供同请求重试。query 层还核对 catalog/consent/data/page revision，因此不能混页，worker 重启 Map 消失则旧 cursor 无效。close 解绑publisher、清 cursor、关闭 database；published 捕获同步/异步通知失败，不撤销已成功事务。

readPolicy 用 siteRead=true 的 readonly 内部预检查，返回 siteExcluded；prepareOperation 用新 candidateId/readwrite；mutate 先 validatedWrite，再 append 或 manage，非duplicate提交发布。cancelOperation 先算 cancellationInput，再事务返回真实结果。readHandoffTarget 只读；readInvalidationState 只返回协议/type/data/consent与当前 scope 的 pageRevision 或 catalogRevision，不带正文。open/check/chunk/finish/cancelExport 都走独立只读事务，最后 cancel 仍核 policy。cursor 与 export session 是不同状态所有者。

修改应一起核对 queryIdentity/cursor反例、GET_RECORD容量回退、提交后通知及 export/handoff代数。持久数据未因 cursor 失效删除；详情访问修改 revision 不等于新 lookup。相关 storage/access/operations 测试及 A/ABC 归档提供原候选证据，本轮未运行。

<a id="file-service"></a>
## 5. service.js：统一身份、分派、复核与撤销

[src/background/reading-record/service.js L1–L143](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/background/reading-record/service.js#L1-L143)；blob `94df455a1b3c86f57d4da55380875833298b5638`。

factory 注入 browser/repository/collector/clock/randomId/learningCenterAvailable/siteMarkers，创建 accessControl、operations、exports、handoffs；repository 缺方法报 NOT_READY，不造空列表或成功收据。handle 先 validateRequest→authorize真实sender。Content 除 REGISTER/OPEN 外先 readPolicy，GET_PAGE_SUMMARY 对 excluded 明确拒绝；authorizeReadingMethod 再核 scope/resourcePageKey，非Content不得调用写入、summary/cancel/register/consume等 Content-only方法。

dispatch 的 OPEN 只开固定 learning-center.html 或准确 record hash；打开成功不再强求原 Popup 存活，避免正常关闭被报失败。REGISTER 绑定 pending handoff，返回 page/site/document/navigation 可选 handoffId。GET/SET_SITE_MARKERS 从 Content access 或显式扩展 siteKey 得 origin；Content带siteKey拒绝，扩展缺siteKey拒绝；SET先validateCurrent，关闭只撤相应hand-off。CREATE/CONSUME委托registry。

READS委托repository，GET_RECORD二次核recordId/Content page所有权，summary限定Content。BEGIN用后台派生safeReturnUrl/pageTitle覆盖来值、比较proof snapshot/captureSafety/pageKey，计算purpose/owner/source等fingerprint，再operations.prepare预留/合并。SAVE/APPEND要求注册operation/token/sourceSnapshot完全一致，artifact.sourceSnapshotId吻合；计算artifactDigest后assertCurrent检查access和operation，再mutate。CANCEL调用repository取真实committed/cancelled结果，然后撤registry entry。

MANAGE先持久提交，再按record/page/site或全局撤operations；全部撤exports；handoffs同样按目标范围或全部撤。EXPORT四方法委托独立registry。除OPEN外，所有结果在返回前validateCurrent，然后validateResponse(method,scope,limit)。ReadingContractError保留枚举code，未知错误映射STORAGE；不返回原URL/正文/stack/error.message。

原生onTabUpdated先handoff处理早到/重定向，再使access/operations/exports失效；forgetTab另清navigation与handoff，revoke清所有authority/session/operation/export/handoff。此service不负责直接移DOM，靠runtime/subscriptions的断线与Content cleanup。暂停写入不默认禁止read，站点意图保存在auto-sites而非Reading meta；开关不经repository.publisher的区别影响即时刷新。

修改消息需要同步DTO/response/client及access/write/query管理反例，不能把“客户端可信按钮”替代后台身份验证。全文件各分支已静态阅读；没有重做存储算法/Provider，更未运行测试。

<a id="file-list"></a>
## 6. shared/reading/list.js：摘要和列表的严格投影

[src/shared/reading/list.js L1–L56](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/shared/reading/list.js#L1-L56)；blob `9a11885863c3a821cfa71596b3a700b076a860de`。

纯validator，无chrome/状态/I/O。validatePageSummaryItem严格只收recordId/revision/anchor/hasCompletedAssistant，调用source.validateAnchor而非信任任意JS对象。validateResultPreview验证kind、artifact/source关联id、language、有界text/truncated；pageFields集中pageKey/siteKey/title/safeReturnUrl。

validateRecordListItem验证时间顺序、lookupCount、preview/context以及assistantTurnCount/hasCompletedAssistant一致（turnCount>0），无preview时context必须空；locationCapability只描述保存证据。validatePageListItem有至少1条record的page统计；exclusion项只能excluded=true。revision从1起，所有id/URL/长度复用validation。摘要允许带assistant布尔值，但validator不会替UI实现AI-only选择。

validateListPage限制items≤请求limit≤100，nextCursor有界字符串/null；禁止空items还带cursor、禁止同页重复key，按extra校验page/catalog revision等字段。它不维护跨页全局Set，也不证明DOM定位/权限。修改字段需同步query投影、response、classic contract生成与DTO/response tests；不应扩大页面摘要为详情。

<a id="file-constants"></a>
## 7. shared/reading/constants.js：版本、限制和方法集合

[src/shared/reading/constants.js L1–L119](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/shared/reading/constants.js#L1-L119)；blob `32d15b4dcfa5e44c9845a15aef25f3e1000b9a2b`。

纯常量从SELECTION_EXPLAIN_LIMITS复用选区/上下文上限；schema=1、protocol=2、固定learning-center.html、reading.invalidate、tf-source-utf16-v1、ri1分别区分持久结构/消息/页面/订阅/投影/身份。limits包含字段长度与64KiB artifact、128KiB request、10k records/64MiB application数据、100条page/1MiB list/32MiB detail、每record256 artifacts与snapshots、预览长度、200排除站点、operation每owner16/global128/10分钟、export256KiB块/每owner1/global2/10分钟。

定位常量为16k/500/8ms slice，1M/25k/250ms total，3 retries、150ms mutation、200 pageMarkers、60s handoff。它们是合同数值；实际projection-policy/resolver另有本地同值定义，不由导入强制共享，需防漂移，更不是实测保证。

READING_METHOD完整涵盖BEGIN/SAVE/APPEND、当前页摘要/详情/列表/状态、记录开关/删除/清空、page列表、export四步、固定开页、站点记录/marker开关、排除列表、取消与REGISTER/CREATE/CONSUME。CONTENT_METHODS显式子集不含全局list/manage/export或SET_SITE_MARKERS；error枚举区分DTO/version/能力/not-ready、forbidden/disabled/stale/revision/not-found、capacity/storage/quota/interrupted、unsafe URL/handoff expired。LOCATION_STATUS另含permission-required供入口反馈。

文件无运行状态或错误捕获；改变limits/version/method值会影响generated reading-contract、所有调用端、测量字节、旧版本兼容与权限反例。不能只修改常量让预算/用例变绿。

<a id="file-response"></a>
## 8. shared/reading/response.js：方法与 scope 的响应语法

[src/shared/reading/response.js L1–L104](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/shared/reading/response.js#L1-L104)；blob `18f4c1b5eef263d196ec732ecc574c4a9954a303`。

纯模块；validateReadingResponse先核method/scope、整体JSON bytes（GET_RECORD 32MiB，其余1MiB）、严格envelope、protocol/ok。失败只允许已知code；成功时content必须在CONTENT_METHODS，entry仅OPEN；scope由可信adapter传入，此validator只证明语法，不创建权限。

data分派：BEGIN只有ready+token或disabled；SAVE/APPEND要求saved/recordId/revision/artifactId/duplicate；summary复用listPage附pageRecordCount/pageRevision且items不能超过总数；records/pages/exclusions分别附catalog或无extra。GET_RECORD完整detail；GET/SET_RECORDING的content只见enabled/consentGeneration/capacityReached，extension额外见dataGeneration/recordCount/totalBytes并验证capacity布尔一致。

站点recording返回excluded/sitePolicyRevision；marker返回ready或permission-required/enabled/permissionGranted，不自行推导三者关系。DELETE_RECORD固定deleted:true，DELETE_PAGE/CLEAR返回计数与对应generation；export四步交专用validator。OPEN固定opened:true；REGISTER返回document/navigation/page/site和可选handoffId。CANCEL的cancelled/committed必须recordId与revision同为空或同存在，committed不可空；CREATE_HANDOFF为ready+handoff或permission-required/unsupported，最后CONSUME返回最小summary。

输入错误抛ReadingContractError，service/client各在自己的边界处理；这里不重试、缓存或直接修改UI。增加响应字段要同步request method、backend数据最小化、classic生成与contract-response/DTO tests；成功语法不证明底层事务/权限/页面仍有效。

<a id="projection-boundary"></a>
## 9. 关联 source、query 与 runtime：本切片局部说明

- [src/content/text-projection-policy.js L5–L37](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/content/text-projection-policy.js#L5-L37)：slice与total分开；排除owned译文/UI、不可见/编辑/敏感节点，shadow/custom host/slot保守unsupported，chrome.dom.openOrClosedShadowRoot缺失也不能声称安全支持。rangePolicy先查light DOM/top frame/祖先和内部；sourceMutation忽略扩展/译文与仅切abt-hide-translations的class变化。marker自己的observer没有复用这个过滤。
- [src/content/text-projection.js L30–L80](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/content/text-projection.js#L30-L80) 与 [src/content/text-projection-builder.js L1–L41](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/content/text-projection-builder.js#L1-L41)：project共享budget时沿用消耗，默认新8ms slice，按原Text.length先拦16k再读nodeValue；DFS每节点计数，builder以UTF-16单位折叠ASCII whitespace、块界插newline并保存DOM offset mapping。失败不返回可用局部投影，resolvePage不能把失败的“前16k”当完整page。builder的NBSP/emoji/组合字符不等价按词/码点计数。两文件完整算法仍保留待解释，不因本节提升。
- [src/content/selection/source-snapshot.js L44–L86](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/content/selection/source-snapshot.js#L44-L86)：Selection捕获优先局部context，再尝试全局position；digest ready异步冻结snapshot，documentGeneration须后台绑定。只有本切片源连续性核对，非整章复写。
- [src/background/reading-record/query.js L42–L71](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/background/reading-record/query.js#L42-L71)：content锁定pageRecent，当前summary从row.record.anchor与已存listItem布尔投影，按条数/字节决定more；cursor检查catalog/consent/data/page revision。[src/shared/reading/previews.js L12–L28](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/shared/reading/previews.js#L12-L28)中的assistant计数来自保存的artifact，不预读完整问答来画点。旧完整query/previews说明仍有效。
- [src/background/auto-sites.js L20–L37](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/background/auto-sites.js#L20-L37)：串行写所有独立intent，Reading origin含端口，permission当前contains；关闭不删除历史或其它intent。[content.js L35–L61](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/content.js#L35-L61)的storage监听未处理readingMemorySites；不能由已有translation监听猜出marker开关即时刷新。
- [src/background/reading-record/runtime.js L28–L42](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/background/reading-record/runtime.js#L28-L42)、[src/background/reading-record/subscriptions.js L9–L55](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/background/reading-record/subscriptions.js#L9-L55)：后台onUpdated/loading/url与撤权关闭订阅，授权订阅只发代数，commit后重新核policy再publish。[src/background/reading-record/storage-state.js L25–L31](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/background/reading-record/storage-state.js#L25-L31)只在write时检查meta.enabled，解释暂停后读取仍可用。后台index的新assistant-stream分派是相邻增量，仅保留Reading钩子说明，不算新streaming全链解释。
- [src/content/ui/tokens.js L84–L84](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/content/ui/tokens.js#L84-L84)确有hidden !important；[src/content/ui/host.js L27–L35](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/content/ui/host.js#L27-L35)open shadow与通用pointer-events，[src/content/reading-return-card.js L18–L18](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/content/reading-return-card.js#L18-L18)的Escape只关闭临时card。不能把panel/grid误判为hidden失效，也不能把card的键盘代码算给marker。

修改上述旁支需各自进一步验证。部分正文不计完整，正文链接与完整状态由coverage分别记录。

<a id="test-marker"></a>
## 10. e2e/reading-page-markers.spec.mjs：唯一 marker 浏览器故事

[e2e/reading-page-markers.spec.mjs L1–L52](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/e2e/reading-page-markers.spec.mjs#L1-L52)；blob `1a496671aebfebabf75c274845ac04f13ea4e318`。

输入为mock HTTP页面一段 PUBLIC session alpha tail，fixture本地词典、真实WXT测试副本、一次性persistent profile；不使用真实词典/密钥。普通TAB popup.html driver设置en并清五类intent，学习中心实际点击Enable recording。页面程序化Range/selectionchange选session后，真实点击chip并等待saved；学习中心reload、第一记录详情、可信Enable site markers并检查aria-pressed。

关闭源tab，新的revisit页须显示本页历史1、1个marker；点marker，panel可见且含session/已定位。改innerHTML为跨inline文本后仍1marker/已定位；history.pushState后主动dispatch PopStateEvent，离页历史控件清空，goBack恢复原URL及总数。截合成截图，server.calls=0；finally关闭context/server并rm自己创建的临时目录。没有计时测量或GET_RECORD消息计数。

这是普通dictionary结果也画marker的现有断言，不是completed AI专属标记测试。没有201+分页、预算外重复、body16k失败、真实撤权、关闭意图即时清理、BFCache、Escape/焦点返回、拖选/链接命中、CSS API强制降级。locale设en但断言marker中文，表明该控件当前硬编码中文，不可据此称marker自身en/zh均验收。改变产品选择应同步该测试及上层合同，不能删断言换PASS。

<a id="file-measurement"></a>
## 11. marker-measurement.json：数据构造测量记录

[tests/fixtures/reading/marker-measurement.json L1–L16](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/tests/fixtures/reading/marker-measurement.json#L1-L16)；blob `dc11b69b5ce30fe15c4e6a427cbfab9bed8a3f24`。

静态结果对象，无测试执行入口。记录Node v24.21.0/linux/x64，200项最小page-summary DTO为64,422 bytes，median1.084ms/max4.453ms。限制明确只重测DTO构造/bytes、保存anchor是capture证据，未测DOM/layout/IDB/E2E；这里原样归因，不将其变成resolver/重访耗时。没有本轮重算或取得原测量过程，也不把这个样本平均字节推成所有100项页必能装满。

修改schema/anchor上限要重核测量输入和消息bytes，但不能以改静态JSON替代新的实测。其固定source blob能证明本篇引用的记录身份，不能证明现在的机器/浏览器表现。

<a id="evidence"></a>
## 12. #239/#240 八份归档：分别负责什么

本节八文件全部全文读取。task是目标与边界；state是协调者同步状态；acceptance是准确候选/命令/产物的结果索引；review是主Agent自查说明。它们是开发文档，不进入产品运行，不由本导读修改。原始ignored日志/截图/实际包未取得，因此只引用归档，不自称重新验收。

<a id="file-task239"></a>
### docs/tasks/239/task.md
[docs/tasks/239/task.md](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/docs/tasks/239/task.md)；blob `920370be0c69ea8794f9820b2e32c99bbf1e816e`。依赖238，定义明确readingMemorySites+站点访问、当前页最多200摘要、各种状态列表、resolved点与准确LC打开，以及DOM/SPA恢复；限定Content只读最小页面消息、Shadow UI、无Provider/词典/DB变更。要求共享预算与“最多两次100项读取”、三条验证命令。它是本地收窄合同：不含原Issue所有AI-only/CSS Highlight/201+手动分页细项；具体源码差异见[用户链](../features/reading-page-markers.md#boundaries)。修改它会改变验收范围，不能仅靠PASS反推所有原Issue已实现。

<a id="file-state239"></a>
### docs/tasks/239/state.json
[docs/tasks/239/state.json](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/docs/tasks/239/state.json)；blob `0b12c7b0e60248ce49851ed838145c687d47b960`。当前status=completed、owner=main、依赖238、branch=main，candidate=488d514ff2ef6ce4651908f36647586dbf9ae7c1，sync=05dbcb04a910883b1b3c833d01518306706bc4b8，PR290，merge=33ab3ea2a38ce591b622ba06739344858d7da403，result=TASK_239_PASS；保留validate/build/marker spec命令与artifactRequired。旧33ab快照里的ready_to_sync属于旧记录，现在不能继续当当前状态。state是索引而非额外运行证据；下一步240亦为当时阶段叙述，不自动启动任务。

<a id="file-acceptance239"></a>
### docs/tasks/239/acceptance.json
[docs/tasks/239/acceptance.json](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/docs/tasks/239/acceptance.json)；blob `f35075b1f64c8915d2e5b7214bece69900cfe98b`。绑定488d514候选/tree d4ce58a08d8595b58525fa0e1c54ba356f91a13d及inputTree，冻结2026-10-03T23:25:32.992Z。Node24.21/npm11.19/Chromium153.0.8010.12，validate/build/marker E2E三命令均PASS/exit0，分别记录duration/start/local-log/hash。输出.output/chrome-mv3，treeSha256=47bf5a9ab7851a6e288a7465fe64db23cac8b8b71a43b8f70015479fc7094647；160files/1,820,239B，platform1,572,850≤1,576,595且未升预算。decision=LOCAL_CANDIDATE_PASS。

limitations中的“240 NOT RUN”只描述该次时间点，后被240归档补充；Chrome102/其它浏览器/隐身/真实权限撤销/商店与audit1low/1high仍需按各自证据区分。inputTree、Git tree、包SHA256、日志SHA256不是可互换的身份。修改生产/测试/构建输入后不能沿用这份报告作为新运行。

<a id="file-review239"></a>
### docs/tasks/239/review.md
[docs/tasks/239/review.md](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/docs/tasks/239/review.md)；blob `8e8c57b07b1dd364f91aa8c0eda98fb62ffd63ff`。主Agent自查，非独立审核；基线7c97090、候选488d514。归档总结scope/page proof、DOM/SPA cleanup及Provider0，引用validate1055Node/15Vitest/typecheck、显式WXT预算和marker1/1。文中的共享总预算/清理表述是自查结论，必须与本篇逐分支实现及测试输入并读，不能抹去body小片门槛、无限新load或剩余listeners。历史240未运行不覆盖后来240归档。

<a id="file-task240"></a>
### docs/tasks/240/task.md
[docs/tasks/240/task.md](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/docs/tasks/240/task.md)；blob `c88b2367567e6e18bc65019ae53b9c6344cbb0fc`。依赖239，仅QA不新增业务；目标A真实保存/重启离线→B安全返回→C站点marker/SPA，合成输入/mock Provider。矩阵明确四spec的角色及Node/contract/storage权限/事务/TTL/预算反例，完成标准为validate+显式WXT+四spec命令全PASS与固定fingerprint；不得外推D、其它浏览器/发布。目标列“应覆盖”不等于marker spec逐项已断言。

<a id="file-state240"></a>
### docs/tasks/240/state.json
[docs/tasks/240/state.json](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/docs/tasks/240/state.json)；blob `8e1e81d3e8c820575b69ce446da67867f1bca995`。completed/main，candidate1bbfdfb001f73f3175f0b47c9935cd4e486f3b71，sync1faf7d79c62d60eeb8f704c99fd94e65ef486c1f，PR291，merge03d8126877ebf7640b188495961c73b8762281da，result=READING_ABC_PASS。配置三命令并要求产物；“继续241”是流程索引，不是本导读的执行授权。当前main已到1304166，按固定身份保留其历史验收，不擅改状态或补虚假现在运行。

<a id="file-acceptance240"></a>
### docs/tasks/240/acceptance.json
[docs/tasks/240/acceptance.json](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/docs/tasks/240/acceptance.json)；blob `499272cc4e56094e3fa63813969e7a0459c62018`。冻结2026-10-04T01:49:34.343Z、candidate1bbfdfb、Git tree96705a0c525a458c09ea25d63ce8128ea45d0e01、inputTree db6042b1ebd9915bdc6e5bc490dac0c98c792d4fbfa81850c436ecf0bfdde513。相同Node/npm/Chromium，validate57,569.273ms、build2,230.906555ms、四spec43,418.009837ms各PASS/exit0，并有开始时间/日志hash。包fingerprint仍47bf5a9…4647，decision=READING_ABC_PASS。

限制列D/AI、Chrome102/其它浏览器/隐身/商店未运行和既有audit告警；这些是该候选范围，后续241/242的独立实现/归档不在本章判定。报告未给当前1304166的重建包，不能拿旧fingerprint声称最新streaming输入已验收。本轮也未读取原始日志验证时长数字。

<a id="file-review240"></a>
### docs/tasks/240/review.md
[docs/tasks/240/review.md](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/docs/tasks/240/review.md)；blob `0967035902d0a22ac1a318daacd5783768e37ae4`。基线33ab3ea、无生产改动、候选1bbfdfb的主Agent综合自查；记录validate1055Node/15Vitest/strict typecheck和四Chromium spec9/9，分解为A六个、handoff/return/marker各一个。PASS涵盖这些输入的保存/重启/离线/近64MiB导出/worker/quota、返回状态、DOM/Escape、marker/SPA及历史Provider0。“无任务内FAIL/BLOCKED”保留原归档含义，不能扩为没有任何静态缺陷、全Issue矩阵/长期性能或隐私保证。

[33ab3ea→03d8126 比较](https://github.com/CoderLambert/translateflow-plugin/compare/33ab3ea2a38ce591b622ba06739344858d7da403...03d8126877ebf7640b188495961c73b8762281da)仅7个docs/tasks文件，说明#291主要补验收归档；#292/#293后续运行时变化另登记待复核。本章纠正此前概括的#240 NOT_RUN，同时严格保留“本轮未运行”。

<a id="classic-current"></a>
## 13. 当前 authored→generated 关系

<a id="file-record-entry"></a>
## scripts/reading-record-entry.mjs

[scripts/reading-record-entry.mjs L1–L9](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/scripts/reading-record-entry.mjs#L1-L9)；blob `ef3bec11519fbb8cf82005e5c7eb4ab8a0638d44`。

当前entry保留record-access→record-client→handoff-client→return-card→page-markers→record-status→selection/controller七个side-effect imports，**再导入quick-control-view、quick-control**。没有状态/export/恢复，顺序是装配依赖；它仍由reading-content-classic.mjs打包为自包含minified IIFE（chrome102编译目标），不能把文件名Reading误读成只含Reading业务。

[src/shared/constants.js L55–L68](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/shared/constants.js#L55-L68)仍先加载rich-details再reading-record，Quick Control两源已不单独出现在CONTENT_SCRIPT_FILES。源码应改owned输入再生成，不能手改[src/content/reading-record.js](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/content/reading-record.js)；该输出本轮只记录映射/当前blob，不因三个minified物理行算全文解释。[src/content/reading-source.js](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/src/content/reading-source.js)仍从source-snapshot/resolver entry生成，相同blob连续性保留前章。未运行生成器，未声称当前bundle与输入重建字节已由本轮验证。

<a id="test-classic"></a>
## tests/reading-content-classic.test.mjs

[tests/reading-content-classic.test.mjs L1–L13](https://github.com/CoderLambert/translateflow-plugin/blob/13041666b253ecf9aa86b3ff5edfa677dde01c05/tests/reading-content-classic.test.mjs#L1-L13)；blob `b63da43cbe5add3e330abc0961a3558bc1091c35`。

一个Node async test先checkReadingContentClassic，实际调用Vite内存生成并比较两个checked-in输出；再要求reading-source/reading-record在Content清单、九个Reading owned源不在清单。新增第二循环要求quick-control-view/quick-control也不单独列入。无浏览器、页面交互或rich-details前序的直接断言；测试读取不是执行。改entry/source/构建依赖要重验漂移与包清单及触及的真实用户入口，纯文档不用启动它。

<a id="next-slice"></a>
## 14. 本轮完成与剩余范围

主用户链已能从站点开关追到真实文档证明、page-scoped cursor/最小摘要、批量位置判断、UI数量和history deep link，再到修改/失效/暂停/删除/撤权/取消边界。新增的完整解释严格对应本章20文件，底层projection、access和其它源码增量仍按coverage保留局部/待复核。旧单次return章节负责handoff/临时卡，不把marker生命周期混成那套三次重试。

下一步按独立授权核对具体合同差异或继续未覆盖模块，不能由本次文档任务启动产品修复、测试、合并或发布。本轮全树增量共15新增/16变更；本切片之外只做清单同步，不把assistant streaming/grounded turns算已解释。
