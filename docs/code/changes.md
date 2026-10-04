# 导读更新记录

[首页](README.md) · [架构](architecture.md) · [覆盖清单](coverage.json)

## 2026-10-03 02:20 UTC+08 开始的启动切片

- 读取最新main，仍为 `d5e308a709c008acf6b277d466d020f13025bdca`；#275此前无评论、未有同任务执行者。延续已创建的docs/code-walkthrough，不新建平行方案。
- 完成默认原生与opt-in WXT入口、后台同步监听、Popup/快捷键/持久注入、Content装配与UI启动、状态/错误/重复注入说明。
- 重要认识：打开Popup的缓存状态查询可触发Content注入；STATUS.ok不代表全部异步启动完成；loaded幂等标记不构成失败回滚或热更新协议。具体证据见[功能章](features/extension-startup.md)。
- 完整递归tree登记636个blob文件。11个完整解释、625个待解释，17个局部依赖仍计待解释；测试引用不计测试文件已解释。
- 静态校对源码身份、调用链、目录/链接与覆盖分母；未执行npm、浏览器、业务测试。运行验证 **NOT_RUN**，不把历史CI作为本轮PASS。
- 无业务、依赖、权限或发行修改。

### 当时下一步（本轮已接续）

沿同一main（如变化先比较blob）完成划词词典用户路径：有效选择→触发查询→后台本地结果/富文本请求→浮层呈现→切换选择/关闭取消→错误与显式AI增强入口。复用本轮启动章，不重写启动；补全现有partial依赖并更新相邻导航与coverage。该源码导读说明现状，不代替Oxford10兼容设计或真实词典验收。

## 2026-10-03 04:20 UTC+08 划词查询切片

- 轻量检查main与导读分支，源码仍为d5e308a；无同任务并行执行者，不重复启动章。
- 完成[选择→本地/普通翻译分流→主卡和富文本→取消/换词→显式AI](features/selection-and-dictionary.md)调用链及[18个完整文件](modules/selection.md)。SourceSnapshot内存证据与Reading保存、当前main与Oxford10拟议接口明确区分。
- 富文本取消先本地失效，再尝试后台取消；allSettled结束不代表所有底层I/O确认停止。句子/不支持语言与无命中多词短语仍可走普通翻译，修正总览中容易过度概括的“本地优先”。
- 636文件分母未变；29完整、607待解释，41个仅局部边界，所有测试文件仍按真实解释范围保守计数。
- 本轮仅静态分析和文档结构校验，运行验证NOT_RUN，无业务或权限修改。

### 当时下一步（本轮已接续）

完成MDX/MDD导入与安全资源渲染：Options预检→worker→OPFS/索引/激活→查询原记录→sanitizer/CSS→viewer/MDD资源→取消/替换/重启。复用本轮选择/owner/队列说明，补足安全清洗、资源生命周期和实际容量门槛，明确现状与Oxford10方案差距，不把方案当实现。

## 2026-10-03 06:20 UTC+08 导入与安全展示切片

- 固定main仍d5e308a；文档继承94b18ca，不重复前两章。
- [功能链](features/local-dictionary-import.md)连接Options预检、MDX/MDD控制器与Worker、OPFS暂存/后台核验激活、rawRecord清洗与viewer/MDD资源、取消/替换/重启。
- 新增[15个完整文件解释](modules/dictionary-import-render.md)，35个大型依赖保守按局部记录。总计44/636完整、592待解释，其中70局部。
- 明确MDX和MDD两次提交、commitpoint不能假报取消、普通另存与curated替换不同、已安装数据重启可读不等于未完导入自动恢复。限制与Oxford10拟议升级分开。
- 静态核对路径/锚点/导航/身份与覆盖；所有业务、构建、测试和浏览器运行NOT_RUN。无业务或权限修改。

### 当时下一步（本轮已接续）

接续网页翻译与缓存闭环：用户翻译/本站自动恢复→DOM提取/结构化标记→批处理→缓存查询→必要时Provider→安全DOM回写→取消/重试/页面再访。保留与划词、词典的状态/存储边界；大型词典parser/存储余项继续在coverage明确待解释，不因功能章完成就计整模块完成。

## 2026-10-03 08:20 UTC+08 网页翻译与缓存切片

- main仍d5e308a，复用此前三章，完成[网页翻译/恢复/重访链](features/page-translation.md)及[15个文件正文](modules/page-translation-cache.md)。
- 连接DOM筛选、结构marker、去重批次、缓存身份、Provider协调、回写检查、取消/重试及自动观察。
- 明确同一配置解析规则不等于跨消息固定配置快照、已发store不能被取消回滚、关auto不取消已启动请求。均为静态边界，竞态尚未复现。
- 总计59/636完整、577待解释，其中82局部；测试引用仍不计测试文件完整。
- 所有运行/构建/浏览器/测试NOT_RUN，仅文档和导航/映射静态校对。

### 当时下一步（本轮已接续）

接上YouTube字幕完整链：播放器/MAIN观察→ISOLATED来源仲裁→cue与批次→后台缓存/Provider→双语渲染→导航/切视频/取消。复用本章请求和缓存基础，解释字幕专用identity与fallback，避免把网页段落算法直接套到字幕。


## 2026-10-03 10:20 UTC+08 YouTube字幕切片

- main仍d5e308a，沿既有导读增加[字幕完整链](features/youtube-subtitles.md)与[11个生产文件说明](modules/youtube-subtitles.md)，复用共享缓存/Provider，不新建平行架构。
- 贯通MAIN播放器观察、协议、ISOLATED来源仲裁、cue稳定化/队列、后台单批配置/缓存/Provider、双语UI、切视频/停止/重试。
- 明确original仍进入翻译、off不取消已排队/在途、媒体代不等于同视频cue精确对齐、后台取消登记只覆盖Provider阶段。静态边界尚未作为真实故障复现。
- 总计70/636完整、566待解释，其中87仅局部；7个字幕测试文件保守计局部，未将测试引用算完整解释。总览旧的字幕/导入待说明描述已同步纠正。
- 文档链接、覆盖身份及分母静态校对；业务、安装、构建、浏览器和测试均NOT_RUN。

### 当时下一步（本轮已接续）

接续Provider与设置：Options/Popup选择与保存→有效配置及站点/临时Preset优先级→Provider适配、网络/流式/错误/取消→用户反馈。复用网页与字幕请求章，解释共享配置在不同功能链的快照边界；Reading随后接入。发现的字幕时序/取消风险保留待验证，不顺手开发。


## 2026-10-03 12:20 UTC+08 Provider与设置切片

- 固定main仍d5e308a，新增[Provider与设置链](features/providers-and-settings.md)及[11个整文件说明](modules/providers-and-settings.md)，复用现有请求、DeepSeek、缓存与字幕章节。
- 解释Options/Popup保存与权限、有效配置优先级、站点会话Preset、Glossary、普通HTTP/SSE/本地模型、错误/取消及返回UI。
- 测试按钮先保存不回滚、临时Preset非单tab、SSE无普通HTTP重试循环、连接成功不等于翻译验收均有源码依据；未执行或修复。
- 总计81/636完整、555待解释，其中87局部；Options/Popup/router/constants和9测试文件仅相关范围，不计整文件完成。
- 仅docs/code文档变更，源身份、导航、路径/锚点与计数静态校对。运行/安装/构建/测试/真实Provider验证全部NOT_RUN。

### 当时下一步（本轮已接续）

Reading完整链：授权与来源快照→后台v2会话/消息→真实repository事务→读取/分页/导出/撤权→用户入口。必须区分现已实现底层与#234/#235尚未交付的完整保存/学习中心流程，不能将未来方案写成当前功能。复用前六章，不扩成产品开发。


## 2026-10-03 14:20 UTC+08 Reading后台与入口断点切片

- 固定main仍d5e308a，新增[Reading功能章](features/reading-records.md)及[19个完整生产文件说明](modules/reading-records.md)，复用前章来源捕获与启动。
- 贯通native身份/政策、v2路由、BEGIN/SAVE/取消登记、真实IDB事务、分页/管理、分块导出与失效通知；明确当前生产collector/保存点击链/学习中心缺失，handoff尚有合同无服务接线。
- 区分测试临时页面、直接源码native-IDB probe与真实生产包；旧reading-access-v1文档的repository absent及删页receipt概述按当前源码澄清，仅在导读记录差异。
- 总计100/636完整、536待解释，其中110局部；27个共享合同/大入口/规范/测试路径仅相关范围。
- 文档仅docs/code，身份/路径/锚点/导航/覆盖计数静态校对。业务、构建、测试、浏览器、下载均NOT_RUN。#234/#235暂停与未推源码缺口不作为已实现证据。

### 当时下一步（本轮已接续）

构建与测试交付链：默认legacy与opt-in WXT→资源映射/产物→测试消费者→CI→安装及升级证据。解释何时测到真实包，哪些合成权限/夹具不可冒充产品验收，仍保留未完整解释文件的明确缺口。之后继续补齐大型依赖，未覆盖全仓前不宣称导读全部完成。


## 2026-10-03 16:20 UTC+08 构建到安装链与基线增量

- main从d5e308a推进到86ed596（#266），完整递归tree重新盘点651个blob（新增15个），31个路径变动。此前100个完整解释源文件字节未变；旧章保留固定引用，补基础设施增量说明。
- 新增[构建/产物/测试/CI/安装升级链](features/build-test-release.md)及[27个完整说明](modules/build-test-release.md)，22个大型消费者/专项CI/脚本保持局部。总计127/651完整、524待解释，其中130局部。
- 明确默认build legacy与默认本地E2E WXT不同、fixture不隐式build/fallback、sourceHead只是标签、测试副本差异及真实Worker激活，避免旧绿灯或错误包冒充验收。
- 阅读#248已报告的破坏性输出事故及未合入#278审查，在固定main说明风险，未执行危险反例或导入未合入修复。仅docs/code写入。
- 当前清单sourceBlob与正文引用身份分开；变化的package局部说明已重读，已覆盖运行时字节未变。路径/锚点/导航/分母静态核对；安装/构建/测试/浏览器/发布NOT_RUN。

### 当时下一步（本轮已接续）

八条主要功能链已有导航，但全仓逐文件说明尚未完成。优先补齐MDX/MDD parser与OPFS/紧凑索引读写的完整内部链，复用导入/展示章，精确区分格式检查、块/键边界、索引身份、资源范围读取和失败恢复；不得借文档任务开发Oxford或运行词典JS。


## 2026-10-03 18:20 UTC+08 Rich MDX/MDD内部读取切片

- main仍86ed596，补齐[二进制/索引/OPFS/范围读取内部链](features/mdict-storage-internals.md)及[35个完整说明](modules/mdict-storage-internals.md)，复用现有导入、Worker、Content清洗与viewer章节。
- 29运行时文件与6测试整文件解释，4路径保留局部；累计162/651完整、489待解释，其中117局部。MDX/MDD不同提交校验、cache限额、取消粒度与原始/规范key边界均按当前源码说明。
- OPFS写入不等于active提交，MDX已索引不等于全record认证；MDD结构筛查不等于媒体完整解码。独立8aceb7c与Oxford拟议能力未写成main已实现。
- 仅docs/code，静态核对blob、锚点、链接与计数；未访问私有词典、未执行业务/测试/浏览器/构建，全部NOT_RUN。

### 当时下一步（因新主线流程变化先更新验收链）

接续普通pack/TFLex active OPFS索引读取和通用pack生命周期，连到现有dictionary-first结构化主卡；它与Rich MDX/MDD支路不同。旧MDX/StarDict显式文本投影、界面与共享合同余项保留待解释，不能以本轮内部链完成宣称全仓结束。


## 2026-10-03 20:20 UTC+08 本地验收与监控增量

- main从86ed596推进至9bea2dd（#280工作流迁移/#281归档）；重新盘点732个blob，81新增。先修正新的执行/验收链，普通pack/TFLex深入顺延，不重做运行时章节。
- [新功能章](features/local-task-acceptance.md)与[17个新增完整文件](modules/local-task-acceptance.md)贯通合同/冻结/命令/包/独审/gate/同步及被动hook报告；15个规范/工作流/认证断言仅局部。两项旧完整CI和9项旧partial变化已复核，构建章同步为手动Actions。
- 累计179/732完整、553待解释，其中123局部；其他16组迁入任务文件保留待解释，不因index列出即全算完成。
- 真实独立审核/人工验收不由gate布尔声明证明；local与E2E同名hash不可互换；完整命令日志与被动脱敏hook的隐私边界不同；ignored输入并非全部纳入tracked检查。
- 仅docs/code文档，未调用freeze/run/gate或配置hooks；全部运行/构建/浏览器/测试NOT_RUN。身份、路径/锚点、覆盖分母静态核对。

### 唯一下一步

回到普通pack/TFLex active OPFS索引读取及通用pack生命周期，连到结构化词典主卡。若主线再有实际运行时变化，先作影响增量核对；不因新的任务归档数量扩大重复研究，也不启动产品开发。

发布前增量：主线又到2e7661（#282），仅3个规范文件变化，清单仍732。已读取完整diff并更新规范解释及当前blob；纯文档/符合条件归档的证据复用与新实现完整验收分开，不为本导读启动业务测试。其余新章脚本保留9bea固定引用。


## 2026-10-03 主线 d5246ca 增量复核

- 固定最新 main `d5246cae6469e4a876fc122b229a2e0ddf115709`，先读取当前 AGENTS、#275、导读 README/coverage，再逐项比较完整 recursive tree；750 blobs，新增18、变更52、删除0。
- 本轮不增加无关功能章，优先修正已交付内容：默认 WXT 的 staging→audit→安全复制→dist/extension、显式 .output/chrome-mv3、E2E 选包/副本/原生升级与注册闭包；#278 路径安全已合入，非事务复制和竞态边界仍说明。
- Reading #234 的真实 collector、可信查询、BEGIN/SAVE/APPEND、结果摘要与版本和 ACK/UI 状态已接通；Rich 只在实际展示成功后保存有界摘要/packVersion，学习中心仍未交付。不再说 production collector 或保存入口不存在。
- local-task gate 不再读取 review.md，不强制模型独审或硬编码 validate；保留候选、真实日志、依赖、产物与外部/人工门槛。当前 index 的248 ready_to_sync 与 #284 已合入代码分开说明。
- 187 个完整解释、534 个待解释、29 个待复核；局部正文 129 个（待解释中 112、待复核中 17），不计完整覆盖。完整解释要求实际重读与正文；任何变动而未完成全文复核路径保留待复核，旧固定链接标记历史范围。
- README、总架构、启动与相邻 renderer 描述、地图、coverage 和双向链接同步；提交仅 docs/code/。文档身份、路径/锚点、清单计数与远端内容静态核验，不运行安装、构建、测试、浏览器、freeze/run/gate 或发布；全部运行 **NOT_RUN**，无 realOxford PASS 声明。
- 下一步先按 coverage 清理待复核余项，再继续原有普通pack/TFLex与共享合同缺口；本轮不改业务、不启动其它开发任务。


## 2026-10-03 #235 实际 React 学习中心导读

- 本轮读取最新main/AGENTS/#275/导读README后固定 `b606cfd556792d9764d0b15461b7a142fcd99575`（#285），文档父提交26864e8；一次推进清单到766 blobs，新增16、变更20、删除0，不追后续移动main。sourceTree记录实际Git tree ae16411834ca7092ae6b3d2a6daa59e320290a1f，sourceCommit另列。
- 接通Popup/Selection固定打开→HTML/main→App→typedclient/hooks→列表/搜索/页分组/详情→v2身份/后台query与管理→UI确认/重试/导出FINISH，给用户行为对应的修改入口，不孤立罗列文件。新增modules/learning-center完整解释16个新增文件；后台runtime/access/constants三处全文复核，其它20变动中的余项保留待复核。
- 198 个完整解释、525 个待解释、43 个待复核；局部正文 139 个（待解释中 108、待复核中 31），不计完整覆盖。完整数变动同时包含新增与旧覆盖因源码变化降级，不能只用累计数字当工作量。README、架构、Reading功能/模块、构建交叉提示、地图/coverage同步，原#234保存、WXTdist与E2E.output、本地主Agent自查均保留。
- #235归档候选的16 PASS只包含两个实际React故事，Selection旧首次同意仍synthetic；真实UIoffline reload不等同profile restart，大导出归档3,622,698B。旧storage确有同profile重启及>62/<64MiB native种子流测试，但其旧NOT_READY断言/预构建输入需要重新核验，不能继承成新UI近容量/重启PASS。#236无已核验综合PASS。
- 只静态校对清单/源码身份/内部链接/正文，所有安装、构建、测试、浏览器、下载、freeze/run/gate、私有词典、发布运行NOT_RUN。仅docs/code分支文档，不改任何产品或任务状态。
- 下一轮先按coverage复核变动旧入口/构建说明，再继续既有普通pack/TFLex和共享合同缺口；本次切片完成不代表全仓覆盖。

## 2026-10-03 18:22 UTC 构建与产物消费待复核闭环

- main 仍为 b606cfd556792d9764d0b15461b7a142fcd99575，树 ae16411834ca7092ae6b3d2a6daa59e320290a1f；清单766不变。目标文档由9fe7bfe固定树逐文件blob核对复用，仅改docs/code。
- 完整重读八文件：wxt.config、audit-wxt-extension、runtime-assets、package、wxt-assets/mapping两测试、E2E与WXT_COMPAT两规范。206完整、525待解释、35待复核；133局部（108待解释、25待复核）不计完整。八项原待复核含六个partial和两个未有完整正文的规范，本轮以真实全文解释补齐，不仅改状态。
- 修正generateBundle旧描述为writeBundle最终输出/固定HTML映射；解释React仅学习独占可达、共享chunk仍属平台、原预算只约束platformCodeBytes，以及安全动态闭包与报告静态闭包不相同。三页面映射负例与旧代冻结独立，构建两输出/消费者路径保持准确。
- package所有命令分组明确入口和副作用边界；E2E规范图示与实际Popup driver区分；兼容报告的历史opt-in/React absent/PASS/NOT RUN只归原候选，不移植到当前。未复读的大型升级spec保留待复核并显著注明旧NOT_READY探针边界。
- 静态自查：固定源码blob、766清单路径/计数、内部链接/锚点、文档diff范围和远端正文逐字核验。这里的脚本文本核对不是运行项目脚本。安装、构建、npm/Node/Vitest/浏览器/E2E/验收命令全部NOT_RUN；没有产品、权限、任务状态、合并或发布操作。
- 剩余35待复核继续按用户入口/共享合同优先处理；普通pack/TFLex缺口仍在，不新增无关章，不宣称全仓完成。

## 2026-10-03 20:35 UTC Reading Release A 用户链与证据归档

- 固定最新main 345d630c0f0e0040f39fd74b8ed0457e3d193fd4 / tree d15489bca1ebeb1d6a5b1de6bc78c5114af52917；#286于18:51:37 UTC合入，PRhead2459102与main树等同。起始文档18b09b3的26份本地正文逐blob核对远端身份；仅更新docs/code。
- 214 个完整解释、519 个待解释、35 个待复核；局部正文 132 个（待解释中 107、待复核中 25），不计完整覆盖。分母766→768（两新增、十变更、无删除）；八个完整新增解释为Release A/storage两个spec、storage fixture、总验收文档及236四份合同/状态/证据。App/useLibrary既有完整解释更新至当前blob，不重复计新增。
- 修正旧“只有#235、尚无端到端证据”、storage固定打开NOT_READY及一次性过早焦点表述。区分不seed可信创建、canonical压力输入、compiled消息/source探针、原生quota/注入错误；逐项写输入、输出、清理、中断、错误和修改影响。
- 记录8a972fc完整validate、215759f全E2E148/1/6、d6cf346唯一失败修复PASS；149/0/6是复用汇总并非新跑155。归档ready_to_sync/未合入与当前Git整合分别说明，不补任务状态/发布认定，不另开任务。
- 静态校对完整清单/blob/计数、路径锚点/双向导航、源码身份、仅docs/code改动及远端回读。原始日志/包/截图未取得，数字只引用归档；安装、构建、项目测试、浏览器、下载、验收命令全部NOT_RUN。没有业务代码、权限、任务状态、合并或发布修改。

## 2026-10-03 22:17 UTC 真实启动与原生 Popup 切片

- 固定main `c250ce91aff7eb84d1ad8acbe1d4155ad244dc24`（#287），从docs头90bb491增量；main新增2、变更28、删除0，分母770。
- 修正完整启动链：静态HTTP/HTTPS document_idle→Content→Selection；Popup正文按钮→v2→唯一原生POPUP fallback→固定学习中心，开页后自然关闭不作失败。全文复读并有正文13文件，其余局部/未读变更保守待复核。
- 218 个完整解释、516 个待解释、36 个待复核；局部正文 130 个（待解释中 105、待复核中 25），不计完整覆盖。
- 明确旧TAB driver/harness.inject的下游证据；新POPUP直接CDP发消息未点可见按钮/未消费ACK，新页面spec为HTTP mock非真实HTTPS。旧升级注册期望冲突、商店重确认/恢复与全站observer成本保留限制，不宣称运行FAIL。
- 仅静态文档身份、锚点、覆盖与范围校对；安装、构建、测试、浏览器、Oxford与发布全部NOT_RUN。未改代码/权限/任务状态，未合并。


## 2026-10-04 UTC 返回原文与 classic 投影切片

- 固定main `33ab3ea2a38ce591b622ba06739344858d7da403`，文档起点a16589d；在同一docs分支仅更新docs/code。相对c250ce9新增32、变化33、删除0；完整802条blob清单。
- [完整流程](features/reading-return-to-page.md)与[20个逐文件说明](modules/reading-return-to-page.md)覆盖可信ReturnToPage、tab/nativeDocument/document/navigation绑定、60s一次性摘要交接、exact/context/digest重新定位、ambiguous/missing/预算/重试/关闭与准确deep link，以及两个owned entry生成classic IIFE和rich-details前序。同时解释main已有page-markers源码，未声称#239/#240集成或发布通过。
- 明确记录历史quote在定位前进入open Shadow的静态隐私风险；trusted入口不让目标站点DOM成为秘密容器。没有修业务代码。session容量、重试/abort和overlay命中只写源码事实及待验证，未伪造运行复现；resolver预算中已有一候选的resolved优先级也未包装为穷尽全页证明。
- 802 个文件全部登记；219 个完整解释、529 个待解释、54 个待复核；局部正文 140 个（待解释中 106、待复核中 34），不计完整覆盖。 未变旧文件保留原正文身份，变更且未完整复核者转/留待复核；局部正文不计完整。
- 同步README、架构、启动、Reading/学习中心与构建交叉链接；没有重复完成整个旧章节。task238的旧候选PASS只按归档引用，未变为当前main运行结论；Oxford classic兼容另有方案，不由Reading投影证明。
- 仅执行文档静态路径/固定blob/内部链接与清单校对，以及发布后远端字节/分支检查；安装、生成、构建、业务测试、浏览器、Oxford、集成、商店与发布全部NOT_RUN。

### 后续缺口

继续解释未覆盖的相关测试/再访生命周期与当前待复核队列；不把20文件切片视作全仓完成。#239持久marker/#240集成和独立安全修复属于各自授权，本文不改变它们的状态。
