# PR #345 最终缓存系统验收报告

日期：2026-10-19；结论：**READY_FOR_USER_ACCEPTANCE**。用户人工验收也已明确 PASS；本报告保留该实际反馈，不要求重复验收相同安装包。

## A. 测试基线

| 项目 | 实际结果 |
| --- | --- |
| origin/main | `961a3757f3cad93921031b038e52e621c8c840b7` |
| 准备前 PR #345 head | `23bb8275608d9053d92219e55dace44cc69bb39e` |
| 最终实现候选 / 本轮全部命令 testedHead | `4545d8ce19a808a0ef940d61f64ca43dceb97e53` |
| candidate tree | `04d413137c13b6ffe921aa0161d076d0f91fc297` |
| inputTree | `1951fd55bbb147d3f4ce9ee12203844056f9a91b050bdc575ac1145db6b36d13` |
| Node / npm | `v24.22.0` / `11.19.0` |
| 浏览器 | Chromium 153.0.8010.12 / Playwright 1.63.0 |
| 系统 | Linux-7.2.5-3-omarchy-x86_64-with-glibc2.44 |
| WXT / 扩展 | 0.21.4 / 0.8.20 / MV3 |

候选已通过普通 push 更新同一 PR 分支，包含已 fetch 的 main。最终验收归档是其后代，只有当前任务元数据和生成索引差异；归档后的精确 syncHead 由最终 Gate 和 PR 说明记录，避免文件自引用未来提交 SHA。原先不同父链/tree 传输提交的验收未被改写成本轮结果。

依赖沿用上一轮 `npm ci --no-audit --no-fund` 的成功安装；本轮 package/lock 未改。`npx playwright install chromium` 实际退出 0，复用已安装浏览器。旧升级包沿用固定提交 `19e89b65fd3600073410407392da82ffa666ffc8` 的独立 worktree 产物，没有重建、下载词典 setup 或使用用户私有词典。

## B. 测试结果矩阵

本表按实际报告单位填写，各行有包含关系，不相加。Native IndexedDB 是 1 个 Playwright wrapper 内的 19 条真实浏览器合同断言。

| 测试 | PASS | FAIL | SKIP | BLOCKED | NOT RUN |
| --- | ---: | ---: | ---: | ---: | ---: |
| Check（语法/架构 + i18n） | 2 | 0 | 0 | 0 | 0 |
| Node tests | 1844 | 0 | 0 | 0 | 0 |
| Typecheck | 1 | 0 | 0 | 0 | 0 |
| Vitest | 59 | 0 | 0 | 0 | 0 |
| Extension build（validate 内） | 1 | 0 | 0 | 0 | 0 |
| 定向缓存 Node | 148 | 0 | 0 | 0 | 0 |
| 提交规则/任务归档定向 Node | 24 | 0 | 0 | 0 | 0 |
| 显式 WXT build | 1 | 0 | 0 | 0 | 0 |
| WXT smoke | 1 | 0 | 0 | 0 | 0 |
| Native IndexedDB | 19 | 0 | 0 | 0 | 0 |
| MV3 integration | 6 | 0 | 0 | 0 | 0 |
| 同 ID 升级 | 2 | 0 | 0 | 0 | 0 |
| 完整 Chromium E2E | 224 | 0 | 7 | 0 | 0 |
| 本地 Gate（归档前） | 1 | 0 | 0 | 0 | 0 |

`npm run validate` 的五道实际门禁均退出 0，检查 769 个源码文件；没有跳过失败断言或降低覆盖。Node 与单 worker 浏览器链并行，日志分别保存；9 条合同命令均有实测耗时和完整日志 hash。完整 Chromium 是**单次**运行 224 PASS / 7 SKIP / 0 FAIL / 0 flaky / 0 retries，包含升级及 injection 样本，没有用旧候选 PASS 充作本轮新执行。

准确命令和日志：

- `npm run build:extension:wxt`
  - 退出码 `0`，实测 `2431.592 ms`；日志 `docs/task-execution/local/cache-system-v1/5ffb033a-1bdc-4e44-9d54-2b473d7faabb.log`；SHA-256 `7cc2d0a12adb030492592a3422fa9b6e0449ff4b187b631942348eb683d6072f`。

- `node --test tests/cache-system.test.mjs tests/cache-system-domains.test.mjs tests/cache-system-review.test.mjs tests/cache-system-integration-review.test.mjs tests/cache-system-auto-feedback.test.mjs tests/cache-system-persistence-failure.test.mjs tests/native-client.test.mjs`
  - 退出码 `0`，实测 `270.399 ms`；日志 `docs/task-execution/local/cache-system-v1/3a0ebc8c-5077-42ed-a0f1-6dc98bce91a3.log`；SHA-256 `14f7827ddcff8447fd0572f8ea89a0849b28ca87ed4329d7934adfa878f3a62e`。

- `npm run test:wxt:smoke`
  - 退出码 `0`，实测 `1152.278 ms`；日志 `docs/task-execution/local/cache-system-v1/5b0c80ad-ef43-4bc7-8b38-f3c60930a3ce.log`；SHA-256 `4f29e14a95b7c2a8fee00e9aed7deb03f0a1bb9390ec1673daf3f6c126156efe`。

- `node --test tests/local-task.test.mjs tests/versioned-commit.test.mjs`
  - 退出码 `0`，实测 `3815.460 ms`；日志 `docs/task-execution/local/cache-system-v1/effd83e9-fdbb-4185-82a1-08ae0688790b.log`；SHA-256 `5554130fd425bb9954315e19fca21f73145a2efd5dabf0ad999e0e4a0098254f`。

- `npm run test:e2e -- e2e/cache-system-native.spec.mjs --workers=1 --retries=0`
  - 退出码 `0`，实测 `891.076 ms`；日志 `docs/task-execution/local/cache-system-v1/75422e4b-0b26-4ab1-b8c9-5d556497f1ef.log`；SHA-256 `fdd1d608ea222fa11e2b5c819fbe5e953fca6d524087f75f282541cf71d42452`。

- `npm run test:e2e -- e2e/cache-system-mv3.spec.mjs --workers=1 --retries=0`
  - 退出码 `0`，实测 `4898.553 ms`；日志 `docs/task-execution/local/cache-system-v1/4e5deb6e-0be4-4423-8bf0-9ed012e71fab.log`；SHA-256 `1fa14e9f059dc806d5c5f2511ef577142d2321ebf5cce9e70369574184c1bca0`。

- `npm run validate`
  - 退出码 `0`，实测 `54764.175 ms`；日志 `docs/task-execution/local/cache-system-v1/9c0e2c84-7377-4cc5-9824-bc6172ab2ef6.log`；SHA-256 `745f2f67b5f46b7c814ae5a28cdfa8154b37e2593399d438ba0bfb20661bd350`。

- `npm run test:e2e -- e2e/wxt-upgrade.spec.mjs --workers=1 --retries=0`
  - 退出码 `0`，实测 `22118.585 ms`；日志 `docs/task-execution/local/cache-system-v1/d1ec5ace-b298-41c6-921a-10aa3aae1ab4.log`；SHA-256 `e10e3e345b933fb2274755dd8b24980db68836b33e620c66ccdc2341a97a8742`。

- `npm run test:e2e -- --workers=1 --retries=0 --reporter=line,json --output=docs/task-execution/local/pr345-final/test-results`
  - 退出码 `0`，实测 `460596.350 ms`；日志 `docs/task-execution/local/cache-system-v1/89f8323c-8849-47ed-9841-bffd9df75e6c.log`；SHA-256 `262cc959320daddada59a1548ae6d315e9f27707c732290dd148b414def696de`。

完整 JSON：`docs/task-execution/local/cache-system-v1/final/full-report.json`，SHA-256 `f7cc2def7ecf768be2f8bf2bdf19c9b0e124f27c11c128468ace60519dccdb63`。并行运行器在两条链结束后合并每个 runCheck 实际生成的记录，保留原 command/candidateHead/log/duration，不丢失并发归档结果。归档前 Gate：`docs/task-execution/local/cache-system-v1/final/gate-before-archive.json`；归档后再次核对同一输入。

实际条件跳过（完整身份和注释在 `docs/task-execution/local/cache-system-v1/final/skip-manifest.json`）：

- `cc-cedict-resource-display.spec.mjs`：imports original MDX/MDD, displays a selected record with safe styles, and survives restart。
- `large-mdd-opfs-import.spec.mjs`：imports the 1.63 GB logical resource stream into OPFS and reads its tail after restart。
- `local-dictionary-import-v2-product.spec.mjs`：locally supplied real MDX/MDD imports, looks up offline, and survives a browser restart。
- `local-dictionary-preflight-real-ecdict.spec.mjs`：pinned real ECDICT MDX preflight stays local, bounded, and routes to the rich importer。
- `release-lexicon.spec.mjs`：production extension resolves the built Core and Technical packs without Provider calls。
- `rich-mdict-real-corpus.spec.mjs`：Settings install survives reload, Selection shows a real record with zero Provider calls, and delete removes it。
- `rich-mdict-real-corpus.spec.mjs`：the Settings card requests the exact host pair, installs/reinstalls the real archive, preserves the active version on failure/cancel, works offline, and deletes。

## C. 发现与修复

| 触发 / 根因 | 修复文件和关联测试 | 提交 |
| --- | --- | --- |
| 译文已生成后缓存持久化失败导致结果丢失或重发 Provider | Content Page/Selection/Subtitle/native client；cache-system-persistence-failure、native-client、MV3 回归 | `60650024` |
| 增量自动翻译/仅恢复缓存错误缺少可恢复提示 | `src/content/auto.js`；cache-system-auto-feedback | `0e7d7372` |
| 普通原文中的 TF 标记被猜测为内部结构化协议 | `src/shared/translation-cache-identity.js`；cache-system-domains | `69530172` |
| 全局 LRU 误淘汰独立 AI explanation | `src/background/cache/application.js`、Memory/IndexedDB driver；domain/native 容量回归 | `baa650df` |
| 词典 Worker 提交、状态刷新、Selection 导航取消及 Reading 关联问题，以及安装默认值/React/共享 Profile fixture 漂移 | Selection/Reading/Options/Worker 和现有 harness；完整 Node/Vitest/E2E，历史逐项归因保留在 review.md | `23bb8275` |
| 无状态历史任务目录使索引 ENOENT，验收报告无法归档，普通提交自动升版本/构建使证据再次失效 | `scripts/local-task.mjs`、`.githooks/pre-commit`、AGENTS/CONTRIBUTING/LOCAL_WORKFLOW；local-task 和 versioned-commit 真实临时 Git 回归 | `4545d8ce19a808a0ef940d61f64ca43dceb97e53` |

本轮收口没有再改缓存生产代码、依赖或扩展权限。索引只投影实际存在的 state.json，未虚构 browser-native-language 状态。提交钩子只检查暂存 diff；按需版本准备命令仍保留。Gate 的准确候选、祖先关系、实际磁盘输入、必需命令/日志、退出码和包指纹校验全部保留。

## D. 数据及安全检查

- Native IDB：DB4 初始化、DB2/DB3→DB4、非空 explanation 搬迁、迁移事务回滚、blocked retry、持久失效令牌、并发事务、TTL/LRU/容量、跨连接失效、关闭和重开、namespace 与 explanation 独立配额均通过。
- 两种真实同 ID 升级：相同临时 Profile、相同扩展路径，旧包实际写数据→新包→运行时恢复→浏览器重启。旧普通缓存按协议清理；AI explanation、ReadingRecord、词典 OPFS、配置/站点/合成凭据保留。报告位于 `docs/task-execution/local/cache-system-v1/final/upgrade-upgrade-evidence/`；扩展 ID 为 `khcmfhpkoenhepkeocmmjimdhgppgcip` 和 `icanghpjbjcabpmhbgllaoehoolhinnb`。不清库修复迁移。
- Page cache-only 恢复不增加 Mock 请求；本地词典命中不隐式调用 AI；解释缓存命中及翻译容量清理后仍不增加请求。清页失效令牌拒绝旧任务写回；Selection/SPA/取消不覆盖新结果，自动化有请求次数和实际关闭断言。
- 真实收费 Provider **NOT RUN**。测试只用仓库 Mock、合成数据和临时 Profile；没有用户真实 Key/Cookie、页面、翻译记录、ReadingRecord 或私有词典。人工 Provider 请求计数 **NOT VERIFIED**，不以体验正常代替计数证据。
- 当前包全部权限数组与 origin/main 相同；0 符号链接，无 tests/e2e/docs/scripts、source map、秘密配置或密钥文件。包内 src 路径仅为既有审核过的精确 MAIN/Worker 资源闭包，词典资源为 0 bytes。WXT smoke 扩展 ID `jaihmoddoflbpjeogjagpnflmcnminkf`；生产 manifest 没有固定 key，实际 unpacked ID 由安装路径确定。

## E. 构建产物

| 项目 | 实际值 |
| --- | --- |
| 实际 WXT 安装包 | `.output/chrome-mv3/`；默认输出 `dist/extension/` |
| 版本 / candidateHead | 0.8.20 / `4545d8ce19a808a0ef940d61f64ca43dceb97e53` |
| 文件数 / 总字节 | 128 / 2916095 |
| local-task 包 fingerprint | `c3b444aed6277b4741c0a10637cfe85a0941476582973a8a535685422f02e664` |
| ZIP | `docs/task-execution/local/cache-system-v1/final/TranslateFlow-0.8.20-pr345-4545d8ce.zip` |
| ZIP 大小 / SHA-256 | 858441 / `82a13b8c583c5f77b3ca1b95d931f53c068083fa6a072a5696eb2fe23c5d33f7` |
| 逐文件清单 | `docs/task-execution/local/cache-system-v1/final/artifact-inventory.json` |

相同版本的实际生产包内容 fingerprint 与用户已验收候选完全相同；ZIP 使用当前候选提交时间与确定性文件顺序封装，来源明确，没有把元数据归档文件放入包。旧/新 WXT 对照复用固定旧包，测试不扩大生产权限。

## F. 剩余问题与结论

**READY_FOR_USER_ACCEPTANCE**。本轮全部必需且可执行自动化命令与本地 Gate 通过；用户于 2026-10-19 明确确认页面翻译/缓存恢复、Selection、统计和 YouTube 字幕人工验收通过，实际安装包字节未变，因此保留该证据。

仍保留上述 7 个缺外部资产的条件性 SKIP，未宣称支持未验证私有词典；Chrome 102、其它浏览器和真实收费 Provider 未运行。既有 #245 体积 advisory 非阻断，没有降低预算。本报告由主 Agent 根据真实结果自查整理，不冒充独立模型审核。

用户已授权 squash 合并。归档与合并前核对精确远端 head，使用 `--match-head-commit`；仓库当前没有 main 分支保护/ruleset，不使用 admin bypass 或强推。状态在实际合入并核对 main tree 前保持 ready_to_sync；合入后本地记录 mergeHead/completed，完成记录按仓库流程随后续同步，不直接向 main 推送元数据。
