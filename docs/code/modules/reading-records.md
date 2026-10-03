# Reading：逐文件说明

[功能完整链与产品断点](../features/reading-records.md) · [首页](../README.md) · [已解释的来源捕获](selection.md#file-source-snapshot)

固定源码 `d5e308a709c008acf6b277d466d020f13025bdca`；2026-10-03复核。以下19个生产文件完整读取并逐一说明；其余共享合同、入口和测试仅本切片相关边界。本文不运行代码、测试、安装或构建，全部运行验证 **NOT_RUN**。计数不重复既有source-snapshot/controller/index，引用测试不计测试文件完整解释。

## 覆盖索引

- [src/background/reading-record/runtime.js：运行时装配与所有权](#file-runtime)
- [src/background/reading-record/policy.js：页面身份与有限隐私策略](#file-policy)
- [src/background/reading-record/access.js：浏览器原生身份与受控证明](#file-access)
- [src/background/reading-record/service.js：v2 请求编排与隐私安全响应](#file-service)
- [src/background/reading-record/operations.js：有界临时 operation 注册表](#file-operations)
- [src/background/reading-record/idb.js：唯一直接 Reading IndexedDB adapter](#file-idb)
- [src/background/reading-record/storage-state.js：meta、代次与共享事务规则](#file-storage-state)
- [src/background/reading-record/write.js：BEGIN、原子保存与真实取消收据](#file-write)
- [src/background/reading-record/management.js：授权管理与删除代次](#file-management)
- [src/background/reading-record/query.js：最小化读取、字面搜索与revision游标](#file-query)
- [src/background/reading-record/repository.js：短事务门面与单链分页令牌](#file-repository)
- [src/background/reading-record/export-reader.js：短事务的连续 JSON 流](#file-export-reader)
- [src/background/reading-record/exports.js：导出背压、重试和结束确认](#file-exports)
- [src/background/reading-record/subscriptions.js：只读 revision 失效端口](#file-subscriptions)
- [src/shared/reading/constants.js：协议、版本与资源预算](#file-constants)
- [src/shared/reading/identity.js：分组键、源摘要与同位置证明](#file-identity)
- [src/shared/reading/previews.js：后台一次生成轻量列表投影](#file-previews)
- [src/shared/reading/export.js：分块传输响应校验](#file-shared-export)
- [src/shared/reading/invalidations.js：无内容的 scope 专属失效合同](#file-invalidations)

<a id="file-runtime"></a>
## src/background/reading-record/runtime.js：运行时装配与所有权

blob `7d754367448ac1712ef90c7528bf05900f6759e7`；[完整源码 L1–L42](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/runtime.js#L1-L42)。

**调用、输入输出。** router 将 Reading 消息交给 handleReadingMessage；background/index 同步注册 Port、tab 更新/删除与权限撤销监听。runtime() 首次使用才创建 repository/service/subscriptions；工厂本身不打开 IDB。默认 learningCenterAvailable=false，不能因路径常量存在就声称学习中心可打开。

**状态与清理。** 单例 current 拥有默认 repository；configureReadingRuntime 先关旧订阅、撤销 service 的会话/operation/export、摘 publisher，只 close 自己创建的 repository。注入 repository 属于调用方，不代为销毁。新配置返回 publishInvalidation，repository 在提交后调用它。isReadingMessage 只检查 reading. 前缀，因此旧/未知方法也进 v2 validator，获得显式错误。handleReadingPort 对其它名字返回 false。

**导航与失败。** loading 或存在 url 字段都 invalidateTab 并 closeTab；removed 则 forgetTab；任何权限撤销 revoke 全部并关 Port。URL 字符串变化即失效，比普通查词页面身份更保守。关闭操作不会删除已持久记录。runtime-storage 测试用会抛错的 indexedDB getter 证明拒绝身份/不可用学习中心的路径不访问库，并验证注入对象不被 close；这些断言已阅读、NOT_RUN。修改监听时机/ownership 时需同时检查 service、subscriptions 与宿主启动。

<a id="file-policy"></a>
## src/background/reading-record/policy.js：页面身份与有限隐私策略

blob `590b38f09cc7529f0e72e7d8262795e2fdbda922`；[完整源码 L1–L34](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/policy.js#L1-L34)。

**输入输出与算法。** derivePageIdentity(rawUrl) 限长并只接受 HTTP(S)，克隆 URL 去 userinfo、sort query；SHA-256 输入是 rp1、origin、pathname、search、hash，输出 rp1:摘要、origin siteKey 和可空 safeReturnUrl。query/hash 对身份有意义，不能套用翻译缓存的 URL 简化。safeReturnUrl 另过敏感参数/片段检查，再要求所有 query 名属于 id/page/p/article/lang/language/chapter/section/v。不可安全回跳只令 locator=null，并不抹去 pageKey 或 siteKey。

**安全与生命周期。** classifyPage 对 mail/webmail/chat/messages 子域前缀、列出的通信站点和 mail/inbox/chat/account/login/settings/admin 等路径保守拒绝；这是有限黑名单，不是完整私密内容检测。requireCaptureSafety 要求 selection/context 都为 safe 且 root=light-dom；unknown 不降级成可存。无持久状态、网络或取消器，异步 hash 后的时序由 access 层复核。

**修改影响/验证。** 改身份算法会影响同页关联、旧库可回访性、operation 和 cursor，需版本/兼容方案；放宽 locator 或 host 规则涉及隐私而非普通 UI 改动。reading-access 的文章 query/hash 和 unsafe locator、reading-access-inline 的 Slack 精确 host/lookalike 断言是相关证据；NOT_RUN。

<a id="file-access"></a>
## src/background/reading-record/access.js：浏览器原生身份与受控证明

blob `41acc833a8d560deb0f632ff710e689521aaa8b0`；[完整源码 L1–L126](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/access.js#L1-L126)。

**职责与入口。** createReadingAccess 为 service/subscriptions 生成后台 access；输入 sender、已校验 method/request，输出 scope、ownerKey、tab/document/navigation/authority generation，以及 Content 的 page/site/安全回跳/标题/selection/proof。调用方 DTO 不能声明自身权限。

**原生身份算法。** native 首先要求 sender.id=runtime.id。扩展 URL 仅固定 learning-center.html 得 extension scope，Popup/Options 为 entry；两者都必须通过 getContexts 按 documentId 找到唯一非隐身 TAB/POPUP、contextId、documentUrl、可选 sender.tab 与 frame0 匹配。学习中心 URL 必须精确无 query/hash；Popup/Options 可含受原生 context 核验的 hash、不能含 query。缺 documentId/getContexts 为 CAPABILITY_LIMITED。documentId 接受 UUID 或 32 位十六进制但原值严格比较，不做大小写归一。

Content 限 HTTP(S)、原生非隐身 tab、frame0、若提供则 active documentLifecycle 和有效 documentId，并要求 sender.tab.url 与 sender.url 一致；再做 policy 与 page identity。track 上限128；authority 在 hash 前捕获，随后用于过期检查。ownerKey 区分扩展原生 context/document，或 Content tab/document；legacy 无 documentId 使用受控 frame0 会话，不相信请求自报身份。

**受控 collector。** readOwnedCollector 用 scripting.executeScript 的 ISOLATED world 定位具体 documentId 或 frame0，调用扩展自有 readingAccessCollector.read。challenge 序列化成 JSON 字符串保持显式 null；要求唯一 frame0 结果和匹配 document。缺 getter 返回 NOT_READY，执行异常/不匹配拒绝。validateProof 校验 nonce、document/selection generation、sourceSnapshot 一致和 captureSafety。register/inspect 的 intent 必须 null；begin/save/detail/cancel 必须精确绑定 action、recordId、operationId。这个接口不是人类点击的密码学证明；真正 trusted UI producer 在当前 main 尚缺。

**会话与竞态。** REGISTER_DOCUMENT 才创建 sessions（最多128），要求请求 generation 等于 proof；其它 Content 操作必须已有同 owner/document/page/navigation session。collector await 后重新比 navigation/authority。isCurrent 验当前 authority、tab epoch、session document；validateCurrent 在返回前对扩展页再次 getContexts。invalidateTab 增 epoch并删相应 session，forgetTab 同时删导航条目，invalidateAll 增 authority 并清 Map。worker 重启自然丢会话。

**失败/修改。** SPA pushState 若让 sender.url 与 tab.url 不同，鲜活注册也会 FORBIDDEN；不承诺任意 SPA 路由无重载恢复。原生权限不足不能由 caller safety、Page postMessage 或缺省 incognito 绕过。相关 reading-access、inline、postmerge、native access spec 覆盖边界，后者用合成 collector/repository；本轮 NOT_RUN。修改 scope/URL/document 判断须联动 DTO、service、Port、真实浏览器 sender 证据，不从测试造身份推断产品 UI 完成。

<a id="file-service"></a>
## src/background/reading-record/service.js：v2 请求编排与隐私安全响应

blob `6c04cd87e3603f709a9f4b32098d14250710b7ff`；[完整源码 L1–L114](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/service.js#L1-L114)。

**完整调用顺序。** handle 先 validateReadingRequest，再 accessControl.authorize。Content 除注册/固定打开外读 repository policy，并复核时序；扩展页不能调用 content-only 的 begin/save/append/summary/cancel/register/consume。authorizeReadingMethod 检查 scope及资源页，dispatch 执行业务，完成后 validateCurrent 再校验响应。这既有入口预检，也保留事务内再验，不把预读 policy 当永久授权。

**分支及 I/O。** 固定打开仅在 learningCenterAvailable 且 tabs.create 可用时打开常量 URL；注册返回 document/navigation/page/site。READS 交 read(context)，Content 的 GET_SITE_RECORDING 不准自选 site；extension 必须给 site。GET_RECORD 返回还要复核 recordId 和当前页。BEGIN 将 caller title/return URL 替换为 native access，要求请求 snapshot/safety 与 collector 完全一致，hash purpose/owner/page/record/revision/language/source 得 fingerprint；交 registry.prepare，再交 repository.prepareOperation，返回 disabled 或 ready/token。

SAVE/APPEND 必须找到同 owner 的 registration；proof snapshot、完整 token、artifact.sourceSnapshotId 都匹配，再 hash artifact。assertCurrent 同时验 access 与 operation selection，交 mutate。CANCEL 允许取已撤销 registration用于重试，收到 repository 真实取消收据后才 revoke。管理操作提交后：删 record 撤该 record 的 operation，删页撤该页，site 设置撤该 site，其他管理撤全部；所有管理撤导出。四个 EXPORT 方法交 export registry。CREATE/CONSUME_HANDOFF 没有真正 dispatch 实现，最终 NOT_READY，不把 validator 当交付。

**状态/错误/影响。** service 拥有 access、operation、export 三个临时控制器；tab navigation/removal 定向撤相应 operation/export，权限撤销全清。repository 缺接口明确 NOT_READY，不伪造空列表/成功。catch 只回 protocolVersion:2、ok:false、error.code；非 ReadingContractError 映射 STORAGE，不向 caller 泄漏原文、URL、stack/error.message。返回被导航阻断并不证明先前事务已回滚，应通过 receipt/重读确认。修改方法需同步 dto/response/lifecycle、repository 和 UI；reading-access/operations/runtime-storage及存储 spec是对应断言范围，NOT_RUN。

<a id="file-operations"></a>
## src/background/reading-record/operations.js：有界临时 operation 注册表

blob `fbb8ebf8ff7e0ed69bb2d6ab60d0c4fb43bcca99`；[完整源码 L1–L93](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/operations.js#L1-L93)。

**数据与算法。** entries/pending 按 JSON([ownerKey,operationId]) 分键。prune 删除已到期注册；usage 同时计算已注册与未重叠 pending，总128、每owner16。prepare 在任何 repository await前占位；相同 fingerprint/代次的并发 BEGIN 共享 promise，不再开一个 preparation；冲突 fingerprint 立即 STALE。已注册重试仍读 live policy，必须得到原 token，TTL不续期。

**登记/输出。** register 校验 token purpose、page/document/selection、旧 recordId/revision 或新记录 revision0、签发/到期时间。sourceLanguage 是由 BEGIN 验证并以不可写属性保存的字符串，SAVE 不从 Provider 结果猜语言。entry 保存原 snapshot、fingerprint、access、token、revoked。get 查 owner/document/navigation/page；assertCurrent 再验 selection；取消专用 getForCancellation 可以拿 revoked entry。

**失效和异常。** prepare 的 reservation guard 检查 Map身份、revocation、原expiry及旧entry；disabled不登记，异常或结束 finally释放对应 pending，不能删除另一 reservation。revoke 只标记 entries和pending，保留用于取消重试/TTL和未完成工作占位；没有 provider 调用、持久化或通用 AbortController。pending未settle不能用过期冒充实际停止。reading-operations/inline 对固定TTL、immutable language、同请求合并、disabled/error/navigation/expiry释放有断言；NOT_RUN。改容量、fingerprint或TTL要与 persisted receipts、service和取消协议同时核对。

<a id="file-idb"></a>
## src/background/reading-record/idb.js：唯一直接 Reading IndexedDB adapter

blob `6c9c2d71b40dcbb57c492e16a895a61fd06b9d81`；[完整源码 L1–L108](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/idb.js#L1-L108)。

**存储模型。** 数据库 translateflow-reading-records，版本1；meta无keyPath，records以record.recordId为key，snapshots/artifacts以recordId+sourceSnapshotId/artifactId为复合key，pages以pageKey，receipts以key。records有recent(-lastLookupAt,id)、page、pageRecent；pages有expires/recent；子行按record、receipts按expires索引。没有访问cache-db、OPFS或chrome.storage。

**惰性打开/恢复。** createReadingDatabase只建闭包。open复用connection/opening；blocked先拒绝但保留pendingRequest，因此反复重试不会堆积不可取消的native open。迟到success若已拒绝/close换epoch，立即关返回连接。只允许从oldVersion0创建schema；未知升级不迁移、不删库。success检查所有store/keyPath/index/unique/multiEntry，失败关闭。versionchange/onclose清缓存connection并增generation；close增generation并关已开连接，不伪称取消尚未结束的native open。

**事务执行。** run先await open并assertCurrent，开包含目标stores的事务，program产生同步generator。每次yield IDBRequest，由onsuccess继续iterator；generator完成再assertCurrent。只有tx.oncomplete返回结果，不把某个put的onsuccess当提交。异常abort；request error保留浏览器默认abort；合同错误原样保留，QuotaExceededError→QUOTA、VersionError→UNSUPPORTED_VERSION，其余→STORAGE。事务内不await网络/timer/hash。

**游标与修改。** only/lower/bound包装IDBKeyRange；collect在同一onsuccess回调continue，可按index/range/limit收集，调用方必须给业务上限，默认并非自动小批量。adapter只负责执行与错误，不替代 repository authority。改schema/索引需迁移策略和真实native验证，不能清库“恢复”。storage-helpers含blocked重试/错误映射；storage spec区分真实native IDB与生产后台消息；NOT_RUN。

<a id="file-storage-state"></a>
## src/background/reading-record/storage-state.js：meta、代次与共享事务规则

blob `b5a082b63e5a41c8ac2568b4e5d1e5098603935d`；[完整源码 L1–L121](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/storage-state.js#L1-L121)。

**初始/校验。** initialMeta 默认enabled=false，consent/data/catalog/export/site代次都1、sites空、count/bytes0。state读取meta.state；只有get及getKey都undefined才视为不存在，存了undefined/false/null等损坏值不能恢复成默认授权。validateMeta拒额外字段、非法计数/代次、重复或不合法origin、排除超过200；保留非排除的短期site tombstone，合计最多200+128。

**授权和状态。** authority运行assertCurrent，必须native verified、非incognito/sensitive/account/editable、合法owner且scope content/extension，再调共享method gate。policy对Content排除站点拒绝，siteRead特例用于读状态；write额外要求enabled。sitePolicy没记录时取全局siteRevision作为默认revision。recordingState Content只得enabled/consentGeneration/capacityReached，extension才有dataGeneration和全库count/bytes。容量提示只表示精确达到上限，不保证下一artifact能放下。

**行/计数工具。** pageState缺页产生generation/revision1的空聚合；detail按record索引读最多limit+1 snapshots/artifacts，再validateRecordDetail保证跨引用。changed总增exportRevision，可选catalog、可选pageRevision。receiptKey是owner+operation。tokenCurrent在事务里重验policy、时钟、consent/site/data/page/document/selection代次，防迟到写。

**清理。** pruneAuxiliary清过期非排除site和无record的过期page tombstone；site清理改变siteRevision。retainSite延长非排除项expiry并限量；pruneReceipts用expires游标逐删。deleteRows先删record的两类子行再record，返回canonical bytes；rebuildPage遍历其records重算count/latest信息与负sortTime，空页删sortTime所以不进recent索引。所有工具受外层事务原子性保护，无自己的持久连接。修改统计/代次可能影响删除、浏览、列表和导出同时成立的条件；storage-helpers与storage-regressions检验损坏meta、clock rollback等，NOT_RUN。

<a id="file-write"></a>
## src/background/reading-record/write.js：BEGIN、原子保存与真实取消收据

blob `dd1028d52576a38c2fde7408b238f69224cba993`；[完整源码 L1–L120](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/write.js#L1-L120)。

**prepare。** 读meta并清辅助tombstone，验policy/page；禁用返回disabled，不创空record。续写existing必须record存在、首轮revision吻合，文本、语言、同page/同document且resolved quote+位置+blockDigest证明同来源位置。registered retry验证旧token实时代次并原样返回。新operation留site/page短期metadata（空page有expiry），由后台newId造recordId，返回冻结时间范围和全部代次的token。

**事务前验证。** validatedWrite查registration未revoked、owner/navigation、token全等，校验snapshot/artifact及source关联；并行计算artifact/source/token三个digest，核对service digest和snapshot.sourceDigest。crypto await发生在事务外。随后append在同一readwrite内重新检查meta/policy/token、current/op.revoked，清过期receipts。

**幂等与冲突。** receipt按owner/operation标识，tokenDigest不符或cancelled拒绝。相同artifactId+相同digest且record仍存在返回原saved并duplicate:true，不再计数；同ID不同payload拒绝。expectedRevision取receipt.lastRevision或token.recordRevision，外部改record导致REVISION_CONFLICT。snapshot ID不能换内容，artifact不可重用。首次非assistant artifact为本operation计一次lookup，迟到rich与assistant不额外计；新record初始化lookupCount1。已有lastLookupAt取max抵御时钟回退。

**原子提交内容。** 组装并validate完整detail，按record+snapshots+artifacts的UTF-8 JSON算canonical bytes，检查10k/64MiB，不驱逐旧记录。写receipt、必要snapshot、artifact、record/listItem，page从pageRecent最新lookup行重建标题/locator，不被旧record迟到rich覆盖；更新meta count/bytes、page/catalog/export revision，一起commit。artifact/snapshot每record256，receipt artifacts也限256，receipt数量128。任一失败整体abort，无半条记录；repository提交后才publish。

**cancel。** cancellationInput在事务外hash token；cancel读policy（允许siteRead）、校验expiry/owner/tokenDigest、清旧receipt并写cancelled墓碑。已有committed则返回state:committed和record/revision，否则cancelled；不会删除已成功记录。service在ACK后撤registration，后续append被receipt或generation阻断。存储spec的失ACK重试、最终guard abort、cancel versus commit、多tab/晚rich与容量断言相关；NOT_RUN。改写序/统计/幂等需要连同query查看revision、management和export复核。

<a id="file-management"></a>
## src/background/reading-record/management.js：授权管理与删除代次

blob `ac07b7dd786b6c672a375dbc9fc8b18c2a48d5d4`；[完整源码 L1–L51](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/management.js#L1-L51)。

**输入/职责。** manage是repository.mutate调用的同步generator，只有service允许的extension管理请求能进；每次读meta、验policy、清辅助记录，返回严格DTO数据。SET_RECORDING比较expectedConsentGeneration，写enabled且无论开/关都增代次；SET_SITE_RECORDING比较该site revision、限制200个排除、提升全局siteRevision并给site tombstone TTL。暂停/恢复不清历史，却令旧token不能复活。

**删除。** CLEAR_RECORDS比较expectedDataGeneration，清records/snapshots/artifacts/pages并清count/bytes，dataGeneration即便空库也增加；consent/sites保留，receipts不在clear列表中，其生命周期仍受代次/TTL约束。DELETE_RECORD必须record存在且expectedRevision一致，删所属子行。DELETE_PAGE按page索引遍历级联删除，即便本来空页也pageGeneration++，空metadata总数有限制。两类删除扣真实bytes/count、rebuildPage并保留空页短期墓碑，changed后原子写page/meta。不能把文档旧概述的“删page receipts”当当前实现，本文件没有该动作。

**结果/影响。** 返回record deleted:true，或deletedCount+page/dataGeneration；repository publish、service撤operation/export发生在commit之后。冲突要求调用方重读决定，不盲目以新revision重发删除。无独立取消机制、无网络，也没有删除cache/词典。管理会影响所有正在读页/导出的revision和写入许可，测试看storage spec pause/resume/site/empty-clear及级联字节统计；NOT_RUN。

<a id="file-query"></a>
## src/background/reading-record/query.js：最小化读取、字面搜索与revision游标

blob `69edd066926f21096513783b2b9ac912b81c9ba8`；[完整源码 L1–L71](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/query.js#L1-L71)。

**查询身份。** queryIdentity绑定owner、authority/navigation/document代次、method、当前Content page或extension过滤page、query和limit。literalMatch只在itemText/pageTitle/siteKey/contextPreview/resultPreview.text里case-insensitive includes；不执行正则、不扫描全部detail。无query直接命中。

**read分支。** 读meta并policy，状态/site读取允许siteRead。GET_RECORD先按recordId取行并检查Content current page，detail完整校验；lastViewedAt=max(firstSeenAt,旧viewed或0,now)，值改变时record revision++、重新算bytes/容量，更新listItem、pageRevision和exportRevision，但不增catalogRevision、不增lookupCount、不改recent排序。read返回committed标记供repository发失效；viewed=false时只读原data。

**分页算法。** Content摘要还取pageState；cursor须identity及catalog/consent/data一致，Content还pageRevision一致。排除站点排序后按offset取limit。records用recent或pageRecent，pages用recent；负timestamp让默认前向游标得到最近在前，同时间以ID稳定断开，下一页lowerBound(open=true)避免重复。page过滤以复合key范围约束；摘要仅recordId/revision/anchor/hasCompletedAssistant，extension list读预投影listItem。条数limit≤100且累计JSON bytes预留envelope余量；遇下一命中放不下则more=true，lastKey保持最后实际扫描位置，未命中也推进。

**生命周期/限制。** 本文件不持有cursor Map；repository把内部key/offset隐藏为opaque token并一次性消费。遍历是有界输出，稀疏search仍可能扫描较多行，不能称全文索引或恒定耗时。查看详情会使并发record写revision冲突/导出中断，却保留global catalog cursor；这是有意分离view与lookup。storage helpers测试字面匹配/identity，native存储及regressions检验cursor和viewed；NOT_RUN。修改排序/preview/search字段须联动indexes、response与cursor失效合同。

<a id="file-repository"></a>
## src/background/reading-record/repository.js：短事务门面与单链分页令牌

blob `86818dfdd0409c3164ce39719d538879a6f1c39d`；[完整源码 L1–L82](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/repository.js#L1-L82)。

**职责/依赖。** createReadingRepository纯惰性工厂，组合idb、state、write、manage、query、export-reader；依赖注入now/randomId/onCommit方便边界测试。每个公开方法将可信context.assertCurrent传给database.run。readPolicy用于Content预检；真正read/mutate/prepare/cancel/export/invalidation各自事务再验policy。close摘publisher、清cursor并关adapter，不清用户数据。

**readContext完整流程。** 先prune过期且非busy的cursor。带cursor要求存在、非busy、queryIdentity相等。列举类请求同步reserve并标busy，上限128，不给并发消费分叉；初始请求也占位。GET_RECORD先readwrite更新viewed，只有QUOTA/CAPACITY才以readonly/viewed=false重试，仍可读已有记录；其他错误原样传播。commit后publish。列表成功消费旧token；more时生成新opaque token，保留原expiry，不续10分钟TTL。失败时新reservation删除；未过期旧cursor恢复非busy供原请求重试。cursor过期不会留槽，但不会伪取消正在进行事务。

**其余接口。** prepareOperation事务前生成候选recordId；mutate的artifact hash/验证在事务前，append或manage在readwrite，duplicate不publish；cancelOperation先算digest再事务。readInvalidationState给Content pageRevision、extension catalogRevision，均附data/consent代次。open/check/readChunk/finish/cancelExport均短readonly，position保留在外层registry。publisher错误被隔离，不把通知失败伪装为已提交写失败。

**重要语义。** GET_RECORD返回可能成功但未更新lastViewedAt（容量降级）；通知是commit后提示而非可靠事件日志，UI需重连/焦点重读。工厂不访问库不代表所有授权读取不打开库。变更cursor、transaction范围、publish和重试需要测试跨页128次以上、失ACK、viewed与导出revision；runtime/storage-helpers以及native storage spec相关，NOT_RUN。

<a id="file-export-reader"></a>
## src/background/reading-record/export-reader.js：短事务的连续 JSON 流

blob `3e5d9c1d7d65ec8a35f58865afcd22e332a41ce6`；[完整源码 L1–L83](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/export-reader.js#L1-L83)。

**入口/数据。** open通过exportState查policy、绑定exportRevision/exportedAt，返回内部position（owner、phase、record/row/afterId、offset、sequence、eof）。chunk/finish每次再次核验固定revision，不建立跨消息长事务或全库快照副本。records按主键稳定顺序；子行按recordId+snapshot/artifactId范围顺序。

**状态机。** segment依次header→record→snapshots→artifacts→between→end；输出真实连续JSON的一小段，可在record或字符串序列化行中间停。position含rowId/offset让下次重读相同canonical行续接，afterId避免重复；本体可能大于单chunk，不需要整record一次发完。chunk的owner/sequence/eof必须匹配，累积raw≤min(maxChunkBytes,256KiB)，escaped JSON字符串字节≤1MiB-2048，空片段报LIMIT，结束位置sequence++。finish要求eof与sequence=请求sequence+1。

**Unicode算法。** safePrefix二分可放前缀，同时算UTF-8 raw和JSON转义后bytes，探测UTF-16高低代理对边界并调整，不能把emoji拆到两条响应。它不是任意完整JSON parser；片段只有按sequence拼接后才是完整export。

**失败/修改影响。** 任一写/查看改变exportRevision导致INTERRUPTED，消费者须丢未完成缓冲重新开始；取消不在此函数伪造回滚。每次短事务可能序列化一行，但不getAll全库。改字段/phase/order/budget要联动export registry、shared/export校验和保存格式，核对反斜线/中文/emoji与大record；storage-helpers、storage spec有边界断言，NOT_RUN。

<a id="file-exports"></a>
## src/background/reading-record/exports.js：导出背压、重试和结束确认

blob `10e7b81e0de3bf42728a7b74424c9541f95918fc`；[完整源码 L1–L131](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/exports.js#L1-L131)。

**准入/所有权。** createExportRegistry持有sessions，只有service授权后调用。start在openExport await前reserve，owner最多1、global2，含starting/active/finishing/cancelling以及仍有work的会话；总receipt≤128。10分钟TTL固定。tracked把每个repository promise记入work，chunk/check另入reads，settle才移除，因此撤销/过期不提前释放真实未完成工作的槽位。prune只删过期且无work。

**start/next。** open返回先验证metadata再变active；原reservation已取消/撤销/过期则不能复活，失败且仍starting时删除。get校验owner和navigation。next只准nextCursor或最后一次lastCursor；同一pending cursor共享promise。同lastCursor重试先checkExport，await后再比cursor与原buffer，避免并发前进后偷换块。新块通过raw/escaped响应验证后才推进position/sequence/cursor，只缓存最后一块。失败不前进，旧更早cursor不能无限重放。

**finish/cancel。** done仅EOF，finish还要求没有pending、nextCursor=null、lastChunk.done和精确sequence，然后同步变finishing，通过repository.finishExport最终revision/position检查才生成finished收据并释放buffer。已finished精确sequence可重试；不能把EOF叫下载成功。cancel对finished/cancelled返回真实终态，对finishing/cancelling拒绝“回滚”；先同步cancelling阻断交付，再等待cancelExport及已在途reads/pending settle，确认后返回cancelled。start/finish不在reads等待集合；失败/超时令interrupted而非虚构ACK。revoke保留finished收据，其余interrupted清buffer；已交付文件无法撤回。

**消费者/验证。** registry只提供片段和finish收据，没有Blob/download UI；当前学习中心消费者缺失。若repository永不settle，保留有限槽位，不能假称物理取消。operations、access-concurrency/postmerge覆盖等待、retry race、TTL、slots和finish/cancel竞争；生产/native存储spec补revision持久层，本轮NOT_RUN。改任何终态需同步下载者“finish ACK后才交付”的合同。

<a id="file-subscriptions"></a>
## src/background/reading-record/subscriptions.js：只读 revision 失效端口

blob `063d43fac37f9eb4e0243b20a0b03441efefe930`；[完整源码 L1–L66](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/subscriptions.js#L1-L66)。

**connect。** Port只准reading.invalidate，不接受caller payload/scope；任何onMessage都会断开。先装disconnect清理，再按128上限reserve pending entry，之后authorize(GET_RECORDING_STATE)，仅content/extension可订阅。native sender有tab先记录，无tab的extension等待getContexts解析。授权后检查entry未被删/未被导航barrier命中，读取repository当前失效state并assertCurrent，严格校验后active+postMessage。

**发布与最小数据。** repository commit后调用publish，遍历active，每个重新短事务readInvalidationState，含政策及current检查；Content只pageRevision/dataGeneration/consentGeneration，extension为catalogRevision，消息没有原文、URL、Q&A、总记录数。异常关该订阅，不转发任意消息、不承担assistant流。首次connect失败可回稳定error code并断开，post/disconnect异常均被兜住。

**导航/清理。** closeTab对已知同tab立即disconnect；尚不知tab的pending entry记录最多128个invalidatedTabs，超过界限关闭该未解析entry；授权后barrier清空。close清所有，onDisconnect删除Map；迟到授权或repository完成不能复活closed entry。listeners由Port生命周期结束，没有持久历史。改准入、pending ownership或payload需同时测slot回收、无sender.tab原生扩展、导航中授权竞态；access-concurrency/postmerge/native access对应，NOT_RUN。

<a id="file-constants"></a>
## src/shared/reading/constants.js：协议、版本与资源预算

blob `c166d53aa0a55611198c7c949dc1482401a872e9`；[完整源码 L1–L117](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/constants.js#L1-L117)。

**合同。** schemaVersion=1与protocolVersion=2分开：存储模型版本未因分块传输而升成2。固定learning-center.html只是路径，注释明确还非built asset；reading.invalidate是专用Port；projection tf-source-utf16-v1、item key ri1。

**范围与依赖。** selection/context字符限制复用selection-explanation；其余集中限定field、request128KiB、artifact64KiB、record10000/total64MiB、page100、每record256 snapshots/artifacts、list1MiB/detail32MiB、export256KiB、operation16/owner128global/10min、export1/owner2global/10min、site exclusions200及扫描预算。字符上限与UTF-8字节是两道检查，容量是应用canonical JSON，不等同磁盘占用。

**方法和错误。** READING_METHOD列所有v2命令，包括未实现handoff；ERROR稳定列BAD_DTO/NOT_READY/CAPABILITY_LIMITED/FORBIDDEN/DISABLED/STALE/REVISION/CAPACITY/STORAGE/QUOTA/INTERRUPTED等。CONTENT_METHODS是允许的本页子集，不能管理全库。LOCATION_STATUS保留resolved/ambiguous/missing/not-loaded/unsupported/permission-required。只导出纯常量，无状态/副作用/取消；改任何值应重审request/response、持久兼容、limits测试及UI，不能靠增加上限绕过性能安全。contract-v2与DTO/lifecycle测试相关，NOT_RUN。

<a id="file-identity"></a>
## src/shared/reading/identity.js：分组键、源摘要与同位置证明

blob `aefa6132253ade059de341f7bcc42e1c9f2d8d4c`；[完整源码 L1–L38](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/identity.js#L1-L38)。

**函数输入输出。** createReadingItemKey把选文NFC、折叠ASCII空白并trim，sourceLanguage trim，构成ri1:JSON([language,text])；保留大小写，不是record主键。createSourceDigest对projectionVersion/selectedText/contextMode/contextText的数组JSON做SHA-256，不含页面位置，不能单独证明同一地点。

sameSelectionIdentity要求存在、正selectionGeneration和sourceDigest，比较document/selection/digest；这只是相同冻结选择。sameProvenLocation先严格校验pageKey、document ID及两anchor，任何异常false；只有两个resolved、blockDigest、exact/prefix/suffix、start/end和document都同才true。词同、itemKey同并不自动合并record。

**绑定/状态。** assertArtifactSource要求artifact.sourceSnapshotId/recordId/operationId吻合snapshot与token，snapshot document/selection代次吻合token，否则STALE。纯函数无存储/浏览器，hash异步后由调用方检查时序；不是凭据或签名。write.prepare用于existing续写，validatedWrite用于artifact关联；修改normalization/digest/proven-location会影响已存itemKey验证及跨位置隔离，需同步source/record/write及版本兼容。contract-lifecycle含same-word、malformed anchor、分组大小写断言；NOT_RUN。

<a id="file-previews"></a>
## src/shared/reading/previews.js：后台一次生成轻量列表投影

blob `dd3133180b00dabaf23bb61d9a61bb72bedbfa4e`；[完整源码 L1–L28](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/previews.js#L1-L28)。

**输入/算法/输出。** projectRecordListItem(detailValue,siteKey)先完整validateDetail，再去schemaVersion/itemKey/anchor主体，将artifacts复制排序（createdAt降序，同时间artifactId降序），选最新完成artifact。dictionary命中用definitions以分号拼接，无命中诚实显示No dictionary result；translation取text，assistant取assistantAnswer。resultPreview≤240 UTF-16单位，contextPreview≤160且来自同sourceSnapshotId的snapshot；prefix在边界是高代理时后退，避免拆emoji。

统计所有assistant artifact得assistantTurnCount/hasCompletedAssistant；locationCapability看保存时anchor position/quote是否存在，不能解释成当前DOM已重定位。返回validateRecordListItem结果并保留record基本字段、siteKey；不把所有detail交UI再筛。无独立状态/IO，write事务存储投影，query直接读它，GET_RECORD的viewed更新只改revision/lastViewedAt。

**边界/影响。** artifact.createdAt是排序字段，非网络到达顺序；缓存的列表文本会受选择算法变更影响，修改后要考虑已有listItem是否需重建。NOT_RUN：contract-v2检验latest artifact与exact snapshot/no-hit，response测试检查最小化projection；浏览器列表产品尚未交付。

<a id="file-shared-export"></a>
## src/shared/reading/export.js：分块传输响应校验

blob `c6196a640f129630823deeb33fb56ca501389aef`；[完整源码 L1–L32](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/export.js#L1-L32)。

**输入输出。** validateExportResponse按四个export方法白名单字段返回规范化数据。start要求exportId/revision/expiry/非空cursor；next要求sequence、jsonChunk、nextCursor、done、revision，同时限字符和UTF-8≤256KiB，正则拒不成对UTF-16代理，done必须等价于nextCursor=null。它有意不JSON.parse单chunk：一条record可跨块。

finish要求state=finished和精确ID/sequence/revision；cancel形状只许state=cancelled或finished。外层完整envelope的1MiB转义预算由service/registry校验，本文件不证明owner、存储一致性或实际文件落盘，也不管理网络/取消资源。非法结构抛合同错误由service稳定回传。修改chunk上限、EOF或状态语义需联动export-reader/exports及未来下载消费者；contract-v2中raw/escaped/Unicode边界与operations响应验证相关，NOT_RUN。

<a id="file-invalidations"></a>
## src/shared/reading/invalidations.js：无内容的 scope 专属失效合同

blob `e8ea3e242dc2cdbfe5383f74e104ded395e9618b`；[完整源码 L1–L14](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/invalidations.js#L1-L14)。

**输入/输出。** validateReadingInvalidation(value,scope)只接受content/extension；content只允许pageRevision，extension只允许catalogRevision，另加protocolVersion/type/dataGeneration/consentGeneration。object拒未知字段，版本必须2，type固定reading.invalidate，所有revision正整数，返回重建的小对象。

**调用/状态/影响。** subscriptions connect与publish在后台生成之后调用。没有receiver身份、存储、timer、取消或自动重拉逻辑；纯结构校验不能代替access和repository授权。加正文、URL或同时暴露global/page revision会突破Content最小可见信息，需要重审消息隐私；改代次字段要同步实际消费者的重读策略。reading-storage-regressions的实际Content Port断言精确字段，access-concurrency/postmerge检验订阅范围与生命周期；本轮NOT_RUN。

<a id="partial-contracts"></a>
## 局部：其余共享模型与验证合同

以下文件本轮已读源码，但这里只解释Reading调用链所需边界，尚不计完整逐文件说明；尤其纯handoff算法存在不等于service已接入。

- [src/shared/reading/source.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/source.js)，blob `ade9433ccc4398b0e82540108d023e2b00d944f8`。
- [src/shared/reading/lifecycle.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/lifecycle.js)，blob `0daf499cdff894e21377df2e1fb19d970711df57`。
- [src/shared/reading/dto.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/dto.js)，blob `5ce3d97212bdb16da111fdc1cb27ec0713902859`。
- [src/shared/reading/artifact.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/artifact.js)，blob `18353fe9063e70388a8e2f6057b63926349cffe4`。
- [src/shared/reading/record.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/record.js)，blob `48e8cbd49aa71b2f539d9de5337bee3a0e88a4aa`。
- [src/shared/reading/response.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/response.js)，blob `1a9dc09c4e7ab161871c1dc44b508ecc197695a3`。
- [src/shared/reading/list.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/list.js)，blob `9a11885863c3a821cfa71596b3a700b076a860de`。
- [src/shared/reading/validation.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/validation.js)，blob `033ca350eb729fb99da9bf61ee7733d05ca349d5`。

- source.js：validateSourceSnapshot要求schema1、projection固定版本、contextMode与contextText一致、anchor.exact=selectedText，position长度按UTF-16而不是码点；resolved必须position+blockDigest。projectSourceSegments是纯投影参考，跳excluded、blockStart加换行、折叠ASCII空白并保留DOM offset mapping，inline不凭空加空格。实际DOM policy/scan由既有Selection链承担。
- lifecycle.js：token有purpose、consent/site/data/page/document/selection代次、recordId/revision、issued/expires，最长10分钟；authorizeReadingMethod区分entry/extension/content并保护resourcePage。checkOperationScope/checkWriteEligibility提供纯状态比较，不读取实际浏览器或存储；checkCapacity不驱逐；applicationBytes是每行JSON的UTF-8总和。handoff只定义1分钟一次性资格检查，当前service没有创建/消费实现。
- dto.js：请求先限128KiB，版本必须2、字段白名单；BEGIN的itemText与snapshot选文一致，recordId/revision同时null或同时合法。SAVE/APPEND要求token与artifact record/operation匹配，lookup不能装assistant，assistant必须对应purpose。分页默认30、上限100；cursor要明确null，不能用undefined偷换。siteKey可选性由service按scope补语义检查。
- artifact.js：每artifact≤64KiB，仅dictionary/translation/assistant。dictionary hit需definitions和provenance，no-hit definitions必须空；Provider来源只provider/model/promptVersion/fingerprint，无credentials。assistant要求完成答案、action、thread/turn/branch关系；不接受rawHTML或任意额外属性。此处结构校验不证明Provider结果真实可信。
- record.js：record验证itemKey、anchor、timestamps/revision；detail限制snapshot/artifact各256，ID唯一、artifact引用存在且同record；assistant同thread固定source/action，parent/regeneration须存在且时间/branch规则成立，DFS拒环。validateReadingExport还限10000/总bytes，不能拿其存在替代流式导出终态检查。
- response.js：每种method显式重建success shape，普通响应≤1MiB、detail≤32MiB；content/entry输出范围再次收窄，error只有稳定code。begin的disabled无token；cancel的committed需record/revision。结构校验不替代native authorization。
- list.js：摘要不含全库/正文；record list包含bounded preview、assistant count和保存时locationCapability；列表项唯一，limit及nextCursor受限，空items不能携带nextCursor。pageList要求recordCount≥1，空tombstone不会当普通历史页展示。
- validation.js：只接受plain/null-prototype object并拒额外key，各字段自行保证必填；字符串长度是UTF-16，另有JSON byte校验；ID/UUID/digest/pageKey/origin格式各不同。safeReturnUrl只HTTP(S)、无userinfo，拒敏感参数/fragment及@，不是对所有PII的万能检测。ReadingContractError内部含path，service对外只code，不能把原error.message直接暴露。

**修改联合影响。** schema、normalization、response budget与scope变化要同时检查持久旧记录、native sender、source capture及未来UI，不能靠清库或放宽权限“兼容”。contract-dto/lifecycle/response/v2是对应测试设计范围；本轮NOT_RUN。

<a id="partial-entry-router"></a>
## 局部：实际入口、已有来源与历史文档

- [src/background/index.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/index.js)，blob `ed1670cff60eba5b7a411b07ec2b259746e7552b`。
- [src/background/router.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/router.js)，blob `31225c7b39bdbaba5bd64524a060623382cb6ef6`。
- [popup.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/popup.js)，blob `b83544b190f2dedccc1d7472413ec9216b472e4f`。
- [options.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/options.js)，blob `7cffc2509a010eda8fdb620c36392ac71f71393c`。
- [src/content/selection/controller.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/controller.js)，blob `417461e57cf3e3500439ae9ec7d56ed77a45f58d`。
- [src/content/selection/source-snapshot.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/source-snapshot.js)，blob `4c332bca620810beb389d2ef77d6710a05274e88`。
- [docs/reading-access-v1/README.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/reading-access-v1/README.md)，blob `976bfde64682afe9e2f4a328eb951eb24e09a550`。

index.js L14–18注册Reading各监听，router.js L71–79优先识别reading.*并保持异步sendResponse通道与v2原样envelope。其它background业务不由本轮解释；index/source-snapshot/controller已在前章完整解释，继续复用原覆盖，不覆盖其coverage文档锚点。

controller.js L412–418同步freezeQuerySource并暴露getQuerySource；source-snapshot中的本地documentGeneration不是受信身份，ready后的snapshot也不会自行持久化。本轮读取的Popup/Options根脚本未包含Reading调用。runtime reader期待的readingAccessCollector在main生产内容脚本中尚无提供者；E2E注入不能补算产品实现。

reading-access-v1/README.md保留#232时期“repository absent”的旧开头，当前runtime默认createReadingRepository已不同；它描述#233的“未来接口”现在可与repository逐项对读，但产品collector/学习中心仍缺。它关于page delete清receipts的文字不是当前management代码事实，本章按代码说明代次/TTL防复活。不修改旧规范或业务，仅把分歧记录在导读。

<a id="test-boundaries"></a>
## 局部：测试设计能证明什么

本轮静态阅读相关测试入口与重点断言；未逐一解释每个fixture/helper，因此这些测试全部保持局部。所有命令、浏览器、实际IDB/下载验证 **NOT_RUN**；不存在本轮PASS。后续获准验证应按package.json/CONTRIBUTING选择现有Node、构建、Playwright入口，不能假设validate含E2E。

- [tests/reading-runtime-storage.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-runtime-storage.test.mjs)，blob `16f5b80197160fdd717777dbd0efe719599c4025`。
- [tests/reading-storage-helpers.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-storage-helpers.test.mjs)，blob `c3b75a44726b2181063844e896c4ff66a4e0d813`。
- [tests/reading-operations.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-operations.test.mjs)，blob `cb8e8c5ba69777d83ed528e69ae0a47361c1ec7a`。
- [tests/reading-access.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-access.test.mjs)，blob `200ff69921b4c93110564d6228ce555a4b2cf671`。
- [tests/reading-access-inline.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-access-inline.test.mjs)，blob `485931b9a7fe3bd0292c40400e78dce62a73b4e9`。
- [tests/reading-access-concurrency.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-access-concurrency.test.mjs)，blob `7d655ff7c9b771c918cf76cabe58f88e062f5872`。
- [tests/reading-access-postmerge.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-access-postmerge.test.mjs)，blob `c675317d11e985ba7dcd0441f160dc75ce78949b`。
- [tests/reading-contract-dto.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-contract-dto.test.mjs)，blob `582ac9e74c286daa508d4ef34d5085076b8e3b86`。
- [tests/reading-contract-lifecycle.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-contract-lifecycle.test.mjs)，blob `ff2d56f8c48eedd37c887d87b4705fc9c6f44d05`。
- [tests/reading-contract-response.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-contract-response.test.mjs)，blob `e49f1c9f89a1b69295c9dc60899e9047f8c38721`。
- [tests/reading-contract-v2.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-contract-v2.test.mjs)，blob `45308fcbdfbdd0275d8bed8a5b115cdd69f689ba`。
- [e2e/reading-access.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/reading-access.spec.mjs)，blob `9df5bf5d7e9d4a7a8a2f566a685b2a0dd1301986`。
- [e2e/reading-storage.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/reading-storage.spec.mjs)，blob `ec3e37be2a2a3533da23dde2d688e0f892d93ab9`。
- [e2e/reading-storage-regressions.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/reading-storage-regressions.mjs)，blob `d633b85234488c741f868fda8211b34a6bc3221b`。
- [tests/reading-ui.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-ui.test.mjs)，blob `b882a9f81877ee23aa251a2f72bf04c34ae2d7c4`。

**惰性与基础（runtime-storage、storage-helpers）。** indexedDB getter若被触碰即throw，断言拒绝sender/缺LC不打开库；runtime替换摘publisher但不close注入库。helpers断言safePrefix中文/emoji和raw/escaped双预算、字面搜索非regex、query identity绑定、meta getKey区分缺失/存undefined、blocked open多次重试只保留一个native request。它们没有完整跑真实用户数据或学习中心。

**operation和访问（operations、access、inline）。** registry caps 16/128、固定TTL、sourceLanguage不变、owner/selection隔离、BEGIN reservation与同identity共享；注入repository double测试cancel receipt，但该double明确不能证明IDB commit/cancel顺序。nativeBrowser模拟context用于exact URL/incognito/frame/document边界。access的collector测试直接装合成getter，证明challenge序列化和错误形状，不证明真实点击可信。

**并发（concurrency、postmerge）。** deferred promise控制connect/open/chunk/check/finish/cancel时序；断言128 pending+active Port slots、导航关闭和pending不复活、只有目标tab export撤销、buffered retry不换块、取消ACK前reads必须settle、revoke/TTL不放掉仍在途工作占位。fake promise调度不是所有浏览器时序实测。

**纯合同（contract-dto/lifecycle/response/v2）。** 构造合法/非法/超界DTO，源关联与UTF-16范围、case保留itemKey、容量精确边界、assistant thread/branch/环、content最小响应、protocol2与schema1、chunk代理对/转义，以及最大cardinality detail边界。handoff fixture仅检验合同，不构成生产handoff可用证据。

**原生访问（e2e/reading-access）。** 合成repository与owned collector、受控扩展页面，真实native sender/getContexts/ISOLATED world、导航Port和private message矩阵；测试显式configure learningCenterAvailable:true。只能在该测试边界下说明native授权，不能声称main LC产品存在。

**持久化（e2e/reading-storage）。** beforeAll选择READING_STORAGE_ARTIFACT→TF_E2E_ARTIFACT→TF_I18N_ARTIFACT的第一个已设变量，否则.output/chrome-mv3；显式空路径拒绝。复制完整artifact inventory并核对background SHA未变，再仅测试副本加synthetic learning-center.html、localhost权限、ISOLATED collector和独立storage-probe worker/source closure。生产后台消息测试保存/重复/重启/迟到暂停和export；直接源码native probe测试超过128页、10k记录、近64MiB、空页/清理代次、transaction guard、quota/upgrade等。localhost quota测例自己标明不是compiled-extension quota。不能将direct-source probe、测试加的权限或假页面当实际发行用户验收。

**最新回归（reading-storage-regressions）。** helper由storage spec注册，viewed时钟倒退不推进时间/revision；真实Content summary/Port pageRevision改变而catalog不变；viewed不毁global cursor；malformed meta拒绝且不修改canonical rows。只看测试标题不等于执行，这里仅记录所存在的断言目标。

**容易误读的名字。** reading-ui.test检查sage/beige appearance、译文排版、toast CSS，不是历史记录/React学习中心验收。来源捕获正文复用Selection章，source-position/text-projection及相关E2E是来源定位证据，未在本章计为完整解释；它们也不等于Reading保存闭环。
