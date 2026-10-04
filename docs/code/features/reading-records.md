# Reading：明确查询、真实保存与事务历史

> 2026-10-04 返回原文增量：增量到 main `33ab3ea2a38ce591b622ba06739344858d7da403`：详情 ReturnToPage 已接可信按钮→后台创建新标签/短期能力→Content消费最小摘要→精确定位/临时卡/准确记录deep-link，详见[返回原文完整链](reading-return-to-page.md)与[逐文件](../modules/reading-return-to-page.md)。普通URL链接不等于handoff。当前源码还含site markers，#239/#240集成状态和隐私风险明确分开；下面历史固定版本中“尚未接定位/返回”的表述不再代表这个新增切片，旧Release A证据不外推到它。


[首页](../README.md) · [逐文件说明](../modules/reading-records.md) · [已有划词来源链](selection-and-dictionary.md)

当前产品链清单固定main `c250ce91aff7eb84d1ad8acbe1d4155ad244dc24`；2026-10-03 只读复核。#234 已接通 Selection 的 production collector、结果存档与保存状态，不再是只有后台合同。保留 #285/#235 实际学习中心实现；本轮接上 #286 合入的真实 Release A 用户故事和归档候选证据，区分代码整合、历史运行和本轮静态阅读。

本轮完整复读八个Release A/存储测试与证据文件以及App/useLibrary，详见[验收逐文件章](../modules/reading-release-a.md)。先前保存切片复读范围见[逐文件说明](../modules/reading-records.md)与[Selection 模块](../modules/selection.md)。下文后台事务/导出细节沿用 `d5e308a709c008acf6b277d466d020f13025bdca` 的历史完整说明；清单逐项 blob 比对确认除本轮 runtime/access 及 shared constants 增量外，引用的后台事务文件字节未变，未重读部分仍保留旧源码身份，不冒充本轮审计。本导读本轮所有测试、构建、浏览器、实际下载 **NOT_RUN**；已有任务归档运行另按[候选链](../modules/reading-release-a.md#evidence-chain)列明。预构建产物选择见[构建与测试链](build-test-release.md)。

> #287当前入口补充：[普通网页静态启动→Selection、真实工具栏Popup→固定OPEN→Reading access](extension-startup.md#popup-reading-access)。required站点访问不等于Reading开启；Popup仍仅entry权限。access/service本轮完整复读，#286的TAB driver和显式Content注入只证明下游，不能补作新入口证据，详见[证据对照](../modules/real-entry.md#native-popup-evidence)。

## 1. 用户今天真正能走到哪里

- 仅选择文字/显示“译”chip 不产生 Reading BEGIN 或历史。用户点击自有 UI 后，controller 同步冻结来源并让 record-access 校验 isTrusted+uiHost 归属，production readingAccessCollector 现在实际存在。
- 已开启且本站未排除：明确查询的可保存完成结果会自动进入 Reading 队列；基础本地命中/no-hit、普通翻译/缓存命中、已显示的 rich 摘要和 completed AI 有各自 artifact。
- 尚未开启：只保留当前仍有效的一张有界结果卡，显示“在学习中心开启阅读记录/暂不”，不 BEGIN、不写历史。若后台政策已通过授权入口启用，focus/visible 重读后仅显示“保存本次结果”，还需本卡明确点击，使用新操作存现有结果，不重新调用 Provider。
- 默认 runtime 已启用固定 learning-center.html；Popup/Selection 邀请能进入实际 React 学习中心，完成开启、浏览、搜索、删除与导出。#234 旧 synthetic consent fixture 与 #235 真实 React 证据分开，见[完整页面链](#learning-center)。
- CREATE_HANDOFF/CONSUME_HANDOFF 仍只有合同，service 最后返回 NOT_READY；Selection collector 也没有 detail intent 生产入口，不把后台可读方法等同已完成历史面板/回原文产品。

[#234 本地任务记录](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/docs/tasks/234/state.json) 标 completed/PR #279/mergeHead 19edb542；旧暂停说明是历史状态，不再作为当前实现缺失的依据。source capture、可信动作、后台仓库和学习中心入口各有自己的交付边界。

<a id="flow"></a>
## 2. 从可信点击到保存 ACK 的实际链路

1. **同步冻结与建立 intent。** controller 的 freezeQuery 捕获 Range/选文/bounded context/源 revision；source.ready 只对冻结字符串 hash。record-access.create 只接自有 UI 的可信 click，登记限时 operation。普通结果请求无需等待 digest；Reading 政策链则等 ready 再 REGISTER_DOCUMENT。
2. **先注册、读政策。** record-client 并行读 GET_RECORDING_STATE/GET_SITE_RECORDING；未启用只 invite，排除站点 disabled 且不连失效 Port。production collector 在 ISOLATED challenge 返回匹配 nonce/action/record/operation 的冻结 proof；MAIN world 同名对象或 postMessage 没有此通道。
3. **结果先可用，再存档。** model 把真实基础结果转 draft；translation-query 在缓存命中或 Provider→CACHE_STORE 完成并展示后回调；AI 仅保存 completed、实际发送的固定问题与显示答案。draft 校验、去重、最多八项，保存队列串行；结果展示与 Reading ACK 分别计状态。
4. **BEGIN 延迟到真正 flush。** 已开启自动保存或显式 manual save 才 BEGIN。同位置明确重查可在 pageUrl/consent/site/sourceLanguage/位置证明都匹配时，经本页 summary 取当前 record revision 复用；不是只按单词合并。新位置新记录，BEGIN 本身不生成空 ReadingRecord。
5. **后台授权与短事务。** reading.* 经 v2 DTO→native sender→collector proof→policy/scope→service dispatch；后台替换 caller title/return URL 为 native 值，operation registry 先占位，hash 在事务外。SAVE/APPEND 继续核同一 source/token，repository 事务末尾再查全部代次/TTL/record revision。
6. **只在匹配 ACK 后显示 saved。** receipt/snapshot/artifact/record/page/meta 同一事务提交，IDB oncomplete 后才响应。client 校验响应及 artifactId/recordId，更新 saved/ref/revision；失 ACK 显示“保存确认中断”，可用原 token/artifact 重试，不能为重试再查词或再次调用 Provider。

沿线：[record-access](../modules/reading-records.md#file-record-access) → [record-client](../modules/reading-records.md#file-record-client) → [access/service](../modules/reading-records.md#file-access) → [operations/write/idb](../modules/reading-records.md#file-operations) → [record-status](../modules/reading-records.md#file-record-status)。

## 2.1 rich 显示摘要与 packVersion 为什么要一起追踪

lookup controller 从实际 active pack 返回 packVersion。rich-details 的成功结果交 rich-result-renderer；折叠时只保留 pendingResult，真正展开并渲染后才 onDisplay。renderer 从安全 viewer 的 `.tf-rich-viewer` 取 textContent，纯文本退化取实际 fallback bodyText，输出 id/headword/packVersion/text，而非 rawRecord。

model.readingRich 要求词典 id 匹配且有实际 packVersion，拒绝空/仅词头以及可疑 HTML、占位、资源 URL/路径模式，最后限制八行×240字符；provenance 标 local-rich-mdict、packId/packVersion/sourceEntryId。client 再严格校验整个 artifact。迟到 rich 以 rich:dictionaryId 去重，与基础结果用同一 lookup operation、不同 artifactId；它不是新查词计数，也不保存 MDX HTML、MDD、CSS 或文件路径。这里是有限安全投影，不承诺所有 PII 都能由正则识别。

## 2.2 状态、用户恢复路径与取消

invite→manual→saving→saved 分别表示未开通、已开通但还需本卡明确保存、等待保存、收到匹配 ACK；disabled/not-saved 不影响已有结果复制。版本不兼容提示刷新；陈旧 operation/record conflict/权限/容量等非可重试错误 blocked；STORAGE/QUOTA/INTERRUPTED 提供“重试保存”。已保存基础 artifact 后 rich 失败不会回滚基础记录，不能将 not-saved 文案解释为整个事务历史清空。

关闭/新选择/源 mutation/离页会清临时 drafts、撤本地 intent；close 等在途 BEGIN 获得 token 后仍发实际 CANCEL_OPERATION。cancelled ACK 表示未提交，committed ACK 带已提交 record/revision，不能说关闭撤回了历史。晚 ACK 不得覆盖新卡或倒退已知 revision。focus/visible/失效通知重读政策；删除、暂停、站点排除或 source anchor 变化撤引用，viewed-only revision 可以前移而不改旧 token。unsupported anchor 保留已有快照也不会凭空获得同位置追加资格。

## 3. 三种身份与两种版本不能混为一谈

- `itemKey`是语言+NFC/空白规范化且保留大小写的选文分组键；它不是recordId。相同词出现在不同位置不会自动合并。
- `sourceDigest`只绑定projection/选文/contextMode/contextText；位置证明另外要求page、document、resolved quote前后文、position、blockDigest都匹配。
- `pageKey`是原生URL导出的rp1 SHA-256，保留有意义query/hash，去userinfo并排序query；`safeReturnUrl`可能为null。没有安全回跳地址不代表没有site/page身份。
- 持久模型schemaVersion=1；消息protocolVersion=2。协议变化不意味着把记录schema写2。操作token含授权/数据/页/选区代次，既不是永久凭据也不是signed用户确认。

SourceSnapshot由snapshotId、选文、context、projectionVersion、sourceDigest、document/selection generation、anchor和capturedAt构成；artifact独立保存kind、payload、provenance、sourceSnapshotId、record/operationId。dictionary只存有界纯文本结果及pack来源，不存raw HTML/MDD资源；assistant只收completed，并在detail校验thread/source/branch引用及无环，不保存半截流当完成答案。详见[共享合同边界](../modules/reading-records.md#partial-contracts)。

## 4. 事务为什么要在末尾再次检查

授权和hash都可能await；期间用户可能暂停记录、排除站点、清库、删页、换选区或导航。前面“同意过”不够：

- consent开关改变consentGeneration；站点开关改变sitePolicyRevision；全清改变dataGeneration；整页删除改变pageGeneration。恢复开关不会复活旧token。
- native URL/loading/removed及权限撤销使临时access/operation/export失效；worker重启丢registration，即便持久receipt还在也不能凭旧token续写。
- IDB generator只yield原生请求，最后一步assertCurrent失败会abort整个事务；crypto/hash在事务外，不能在事务中await网络/计时器。
- 同operation同artifactId同digest重试返回原收据；换payload拒绝。先查receipt再对revision续写，保留失ACK重试路径。其它更新造成revision变化则冲突，不能盲目覆盖。
- 第一个非assistant artifact对该lookup operation计一次；迟到rich不再计，assistant续答也不追加lookupCount。late rich重算page metadata时保留真正最新lookup的标题/回跳信息。

容量按canonical record/snapshot/artifact UTF-8 JSON字节累计，最大10000记录/64MiB；不自动驱逐旧历史。应用计数不等同浏览器磁盘实际使用量，QUOTA仍可能提前发生。

## 5. 一个失败与一个取消场景

**暂停与迟到保存。** BEGIN成功→查词结果尚未到→实际学习中心点击暂停提交consentGeneration+1→迟到SAVE进入。registration即使尚能查到，事务tokenCurrent也拒绝旧generation；没有半条snapshot/artifact或空record残留。普通查词Provider任务和Reading保存是不同取消域，本章没有声称Reading暂停自动取消原查询。

**取消与已提交结果竞争。** CANCEL_OPERATION进同一库readwrite序列，写receipt.cancelled。若此前没有commit，ACK为cancelled且record/revision为空；若此前保存已提交，ACK为committed并带原record/revision，不能显示“取消且已撤回记录”。service在真正ACK后才撤注册；失败或导航后的响应不能被UI当取消成功。按顺序取消后迟到写会被墓碑/代次挡住。

**导航边界。** Reading任何native URL更新都使旧token和Port失效，普通query的页面身份可能对tracking/hash更宽容。某些pushState使sender.url和tab.url不同，当前native guard拒绝新注册；不能凭旧source未变就承诺无刷新恢复。

## 6. 已有读取/列表/管理怎样回给消费者

Content只可读本页最小summary、同页显式detail及本页状态。summary仅recordId/revision/anchor/hasCompletedAssistant和页count/revision；不会自动携带原文上下文、URL或全库数。全库LIST_RECORDS/LIST_PAGES、排除设置、删除/清理、导出只给严格allowlisted学习中心extension scope；Popup/Options不是旁路。

repository把internal index key包装为不透明cursor；cursor绑定owner/document/代次/query/limit，10分钟TTL、最多128并发链；每页成功消费旧token并替换下一token，一条长链不永久累积槽位。并发同cursor消费拒绝，错误可保留未过期旧cursor重试。recent按负lastLookupAt和稳定ID索引；搜索只case-insensitive字面includes预览字段，不是regex/全文索引，有限返回不保证扫描恒定。

GET_RECORD可更新lastViewedAt及record/page/export revision，使用max抵御时钟倒退；不增加lookupCount/catalogRevision，也不改变最近查词排序。若viewed写遇容量/配额失败，可只读回既有detail，不强迫用户无法阅读。全库catalog cursor继续有效，当前页summary和导出需看到变化。

管理全部CAS或代次约束：单条删除expectedRevision，consent/site设置expected generation/revision，全清expectedDataGeneration；页删除即空页也增加pageGeneration。清历史保留consent/site设置；删除不碰翻译缓存/词典OPFS。源实现明确无自动清库恢复或驱逐。

## 7. 有界导出与实际下载 UI 的交付边界

START同步占每owner1/global2的slot→仓库只读取得exportRevision与内部position→NEXT背压读取连续JSON片段→EOF→FINISH复核同revision、owner、sequence和eof→消费者才可交付Blob。当前 React exportRecords 已是生产消费者，后台不创建下载文件；成功 FINISH 后才由本页发起 Blob 下载。

- 单chunk raw UTF-8≤256KiB且转义后的完整消息≤1MiB，Unicode代理对不能跨块；单record可以大于1MiB，按row/offset续接，不getAll整库。
- 只保留最后一个buffer重试。重试也读policy/revision，await后核对buffer未被别的NEXT推进；错cursor/旧块/owner不符/TTL报INTERRUPTED。
- 每块、重试、FINISH独立短事务；不长期锁库。中途append/delete/viewed等exportRevision改变必须丢弃未完成结果重启，不能拼混合版本。
- CANCEL先阻止交付，再等已在途reads及repository ACK，失败不伪造cancelled；仍在途的work不因TTL/revoke而释放准入槽。finishing时不承诺取消，finished收据和已给用户副本不可撤回。
- done=true只说明完整流到EOF，不等于finish ACK、更不等于操作系统文件已落盘。

实现入口：[exports](../modules/reading-records.md#file-exports)、[export-reader](../modules/reading-records.md#file-export-reader)、[分块校验](../modules/reading-records.md#file-shared-export)。

## 8. 失效通知与隐私边界

commit后publisher驱动reading.invalidate端口。每个消息发送前再读政策；Content只有pageRevision，学习中心是catalogRevision，另有data/consent代次，不含正文。导航立即断对应Port；pending native授权先reserve，导航barrier阻止迟到connect复活。通知发送失败不推翻已commit数据，消费者不能只信通知：当前 Selection 已在 focus/visible/每次明确查询重读政策，当前学习中心清未确认内容、有限重连并保留手动重试，重启后重读，而不能把Port当永不丢失事件日志。

“本地存储”不等于文本不敏感。Reading独立库保存选文、bounded context和完成答案；仅安全light DOM证据可入，private/未知身份拒绝，有限敏感host/path规则不能宣称识别所有私密页面。导出是可携带明文JSON，当前UI已提醒私人内容与已下载副本不可删除，但不能确认浏览器保存位置/结果。本章没有读取任何用户库、页面、词典私有正文或凭据。

## 9. 读代码得出的测试范围，不冒充本轮运行

此前保存切片的静态证据包括 production collector/client/model 的 VM 测试、translation-query/provenance/新旧注入列表测试，以及 selection-reading-record E2E。此前#235新增实际React组件/导出单测与两个学习中心E2E故事，详见[文件说明](../modules/learning-center.md#test-e2e)。后者用真实随包 UI/collector 与后台 IDB，测试副本添加 synthetic LC、合成词典/localhost 权限；与下方旧合成 collector 的 native-access 测试不是同一层。#234 acceptance 记录 72fc8cdd 上的历史 PASS 与 7 SKIPPED，不能把它说成本轮345d630 PASS；[精确边界](../modules/reading-records.md#test-boundaries)。下方旧测试主题仍保留历史基线语义。

- 纯合同/registry Node测试：DTO bounds、source/branch关系、代次、capacity、并发reservation/ACK，很多使用synthetic browser/repository。这证明断言设计，不替代真实IDB。
- native access spec：真实浏览器sender/context、隔离world和Port导航；fixture注入collector/合成repository并启用测试页面，不证明产品trusted点击链。
- storage spec：复制选定production artifact，检查background bytes未改，给临时副本增加合成LC页面、ISOLATED collector和localhost权限；同时另设直接源码native-IDB probe。生产router/repository消息与direct-source probe分开标注，不能把后二者合成最终LC验收。
- 存储回归包括viewed页revision、不变catalog cursor、clock rollback和损坏meta。reading-ui.test只是阅读外观/译文/toast静态断言，名字不代表Reading历史学习中心UI测试。
- 本轮未执行npm、构建、Node/Vitest/Playwright或下载；所有相关运行 **NOT_RUN**。详见[测试边界](../modules/reading-records.md#test-boundaries)。

## 10. 推荐阅读与最小修改入口

先看[真实保存链](#flow)和既有source-snapshot → policy/access/service → operations/write/idb → state/management/query/repository → exports/export-reader → subscriptions/shared契约。原19文件历史解释保留；本轮新增三份 Reading Content 完整解释，并更新 Selection 的十三份当前文件节。其它共享合同、大入口和测试仍按实际复读/解释范围标局部或待复核，未据“被引用”算完整覆盖。

- 记录为何拒绝：先定位稳定error code和access/policy/token generation，不放宽sender/incognito校验。
- 保存计数/幂等：write + storage-state + operation registration，验证late rich/失ACK/删除竞态。
- 列表和搜索：query + previews + index/cursor contract，避免UI拉全库detail。
- 导出：先分清START/NEXT/EOF/FINISH/CANCEL，联动两种字节上限和真实消费者ACK。
- 产品入口：#234保存和#235学习中心已分别有生产实现；#236现已有#286真实跨页、完整重启、UI导出与quota证据，仍不能把各候选复用汇总改写为一次新全量运行。本轮只更新导读，不补业务代码。

现有规范[reading-access-v1](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/reading-access-v1/README.md)开头仍写repository absent，是#232时期状态；main的runtime已默认装配真实repository，应以固定源码为当前事实。该规范也有旧的页删除receipt概述，当前management并未删receipts；已在逐文件节区分。




<a id="learning-center"></a>
## 11. 实际学习中心：从入口回到可操作历史

[页面逐文件正文](../modules/learning-center.md) · [消息客户端](../modules/learning-center.md#file-client) · [App 状态](../modules/learning-center.md#file-app)

### 入口、首次开启与回原卡保存

Popup learningCenter 按钮或 Selection 的开启邀请 → OPEN_LEARNING_CENTER → router 的 reading.* 分支 → runtime/service → 原生 sender/context 校验 → tabs.create 固定 learning-center.html → WXT HTML/main.tsx → App。默认 runtime 现在传 true；configureReadingRuntime 的注入默认仍 false，不能把测试配置默认当生产默认。Popup/Options 只得 entry scope，固定打开不授予全库权限。Content 固定打开带 nativeEntryOnly，注册前后都能打开但仍受 tab/navigation 约束。

App/useLocale 就绪 → ReadingClient.state 与只读失效 Port → GET_RECORDING_STATE → access/service/repository/query → 独立 IDB meta → extension DTO 返回 UI。首次 Enable 必须可信事件且带 expectedConsentGeneration，后台提交 ACK 后重读。Not now 不改授权；成功后未来明确查询可保存，原卡 focus/visible 重读只到“保存本次结果”，仍需本卡可信点击，闭卡/过期卡不会被重新采集。此处续接[真实保存链](#flow)，不新建第二套采集器。

### 列表、搜索、页面分组与详情

Recent / By page / 提交搜索 → App 的 mode/query/pageKey → useLibrary → LIST_RECORDS/LIST_PAGES（limit30） → query/read → recent 或 pageRecent 索引与轻量 projection → opaque cursor/列表 DTO → Library。搜索是后台不区分大小写的字面 includes，record匹配选文、预览、context预览、标题、site；page匹配标题/site，不是完整答案全文搜索。UI 只在提交后改变 query；切模式清过滤，选页面转 recent + pageKey。列表不逐行 GET_RECORD。

点击记录 → ID-only fragment → GET_RECORD → 同一原生 TAB 身份 + repository → 有界全部 detail → Detail。详情初始只渲染五个 artifact，再每次加五，但网络/消息不是五个一页。所有存储内容用 React 文本节点，sourceSnapshot/provenance折叠，无在线翻译/词典查询；网络离线且无Provider配置可读取本地历史。safeReturnUrl只打开原页，不保证原选区定位。非法/已删ID显示返回列表/重试；浏览器hash导航与返回撤旧响应；Escape返回登记焦点意图，等受限连接重连、有state且列表settled后按recordId重找按钮，失败/空列表回最近记录；未就绪保留意图，详见[App](../modules/learning-center.md#file-app)。

### 管理、删除、取消和重试

Pause/Resume → SET_RECORDING(expectedConsentGeneration)；站点排除/恢复 → Management先读GET_SITE_RECORDING，再SET_SITE_RECORDING(expectedSitePolicyRevision)，原子性最终由后台CAS保证。排除只影响未来记录，既有历史保留；清历史也保留排除清单。

Delete record / page / all → 原生dialog确认 → DELETE_RECORD(expectedRevision) / DELETE_PAGE(pageKey) / CLEAR_RECORDS(expectedDataGeneration) → management短事务 → record/snapshot/artifact/page/meta更新 → service撤对应operation/全部导出 → publisher通知 → App清旧详情并重读 → 更新列表/计数。取消确认或Escape仅关闭dialog，无删除消息；收到冲突/过期错误不会盲目覆盖，提示刷新后重试。删除不碰翻译缓存/词典，不回收已下载副本。

useLibrary用epoch挡旧搜索/旧页回包；续页cursor过期回到首屏，不混拼；App mutation ref阻止重复管理提交。Port断线清未经确认的state/detail并abort导出，最多三次短退避重连，失败留手动Retry。重连重读meta/list，不把通知当可靠历史日志。后台worker重启会丢operation/export session；持久历史可重读，旧token/export cursor不能续传。原#235故事只测offline页面reload；#286另有不seed真实创建后的完整browser/profile重启、移除词典/Provider后offline读不可变快照，以及实际UI近容量seeded导出。证据输入与已记录结果见[Release A故事](../modules/reading-release-a.md#file-release-spec)。

### 导出到用户可用文件

Export JSON → App唯一AbortController → exportRecords → EXPORT_START/NEXT逐块背压/EOF/FINISH → exports + repository/export-reader短事务 → 校验revision/连续sequence/幂等重复 → Blob → a.download → 立即安排Object URL回收。失败/取消/卸载/断线丢本地片段并请求取消；中途内容改变要重新导出，不能续拼两个版本。成功FINISH优先于取消竞态；UI“已生成、已发起下载”明确不保证磁盘保存。保留有界Blob parts不是全库JSON stringify，也不是恒定内存直接落盘流。详见[导出实现与资源清理](../modules/learning-center.md#file-export)。

### 要改哪个用户行为

- 入口/首次开启：Popup及Selection邀请 → App consent → access/service/runtime；同时看isTrusted、CAS和旧卡显式保存。
- 列表/搜索/分组：App + useLibrary + Library → ReadingClient → query/列表合同；同时验旧响应、cursor失效、无逐行detail。
- 历史显示/回原页：Detail + shared record/source/artifact/URL validators；不加入Provider或不可信HTML。
- 删除/站点管理：App/Confirmation/Management → service → management；同时验多标签冲突、历史与排除/缓存/词典分域。
- 导出/重连：client/export + subscribe/App → exports/export-reader/subscriptions；同时验取消/EOF/FINISH和worker重启边界。

[16个新增文件的完整解释](../modules/learning-center.md) 和 [相邻入口/打包增量](../modules/learning-center.md#integration-deltas) 按该调用顺序连接；后者局部说明不计全文件完成。


<a id="release-a"></a>
## 12. #286 怎样把真实用户链与验收连起来

当前main的同一产品链已有单独Release A测试：真实Selection未开启查询→邀请进真实LC→可信Enable→回旧有效卡显式保存；随后新查询自动保存local hit/no-hit、translation/cache hit与completed Explain→读取snapshot/artifact→移除词典和Provider配置→完整浏览器同profile重启且断网仍可回顾，历史阶段不调用Provider/资源。普通存储失败不重发查询，原生quota故事观察READING_QUOTA/not-saved→恢复空间→明确重试保存，Provider0次。

大语料另用canonical seed，真实UI导出1,439条/67,092,027B/256块，每行来源/序列/字节均由测试断言；不能把seed当用户创建，也不能把下载事件当磁盘落盘。worker停止/页面退出使未完成导出不可续传且无残缺文件，容量10k删一条恢复。见[完整测试、输入、取消与证据章](../modules/reading-release-a.md)。

已有归档为8a972fc完整validate、215759f全E2E148/1/6、d6cf346唯一失败定向修复PASS，汇总149/0/6并非新全量155。#286已合入345d630且tree等同PRhead；归档中的ready_to_sync/未合入是历史阶段文字。此导读不运行测试、不改任务状态、不作新发布认定；详细限制和可核验身份见[证据链](../modules/reading-release-a.md#evidence-chain)。

