# Reading：冻结来源、可信授权与事务历史

[首页](../README.md) · [逐文件说明](../modules/reading-records.md) · [已有划词来源链](selection-and-dictionary.md)

源码基线：`d5e308a709c008acf6b277d466d020f13025bdca`；2026-10-03 只读复核。运行、测试、构建、浏览器与实际下载全部 **NOT_RUN**。本章完成“已存在 Reading 后台能力”的解释闭环；不表示用户侧保存/学习中心已交付。


> 2026-10-03 增量说明：本章运行时固定源码在main 86ed596中的blob未变。共享浏览器测试基础设施已切为复制预构建的明确产物，不再隐式构建；默认构建与默认本地E2E选择不同，实际运行请先读[构建与测试链](build-test-release.md)。旧测试链接只说明固定版本断言，不作为当前产物PASS；本轮运行NOT_RUN。

## 1. 先辨认用户今天真正能走到哪里

普通划词已能冻结 SourceSnapshot、查本地词典及显式调用 AI；其来源与取消链复用[已有章节](../modules/selection.md#file-source-snapshot)。Reading 的 v2 路由、原生身份授权、独立 IDB 仓库、分页/管理/导出和失效通知已经在 main。用户侧到这些能力的产品连接仍有断点：

- 当前 source-snapshot/controller 提供冻结来源/getQuerySource；没有 production `readingAccessCollector` 提供者，也没有完整 Reading begin/save 的 trusted 点击编排。missing collector 明确 NOT_READY，不偷偷记录普通查词。
- Popup/Options 根脚本没有 Reading 消息调用。后台认可这两个固定页面的 entry scope，仅可请求“打开固定学习中心”，不能列库/导出/管理。
- runtime 默认 `learningCenterAvailable=false`；`learning-center.html` 只有合同路径，不是已打包页面。因此固定打开仍 NOT_READY。
- CREATE_HANDOFF/CONSUME_HANDOFF 已有 DTO/纯校验，但 service 没有完成对应 dispatch；不能称已具备“从学习中心回原文”的产品流程。
- [#191 暂停检查点](https://github.com/CoderLambert/translateflow-plugin/issues/191#issuecomment-5965938250)及[#234 暂停说明](https://github.com/CoderLambert/translateflow-plugin/issues/234#issuecomment-5965941483)确认 #234/#235 未交付。旧局部组件记录和缺失未推源码不作为本章实施证据。

这不是后台“空壳”：#267 对应的真实事务与分页导出源码已在main。但后台合同可用、合成入口能测、最终用户入口存在，是三件事。

<a id="flow"></a>
## 2. 从选择到记录的链路（在 UI 断点处分开）

1. **现有 source capture：** controller 点击时同步 capture Range、选文、bounded context与投影revision。snapshot.ready只对已经冻结的字符串计算source/block摘要，不在await后重读DOM。documentGeneration是本地证据标记，不能代替native sender。来源无法安全捕获/hash时可继续普通查词，不能因此把未知安全状态当可存。
2. **尚缺 collector生产者：** 将受信用户动作、当前冻结source及已完成digest变成受控 pending intent。后台已有reader会用ISOLATED scripting定点挑战，检查nonce/action/record/operation；网页MAIN world自建同名对象或postMessage不能获得这一通道。
3. **已有 v2入口：** router先截获所有reading.*（包括旧/未知）→runtime.service.handle→request schema→native access→Content policy预检→method scope→dispatch。它保留v2 envelope，不进旧router的普通错误包装。
4. **已有注册/BEGIN：** REGISTER_DOCUMENT绑定native owner与受控documentGeneration。BEGIN核对page/source/safety，后台取真实title/安全回跳URL，hash请求身份；operation registry先占位再repository.prepareOperation。禁用返回disabled，启用才给ready/token。BEGIN不生成空ReadingRecord。
5. **尚缺产品保存调用；已有保存处理：** 将完成的dictionary/translation或assistant artifact连token送SAVE/APPEND。service要求原source proof与registration一致，repository事务前hash；事务内再验consent/site/data/page/document/selection/record revision和TTL。
6. **已有落盘/响应：** receipt、snapshot、artifact、record、page聚合、meta容量/代次在同一短事务提交。只有IDB oncomplete才算保存ACK；之后publish最小revision通知，service返回`{protocolVersion:2,ok:true,data:{state:"saved",recordId,revision,artifactId,duplicate}}`。最终UI保存反馈尚待#234，不能把这条响应臆写成当前按钮行为。

沿线核心文件：[access](../modules/reading-records.md#file-access) → [service](../modules/reading-records.md#file-service) → [operations](../modules/reading-records.md#file-operations) → [repository](../modules/reading-records.md#file-repository) → [write](../modules/reading-records.md#file-write) → [idb](../modules/reading-records.md#file-idb)。

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

**暂停与迟到保存。** BEGIN成功→查词结果尚未到→管理页暂停（在未来产品入口或授权测试入口）提交consentGeneration+1→迟到SAVE进入。registration即使尚能查到，事务tokenCurrent也拒绝旧generation；没有半条snapshot/artifact或空record残留。普通查词Provider任务和Reading保存是不同取消域，本章没有声称Reading暂停自动取消原查询。

**取消与已提交结果竞争。** CANCEL_OPERATION进同一库readwrite序列，写receipt.cancelled。若此前没有commit，ACK为cancelled且record/revision为空；若此前保存已提交，ACK为committed并带原record/revision，不能显示“取消且已撤回记录”。service在真正ACK后才撤注册；失败或导航后的响应不能被UI当取消成功。按顺序取消后迟到写会被墓碑/代次挡住。

**导航边界。** Reading任何native URL更新都使旧token和Port失效，普通query的页面身份可能对tracking/hash更宽容。某些pushState使sender.url和tab.url不同，当前native guard拒绝新注册；不能凭旧source未变就承诺无刷新恢复。

## 6. 已有读取/列表/管理怎样回给消费者

Content只可读本页最小summary、同页显式detail及本页状态。summary仅recordId/revision/anchor/hasCompletedAssistant和页count/revision；不会自动携带原文上下文、URL或全库数。全库LIST_RECORDS/LIST_PAGES、排除设置、删除/清理、导出只给严格allowlisted学习中心extension scope；Popup/Options不是旁路。

repository把internal index key包装为不透明cursor；cursor绑定owner/document/代次/query/limit，10分钟TTL、最多128并发链；每页成功消费旧token并替换下一token，一条长链不永久累积槽位。并发同cursor消费拒绝，错误可保留未过期旧cursor重试。recent按负lastLookupAt和稳定ID索引；搜索只case-insensitive字面includes预览字段，不是regex/全文索引，有限返回不保证扫描恒定。

GET_RECORD可更新lastViewedAt及record/page/export revision，使用max抵御时钟倒退；不增加lookupCount/catalogRevision，也不改变最近查词排序。若viewed写遇容量/配额失败，可只读回既有detail，不强迫用户无法阅读。全库catalog cursor继续有效，当前页summary和导出需看到变化。

管理全部CAS或代次约束：单条删除expectedRevision，consent/site设置expected generation/revision，全清expectedDataGeneration；页删除即空页也增加pageGeneration。清历史保留consent/site设置；删除不碰翻译缓存/词典OPFS。源实现明确无自动清库恢复或驱逐。

## 7. 有界导出不是一条大消息，也不是已完成下载 UI

START同步占每owner1/global2的slot→仓库只读取得exportRevision与内部position→NEXT背压读取连续JSON片段→EOF→FINISH复核同revision、owner、sequence和eof→消费者才可交付Blob。当前消费者尚未实现；后台不创建下载文件。

- 单chunk raw UTF-8≤256KiB且转义后的完整消息≤1MiB，Unicode代理对不能跨块；单record可以大于1MiB，按row/offset续接，不getAll整库。
- 只保留最后一个buffer重试。重试也读policy/revision，await后核对buffer未被别的NEXT推进；错cursor/旧块/owner不符/TTL报INTERRUPTED。
- 每块、重试、FINISH独立短事务；不长期锁库。中途append/delete/viewed等exportRevision改变必须丢弃未完成结果重启，不能拼混合版本。
- CANCEL先阻止交付，再等已在途reads及repository ACK，失败不伪造cancelled；仍在途的work不因TTL/revoke而释放准入槽。finishing时不承诺取消，finished收据和已给用户副本不可撤回。
- done=true只说明完整流到EOF，不等于finish ACK、更不等于操作系统文件已落盘。

实现入口：[exports](../modules/reading-records.md#file-exports)、[export-reader](../modules/reading-records.md#file-export-reader)、[分块校验](../modules/reading-records.md#file-shared-export)。

## 8. 失效通知与隐私边界

commit后publisher驱动reading.invalidate端口。每个消息发送前再读政策；Content只有pageRevision，学习中心是catalogRevision，另有data/consent代次，不含正文。导航立即断对应Port；pending native授权先reserve，导航barrier阻止迟到connect复活。通知发送失败不推翻已commit数据，未来消费者应focus/reconnect/restart时重读，而不能把Port当永不丢失事件日志。

“本地存储”不等于文本不敏感。Reading独立库保存选文、bounded context和完成答案；仅安全light DOM证据可入，private/未知身份拒绝，有限敏感host/path规则不能宣称识别所有私密页面。导出是可携带明文JSON，未来UI需清晰提示保存位置和共享影响。本章没有读取任何用户库、页面、词典私有正文或凭据。

## 9. 读代码得出的测试范围，不冒充本轮运行

- 纯合同/registry Node测试：DTO bounds、source/branch关系、代次、capacity、并发reservation/ACK，很多使用synthetic browser/repository。这证明断言设计，不替代真实IDB。
- native access spec：真实浏览器sender/context、隔离world和Port导航；fixture注入collector/合成repository并启用测试页面，不证明产品trusted点击链。
- storage spec：复制选定production artifact，检查background bytes未改，给临时副本增加合成LC页面、ISOLATED collector和localhost权限；同时另设直接源码native-IDB probe。生产router/repository消息与direct-source probe分开标注，不能把后二者合成最终LC验收。
- 存储回归包括viewed页revision、不变catalog cursor、clock rollback和损坏meta。reading-ui.test只是阅读外观/译文/toast静态断言，名字不代表Reading历史学习中心UI测试。
- 本轮未执行npm、构建、Node/Vitest/Playwright或下载；所有相关运行 **NOT_RUN**。详见[测试边界](../modules/reading-records.md#test-boundaries)。

## 10. 推荐阅读与最小修改入口

先看[真实入口断点](#flow)和既有source-snapshot → policy/access/service → operations/write/idb → state/management/query/repository → exports/export-reader → subscriptions/shared契约。逐文件正文新增19个完整解释；其它共享合同、大入口和测试仍标局部，未据“被引用”算完整覆盖。

- 记录为何拒绝：先定位稳定error code和access/policy/token generation，不放宽sender/incognito校验。
- 保存计数/幂等：write + storage-state + operation registration，验证late rich/失ACK/删除竞态。
- 列表和搜索：query + previews + index/cursor contract，避免UI拉全库detail。
- 导出：先分清START/NEXT/EOF/FINISH/CANCEL，联动两种字节上限和真实消费者ACK。
- 产品入口：#234/#235需独立已授权实现，不能在导读任务补代码；不得把本章“已有后台分支”改写为“点击即可完成”。

现有规范[reading-access-v1](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/reading-access-v1/README.md)开头仍写repository absent，是#232时期状态；main的runtime已默认装配真实repository，应以固定源码为当前事实。该规范也有旧的页删除receipt概述，当前management并未删receipts；已在逐文件节区分。

