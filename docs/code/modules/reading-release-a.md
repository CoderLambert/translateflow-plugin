# Reading Release A：真实产品、原生存储与验收证据

[完整 Reading 用户链](../features/reading-records.md) · [学习中心实现](learning-center.md) · [存储与保存实现](reading-records.md) · [首页](../README.md) · [覆盖清单](../coverage.json)

固定 main `345d630c0f0e0040f39fd74b8ed0457e3d193fd4`，tree `d15489bca1ebeb1d6a5b1de6bc78c5114af52917`。2026-10-03 静态全文读取本章八文件，并复读 App/useLibrary 两个改动文件。此章不重写 #235 组件/构建章，也不将测试阅读算成运行。安装、构建、Node/Vitest、浏览器及验收命令本轮均 **NOT_RUN**。

<a id="evidence-chain"></a>
## 1. 先区分代码合入、已有验收和本轮核验

[PR #286](https://github.com/CoderLambert/translateflow-plugin/pull/286) 已于 2026-10-03 18:51:37 UTC 合入上述 main；PR head `24591029bddff0e59258b952d5f2c54925efc759` 与 squash main 的 tree 完全相同。因此新 spec、真实 quota 恢复路径和焦点修复已在 main，不应继续写“只有组件、尚无跨页闭环证据”。以下 PASS 都是仓库归档记录，不是本导读重新执行或独立认证。

1. `8a972fc7546f39201e83606eb9e54738981c4018`：一次完整 `npm run validate`，归档 1034 Node、15 Vitest、严格 TS、WXT PASS。
2. `215759f8a050448287140efccd1f1f6918fb5141`：修正 Escape 返回过早恢复焦点；check、typecheck、学习中心 11 项单测、实际 WXT 包 PASS。完整 `npm run test:e2e` 原结果 **148 PASS / 1 FAIL / 6 SKIPPED**，唯一失败是原生 extension-origin quota 未观察到拒写。
3. `d6cf346bdd7b7f06db784d61c6edc225ed8e52f5`：修正 quota 测试的浏览器生命周期，并增加 compiled Reading 原生错误/恢复断言；只执行 `npm run test:e2e -- e2e/reading-loop-release-a.spec.mjs --grep 'extension-origin physical quota' --workers=1`，归档 1 PASS。生产源码、fixtures、构建输入和其它场景未变，保留其原 PASS/head/log，不改写原 FAIL。
4. 汇总 **149 PASS / 0 未解决 FAIL / 6 SKIPPED** 是已有全量运行加唯一失败替换，`newFullE2ERun:false`；绝不是新候选又完整运行 155 项。归档包 `.output/chrome-mv3` fingerprint 为 `a4348aaa4e4775eb163fdb3cf55d6f55f7d960f1dbbda229f54da6c368d04eb9`。

acceptance/review/state 仍保留归档时“ready_to_sync、未合入、等待授权”的文字。它记录候选阶段，不能推翻已核实的 #286 合入；也不自动成为新执行或商店发布许可。当前正文只确认代码整合与已有证据链，不擅自补写 `READING_LOOP_A_PASS`、completed 或后续任务状态。归档对照可在下次获授权的状态同步中处理；不为此建立额外业务任务。

原始日志、截图、trace、产物目录属于本地/忽略资产。仓库只记录路径和 hash，本轮未取得这些字节、未独立校验其摘要或下载结果。main/PR 的 Git tree 等同仅证明受版本管理文件身份，不能证明打包产物字节等同。六个 skip 为专用新旧包/升级三项及真实词典输入/one-click 三项；Chrome 102、其他浏览器、实际桌面 IME、付费模型质量、文件对话框/磁盘结果、商店发布均不由此认证，更不是 Oxford 私有包 PASS。

<a id="file-release-spec"></a>
## 2. e2e/reading-loop-release-a.spec.mjs：六个真实产品/边界故事

[完整源码 L1–L351](https://github.com/CoderLambert/translateflow-plugin/blob/345d630c0f0e0040f39fd74b8ed0457e3d193fd4/e2e/reading-loop-release-a.spec.mjs#L1-L351)；blob `052d053ca3039df2a68332325e951c754eb10d32`。

### 测试入口、输入与资源生命周期

Playwright 从预构建产物经 prepareExtensionTestCopy 建独立临时扩展、副本词典和 localhost mock；不安装、不隐式构建。environment 启动 Chromium persistent profile，取得 service worker 的扩展 ID，以 Popup 作 driver，center() 打开随包真实 learning-center.html。openContent 生成普通合成文章，通过 scripting 按生产 CONTENT_SCRIPT_FILES/CONTENT_STYLE_FILES 注入。query 只合成 Range/selectionchange，随后 Playwright 真点击 chip；保存走生产 collector，不直接调用合成授权来冒充用户创建。

restart() close 整个 context 后在同 profile 重新 launch，区别于 page.reload 或仅停 worker。fixture() 仅在大语料/探针场景复制 storage fixture 的精确源码闭包：已有文件必须字节相同，缺文件才新增；第一真实创建故事不调用它、不 seed 历史。finally close 浏览器/server并删本次临时目录；异常仍执行清理。

send 用 protocolVersion=2 的 runtime 消息；details 是测试侧列摘要再 GET_RECORD 的核验助手，不是产品列表的 N+1 行为。downloadJson 等原生 download event 并读取下载流核 JSON，是测试收集器，不是生产 UI 用 Buffer/JSON.parse 全库。report 写合成 JSON、浏览器版、inventory/fingerprint/background比较；该函数的产物 fingerprint/background 基准固定为 `.output/chrome-mv3`，解释其它 artifact 覆盖输入时必须另外核对实际副本，不能把这个固定报告字段当万能来源证明。

### 六个故事分别证明什么

- **真实创建与重启（120秒）**：未开通 local hit→invite且库0条/Provider0次；邀请打开真实 LC→可信 Enable→回仍有效旧卡显式保存。新 no-hit 自动保存，明确句子翻译调用 mock 一次、重查命缓存不再调用，明确 Explain 再一次。读取完整 snapshot/artifact/lookupCount 后删除 Provider 配置与副本词典 assets，完整重启同 profile，再 offline 打开真实 LC，逐条阅读问题/答案/译文；比较不可变内容并检查历史阶段0 Provider/0词典或外部资源请求。archive记录4条、dictionary/translation/assistant三类、明确mock共2次；“no seed”只指这一创建故事。
- **近64MiB UI导出（180秒）**：canonical seed 先量一条字节，再按共享 totalBytes 减64KiB余量计算记录数；答案含中文、emoji、引号、反斜线、换行。真实 UI 显30条摘要，再点 Export JSON；包装 sendMessage 只观察响应，不替换后台数据。核每个完整响应≤1MiB、块数>250、sequence从0连续、块UTF-8字节和下载总字节相等；遍历每行确定 recordId、snapshot/artifact关联和答案原样。archive为1,439条、存储67,031,498B、下载67,092,027B、256块、最大完整消息342,508B。它是 seeded 容量压力输入，不能说1,439条由人逐次创建，也不能说 UI 恒定内存落盘。
- **worker/页面退出与容量（120秒）**：seed一条64 artifacts大记录；持有已经返回的首块以排列竞态，用CDP停实际 background worker，真实Port断线→App abort→丢片段/提示取消→重连可读，断言无残缺下载。另一次导出持有块后关闭所属页面，重开不能续用旧exportId。最后seed10,000条，真实容量提示出现，实际详情删除一条后9,999条且enabled仍true；不是修改假计数或自动清库。
- **DOM捕获计时（60秒）**：在实际 ISOLATED 模块上调用 shipped capture，native performance.now 分同步片段与等待 ready 总时长，普通DOM十次要求resolved且position非空、context≤900；1.1M字符节点要求有限context与非resolved退路，替换动态内容后又resolved。源码100ms断言是诊断护栏，runtime slice预算另记录8ms；不是100ms替代8ms，更不是全网站性能保证。archive的普通89字符/4节点本机十样本及CPU数据只绑定原记录。
- **物理 extension-origin quota（60秒）**：seed一条后完整重启，CDP限额为usage+32KiB；额外探针库写16×32KiB随机不可压缩数据，必须真正 transaction abort/QuotaExceededError且completed=false。旧历史仍能实际UI读/导出/删除。第二阶段重新seed、完整重启再quota=1，用真实Selection collector→编译后台读取实际READING_QUOTA；卡显示not-saved且原1条保留，恢复额度后点“重试保存”变2条、Provider仍0。这里只观察回包，不注入DOMException、不改IDB原型/生产预算/权限、不填宿主磁盘。归档错误发生在 reading.begin-query，不能凭标题写成只有 SAVE 才失败。
- **注入错误与安全交互（60秒）**：独立用例在真实worker临时覆盖IDB records.put抛合成QuotaExceededError，检查不误报saved与恢复后0 Provider重试；明确只是错误映射注入。随后seed恶意script/img字符串，真实详情仅文本、无执行/远程请求；Escape返回记录焦点；合成composition Enter必须preventDefault；切zh_CN不变历史内容；暗色/reduced-motion与CSS200%缩放无横向溢出。合成CompositionEvent和CSS zoom不冒充桌面IME或浏览器原生缩放UI实测。

### 调用链与修改影响

创建经过[Selection冻结/可信动作→保存ACK](../features/reading-records.md#flow)，读/管理/导出经过[React→受限后台→独立库→UI](../features/reading-records.md#learning-center)。FIRST query可显示结果但Reading失败；重试只写现有artifact，不能偷发Provider。worker断线清未确认内容并取消导出，不能将本地abort当持久事务回滚。修改query collector、焦点、IDB策略、export序列或产物adapter，必须按受影响故事重核实际输入；不能扩大许可、弱化拒写断言或用seed代替首次可信创建。

<a id="file-storage-spec"></a>
## 3. e2e/reading-storage.spec.mjs：编译消息与直接源码探针双轨

[完整源码 L1–L404](https://github.com/CoderLambert/translateflow-plugin/blob/345d630c0f0e0040f39fd74b8ed0457e3d193fd4/e2e/reading-storage.spec.mjs#L1-L404)；blob `052b9b81dde5e527a1fc97fcc8d68cc77c56032e`。

文件输入选择第一个已设 READING_STORAGE_ARTIFACT→TF_E2E_ARTIFACT→TF_I18N_ARTIFACT，否则`.output/chrome-mv3`；显式空值报错。READING_STORAGE_SOURCE_ROOT只控制独立探针源码闭包，可与artifact不同，报告必须保留两身份。beforeAll递归列包size/hash、复制后逐项核对，再只在测试副本加 synthetic LC HTML、localhost权限和storage-probe模块worker；compiled background哈希必须未变。copyClosure只递归相对静态import/from，输出源码inventory。launch启动同临时profile、Popup driver和合成LC，并等探针worker.__probe。

beforeEach清Reading历史、关闭同意、清站点排除并重新建repo/clock，server.reset防跨用例泄漏；afterAll关闭浏览器/server并删临时副本。openContent以ISOLATED合成owned collector回challenge，并经真实browser sender注册，所以compiled router/repository真实，但点击/collector/LC是synthetic，不能把它等同上节产品故事。registerStorageRegressions另导入补充用例，其文件本轮未全文重读，仍局部覆盖。

**编译消息组：** 默认状态disabled/0；Popup OPEN_LEARNING_CENTER现断言`data:{opened:true}`（L107），已替换旧NOT_READY。测试同意→BEGIN不生空记录→SAVE/idempotent重复→同artifact变payload拒BAD_DTO→迟到artifact不多计lookup→完整profile重启保留精确状态。两标签用独立snapshot存no-hit/translation、追加completed assistant、再查一次；确认最小Content summary/state字段、轻量列表/字面搜索/page聚合、通知仅revision/代次、Provider0次。digest gate在artifact hash阶段持有写请求，先暂停再放行，真实late save须STALE_OPERATION且无记录。

**直接源码native-IDB组：** 3900条以30条页遍历130页不耗尽128 cursor槽；scope/query变更、并发同cursor和复用拒STALE，viewed保留catalog链。receipt上限128，过期清理后旧token不复活；站点排除上限200且分页。最终transaction guard在写开始后撤授权，abort前后records/snapshots/artifacts/receipts完全一致；提交后publisher失败仍可用原artifact幂等重试，cancel返回committed而非撤回。pause/resume、site往返、空页删除、clear、cancel均不能复活旧首次写token；迟到Rich不能覆盖较新lookup页标题/时间。

**容量/导出组：** canonical10k禁止新记录但允许旧记录append，删除扣行/关联并能补回10k。大record跨小块Unicode流，代理对不拆、raw≤256KiB；viewed改变exportRevision而不改catalog/lookupCount。compiled EXPORT测试精确重试块、错cursor拒绝、完整响应≤1MiB、EOF后FINISH成功；FINISH后CANCEL仍finished，clear/主动cancel/重启让旧导出INTERRUPTED。direct-source近64MiB用consume只累积checksum、不保留整库字符串；追加超预算报CAPACITY，页删除后字节归零。后者不等于实际React下载，真实UI近容量故事见上节。

**quota/版本组：** localhost HTTP仅服务白名单探针模块，完整重启后CDP限额，直接源码repo遇原生QUOTA仍可读/导出/删除旧行，finally撤override并关闭服务。其注释“extension origin忽略override”是旧失败时的历史诊断，已被#286完整browser/profile重启的extension-origin正向证据补充，不能再概括成永远不支持。最后持有native连接触发blocked upgrade，释放后v2升级；旧repo拒UNSUPPORTED_VERSION且保留records/meta/未来store sentinel、翻译cache与OPFS sentinel，不能自动重置未知版本。

输出inventory、容量/quota JSON及Playwright断言；没有产品下载UI，也不造真实词典内容。改storage/receipt/cursor/版本应同时核compiled与source-probe身份、清理与真实abort，不把合成authority当native授权证明；全文件已读不代表补充helper全文件已解释。

<a id="file-storage-fixture"></a>
## 4. tests/fixtures/reading/storage.mjs：明确合成权限的canonical输入

[完整源码 L1–L89](https://github.com/CoderLambert/translateflow-plugin/blob/345d630c0f0e0040f39fd74b8ed0457e3d193fd4/tests/fixtures/reading/storage.mjs#L1-L89)；blob `42400c9d329695d9c31fc9a1e7980aac6f992ecb`。

导入contract fixture的request/snapshot/artifact/record/PAGE_KEY和共享DTO/identity/hash/lifecycle/previews，导出M/L与基础fixture。access构造synthetic-owner、allowlisted等合成authority，ctx只校验DTO并给空assertCurrent；绝不能部署为生产权限。source重算sourceDigest；begin以repo.prepareOperation创建有TTL的token（clock来自__probe或1000），save生成artifact UUID、按assistant分派APPEND、校验DTO并hash后mutate；options允许探针注入最终guard。enable先读consentGeneration再mutate。

rawDatabase打开独立Reading库v1；counts用readonly事务同时数四个store和meta，只在oncomplete返回，失败reject且关闭连接。seedRecords先读旧meta，在内存生成确定UUID/record、共享snapshot、每记录指定artifact数；answerChars决定assistant/dictionary，新增answerText允许精确Unicode/恶意纯文本，否则生成emoji默认答案。每行bytes用applicationBytes真实canonical计费，并生成list projection。一个readwrite事务清records/snapshots/artifacts/pages/receipts再写新行，meta递增consent/data/catalog/export代次，保留sites/siteRevision，设置enabled与真实count/bytes；pages一行记录聚合。提交后返回count/bytes/首recordId，abort拒绝，不靠虚构meta满库。

exportAll直接repo.openExport→readExportChunk，检查raw/完整包装消息双预算和代理对边界；position/sequence推进至eof，最后finishExport。consume存在时只回调块，text保持空；否则收集字符串用于小数据核验，返回bytes/chunks/text。它不走产品export registry/owner Port/UI下载，也无通用cancel包装，错误交测试finally处理。

这是临时测试库输入工具，会清本库，不可对用户profile调用。修改schema/artifact/byte billing/projection时同步seed和断言；保留直接源码的synthetic标记，不能把fixture移入生产包。answerText变化使测试可精确验证转义与注入文本，未改变产品持久schema。

<a id="file-acceptance-guide"></a>
## 5. docs/READING_LOOP_ACCEPTANCE.md：证据矩阵与复现边界

[完整源码 L1–L45](https://github.com/CoderLambert/translateflow-plugin/blob/345d630c0f0e0040f39fd74b8ed0457e3d193fd4/docs/READING_LOOP_ACCEPTANCE.md#L1-L45)；blob `e1b3f390b4dfad5b5fb9f99ff56818f0a9430604`。

面向验收读者，依task236/acceptance和已合入#235，按Decision、Evidence matrix、Reproduction、Limitations、Native quota diagnosis sources组织。矩阵将真实创建、支付/上传、权限、事务、列表、导出、退出、容量、quota、安全/交互、DOM性能映射到不同层证据；不把native/source seed冒充React创建。复现说明实际WXT包、临时副本、源码/产物身份、用户操作链及精确回访/新助手等非目标。

Decision保留LOCAL candidate PASS与归档时远端未合入；按[证据链](#evidence-chain)读当前main差异。quota诊断链接锁定Chromium153.0.8010.12的BucketContext/Transaction实现，说明额度缓存和完整重启对照；不是声称读取内部cache值。修改它应保持原FAIL与替换结果并存、skip和未验证项清楚；文档不执行恢复、取消或状态同步，不以更新文字授予发布权限。

<a id="file-task"></a>
## 6. docs/tasks/236/task.md：合同、验收与历史流程文字

[完整源码 L1–L44](https://github.com/CoderLambert/translateflow-plugin/blob/345d630c0f0e0040f39fd74b8ed0457e3d193fd4/docs/tasks/236/task.md#L1-L44)；blob `a1b1cfd3e8d6fe056b5380b17cd6402d500df399`。

任务合同定义#234/#235硬依赖、Release A真实查询→明确同意→保存→重启历史→管理/导出完成条件，要求实际WXT包而非另造旧构建。十步验收涵盖首次/自动保存、拒绝与卡失效、结果矩阵、迟到Rich/两标签、数据退出与quota、摘要/cursor、Unicode近预算导出、取消/中断、权限安全与键盘语言。性能要求明确正常DOM可定位与巨页有界退路，命令/输入/hash/证据随候选冻结。

末尾记录validate复用、App/useLibrary焦点修复与quota唯一失败的生命周期修复。文内旧“具名独立终审/旧Issue状态”与后续当前LOCAL_WORKFLOW主Agent自查约定不一致；review明确self-check，不能凭旧段落声称已独立审核，也不自行启动第二轮审核。合同是约束而非运行PASS。后续实现变动应重冻candidate并按影响重验，纯证据同步不能篡改旧日志绑定。

<a id="file-acceptance"></a>
## 7. docs/tasks/236/acceptance.json：按候选保留的机器可读证据

[完整源码 L1–L325](https://github.com/CoderLambert/translateflow-plugin/blob/345d630c0f0e0040f39fd74b8ed0457e3d193fd4/docs/tasks/236/acceptance.json#L1-L325)；blob `3d7ddcaf1a23ef23ebe23fa10770e4cca3815da3`。

schema/task/candidateHead/tree/inputTree/frozenAt绑定d6cf346，environment记Node24.21/npm11.19/Chromium153；checks只含当前quota定向命令、PASS/exitCode/signal/duration/time/log/hash，artifact另含实际包路径/fingerprint。decision=LOCAL_A_CANDIDATE_PASS，limitations保留skip、未运行和归档阶段权限。

reusedValidation保留8a972fc完整validate身份；reusedChecks保留215759f检查/类型/11单测/WXT。priorFullE2E保留该head原FAIL、148/1/6和唯一失败说明；coverage明确reconciliation、149/0/6、newFullE2ERun=false及replacement。reuseProof列src/entrypoints/manifest/package/lock/wxt/scripts/tests输入未变和产物指纹未变的归档判断；它不是本轮下载产物后的独立证明。

supplementaryEvidence是截图/JSON/旧error-context/trace/审计报告的本地路径+SHA256索引；productEvidence记无seed真实创建、历史0调用、seed大导出、物理quota拒写与compiled重试数据。performanceEvidence含10样本、输入规模、同步/总时长median/range、巨页/动态退路、8ms预算和机器限制；diagnosisSources锁定浏览器源码链接。reusedValidation.reason仍使用“当前候选完整E2E”这类相对时态时，应按其215759f重验阶段和priorFullE2E字段理解，不能覆盖顶层d6cf346 checks的定向事实。

此文件给复用/审核消费者读，不触发测试或删除；改结果须保持准确candidate/head/log/artifact和原失败，不能将统计加法改写为执行历史。

<a id="file-review"></a>
## 8. docs/tasks/236/review.md：主Agent自查的范围

[完整源码 L1–L21](https://github.com/CoderLambert/translateflow-plugin/blob/345d630c0f0e0040f39fd74b8ed0457e3d193fd4/docs/tasks/236/review.md#L1-L21)；blob `1cd51ab476b092fb6dbf9025f1343e62cd20583a`。

绑定d6cf346与b606基线，标明self-check、生产/fixture/build不变、包指纹复用。解释16×32KiB真实拒写断言未放宽、完整重启与Chromium额度缓存诊断，记录compiled Reading在BEGIN阶段READING_QUOTA、原1条→显式retry2条且Provider0。验收段逐候选保留全量失败、定向修复和149汇总；后段列真实创建/近容量/中断/交互证据与未测边界。

旧“尚未同步合并”是候选时态，当前应对照#286，不能改写成新的阻塞或独立终审。review输出判断与限制，无运行/恢复副作用；自查不是另一个模型的审核。实现再改时应重审受影响路径，不能仅更新审核日期冒充复验。

<a id="file-state"></a>
## 9. docs/tasks/236/state.json：归档状态不等于当前Git事实

[完整源码 L1–L28](https://github.com/CoderLambert/translateflow-plugin/blob/345d630c0f0e0040f39fd74b8ed0457e3d193fd4/docs/tasks/236/state.json#L1-L28)；blob `9969578a93fdf0ed24ae94bb85e519ccdc7e514e`。

schema/task/status/owner和dependencies234/235、branch/worktree标任务归属；candidateHead为d6cf346、mergeHead=null；validationCommands只配quota定向E2E，artifactRequired=true。nextAction记本地候选通过并等待远端同步；它保留当时授权边界，不是自动调度命令。实际#286现已合入，不能以null mergeHead断言未合入，亦不能由本导读越权改state/index。

state供本地任务工具/index消费，状态字段自身不会撤销导出、修复代码或发布产品。下一次获授权的状态同步需以真实main/候选证据对账，不能因文档滞后重跑已有效验证或创建额外产品任务。相邻235/state现completed且mergeHead=b606，index变动只做局部辨读，两文件保持原待复核，不计本章完整覆盖。

## 10. 推荐修改入口

- 用户不能保存：先看record-client错误与后台BEGIN/SAVE真实code，再选原生quota或注入映射故事；不修改预算掩盖错误。
- Escape焦点：看[App/useLibrary当前状态门控](learning-center.md#file-app)，等restricted Port重连、state、列表settled再找recordId；不靠固定timer。
- 历史/大导出：先分无seed可信创建与canonical压力语料，再核实际包、owner/revision/序列/FINISH；不能把本地abort当提交撤回。
- 报告149通过：先沿[候选链](#evidence-chain)核原全量与修复项，保留skip/FAIL原身份；测试正文、归档报告与本轮NOT_RUN分别说明。
