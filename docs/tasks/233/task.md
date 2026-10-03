# [Reading Loop][RL-03][P0] 阅读记录仓库、幂等事务、删除防复活与容量管理

历史引用：[#233](https://github.com/CoderLambert/translateflow-plugin/issues/233)。2026-10-03 一次迁入；后续以本目录任务和本地证据为准。

## 流程迁移决策

下方是迁入的产品/工程合同。历史合同中的 Issue 评论/标签、远端 CI、自动 GitHub Review 和旧状态流不再是日常执行动作；统一采用 [LOCAL_WORKFLOW.md](../LOCAL_WORKFLOW.md) 的本地完整验收、真实浏览器/产物要求、具名独立审核及受保护代码同步。安全、数据、硬依赖与人工验收保持有效。原有“规划待启动”限制以用户本轮授权和 state.json 为准。

## 执行卡
Parent #229；Release A；L3数据一致性。硬依赖：**#232（包含C1–C8合同补丁）合入main**。主执行rl-data；独立只读rl-reviewer。沿用现有执行标签/owner，不重新领取他人任务。
2026-10-02同步：消息消费修订后的protocolVersion=2，持久对象仍schemaVersion=1；字段以docs/READING_LOOP_V1.md与#232为准。不要继续接原单次export-json、纯ReadingRecord列表或不含AI标识的页面摘要。

## 用户结果
真实查询与完成问答重启后仍可回顾；暂停/站点排除/删除/容量满都诚实生效；学习中心无需逐条查详情拼列表，大量记录仍可本地导出。

## 实现步骤
### 1. 独立数据库与边界
新增src/background/reading-record/下薄service、唯一IDB adapter及按职责拆分的query/write/export模块。少量records/sourceSnapshots/artifacts/meta与必要索引即可，不用无限JSON或通用event store。外部调用通过#232 policy/access，不能让UI/Content直接访问IDB。

登记精确storage adapter例外，同步scripts/check.mjs、AGENTS.md、CONTRIBUTING.md、docs/ARCHITECTURE.md及正反例。旧translation/selection cache和词典OPFS均不迁移、不清空。versionchange/blocked/打开失败有可恢复错误；未知版本保留原数据，升级失败不自动删库。

### 2. 授权、操作登记与提交
全局recording consent和excluded sites只有Reading meta一个事实来源。单origin排除patch、sitePolicyRevision与在途token撤销在同一读写事务内完成；撤销后重新开启不复活旧token。safeReturnUrl为空仍通过内部siteKey关系管理排除设置。清空记录保留用户的授权/站点排除设置，界面明确范围。

operationId由明确查询的调用方产生幂等键，后台验证实际sender/session并登记后签token；重放同ID但source/purpose/page不同必须拒绝。pending操作/receipts有数量及TTL上限，private/未同意不把选文/答案落到Reading库。记录只在首个合法完整结果提交时创建，不暴露空占位条目。

最终事务顺序：读取当前consent/site/data/page/deletion版本→校验registered operation/expiry/source与sender会话→检查相同artifact receipt→检查record revision→容量/不可变引用验证→append rows、operation计数标记、字节和索引→oncomplete后ack。异步hash、浏览器API、DOM或网络等待放在事务外，进入事务重验版本；不能await网络/计时器让事务跨消息存活。

一次lookup operation的基础词义、后到可靠Rich摘要可以分别追加，**整个operation只增加一次lookupCount**。相同artifactId+相同payload幂等；相同ID改payload拒绝；后到新摘要新artifactId，不覆盖原行。AI append不增加已有记录lookupCount。同位置复用需可靠证据，无法证明则新record，不按同词/同页硬合并。

并发revision冲突只重试存储，重新校验当前权限/source/token后append，不重新调用Provider、不整对象覆盖。删除/清空/暂停/cancel与save以后台事务先后决定；已commit不能被后来关卡伪回滚。

### 3. 修订号与读取视图
保留record revision、consent/site policy版本和清空dataGeneration的独立语义；增加内部catalogRevision/exportRevision。普通append不递增全局删除代次，避免两个合法标签互相作废。

list-records返回#232.RecordListItem，有界预览/短上下文/问答数来自同一真实snapshot；按`lastLookupAt DESC, recordId ASC`稳定排序，cursor绑定查询/权限/catalogRevision。后台提供真正按页面聚合的有界视图与页面过滤，不在React下载全部历史再分组。搜索是有界literal文本，不执行regex或调用Provider/词典。

get-page-summary只返回当前sender页面的minimal items、hasCompletedAssistant、本页数量和pageRevision，不附全文或全局数量；后台derive标识，不相信Content传来的计数。完整get-record需明确授权读取，断网/卸载词典仍显示真实快照；读取只更新viewed，不加lookup。viewed更新影响包含它的exportRevision，但不无故让最近列表分页无限失效。

只向合规订阅方发无正文invalidate通知：学习中心全局，Content只本页。删除后的旧异步详情/分页结果不能重新展示为有效数据；断线后client重新取状态，不假通知永不丢失。

### 4. 容量与不可变数据
沿用10k记录、64 MiB canonical rows、64 KiB单artifact、每record最多256 snapshots/artifacts。UTF-8 JSON计费仅算canonical行一次，索引/引擎/receipts开销另有有界管理，不宣称物理磁盘精确值。

记录数满只拒绝新建；已有record append仍以剩余字节/单record上限判定。预估本次写入超限返回READING_CAPACITY，即使当前字节没恰好等于上限；不能假报已保存或把全局enabled改成false。QuotaExceededError单独反馈，旧数据仍可读/删/导出。删除扣实际已计费字节，无孤儿snapshot；no-hit中性记录，错误/partial不制造假释义/完整答案。

### 5. 分块一致导出
实现#232.C3 start/next/finish/cancel，保留最终JSON文件schema；不保留生产整包export-json逃生路径。

开始冻结exportedAt、exportRevision和拥有者。每块短readonly事务内检查revision并读record/snapshot/artifact游标；导出内容有任何已提交改变则下一块或finish返回READING_INTERRUPTED。**不是跨请求保持IDB snapshot，也不为导出锁住所有写入。** UI可提示暂停操作后重试，但不可擅自暂停记录。

按有界canonical行构建JSON片段，不先getAll全部detail。支持一个record跨块；原始chunk≤256 KiB，实际完整响应JSON UTF-8≤1 MiB；不拆开Unicode surrogate pair后分别编码成替代字符。固定顺序/序列号/opaque cursor；重复同cursor片段不变，未知/过期/错owner拒绝。只缓存有界重试片段，不在后台保存一份64 MiB完整导出。

最后EOF后finish在当前授权/版本/序列下确认。页面只在确认后发起本地下载；取消/删除先于确认则中断，确认后不能承诺追回已经交付的副本。worker重启丢会话则明确重试，不发成功的半个JSON。实际Blob和object URL由#235管理，不新增downloads权限/后台私人临时文件。

### 6. 真接口接线与兼容
router/constants/架构规则由coordinator单写，所有生产接口共用#232权限与v2 validator。#231可独立并行；#234/#235使用本service，不复制写入规则。Reading schema升级测试保留旧数据；#248切换期间按实际包分别验证，不拿旧包结果冒充WXT。

## 必测矩阵
- 真实IDB create/read/restart、分页/搜索/按页聚合、未知版本/blocked/open/abort，不改变旧cache和词典。
- 同operation基本→Rich补充→重复回调只加一次lookup；新明确查询再加一次；两标签合法append均存在。
- save先commit、delete先commit、clear空库后旧首写、pause/re-enable、site exclude/re-enable、关卡取消与receipt丢ack；无复活/串写。
- 普通词典/no-hit/句子译文/现有Explain的source/语言/来源可读回；rich无法可靠摘要诚实not-saved。
- 记录数满但已有记录可追加；本次字节超限、quota、删后恢复和辅助元数据有界。
- 100条列表不产生100个get-record；预览和context一致，Content拿不到跨页或全局历史。
- 接近总容量的导出、单record超过1 MiB、中文/转义/emoji、重复/乱序块、导出中追加/viewed/删除/清空、worker与UI中断、finish交付边界。

## 验证与完成
npm run validate、实际Chromium/MV3存储/消息专项E2E，竞态用可控barrier而非sleep。代码中未运行的浏览器/性能/下载环节标NOT RUN。准确head独立review；仅合入后implemented，按CONTRIBUTING后审。停用功能/兼容代码是回退路径，不删库。Release A产品完成由#236，不是repository单测通过就完成。
