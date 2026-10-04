# TranslateFlow 持续源码导读


## 目标

建立与当前实际源码同步的中文技术导读，让开发者能回答：插件如何启动、一个用户操作经过哪些模块、每个文件负责什么、修改功能应从哪里入手，以及哪些安全和生命周期约束不能破坏。

本任务不是按行翻译代码，不是自动重构，也不是复制已有架构文档。主要交付是**完整功能调用链 + 逐文件解释 + 可核验源码链接 + 持续更新记录**。

## 工作范围

- 仓库：`CoderLambert/translateflow-plugin`。
- 唯一写入分支：`docs/code-walkthrough`。
- 唯一文档目录：`docs/code/`。
- 读取目标：每轮最新 `main`；文档分支上的代码可能落后，不能把它误当最新 main。
- 当前清单基线：`13041666b253ecf9aa86b3ff5edfa677dde01c05`（#293）。本轮完整说明20个页面再访/摘要/共享响应/归档与classic接线文件，其中16个补齐、4个既有全文复核；其它增量只同步blob和待复核状态，未变正文保留其固定身份。
- 当前状态：817 个文件全部登记；230 个完整解释、531 个待解释、56 个待复核；局部正文 136 个（待解释中 103、待复核中 33），不计完整覆盖。本轮运行验证 **NOT_RUN**；#240 原候选已有 READING_ABC_PASS，见下方准确证据边界。全仓逐文件导读仍未完成。


## 已交付导航与推荐阅读顺序

1. [运行时总览](architecture.md)：后台、扩展页面、Content、MAIN、Worker如何分工。
2. [扩展启动完整流程](features/extension-startup.md)：从普通网页静态加载/Popup/快捷键到页面可交互与Reading固定打开，包含失败与重复注入。
3. [启动模块逐文件说明](modules/startup.md)：保留旧入口并更新Manifest/站点模式；接[真实入口与测试输入](modules/real-entry.md)。
4. [划词、本地词典与显式AI完整流程](features/selection-and-dictionary.md)及[18个文件详解](modules/selection.md)。
5. [MDX/MDD导入与安全展示](features/local-dictionary-import.md)及[15个文件详解](modules/dictionary-import-render.md)；继续读[解析→紧凑索引→OPFS→范围查询](features/mdict-storage-internals.md)与[35个内部文件说明](modules/mdict-storage-internals.md)。
6. [网页翻译、缓存恢复与重访](features/page-translation.md)及[15个文件详解](modules/page-translation-cache.md)。
7. [YouTube字幕完整流程](features/youtube-subtitles.md)及[11个文件详解](modules/youtube-subtitles.md)。
8. [Provider与设置完整流程](features/providers-and-settings.md)及[11个文件详解](modules/providers-and-settings.md)。
9. [授权站点再访→最小摘要分页→页面marker/list→失效清理](features/reading-page-markers.md)及[20个逐文件/证据说明](modules/reading-page-markers.md)；接[返回原文：一次性交接→定位/临时卡→classic投影](features/reading-return-to-page.md)及[20个逐文件说明](modules/reading-return-to-page.md)；先读[Reading真实查询→显式保存→实际学习中心](features/reading-records.md)及[后台/保存详解](modules/reading-records.md)、[16个React/测试/规范文件](modules/learning-center.md)、[#286真实用户验收与八个文件](modules/reading-release-a.md)。
10. [构建→实际产物→测试→安装升级](features/build-test-release.md)及[逐文件详解](modules/build-test-release.md)：含最终 writeBundle、React 独占闭包、平台预算、三页面映射和历史验收辨读。
11. [本地任务合同→冻结→验收→主Agent自查→同步](features/local-task-acceptance.md)及[逐文件说明](modules/local-task-acceptance.md)。
12. [全仓文件地图](repository-map.md)：按目录查文件、跳源码和解释。
13. [覆盖清单](coverage.json)：817个文件的固定blob、状态和正文位置。
14. [更新记录](changes.md)：本轮证据与下一步。

当前已有启动、划词、词典导入/安全展示/存储内部、网页翻译/缓存、字幕、Provider/设置、Reading 与构建/本地验收调用链。Reading production collector 与显式保存已在 main 接通；实际React学习中心已接上列表/详情/过滤、管理、导出与错误恢复，见[用户操作到源码](features/reading-records.md#learning-center)；#286现已整合无seed真实创建/完整重启、近容量UI导出与原生quota恢复；[149项复用汇总](modules/reading-release-a.md#evidence-chain)不是新全量运行。构建和 validate 默认 WXT 输出 dist/extension，而 E2E 默认仍消费 .output/chrome-mv3，测试 dist 必须显式指定。主 Agent 自查取代强制模型独审，真实外部门槛仍保留。

本轮接通持久再访完整链：站点marker意图与权限→真实文档证明→page-scoped摘要/cursor→共享resolver→总数/前200项列表与点→DOM/SPA/暂停/删除/撤权/取消。当前实现对所有resolved记录画点、未按hasCompletedAssistant筛选；body投影16k UTF-16/500节点/8ms提前失败会使批量全not-loaded，mutation新load也不受终身三次预算。详见[现有合同差异](features/reading-page-markers.md#boundaries)，没有顺手修代码。

#240已归档候选 `1bbfdfb` 的validate/WXT/Chromium9/9（6个A、3个B/C）READING_ABC_PASS，#291仅补文档证据；[原候选与后续源码分开](modules/reading-page-markers.md#evidence)。本轮未执行这些命令，不把PASS外推为所有Issue条款、Chrome102/真实撤权/权限迁移/真实Oxford/发布通过。前章[open Shadow历史quote风险](features/reading-return-to-page.md#5-必须保留的隐私警告)及[真实启动证据限制](modules/real-entry.md#limitations)仍保留。


## 建议目录

以下是规划结构；只有实际创建的文档才加入已完成导航，不制造不存在的链接。

```text
docs/code/
  README.md                     # 目标、导航、覆盖状态和阅读顺序
  architecture.md               # 启动、运行时边界、模块与数据流
  repository-map.md             # 所有受版本管理文件的职责索引
  coverage.json                 # 文件清单、源码身份、覆盖与复核状态
  features/                     # 按完整产品流程组织
    extension-startup.md
    selection-and-dictionary.md
    local-dictionary-import.md
    page-translation.md
    cache-and-auto-restore.md
    youtube-subtitles.md
    providers-and-settings.md
    reading-records.md
    build-test-release.md
  modules/                      # 每个模块的逐文件详解，可合理分章
  changes.md                    # 只记录有意义的源码变化与文档更新
```

## 每个文件必须解释什么

每个第一方源码、入口、配置、脚本、测试与重要文档文件，都必须在 repository-map/coverage 中有唯一记录。详细正文可按模块合并，不强制一源文件一Markdown。

1. 文件路径、所属功能、为什么需要它。
2. 主要导出/类/函数与职责；关键实现步骤和算法，而非复述每行语法。
3. 调用方、依赖方、输入、输出及关键消息/数据结构。
4. 状态由谁持有，何时创建、持久化、失效和释放。
5. 用户动作如何到达这里，它的结果如何回到界面。
6. 成功、空结果、错误、取消、重试和过期响应如何处理。
7. 权限、隐私、不可信输入、安全清洗及性能边界。
8. 相关单元/浏览器测试与断言覆盖；未执行的测试明确写 NOT_RUN。
9. 修改此文件通常影响什么，哪些相邻模块需要一起验证。
10. 固定 commit 的源码链接及关键行范围、最后复核的源码身份。

纯数据文件、锁文件、生成物及第三方文件逐项登记用途和类别，不逐行展开或把上游实现当本项目自有代码。依赖安装目录、构建输出、缓存和未跟踪文件不纳入第一方逐文件正文。排除项要解释理由，不能静默漏掉。

## 每个功能流程必须交付什么

- 用户入口与可观察结果。
- 从入口到后台/worker/存储/Provider再返回UI的完整调用链，区分真实存在与尚未实现。
- 关键消息、数据转换、状态所有者和生命周期。
- 正常路径加至少一个相关失败/取消路径。
- 参与文件清单，并链接到逐文件说明；模块关系可用 Mermaid，但必须同时有文字解释。
- 现有测试能证明什么、不能证明什么；不把静态阅读包装成实际运行结果。
- 推荐阅读顺序，以及最小改动入口。

## 如何循环推进

1. 先读取本目录和最新 main 的增量，检查是否已有同任务在运行。
2. 第一轮盘点受版本管理文件，建立覆盖清单；优先解释启动和核心用户路径，不从零散工具函数开始。
3. 每轮完成一个完整功能切片，包含调用链及其涉及的逐文件说明。当前优先：启动 → 划词/词典查询 → MDX/MDD导入与资源渲染 → 网页翻译/缓存 → YouTube → 设置/Provider → Reading → 构建测试。
4. 已覆盖文件发生变更时，将受影响文档标记待复核，更新相关调用链；只更新增量，不反复全仓重读。
5. 文档绑定所读源码的 commit 或 blob 身份。同一功能文档不得混合多个不相容版本；必要时说明迁移中的双构建路径。
6. 覆盖清单维护 path、source blob/commit、状态、所属功能、说明链接、最后复核时间。覆盖率按事先列明分母计算，不把“提到文件名”当作解释完成。
7. 尚未覆盖、存在疑问、与运行证据不一致的内容单列。一个关键疑问不能靠推测填满文档。
8. 全部初始范围解释完成后转为增量维护。没有源码变化或新证据时不提交空改动，不发重复总结。

## 协作和写入边界

- 每轮仅一个文档写入者，避免定时任务重叠造成覆盖；已有任务仍在运行则不重复启动。
- 只修改 docs/code/。不改业务代码、依赖、manifest、权限、全局设置或现有开发任务，不重排其他开发者。
- 同步最新源码使用独立只读引用/工作区；不要为更新导读强推或重置文档分支，也不要覆盖别人的文档修改。
- 发布前重新读取目标文档和分支头；有并发变化先合并内容再提交，禁止无条件覆盖。
- 不运行未知脚本、不读取凭据，不在文档中记录密钥、私有文件、词典原文、用户页面内容或下载地址。
- 遇到值得修复的代码问题，在文档中给证据、影响与建议，并交回协调者；本任务不顺手修代码。

## 完成标准

- 每个纳入范围的受版本管理文件都有记录，并标明已解释、待解释、待复核或有理由的排除。
- 核心功能从入口到结果的调用链完整，源码链接可定位，输入输出和状态所有权一致。
- 每文件说明包含实际实现要点、依赖及修改影响，不是仅一句标题或函数列表。
- 测试结果只报告实际运行过的内容；设计意图、当前实现与待开发项严格区分。
- README有清晰导航和学习顺序；读者能据此定位改动并找到相关验证。
- 每轮提交说明分析了哪些功能/文件、解决了什么理解问题、仍有哪些缺口。

## 当前已知架构事实

下列信息来自当前仓库约定与架构文档，作为导读起点；不代表逐文件解读已完成。

- 当前默认安装包 dist/extension 与显式 .output/chrome-mv3 使用同一 WXT 引擎；Content/MAIN/Worker 仍精确 raw bridge，不能假定已变为普通 bundler ESM。
- shared保持纯合同/纯函数，background协调消息和持久化，content负责页面/划词/字幕界面；根入口保持薄层。
- 翻译缓存、独立ReadingRecord库、词典OPFS是不同数据边界。
- 适合本地词汇检索的选段先查词典，AI详解显式触发；句子/不支持语言及无命中多词短语可走普通翻译。MDX/MDD走范围读取与受控渲染，不执行词典JS。
- 现存测试数量和某个旧PR通过，不等于最新源码全部行为已验收。

来源：[AGENTS.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/AGENTS.md)、[架构文档](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/docs/ARCHITECTURE.md)、[贡献与验收流程](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/CONTRIBUTING.md)。



