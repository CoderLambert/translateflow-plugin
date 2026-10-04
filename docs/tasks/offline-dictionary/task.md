# [Product] 离线词典：解析兼容性修复与一个真实英汉词典的完整验收

## 1. 目标、授权与当前结论

任务 ID：`offline-dictionary`。2026-10-04 根据 main `8c3ad6d8bfc528a12b4b28d3c90ab97e0e403a32` 的源码、既有兼容性报告和本地任务规范建立。执行前核对最新源码差异，不固定沿用旧缺陷结论。

**本次授权仅为把任务定义同步到 main；不启动产品实现、词典下载、Builder 开发、定时任务或发布。** 执行状态以本目录 [state.json](state.json) 为准，保持 `paused`。文档合入不等于本产品任务 `completed`；`candidateHead`、`mergeHead` 不填写本次文档提交来冒充实现验收。

交付目标不是“所有 MDX/MDD 全兼容”，而是：**一个用户实际需要、合法持有的高质量英汉词典包，在指定 TranslateFlow 安装包和浏览器上能正确导入、离线查词、显示义项/中文/例句，并明确媒体与不支持能力的边界。** 内容不足不能靠 AI 或自制稀疏词条冒充达到欧路式学习词典体验。

遵循 [LOCAL_WORKFLOW.md](../LOCAL_WORKFLOW.md)、[AGENTS.md](../../../AGENTS.md) 和 [CONTRIBUTING.md](../../../CONTRIBUTING.md)。本任务卡拥有范围与产品验收；state.json 的 dependencies、validationCommands、artifactRequired 是机器要求的唯一来源；index.json 只由现有脚本生成。历史 Issue/研究仅作引用，不恢复旧远端调度、评论/标签或自动模型审核流程。

## 2. 已有证据与不能外推的结论

| 已核对对象 | 能说明什么 | 仍不能说明什么 |
| --- | --- | --- |
| [ECDICT 1.0.28 检查报告](../../../lexicon/build-evidence/mdict-compatibility/ecdict-1.0.28.json) | 97,786,525 bytes、3,402,564 个索引条目；该报告记录 indexBuilt、12 条确定性正文样本可读 | 条目数不是精编词头数；这 12 条不是全库正文/布局验收；该输入无 MDD，不能证明真实媒体词典可用 |
| [独立 MDX/MDD 合成互操作证据](../../RICH_MDD_INTEROP_EVIDENCE.md) | 已有外部 writer 生成的 fixture 可复用，避免自写 writer 与 reader 互相证明 | 合成 CSS/图片/音频不是用户目标词典；不能替代正文质量和实际浏览器体验 |
| [既有 Rich MDX 证据](../../RICH_MDICT_EVIDENCE.md) 与 [兼容矩阵](../../MDICT_REAL_WORLD_COMPATIBILITY.md) | 保留各自原始输入、候选和覆盖范围 | 本卡不否定其它既有认证，也不把单份 12 样本报告说成仓库全部测试；旧 PASS 不重新绑定到新候选 |
| `mdict-rich-key-codec.js::parseKeyBlock()` 及其 index 调用链 | 当前规范化实际 first/last 后直接比较 descriptor 原值；存在原始边界与规范化边界不一致的明确代码风险 | 不是所有包含大写/标点的词典都会失败；生产复现、新二进制回归和修复均尚未由本卡执行 |
| Builder R01 历史研究 | 提供边界成对兼容、reader 分层验证等修正思路 | 研究或临时实验不是插件 main 已修复，也不是该目标词典已通过 |

必须分别记录：**文件结构/正文读取、查询语义、浏览器展示、词典内容价值**。任意一项通过不自动提升其它项；inspector 的 `supported` 不是产品可用认证。

## 3. 范围与模块所有权

优先修已有读取链，不重建词典引擎或基础词典。复用以下实际模块：

| 范围 | 文件/目录 |
| --- | --- |
| MDX 边界、索引、查询 | `src/background/packs/importers/mdict-rich-key-codec.js`、`mdict-rich-index.js`、`mdict-rich-metadata.js`、`mdict-rich-validation.js`、`mdict-rich-lookup.js` |
| MDD 资源 | 同目录 `mdd-*.js`；仅在目标包复现资源阻塞时修受影响路径 |
| 导入/持久化/反馈 | `src/background/packs/rich-mdict*.js`、`rich-mdd*.js`、`src/options/rich-mdict-import-*.js`、既有 Worker；只改真实复现点 |
| 展示与安全 | `src/content/selection/rich-*.js`；保留现有隔离、sanitizer、资源白名单和取消机制 |
| 验证 | `tests/rich-mdict-*.test.mjs`、`tests/mdd-*.test.mjs`、`tests/helpers/rich-mdict-fixture.mjs`、`tests/fixtures/mdd-interop/`；既有 Rich MDX/MDD、安全、取消 E2E 与本地 corpus 工具 |
| 证据 | 本任务 acceptance.json/review.md、现有兼容矩阵；原始结果仅在 `docs/task-execution/local/offline-dictionary/` |

不做：全规范覆盖、LZO/MDX 1.x/旧编码的无证据扩展、全仓重构、React/UI 框架迁移、新存储格式、云端词典服务、新 Provider、词典全文上传、自制词条扩充、重新激活 Builder。StarDict 现有能力保留；本轮围绕上一轮已定位的 MDX/MDD 问题，不声称完成全部离线格式认证。

主 Agent 负责集成、state 单写及最终自查；小步骤直接执行。仅在已授权委派且确有收益时，由 `dev_specialist` 处理二进制/索引/安全变更，`dev_verifier` 复现和收集证据；实际模型使用本机既有角色配置，未知写 UNKNOWN。禁止为完成文档或归档强制增加子 Agent/独审轮次。

## 4. OD-1：先复现并修复 MDX 块边界校验

**输入：** 最新实际 importer、既有 fixture 与 R01 边界问题。**不依赖用户的商业词典文件。**

### 实施步骤

1. 沿 `buildRichMdictIndex → addKeyBlockLookupBounds → decodeRichKeyBlock → parseKeyBlock` 复核实际行为。制作可复现的小二进制 fixture，强制危险词位于 key block 首/尾，记录旧实现失败的准确错误和调用位置；不要只用 Python 镜像算法或调用单个比较表达式作为最终复现。
2. 用原始边界 `Apple / Node.js` 与 `KeyCaseSensitive=No` 等组合验证风险；复用固定独立 writer 的生成/锁定方式，记录 writer revision、fixture SHA-256 和预期唯一 sentinel。项目自生成负例可用，但至少一条正例须来自独立 writer，不能修改原来的 interop 资产使历史证据失效。
3. 在保留 descriptor 原值的前提下，验证同一块的 **first/last 成对满足原始边界，或成对满足既有规范化边界**。不能对 first/last 分别宽松 OR；不能简单规范化任意 descriptor 来掩盖不一致，也不能删除校验。
4. 将结构边界与查找边界分开：`lookupMinKey/lookupMaxKey` 继续按块内实际词头导出，不能直接用 raw first/last 当规范化范围，也不假定规范化后仍保持原排序。保留现有精确拼写优先与多候选规则，不让碰撞静默返回无关词条。
5. 保持当前 NFKC、JavaScript `toLowerCase()` 和 header 规则；Python `casefold()` 不是等价替代。本修复不顺带改变 StripKey 默认语义、不自动接受拼写变体属性。若目标包后来暴露 `Stripkey`/排序等其它问题，先明确复现与兼容策略再做最小扩展。
6. 核对持久化 index 的 validator/旧索引读取是否受影响。能兼容原 schema 时不升级；确需重建时仅重建该包派生索引、保留原文件与词典设置，并记录版本/迁移及回归；禁止清空 OPFS/用户数据掩盖错误。

候选边界判断意图（具体实现须匹配已验证数据契约）：

```text
rawPair = firstDisplay === firstDescriptor && lastDisplay === lastDescriptor
legacyPair = normalize(firstDisplay) === firstDescriptor
          && normalize(lastDisplay) === lastDescriptor
accept only rawPair || legacyPair
```

### 必须覆盖的回归

| 类别 | 验收 |
| --- | --- |
| 原始/旧式规范化边界 | 两组正例均通过；单块、多块首尾及跨块命中返回正确 sentinel |
| 大小写、技术标点、Unicode | `Apple`、`C++`、`C#`、`Node.js`、空格/连字符/撇号、全角字符、组合字符；明确 header 组合下的预期，不把内容中不存在的词形当 parser 漏词 |
| 损坏/混合边界 | first/last 一边 raw 一边 normalized 的真正混合负例、错误词头/计数、尾随 bytes 均拒绝；校验边界的负例须更新外层 checksum，避免仅在 checksum 阶段失败而漏测目标断言 |
| 记录与别名 | record offset 越界/非单调/安全整数溢出、跨 record block 正文；别名正常跳转、缺目标、循环及现有 hop 上限不退化 |
| 安全与生命周期 | checksum、解压/容量/查询预算保持；取消后无旧结果回写；不通过提高上限或异常吞掉来取得 PASS |

**阶段结果：** 旧基线可复现、新候选通过正负例且已有读取/查询/安全回归无退化。这里只证明边界修复，不签“真实学习词典已可用”。没有目标词典不阻止 OD-1，但也不能凭 OD-1 结束整卡。

## 5. OD-2：固定一个目标英汉词典并验证读取和查询

**输入：** 用户实际需要、可合法本地使用的 MDX 与全部伴随文件；目标名称/版本当前待确认。**输出：** 与实际文件集绑定的本地验证结果，不要求重新编译原词典。

### 目标包与阻塞处理

在本地记录同一套输入的版本、MDX/每个 MDD 的字节数与 SHA-256、明确配套关系、格式/编码/压缩/header 特征、目标 importer revision 和可用的来源/使用范围说明。多个 MDD、同名资源、外置 CSS 或缺少配套文件必须明确，不能默认补齐。文件保持只读，不擅自上传。

没有可用输入时，主 Agent 只请求这一个必要输入，记录 OD-2/OD-3 阻塞和下一动作；不要以 ECDICT 或合成包代替用户高质量英汉目标，也不要回到自建基础词典/无限资源调研。个人本地导入不增加与本任务无关的公开分发审批；未经准入不得提供商业文件下载或公开分发。

### 验证分层

1. **快速检查。** 复用 `npm run inspect:mdict -- <明确本地文件...> --hash --label <脱敏标识> --output <本地报告>`。先按当前工具实际限制执行；默认 12、最多 24 条样本只做诊断，不能把 inspector 改名成全库验证。超限/不支持/损坏/未就绪与真正 no-hit 分开记录。
2. **完整结构与正文读取。** 全部 key/record block 的数量、尺寸、checksum、record offset/终止边界及正文解码必须可核对；以流式、分块方式读取，每个块避免重复解压，不把整个超大词库装入内存。记录真实总数、已验证数、失败数及中断位置；未扫完明确 PARTIAL，不用样本百分比替代。
3. **独立解码对照。** 使用固定版本、不同实现来源的 reader，对相同原始输入核对 key occurrence → record 的完整映射及原始正文 bytes/hash；MDD 核对原始资源 bytes/hash。重复 key、共用 record offset、alias 与 StyleSheet 展开前后的内容分开处理，不能先有损转成纯文本再比较。至少完成目标包全量结构/正文对照；差异逐条归因，不因两个工具都“打开了”就算一致。独立 reader 负责结构对照，不能替代 TranslateFlow 的 header/范围索引/查询语义。
4. **实际查询对照。** 固定至少 60 个不重复的真实查询：常用/多义 20、词形/别名 10、短语 10、技术标点 10、Unicode/大小写边界 10，另加明确不存在的负例。某类不在词典收录范围时如实注明并补其它代表样本，不伪造正文；合成测试继续补算法边界。对库中已知存在的词，必须命中预期词条/义项来源；不返回错误相邻词或因规范化碰撞串词。通过原索引无法构造的词形不承诺自动词形还原。
5. **内容价值单独验收。** 检查所选英汉学习词典的中文释义、词性、常用词分义项和例句/用法是否确实存在，并在产品中保留对应关系。至少选择 10 个复杂词条作同文件对照。内容稀疏是词典选择问题，不能加 AI 中文或手写释义来伪装解析结果。

对照工具的精确版本/命令、本地文件集身份、实际检查范围与结果要可重现。优先复用或小幅扩展 `scripts/certify-rich-mdict-corpus.mjs`、既有 importer 和 corpus harness；它们现有 ECDICT 专用假设必须先核对，不能只换 label 就声称支持任意目标包。不新增另一套通用认证平台。

目标确实需要而目前受限的能力，先记录“对应文件特征 → 复现 → 最小修复 → 回归”。资源脚本执行、任意外网访问、绕过权限/CSP/安全限额不属于可接受修复。不能安全解决的核心能力保持 BLOCKED；可读正文的非核心降级须公开说明，不能隐藏后标完整支持。

## 6. OD-3：对同一目标包做真实浏览器验收

**前置：** OD-2 输入身份与查询预期明确；OD-1 相关修复已进入实际测试安装包。独立 reader 或外部桌面词典的截图不替代插件验收。

使用真实 WXT 安装包、准确 browser version 和临时独立 profile，记录扩展 ID/包 fingerprint。合成流程回归与真实词典验证分开；不得在生产包中偷偷加 fixture 文件或补漏代码。

| 用户故事 | 必须观察到的结果 |
| --- | --- |
| 选择文件 → 导入 → 查询 | 导入有进度/成功或明确失败反馈；列表与实际可用词典一致；选中目标词典后查询来源正确；已有其它词典不丢失 |
| 重启浏览器/扩展 → 再次查词 | 同 ID/profile 保留导入结果、优先级与设置；不卸载、不清库、不重新导入来伪装持久化通过 |
| 断网查词 | 查询与本地资源展示不请求 Provider、不自动下载远程资源；无命中与不支持/出错区分；AI 仅用户另行触发 |
| 60 个固定查询 + 复杂词条对照 | 正文、中文、词性、义项和例句对应关系可读；无乱码、串词、静默丢失关键解释；安全移除与原内容缺失分别说明 |
| 窄面板、滚动、浅色/暗色、键盘 | 扩展控件遵循现有 sage/beige 设计；长词条、表格不遮挡正文；焦点与 Escape 可用；不靠全局 CSS 污染网页 |
| CSS 缺失/不可用 | 原始备份不动；在临时测试副本或受控故障注入中验证无 CSS 仍能读核心文字、层级不混；明确降级提示 |
| MDD 图片与音频 | 对目标实际引用的资源检查配套、路径、类型与 payload；图片正常解码，音频经用户动作能播放；仅“找到 bytes”不算媒体可用；未实际验证的类型标 NOT TESTED |
| 缺资源/损坏资源/取消/替换 | 缺失与安全阻断不冒充成功；核心正文可读时局部降级；失败导入不破坏旧词典；取消/换选区/关闭后旧结果不回写且释放资源 |

目标自身没有图片或音频时记 NOT APPLICABLE，不用合成媒体 PASS 升格真实媒体认证；无法确认实际声音输出时明确未验证。允许对照欧路或 GoldenDict 中同文件的内容结构，但不要求执行原词典任意 JS、恢复危险样式或像素级复制。

性能记录使用实际测试设备和测量：导入耗时、冷/热查询 p50/p95、可测内存及样本量、取消反馈和重启后查询；未知写 UNKNOWN，不填估算的零。用户路径不能无限等待；查询/解压仍受现有预算控制。只对证据显示的可感知阻塞优化，不为本任务另建性能平台或承诺未经测量的“秒开”。

## 7. 验证命令、证据与完成标准

机器命令及产物要求读取 [state.json](state.json)，不要在此再维护第二份清单。当前列出的命令覆盖实现质量和合成 Rich MDX/MDD/安全/取消回归，**不包含尚未提供的真实目标词典验收**。锁定目标与实际可执行的 corpus/browser 命令后，主 Agent 须在冻结候选前将它们补入同一 validationCommands；不能把缺输入时 skip/零测试/占位参数当 PASS。输入绑定和预期查询必须随该验收固定，私人路径只在本地证据中保留。

开发中只跑受影响检查；合入实现前按本地流程完成一次完整验收。`npm run validate` 已构建 `dist/extension`；本卡回归显式用 `TF_E2E_ARTIFACT=dist/extension` 复用这个包，不无故再构建另一份。需要不同产物路径时先按消费者核对并统一绑定，不能测试 A 后以重新构建的 B 交付。

本地原始文件、词头、正文、截图、音频、路径和完整日志仅放在 Git 忽略的 `docs/task-execution/local/offline-dictionary/`；仓库只保留脱敏摘要、覆盖数量、检查结果和必要代码/合成 fixture。具体检查保存实际命令、candidateHead/tree、环境、耗时、日志 hash、字典输入身份和包 fingerprint；旧证据不改写为本次执行，自查不冒充独审。

整卡完成须同时满足：

- OD-1 二进制正负例与已有回归通过，保留安全/查询/存储契约；已知缺陷不再出现在实际目标路径。
- OD-2 的目标已固定、全量读取/独立对照完成，固定查询无未解释漏词/错词，内容价值符合本卡目标。
- OD-3 同一输入、同一实际包的导入/重启/离线/显示/适用资源/恢复验收完成；未验证或受限能力逐项列出，不藏在总体 PASS 中。
- 主 Agent 对准确候选完成自查，无未解决的核心正确性/安全/数据阻塞；本地 gate 与实际远端保护要求满足，按 expected-head squash 合入并核对 main tree 后才记录实现 mergeHead/completed。

最终交付说明必须能填出：

> 词典 X（版本与明确文件集身份）在 TranslateFlow 提交/安装包 Z、浏览器 B 上，已完成哪些范围的读取与查询验证、哪些真实展示/媒体验收；已知限制是什么。

不能写成“所有 MDX/MDD 都能解析”“达到牛津级内容质量”或“全部主流浏览器兼容”。有明确、非核心降级时按范围说明；缺目标文件、未运行正文对照或未做真实浏览器验收时，整卡不得完成。

## 8. 下一步与停止条件

获准实施后的第一步是 **OD-1 的真实二进制失败复现和最小修复**；同时仅收集 OD-2 所需的那个目标包，不让文件缺失阻塞可独立完成的算法修复。需要分阶段合入代码时仍执行适用本地验收，整卡保留未完成阶段和下一动作；不得把部分代码合入当产品任务关闭。

一个目标词典按上述范围验证可用后，先交付可安装包与支持边界。下一项由真实用户使用中复现的兼容性/体验问题决定，不自动扩张为第二个编译器、全格式实现或新一轮无限研究。发现不属于本卡的缺陷只记录，不修改其它任务状态或启动未经授权工作。
