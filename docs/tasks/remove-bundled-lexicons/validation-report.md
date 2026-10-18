# 内置词典移除验收报告

## 1. 代码清理结果

用户现在从正常空词典库开始，主动下载或导入词典；不再有内置词典、包资源探测、健康状态API或源码修复提示。

- UI：删除内置分组、BundledList、snapshot.bundled、旧状态presentation与CSS/i18n；保留精选/官方、已安装与导入。空状态可用下载/导入入口，键盘焦点留在词典页。
- 后台：删除固定Core/Technical Reader、状态消息/router分支、无消费者stats导出与package-assets.js及fetch例外。唯一Gateway继续接active OPFS Reader与Glossary。
- 故障：无安装包正常no-hit；全部用户Reader不可读时保留typed错误和恢复操作，健康Reader与Glossary不被故障压制。诊断按请求局部收集，不读取共享旧stats决定本次结果。
- 构建：删除词典路径、参数、环境变量、资源注册和可重新打入内置词典的模式；MAIN/Worker精确闭包、安全路径及安装包审计保留。
- 工具/来源：删除专属Core/Technical生成、setup/release/bootstrap/benchmark/旧认证、来源锁、手工词条与Wikidata专属来源审计。通用逻辑解耦为scripts/tflex-writer.mjs；通用Reader/Writer/哈希/校验和第三方导入/来源审计保留。
- CI：删除lexicon-release.yml；保留并更新词典库vNext/ecosystem认证，不再构建旧资源。用户词典测试不得作为可选skip。
- 测试：默认fixture不增删任何词典包资源；命中用例显式在隔离OPFS准备用户包，故障针对实际读取范围。原231个浏览器用例保留，新增1个旧main替换/数据保留用例。retry固定为0。
- 文档：当前说明改为用户安装模式；旧政策/生成说明退役，历史原候选的SHA、测量及审计不改写。命中分类和逐文件删除理由见review.md。

按--no-renames统计，候选含36个路径删除；Core编译器共享部分被提取至新writer（Git可识别为重命名）。不引入依赖、feature flag、第二套Gateway或数据迁移。

## 2. 功能保留情况

| 能力 | 保留路径与验证证据 |
| --- | --- |
| 精选上游下载 | 既有curated Provider/Worker与精确origin权限链；curated-ecdict/curated-ecdict-mdx产品E2E |
| StarDict | 既有解析/导入/安装事务；stardict-import-product E2E与Node |
| MDX/MDD | 本地富文本、资源恢复、sanitizer、范围读取及取消；rich-mdict/mdd-resources/Oxford合成fixture/安全E2E |
| TFLex | 通用Reader/Writer/完整性与真实UI导入；writer/reader/local-import Node及升级E2E |
| OPFS | 既有目录与state schema不变；安装回滚/损坏隔离/删除/重启及升级逐文件hash比较 |
| 多词典 | 聚合、首选、顺序、启停、删除与资源恢复保持；multi-dictionary及library E2E |
| Glossary | 既有有效配置/站点覆盖优先；空库runtime测试与升级后显式命中 |
| Selection | 本地优先、no-hit显式交互、AI/取消、旧结果隔离；Selection产品E2E |
| Reading/Vocabulary | 既有独立数据库与消息；Reading/学习中心/E2E及升级全部IDB快照比较 |
| 翻译缓存 | 缓存源码/schema未变；全量缓存回归和升级后真实cache token命中 |
| YouTube | MAIN/字幕源码未改；保留字幕/mock浏览器回归，真实线上timedtext非本次实测 |

## 3. 验证结果

最终候选：`0fcedc71af5e5b3efb57265c3773eabbe020987d`；tree：`6612062c3ede0c2eafd8072fb3ea94c9004420ea`；输入指纹：`0ed339e9bfe123fdd2df6198ac64286e53770d95ae19e82c50b0997dad69c8a5`。

首次`npm run validate`在`fdef650b24aca8a8012902c124b07f20b5f5ab6f`执行，FAIL，40.298秒：静态/i18n通过、Node1790 PASS/1 FAIL。唯一失败为工作流清单11→10的旧测试。该FAIL保留原始命令/退出码/head/日志/hash，未改写PASS。修正后仅重验受影响文件；其余生产/测试/构建输入经Git diff核对完全一致，复用1774个文件外Node PASS；该文件17项全部重验，因此1791个独立Node用例均有有效通过证据。

| 命令 | 结果 | 耗时秒 | 原始日志 |
| --- | --- | ---: | --- |
| `npm run check` | PASS | 14.695 | `docs/task-execution/local/remove-bundled-lexicons/101aadf4-bf39-4fd8-9d57-81e2ca2448a2.log` |
| `node --test tests/local-task.test.mjs` | PASS | 3.608 | `docs/task-execution/local/remove-bundled-lexicons/05e74706-594d-4d49-84ab-1e5a874384e9.log` |
| `npm run typecheck` | PASS | 4.821 | `docs/task-execution/local/remove-bundled-lexicons/21aea779-4b67-4964-a072-46d954480d6c.log` |
| `npm run test:unit` | PASS | 3.813 | `docs/task-execution/local/remove-bundled-lexicons/d17586b8-0f90-4966-b85a-a547f283e748.log` |
| `npm run build:extension` | PASS | 2.468 | `docs/task-execution/local/remove-bundled-lexicons/9d5a0eb9-cd76-4bd9-a3ac-5ae28ad5370b.log` |
| `npm run build:extension:wxt` | PASS | 2.498 | `docs/task-execution/local/remove-bundled-lexicons/a7a0b9c6-5a26-4817-9634-5d27346e9417.log` |
| `npm run test:wxt:smoke` | PASS | 1.190 | `docs/task-execution/local/remove-bundled-lexicons/46eeeb74-dbce-4eeb-8715-d73921656f02.log` |

完整Chromium执行中，最终结果与条件skip在归档前填入。开发阶段失败均保留原日志；定向修复后通过，不将Mock成功当作生产查询证据。完整日志只在Git忽略的docs/task-execution/local/remove-bundled-lexicons/。

## 4. 体积与依赖变化

| 指标 | 之前 | 候选 |
| --- | ---: | ---: |
| 跟踪代码文件（JS/MJS/CJS/TS/TSX/JSX/CSS/HTML，含源码、脚本、测试） | 779 | 760 |
| src+entrypoints运行时源码文件（同后缀） | 400 | 399 |
| 安装包文件 | 128 | 128 |
| 安装包字节 | 2916095 | 2896602 |
| 词典资源字节 | 0 | 0 |

代码行（上述后缀）：+882/-6557。实现候选全部diff（含数据/文档/任务证据）：+1255/-9868，146个Git差异条目。后续元数据归档另计。

基线本就不包含词典资源；此次减少的是相关运行时代码与维护负担，不宣称启动/查询性能收益。包减少19,493字节；未新增或更新依赖，package-lock与manifest权限无diff。旧#245平台代码advisory预算仍有构建警告（当前2,124,585/1,576,595字节），未调整或隐藏阈值；构建和精确边界审计通过。

实际包目录SHA-256（local-task逐文件算法）：`cc5c9155e71c08157828e0fc22365182a93c6528c6601e46e1daddcd0e176625`。

E2E inventory算法指纹：`12f3ce0521a0542e07750eaf472b668af8ac4a470600e436ee51326f98cfbe36`；两者排序/终止换行规则不同，不能直接比较。

本地人工验收ZIP：`docs/task-execution/local/remove-bundled-lexicons/TranslateFlow-0.8.20-no-bundled-0fcedc71.zip`，850697字节；SHA-256：`c30d0fe15421c1503d67c3b06f9d3302180ded73a03b014aae159a8a71c1fd69`。逐文件资源清单在本地artifact-inventory.json，未发现词典、fixture、source-lock、源码语料或开发脚本入包。

## 5. Git、限制与人工验收

main基线：`349321a079544a51834de1b3173f1fc653220e6d`；分支：`refactor/remove-bundled-lexicons`。PR #345 completed记录已按用户指令随本分支同步，旧验收绑定保持不变。最终PR及同步head在交付消息给出；不合并、不发布。

NOT RUN：真实付费Provider、Chrome102实际运行、其它浏览器、真实线上YouTube播放器、未提供的私有大型词典，以及未配置的真实语料/固定pre-WXT版本升级条件用例。精选下载的合成mock和真实大语料认证分别报告，不声称本次重新下载并认证全部上游资源。

新增升级测试使用归档旧main实际包与当前同版本开发包，在同ID/profile/unpacked路径通过真实UI安装TFLex+2MDX/2MDD。原生管理reload后确认执行指纹，storage/全部OPFS/全部IDB严格保留；显式GET_RECORD引起的访问时间/revision按原合同单独核对。此证据不是商店版本变更事件验证。

个人dev_*角色已写入~/.codex/agents；当前调度工具无角色名参数，实际以角色TOML的显式模型/effort和聚焦合同调度，不声称原生自动加载。所有子任务独立worktree，主Agent集成自查；有效权限继承当前danger-full-access/never，模型档位可观测性不足处记录UNKNOWN。原工作区其他任务修改未触碰。
