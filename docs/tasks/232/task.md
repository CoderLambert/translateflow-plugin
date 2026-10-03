# [Reading Loop][RL-02][P0] 补齐产品接口合同、记录隐私策略与消息访问控制

历史引用：[#232](https://github.com/CoderLambert/translateflow-plugin/issues/232)。2026-10-03 一次迁入；后续以本目录任务和本地证据为准。

## 流程迁移决策

下方是迁入的产品/工程合同。历史合同中的 Issue 评论/标签、远端 CI、自动 GitHub Review 和旧状态流不再是日常执行动作；统一采用 [LOCAL_WORKFLOW.md](../LOCAL_WORKFLOW.md) 的本地完整验收、真实浏览器/产物要求、具名独立审核及受保护代码同步。安全、数据、硬依赖与人工验收保持有效。原有“规划待启动”限制以用户本轮授权和 state.json 为准。

## 执行卡与当前范围
Parent #229；Release A；L3协议/隐私/身份。硬依赖#230已合入。主执行rl-architect，独立只读rl-reviewer；**保留现有owner/worktree/working及最新评论中的修复安排，本次不重新领取任务。**

2026-10-02方案基线main@b10c2b355896530f15f69ebad996afc490760ae7，实际开工/恢复必须重读main/PR/本卡评论。#230交付的是初版合同；下面C1–C8由本任务先以一个聚焦补丁同步docs/READING_LOOP_V1.md、纯validator/常量/测试，再接policy/access。不是重开整个#230，不新增架构Epic，不在此实现IDB/React/Provider。

#231当前独立审核发现周边unknown host/slot敏感性、长节点fallback有界读取、隐藏祖先漏检问题，修复仍归其现有owner。不得把“沿用旧合同”理解为跳过本卡新增的产品接口补丁；也不能把修改Issue当成代码补丁已合入。

## C1 — 传输版本与持久数据兼容
- ReadingRecord/SourceSnapshot/ResultArtifact持久schemaVersion=1、tf-source-utf16-v1、ri1不变，旧translation cache/词典数据不动。
- 新Reading请求信封为`{protocolVersion:2,method,...}`，响应为`{protocolVersion:2,ok:true,data}`或`{protocolVersion:2,ok:false,error:{code}}`。消息版本不再冒充文件schema。旧/未知版本稳定UNSUPPORTED_VERSION并提示刷新，不猜字段、不清库。
- 基线只有纯合同；首次接线前集中改constants/dto/response/callers/tests。若并发代码已使用v1，由coordinator同PR协调caller，不覆写他人分支、不维护第二套Reading服务。
- 原整包export-json不接生产路由；新方法名称集中常量。schema/响应都严格校验未知字段、引用和字节上限；所有方法的授权矩阵写成测试。

## C2 — 列表、按页聚合与最小页面摘要
**list-records（学习中心专用）**：请求`pageKey:null|key,query,cursor,limit`，返回`items,nextCursor,catalogRevision`。RecordListItem包含：
`recordId,revision,itemText,sourceLanguage,pageKey,siteKey,pageTitle,safeReturnUrl,firstSeenAt,lastLookupAt,lastViewedAt,lookupCount,resultPreview,contextPreview,assistantTurnCount,hasCompletedAssistant,locationCapability`。
- resultPreview为null或`{kind,artifactId,sourceSnapshotId,targetLanguage,text,truncated}`，text≤240 UTF-16；contextPreview≤160，来自同一preview所引用snapshot。按最新已完成artifact的(createdAt,artifactId)选择，不将新释义与旧context混接；no-hit说明当时未收录。
- preview/count是repository派生视图，可用事务内维护的可重建索引，不复制事实来源。完整问答/全部snapshot/Provider配置不进入列表，不逐条get-record拼卡片。

**list-pages（学习中心专用）**：请求`query,cursor,limit`，返回`items,nextCursor,catalogRevision`；PageListItem为`{pageKey,siteKey,pageTitle,safeReturnUrl,recordCount,lastLookupAt}`。按(lastLookupAt DESC,pageKey ASC)稳定分页，标题/回跳取后台已保存的安全页面代表值。点击后用list-records过滤pageKey。不能前端下载全部10k记录分组，也不另建Page业务系统。

**get-page-summary（Content当前页）**：请求cursor/limit，不信任caller pageKey；返回`items,nextCursor,pageRecordCount,pageRevision`；item只有`{recordId,revision,anchor,hasCompletedAssistant}`。无URL/title/Q&A/provider/全局数量。hasCompletedAssistant仅由已提交completed artifact派生，不能自动get-record判断。

列表默认30、最多100项/页，完整JSON UTF-8≤1 MiB，先达条数/字节限制分页。cursor≤256字符且不透明，绑定实际authority/query/page/sort及相应revision。空items时nextCursor=null。页面总数/已加载/已检查/已定位分开，200候选扫描不等于全页都已检查。

get-record仍按用户操作读取有界完整RecordDetail，沿256 snapshots/artifacts与单artifact上限验证；不机械套用1 MiB列表上限，单独验证最大合法detail低于浏览器消息上限并分批渲染。Content不能自动广播详情；点击独立chip/本页列表才取，hover只可显示已授权取回内容。学习中心有全局授权但也不为列表批量读detail。

## C3 — 分块导出、一致性与交付边界
仅精确学习中心开放export-start/next/finish/cancel；Content/Popup/其它扩展页不能调用。
- start空body，返回exportId/exportRevision/expiresAt/nextCursor；绑定后台核实的tab/document/session。每页面最多1个、全扩展最多2个，TTL10分钟，不靠心跳续命。
- next输入exportId/cursor；输出sequence/jsonChunk/nextCursor/done/exportRevision。原始chunk UTF-8≤256 KiB，**再次JSON序列化后的整个响应≤1 MiB**。不以JS length计传输字节，不在相邻片段拆开surrogate pair再分别编码成损坏文本。
- jsonChunk是最终JSON文件的连续片段，可跨单record切块，不要求每片独立可parse。最终仍`{format:'translateflow-reading',schemaVersion:1,exportedAt,records:[RecordDetail]}`；不是NDJSON。record→snapshots→artifacts按固定游标顺序读，不能先getAll全导出或要求含256artifact的一条记录塞进单块。
- cursor由后台签发，绑定export/owner/revision/sequence/行位置。客户端顺序拉取、有背压；当前待确认块的重复请求返回相同片段，客户端按sequence去重。只需有界保留当前重试块；已经推进后的旧cursor稳定拒绝而不重启导出，未知/乱序/过期不接受。此规则替代对“所有历史cursor无限期重放”的错误理解。
- #233独立持久exportRevision：任何改变导出内容的commit（包括导出中保留的viewed元数据）递增。每个短readonly事务内校验revision并读该块；下一块/finish发现改变即INTERRUPTED。不能跨消息保持IDB事务、把普通分页当快照，或锁住所有写入。
- EOF后finish携exportId及最终sequence，由后台重验当前authority/revision/结束位置，成功才允许UI生成Blob并发起下载。cancel/删除/撤权在finish前被后台处理则中断；finish成功是交付线性化点，之后不能追回已交付/已下载副本。finish/cancel均有幂等结束回执与有界TTL；相同finish重试不新建文件/网络请求，UI也不得重复发起下载。
- worker/页面中断丢弃会话和临时片段，明确重试，不报成功的半个JSON。不后台落私人临时文件、不上传、不加downloads权限。用户保存对话框结果不可观察时只报“已生成/已发起下载”，不假报已存盘。
- 文件上限64 MiB canonical rows加有界framing是文件预算，不是runtime消息预算。普通最大文件、中文/反斜线/引号/emoji、大单record及取消/修改/重复块必须浏览器验收。

## C4 — 首次授权与当前结果保存
Content非阻断邀请“在学习中心开启阅读记录/暂不”；同一document不因每次划词重复弹窗。增加窄open-learning-center，只允许后台打开固定learning-center.html，不接受任意URL，不把选文/问答/token进URL；拒绝private/未知sender，Popup仅此入口。

set-recording依旧仅学习中心。开启后回原网页，同一有效结果卡显示“保存本次结果”；**用户再点击**申请新begin-query token保存已有冻结结果，不重新调Provider，不从旧cache回填。blur/切标签本身不算关闭；明确关卡/换Range/导航/source失效才丢弃临时snapshot；无有效卡则提示之后查询会记录。

未授权结果仅保留当前Content有界内存，不写Reading仓库；原cache独立既有政策不混称历史授权。#234负责卡片生命周期/新token保存，#235负责受信任授权表单，#233负责consent commit，无#234↔#235循环硬依赖。

## C5 — 站点排除接口与唯一归属
siteKey=规范化HTTP(S)origin（scheme/host/有效port），无path/query/hash/userinfo，不等于浏览器host permission pattern，设置排除不申请权限。
- get-site-recording：Content无siteKey、后台由sender取；学习中心可传校验siteKey；输出excluded/sitePolicyRevision。
- set-site-recording：学习中心专用siteKey/excluded/expectedSitePolicyRevision，只patch该origin；输出已commit的本站状态，不覆盖别的标签设置。
- list-recording-exclusions：学习中心分页cursor/limit≤100，输出items/nextCursor；items为siteKey/excluded=true/sitePolicyRevision。最多200个排除origin，满额给管理退路，不替换旧项；清空记录后仍可管理。
- 全局recording consent+站点排除只在#233 Reading meta保存，不再复制chrome.storage；#237 readingMemorySites仍归原site配置/auto-sites，仅控制显示。
- 排除使该site旧写token失效，恢复不复活旧token；sitePolicyRevision在提交事务验证。暂停不删除/默认隐藏旧历史，关闭标记不等于排除记录。内部record→siteKey索引保证safeReturnUrl=null时仍可管理。
- 单条/按页/全部删除记录不删除授权/排除配置，不宣称清掉cache。辅助索引/tombstone/receipts有数量/TTL界限，清理不能使旧token恢复有效；不建无限事件日志。

## C6 — 幂等、代次与变化通知
operationId由明确查询客户端创建幂等键，后台登记后签token（含当前site policy版本等作用域）。相同ID但purpose/source/page不同拒绝。一次lookup operation的基本词义/后到可靠Rich摘要可用不同artifactId追加，**lookupCount只在首个成功结果commit增加一次**。同artifactId相同规范化payload返回receipt，不同payload拒绝；旧snapshot/artifact不可覆盖。assistant append不增加已有record lookup。

dataGeneration用于clear等明确全局失效，不每次append增加。catalogRevision用于列表/聚合游标，pageRevision用于本页摘要，exportRevision用于导出，record revision用于追加冲突，consent/sitePolicy用于授权撤销；viewed可改变导出但不无故重置最近列表分页。

cancel-operation只接受拥有者的operationId并校验当前sender/session；返回取消已处理或先前已commit的真实状态。不能把发出取消当事务已回滚。重复cancel幂等，别人操作不可取消。save/cancel/delete/pause以后台处理与事务commit顺序决定。

后端发受限reading.invalidate信号：普通学习中心可全局失效，Content只本页；payload不带正文/URL/问答。订阅必须绑定实际sender，断线/重启/恢复焦点重新取状态；迟到旧详情不得复活已删内容。具体注册/取消清理接口随本PR冻结，使用现有消息/Port模式，不造通用bus。

## C7 — 产品动作与线程分开，A不等待D
持久action保持understand/analyze/usage/follow-up；前三是产品动作，follow-up沿parent/thread根推导动作，是轮次不是第四主入口。根action/thread/source必须一致。

D首版只重新生成动作根：parent=null、regenerationOf旧根、新branchId，旧follow-up仍挂旧branch。失败/取消追问可显式重发（不存在旧completed artifact）；不承诺任意已保存追问节点的图编辑。#241负责真正Port事件/流预算，#242负责prompt/有限完整问答预算，写入同一规范，不谎称#230已有完整D协议、不倒挂阻塞A。

## C8 — 身份、源证据、安全URL与兼容
- 后台核验真实sender.id/tab/frame/document/url/incognito及受控会话，不接受caller identity/userInitiated=true作为权限。sender只能证明消息来源，不证明人类手势；只在扩展自有UI事件触发，不开放网页任意postMessage转发。
- 精确全局历史入口为扩展origin的learning-center.html，其它页不自动受信任；Content当前页限定；private拒绝全部历史读写/列表/导出/handoff。
- begin-query除sourceSnapshot外接#231捕获的瞬态captureSafety：selection/context各safe|sensitive|unknown、root为light-dom|unsupported。它是扩展采集器的断言，不是密码学证明，不落成永久隐私保证；后台结合站点policy/真实session，sensitive或未知则禁止自动持久化，普通查询仍可用。selection-only不得暗藏context。冻结字段时与#231已有snapshot适配，不能要求其重写投影或复制schema。
- 不仅选区祖先，周边context的unknown custom host/assignedSlot也要排除/降级；更高敏感祖先不能因隐藏节点早return漏检。超长节点fallback须有界substringData窗口，不能先取完整nodeValue再slice。实际修复归#231原owner，本卡消费证据并补后台拒绝例。
- documentId可用时绑定，缺失用受控main-frame导航generation+握手；无法证明归属/worker重启则拒绝并重建。扩展页面的原生context证明按实际能力检测，不能用可伪造字段替代。旧浏览器若不能安全证明则Reading明确不可用、旧查词继续；不静默提升Manifest最低版本，不宣称最低版本全功能已测。
- pageKey保留有意义query/hash的本地身份，safeReturnUrl另行脱敏，不改cache normalizeUrl；不确定secret-bearing locator置null，不盲目去全部query混页。原文/问答/密钥/URL不进日志/CI。
- AI只接明确授权的selectedText/context及可靠有界词典证据，不顺手附anchor前后缀/页面标题/URL/全局历史。记录授权与AI上传授权独立。

## 实现顺序与所有权
1. C1–C8规范/validator/常量及有效/无效/超限fixture集中修订，B/C/D未来方法仅合同不提前激活。
2. 新增reading-record/policy、access、URL/session薄适配，coordinator单写router/index/导航listeners。未接#233的方法返回明确未就绪，不假empty/saved，不新建持久库。
3. 原步进实现必要消息接线，异步onMessage保持最低兼容return true路径，不依赖最新Promise-listener特性。受限invalidate/打开中心/取消/站点策略按逐方法授权表测试。
4. 保存/导出事务与真实实现归#233，ReactUI归#235，query生命周期归#234；工具/边界检查#247不另造Reading模型。与当前#231修复分配协调，不抢其controller。

## 验证与完成
C1–C8每项必须有有效/无效/跨权限/超限样例；保留#230原测试含义，不整批删除换绿灯。新摘要字段与source对应，list-pages不依赖前端全库，page摘要不能泄漏Q&A；Unicode/转义/大record/重复块/版本改变/finish/cancel有纯合同反例。

npm run validate与实际Chromium/MV3消息权限专项；尚未接存储的mock明确标记，不冒充真实IDB/导出/产品流。未知版本、private、伪造学习中心/跨页recordId、失效document、本站排除全路径拒绝。真实数据事务/下载/DOM能力/线上Provider分别在对应任务实测。准确head独立review，规范和代码同PR同步；Issue正文完成不等于本补丁implemented/audited。

官方依据：Chrome JSON消息与64 MiB上限 https://developer.chrome.com/docs/extensions/develop/concepts/messaging#message-size-limits ；IndexedDB生命周期 https://w3c.github.io/IndexedDB/#transaction-lifecycle 。预算是设计上限，不是未运行的性能结果。
