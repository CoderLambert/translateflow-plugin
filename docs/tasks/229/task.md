# [Product][Epic] Reading Loop — 阅读理解、阅读记忆、学习中心与原文回访闭环

历史引用：[#229](https://github.com/CoderLambert/translateflow-plugin/issues/229)。2026-10-03 一次迁入；后续以本目录任务和本地证据为准。

## 流程迁移决策

下方是迁入的产品/工程合同。历史合同中的 Issue 评论/标签、远端 CI、自动 GitHub Review 和旧状态流不再是日常执行动作；统一采用 [LOCAL_WORKFLOW.md](../LOCAL_WORKFLOW.md) 的本地完整验收、真实浏览器/产物要求、具名独立审核及受保护代码同步。安全、数据、硬依赖与人工验收保持有效。原有“规划待启动”限制以用户本轮授权和 state.json 为准。

# Reading Loop — 阅读记忆闭环与实施总图

> 2026-10-02 修订。**PRODUCT_DIRECTION_APPROVED · RELEASE_A_IN_PROGRESS · PRODUCT_ACCEPTANCE_PENDING**。
> 本轮同步读取 main@b10c2b355896530f15f69ebad996afc490760ae7：#230/PR #258 的领域合同、#246/PR #259 的 opt-in WXT 构建已合入。后者不等于默认构建已切换，也不等于学习中心已经可用。开发时刷新实时 main/Issue/PR/CI，不能固定使用本 SHA。
> 当前用户授权的是同步完善方案与实施步骤；本次 Issue 修订不代表实施代码、独立代码审核或发布已完成，不扩大其他执行会话的授权。

## 1. 产品目标与首版边界

**Read → Lookup → Understand（可选）→ Remember → Return**。

用户明确查词/翻译，必要时主动请求上下文解释；同意后记录实际结果。以后从学习中心或明确授权页面的轻标记找回旧结果、回到原文继续阅读。AI不是阅读记忆闭环成立的前提；不以聊天时长或工程任务数量衡量价值。

| 阶段 | 用户可操作结果 | 验收 |
|---|---|---|
| A Remember | 真正查过的词、普通句子译文和既有AI详解可回顾；可暂停/删除/排除站点/导出 | #236 |
| B Return | 从历史打开正确页面，证据唯一时定位，失败仍可读历史 | #238实际故事，#240综合验收 |
| C Recognize | 已授权且启用标记的站点，再访显示轻标记/本页列表 | #240 |
| D Understand | 真实文本流、拆解/用法、有限追问，完整保存完成问答 | #244 |

A+B+C可独立使用，D不能延迟前三阶段交付。保留dictionary-first：词典给可追溯释义，普通翻译负责语言转换，AI为明确标识的辅助解释。

本期不做：Practice/SRS、收藏、自动学习记忆、云同步、遥测、PDF/视频锚点、automatic fuzzy、通用Agent/完整Harness/Tool Calling、新Provider体系、复杂对话图编辑。基本搜索/分页/删除/导出/容量管理在A完成，不后置。未验证的浏览器/模型/词典不宣称全面支持。

## 2. 规范与已完成工作的关系

- 本Epic拥有产品范围和任务图；各子Issue拥有实现步骤/验收。
- docs/READING_LOOP_V1.md是唯一代码侧领域规范。#230已交付初版合同；本次发现的产品接口缺口以 **#232 C1–C8** 为唯一补丁清单，由#232先修规范/validator/tests，再接policy/access。#230保持已完成历史，不重新跑整套规划。
- 持久对象schemaVersion=1、tf-source-utf16-v1、ri1保持。修订后的消息使用protocolVersion=2，文件schema与传输协议分开；具体兼容策略见#232。Issue更新不冒充代码已更新。
- 工程以#191、docs/PLATFORM_UPGRADE_V1.md、docs/WXT_COMPAT_V1.md为准。Reading不重复实施平台迁移，但使用已批准WXT/React/TS/i18n能力。
- [第二轮B1–B7审核](https://github.com/CoderLambert/translateflow-plugin/issues/229#issuecomment-5945386361)保留为历史证据。历史“全部原生/无bundler/尚未启动/#228仍open”等描述不再是当前执行约束；不能靠翻找旧评论覆盖本次正文。

## 3. 用户交互与授权

选择文字、出现chip、hover本身不创建阅读记录或请求AI。明确查询的local hit为零Provider；用户主动普通翻译/AI可调用所选Provider。打开历史、恢复标记、回到原文不增加Provider调用、不重新读词典资产、不增加lookupCount。

三个意图独立：**本机记录、本站自动标记、当次AI上传**。记录授权不申请站点权限，不代表持续上传授权；已有host permission不自动启用标记。

首次流程统一为：
`明确查询 → 非阻断记录邀请 → 打开固定学习中心 → 开启/暂不 → 返回原网页`。
原结果卡仍有效时显示“保存本次结果”，点击后取新token保存已有结果，不重发翻译；已关闭/换选区/导航则不回填，说明之后查询会记录。切标签本身不视为新选区。开启后的新明确查询按已授权策略自动保存。#234负责Content生命周期；#235负责受信任授权UI；#233负责真实提交，没有循环硬依赖。

AI主入口按选区显示“这里是什么意思？”/“读懂这句”/“这里指什么？”。完成后再展开拆解表达、看用法、继续问。产品动作只有Understand/Analyze/Usage；持久action=follow-up表示原动作线程的后续轮次，不是第四个主入口。首版重新解释只重生成动作根；不提供任意旧追问节点的图编辑。

发送前显示并可缩小“当前段落/仅选中内容”；敏感选区不扩周边。Stop保留当前partial并标未完成，不自动保存完整历史，不声称可以续接失去的网络流。AI完成、cache写入、记录保存分别反馈。saved只能来自事务commit ack；保存失败不清掉可读/可复制的原结果。

## 4. 架构与工程边界

```text
Selection Dictionary / Translation / optional Assistant
                         ↓ actual explicit result
                 ReadingRecordService
                         ↓
              ReadingRecordRepository
                 ↙                    ↘
      Learning Center DTO       page-scoped minimal DTO
                                       ↓
                              Resolver → Annotation
                                       ↓
                                Return-to-context
```

- Learning Center不依赖Selection controller；Annotation不触发AI；ReadingRecord不依赖Provider；Dictionary Asset不依赖学习UI。
- Source Text Projection供Selection Context、Anchor Capture/Resolve共用，不重构全站Candidate平台。
- #235直接做WXT+React+TypeScript学习中心，不先做原生版再搬迁。React不进入Content/MAIN/Worker/后台业务。新UI复用sage/beige token和#249 en/zh_CN。
- Content至#250前保留当前classic/已审核legacy桥；#250在#244之后，不倒挂为Reading前置。
- Provider网络仍归原providers；动态脚本注册仅auto-sites.js；#233增加精确Reading IDB adapter例外，并同步check/AGENTS/CONTRIBUTING/ARCHITECTURE及反例测试，不能放开全部后台或把记录塞进cache-db。
- #248切换前区分旧默认包与opt-in WXT；#236/#244验收必须使用#248接通的真实WXT生产包。旧harness绿灯不能证明新包。

## 5. 身份、数据与可靠性

ReadingRecord是用户记录事实来源；SourceSnapshot/ResultArtifact不可变；cache仅计算复用；annotation仅当前页面投影。物理少量store即可，不做无限增长JSON或通用事件溯源。

recordId为稳定UUID；itemKey只聚合/搜索，保留原大小写，technical/kind/目标语言不参与记录硬身份。不同位置同词不合并；可靠证明同位置重查才复用。操作身份、选区generation、永久记录ID分开。

查询开始冻结选文/授权context/锚点/version，不能等AI完成再抓DOM。缓存命中可记录这一次明确查询，但不扫描旧cache伪造历史。

一次lookup operation可追加基础词义和可靠Rich摘要，lookupCount只在首个成功结果提交增加一次；artifact重复消息不重复写入，新补充用新ID且不覆盖旧快照。AI追问不增加已有记录lookupCount。真正no-hit是中性结果；失败/取消不生成空条目。

同一record内每个结果都引用实际sourceSnapshot/targetLanguage/provenance；AI保存真实问题和完成答案。重新解释保留旧分支，旧追问不迁移到新答案。Rich无可靠轻量摘要时诚实not-saved，不伪造释义或把HTML/MDD送模型。

提交在一个实际IDB事务内校验授权/删除代次、receipt、revision、容量，并追加行/计数。异步hash/浏览器API等在事务外准备，入事务重新校验版本，不跨网络等待维持事务。保存、删除、暂停、取消以后台已处理/提交的顺序决定；发出取消不等于撤回已提交数据。

#232/#233明确区分consent/site policy版本、删除dataGeneration、record revision、列表catalogRevision、导出exportRevision。普通append不能递增清空代次使其他合法操作全部失效。

## 6. 可用的读取、导出与数据退出

- 学习中心列表消费有界RecordListItem，一页显示预览/短上下文/问答数，不逐条请求完整detail形成N+1。预览与上下文必须来自同一snapshot。
- 页面摘要只有recordId/revision/anchor/hasCompletedAssistant和本页计数/版本；不含历史问答/全局数量。普通查词在本页列表；默认仅有完整AI问答的记录轻标。完整详情由点击后的单独授权请求取得。
- 默认不按年龄/LRU淘汰历史。沿用10,000条/64 MiB canonical rows/64 KiB单artifact设计上限；这些不是物理磁盘用量或当前产品性能承诺。达到记录数上限仅禁止新建，已有记录能否追加由剩余字节/单记录上限决定；不静默关用户记录开关。
- A具备Enable/Not now、暂停/恢复、不记录本站、单条/按页/全部删除、容量/真实quota反馈。记录删除与cache清理明确分开。
- 站点排除由Reading repository唯一保存，通过受信任界面的窄接口patch；删除所有记录不删除排除设置。本站标记由#237沿原site配置/auto-sites管理，不复制第二份记录设置。
- 导出使用#232.C3的start/next/finish/cancel；单块原始UTF-8≤256 KiB且完整消息≤1 MiB。文件仍为版本化JSON，允许跨大记录切块；在途修改/删除/中断使导出失效。下载前最终确认，已交付/下载副本不可追回。不要一次发接近64 MiB的完整数据，也不要跨消息持有IDB事务。
- 导出含私人内容要提示，只本地生成，无自动上传/额外downloads权限。导入合并后置；本地存储不是永久备份。错误保留原结果和清理/重试退路。

## 7. 隐私、权限与回访

private拒绝所有历史读写/列表/详情/导出。editable、已识别敏感页、未知根敏感性不自动记录。提供站点排除和关闭标记；启发式不宣称能识别所有私人内容。账户切换后同URL不证明同一语境，不自动展开旧正文。

后台验证真实sender/extension origin/tab/frame/document/URL/private及会话；任意recordId、pageKey或userInitiated布尔值不能授权。学习中心仅精确learning-center.html可全局访问；Popup仅入口。无法证明当前document归属时拒绝并重建会话。网页/模型内容不改变这些规则。

pageKey保留有意义query/hash的本地身份；safeReturnUrl单独脱敏，无法安全精确定位则null，不删全部query混页。原文/问答/密钥/敏感URL不进入日志、公开报告或CI。AI payload不附带anchor前后缀/URL/页面标题。

自动标记需要明确站点意图+当前有效optional host permission，复用auto-sites注册需求union；关闭Reading不注销其他功能。activeTab不作为永久站点授权，新标签回访先处理权限。

Return handoff由后台签发，绑定目标tab/预期页面/record/expiry，最多60秒；首次预期导航的绑定由后台完成，后续意外导航/重定向/权限丢失/删除/过期作废。网页URL不带私文或token。没有权限/运行时能力提供打开网页后用户调用扩展的退路，不假已定位。

## 8. 原文映射与标记

普通HTML/light DOM为首版范围。projection返回原文及双向DOM映射，排除TF译文/UI/隐藏/脚本；inline不插伪空格。UTF-16位置/version明确，不冒称W3C code-point互操作。选中生成译文无可靠source映射不冒充原文anchor。

quote/context是主要证据；position仅提示。必须唯一可信匹配；ambiguous/missing/not-loaded/unsupported/permission-required都有退路，无first-match/fuzzy捷径。节点替换、SPA/BFCache、source变化使Range失效并有界恢复；不覆盖历史snapshot。

每片8 ms/500nodes/16k UTF-16，单次250 ms累计/25knodes/1M UTF-16，先达限先停/yield；3次有界重试、150ms debounce、最多200个自动候选，沿#230预算。真实DOM计时、普通页能完成、极端页可降级分别验收；只返回not-loaded不等于性能通过。显示已检查/定位数量，不承诺未扫描全页无歧义。

绘制与命中分别feature-detect；CSS highlight不可用仍有本页列表/临时定位。独立Shadow host chip不包装正文，不劫持链接/拖选，键盘/触摸可用，滚动缩放按需更新，不持续全页测量。

## 9. 任务图、难度与完成依赖

| Issue | 交付 | 完成硬依赖 | 主角色/难度 |
|---|---|---|---|
| #230 | 已合入初版领域合同；补丁转#232 | 已完成历史 | architect L3 |
| #231 | 原文映射/选区身份/锚点捕获 | #230 | runtime L3 |
| #232 | C1–C8合同补丁+隐私/消息/安全URL | #230 | architect L3 |
| #233 | 独立仓库/事务/摘要/站点排除/分块导出 | #232 | data L3 |
| #234 | 真实查询→记录/首次授权后保存当前结果 | #231 #233 | runtime L3 |
| #235 | React学习中心/数据管理 | #233 #248 #249 | UI L2；安全review L3 |
| #236 | A真实产品验收 | #234 #235 | QA L3设计/L2执行 |
| #237 | 站点标记权限/注册/安全handoff | #236 | runtime L3 |
| #238 | 精确回到原文/历史卡 | #237 #231 | runtime L3 |
| #239 | 再访标记/本页列表/SPA恢复 | #238 | runtime L3+UI L2 |
| #240 | ABC闭环验收 | #239 | QA L3 |
| #241 | 真文本流/Port身份/中断 | #236 | runtime L3 |
| #242 | Grounded动作/有限追问/历史分支 | #241 #234 | runtime L3 |
| #243 | Content助手及学习中心历史追问UI | #242 #235 | UI L2+review L3 |
| #244 | A–D最终验收/实际安装包交付 | #240 #243 | QA L3 |

```text
平台 #245→#246→#247→#248
                 └────→#249
领域 #230→#232→#233──────┬→#235←#248+#249
          └────→#231────┴→#234
#234+#235→#236（A）
#236→#237→#238→#239→#240（ABC）
#236→#241→#242→#243
#240+#243→#244（完整闭环）
```
图是主路径，上表附加依赖同样有效。#235的有限组件准备例外：#232新DTO及#246/#247/#249工具/语言基础就绪后，可由coordinator明确分配隔离组件/fixture；没有#233/#248不能做假后端验收或标整卡ready/完成。不额外等待#251–#256。

### 完成清单（只按真实merge/audit更新）
- [x] #230
- [x] #231
- [x] #232
- [x] #233
- [x] #234
- [x] #235
- [x] #236
- [x] #237
- [x] #238
- [x] #239
- [ ] #240
- [ ] #241
- [ ] #242
- [ ] #243
- [ ] #244

## 10. 多Agent、共享文件与状态

通常最多2个写入implementer+1个独立只读reviewer；coordinator单一协调。L3负责协议/隐私/事务/导航/stream；L2负责冻结合同上的UI/确定性测试；L1仅文案/合成fixture。真实能力按环境探测，模型/努力档不可观察就如实说明，不虚构子agent。AGENTS只放稳定规范，不写当前模型/Issue队列。

每个assignment列owner/branch/base/ownedFiles/forbiddenFiles/输入合同/验证。package/lock、WXT配置、router/constants、auto-sites、check、根入口/全局token/规范有唯一writer；接线随功能PR交付，不拖到总验收。独立worktree，保护用户未提交修改，不reset/clean/force。

#228已经合入，不再写作尚未合并的通用阻塞；实际新open PR才决定文件冲突。#231与#232非重叠工作可并行；#233依赖#232；#234与#235按各自依赖并行；A后优先B/C，D只用不冲突的容量。

状态沿CONTRIBUTING：ready与blocked互斥；工作前记录owner/plan；不能抢其他working/auditing。预审针对准确PR head；合入才implemented，独立合后审核才audited。关闭/CI/merge/audit/公开发布是不同事实。修订Issue正文不自动更改执行标签，不重复领取已合入任务。

## 11. 证据、范围保护与关闭标准

B1站点权限→#232/#237/#240；B2位置→#231/#238/#239；B3问答/source→#233/#234/#242；B4退出→#233/#235/#236；B5隐私→#232及所有入口；B6工程→#191/#233/#248/#241；B7事务→#233/#234/#236。C1–C8补丁的字段/路由/反例在#232逐项验收，不再分散重复定义。

每个实现PR执行当前npm run validate，真实DOM/MV3/UI变更跑适用E2E；共享层纯测试不能替代IDB、权限、same-ID升级、WXT实际包、真实用户故事。词典专项按影响/required CI，不为每个小改动重跑大语料。PASS/FAIL/NOT RUN绑定准确head与产物hash，截图只用合成数据。

总故事：真实查询→授权→保存→重启→学习中心找到当时问题/答案/source→安全回访→授权站点再访标记→点击旧记录零Provider→删除/清空→迟到结果不复活；同时覆盖拒绝/敏感/private、容量/数据库失败、并发、恶意渲染、SPA、断流、键盘/IME/深色/窄屏。

#236只代表A，#240只代表ABC，全部本期子任务真实交付与独立审核、#244证据成立才关闭本Epic。不自动发布商店，不扩展SRS/云同步/通用平台。用户最终得到：**查过的能找回，问过的可回顾，回访能准确回到当时位置。**
