# PR #345 缓存系统完整自动化验收报告

日期：2026-10-19
结论：**BLOCKED**（自动化及产品人工验收均通过；本地同步 Gate 未通过）
范围：PR #345 独立缓存系统 V1；包含任务授权内的既有 Selection、Reading、词典、字幕及测试 harness 回归修复。未加入新 Provider 或翻译功能。

## A. 测试基线

| 项目 | 实际值 |
| --- | --- |
| `origin/main` | `961a3757f3cad93921031b038e52e621c8c840b7` |
| PR #345 最新 head（重新 fetch） | `23bb8275608d9053d92219e55dace44cc69bb39e` |
| 实际候选 | `23bb8275608d9053d92219e55dace44cc69bb39e`，tree `9957c71f0c98b679eda9a852c03e7dab151e8580` |
| 被验证的原始工作树提交 | `dc7a15ec3dfb918cf160b2366677eeb7f302a95e`；其 tree 与候选完全相同。PR head 是已验证 tree 的传输提交，未改变源码、测试或构建输入。 |
| Node / npm | Node `v24.22.0`，npm `11.19.0` |
| 浏览器 | Chromium `153.0.8010.12`，Playwright `1.63.0` |
| 系统 | Linux x86_64，kernel `7.2.5-3-omarchy` |
| 扩展 | Chrome MV3，WXT `0.21.4`，版本 `0.8.20` |

## B. 测试结果矩阵

计数按每行实际报告单位填写。原生 IndexedDB 行的 19 是浏览器内合同断言数；WXT smoke 和构建是命令级通过数。

| 测试 | PASS | FAIL | SKIP | BLOCKED | NOT RUN |
| --- | ---: | ---: | ---: | ---: | ---: |
| Check（语法/架构 + i18n） | 2 | 0 | 0 | 0 | 0 |
| Node tests（`npm test`） | 1842 | 0 | 0 | 0 | 0 |
| Typecheck | 1 | 0 | 0 | 0 | 0 |
| Vitest | 59 | 0 | 0 | 0 | 0 |
| 默认 Extension build（validate 内） | 1 | 0 | 0 | 0 | 0 |
| 定向缓存 Node tests | 148 | 0 | 0 | 0 | 0 |
| WXT production build | 1 | 0 | 0 | 0 | 0 |
| WXT smoke | 1 | 0 | 0 | 0 | 0 |
| Native IndexedDB（真实 Chromium） | 19 | 0 | 0 | 0 | 0 |
| MV3 integration（编译后 WXT 包） | 6 | 0 | 0 | 0 | 0 |
| 同 ID 原位升级（两种 UI locale 场景） | 2 | 0 | 0 | 0 | 0 |
| 旧/新包 injection cold/warm 样本 | 1 | 0 | 0 | 0 | 0 |
| 完整 Chromium E2E（用例身份去重） | 224 | 0 | 7 | 0 | 0 |

缓存与业务覆盖包括 Identity/namespace/scope/revision 隔离、record envelope、TTL/LRU/容量、Memory/IndexedDB 合同、cache-only/prefer-cache/reload/no-store、持久失效代次与迟到写保护、single-flight 取消竞态、坏输入处理，以及 Page/Selection/Chrome 本地模型/Subtitle/AI explanation 的配置快照、Provider 身份和富文本/纯文本隔离。

自动化 Provider 请求次数核对（均为仓库 Mock Provider，不代表真实 Provider 测试）：`e2e/translateflow.spec.mjs` 的页面手动翻译产生 2 次 Mock 请求，清理后执行 cache restore 仍为 2 次；增量 cache-only 恢复命中和 miss 均不增加请求。`e2e/selection-release-gate.spec.mjs` 的 Core/Technical 词典命中后请求数为 0，未知短语仅在明确触发普通翻译后为 1 次。`e2e/cache-system-mv3.spec.mjs` 的 AI explanation 首次明确生成请求 1 次，缓存命中及翻译容量清理后再次命中仍为 1 次；页面失效令牌拒绝迟到写入且该场景请求数为 0。`e2e/wxt-upgrade.spec.mjs` 的升级证据为 seed 1 次、缓存恢复没有新增请求、用户明确重译再加 2 次，随后刷新不再增加；报告的 `unauthorizedProviderCalls` 为 0。

取消竞态的证据分层：`tests/selection-explain-runtime.test.mjs` 确认取消会 abort Mock Provider signal 并拒绝旧请求；`e2e/selection-release-gate.spec.mjs` 确认切换 Selection 会关闭旧 AI stream，旧解释不会覆盖新词典结果。旧缓存结果写回由 `tests/cache-system.test.mjs`（失效取消 in-flight loader，迟到结果仍保持 miss）和 `e2e/cache-system-mv3.spec.mjs`（清页后旧 write token 返回 skipped）分别覆盖。上述测试均在最终候选现存测试结果中通过；本次只读取记录，没有重跑测试。证据位置：`docs/task-execution/local/cache-system-v1/full-e2e-base.log`、`docs/task-execution/local/pr345-final/full/reports/report.json`、`docs/task-execution/local/pr345-final/upgrade-evidence/`、`docs/task-execution/local/cache-system-v1/cache-focused.log`。真实收费 Provider 调用为 NOT RUN；用户本地模型人工验收未提供请求日志，因此人工请求数仍为 NOT VERIFIED。

执行记录与证据：

- 依赖安装：`npm ci --no-audit --no-fund`，退出码 0；日志 `docs/task-execution/local/cache-system-v1/npm-ci.log`。之后在这份干净安装上运行了完整 `npm run validate`，退出码 0；日志 `validate-after-ci.log`。结果为静态/架构检查 768 个文件通过，i18n 1,106 keys 一致，Node 1,842/1,842，严格 TypeScript 通过，Vitest 59/59，默认扩展构建通过。干净安装后另外重建 WXT 并重跑 smoke，产物 tree 仍为 `c3b444aed6277b4741c0a10637cfe85a0941476582973a8a535685422f02e664`。
- 缓存定向测试：`node --test tests/cache-system.test.mjs tests/cache-system-domains.test.mjs tests/cache-system-review.test.mjs tests/cache-system-integration-review.test.mjs tests/cache-system-auto-feedback.test.mjs tests/cache-system-persistence-failure.test.mjs tests/native-client.test.mjs`，148/148。日志 `cache-focused.log`。
- WXT：`npm run build:extension:wxt` 和 `npm run test:wxt:smoke` 均退出码 0。干净 `npm ci` 后再次执行的日志为 `build-wxt-after-ci.log`、`wxt-smoke-after-ci.log`；smoke 使用实际 `.output/chrome-mv3`，临时 Profile 扩展 ID 为 `ebakgooplgoioinmpjfkfijgmidpfiok`，无页面错误或非预期外部请求。
- Native IDB：`npm run test:e2e -- e2e/cache-system-native.spec.mjs --workers=1 --retries=0 --reporter=line,json --output=docs/task-execution/local/luna-browser/cache-native/test-results`，真实 IndexedDB、19 项通过；附加参数仅用于保存 JSON/测试输出。日志 `cache-native.log`，Playwright JSON `docs/task-execution/local/pr345-final/cache-native/reports/report.json`。
- MV3：`npm run test:e2e -- e2e/cache-system-mv3.spec.mjs --workers=1 --retries=0 --reporter=line,json --output=docs/task-execution/local/luna-browser/cache-mv3/test-results`，编译后扩展 6/6；附加参数仅用于保存 JSON/测试输出。日志 `cache-mv3.log`，Playwright JSON `docs/task-execution/local/pr345-final/cache-mv3/reports/report.json`。
- 升级：旧版本 `0.8.0`（提交 `19e89b65fd3600073410407392da82ffa666ffc8`）单独 worktree 构包（`TF_UPGRADE_OLD_ARTIFACT=/tmp/translateflow-pr345-old-19e-final/dist/extension`），当前 WXT 包 `.output/chrome-mv3`（`TF_UPGRADE_NEW_ARTIFACT=.output/chrome-mv3`）；设置 `TF_E2E_ARTIFACT_SOURCE_HEAD=23bb8275608d9053d92219e55dace44cc69bb39e` 后运行 `npm run test:e2e -- e2e/wxt-upgrade.spec.mjs e2e/wxt-injection-samples.spec.mjs --workers=1 --retries=0 --reporter=line,json --output=docs/task-execution/local/pr345-final/upgrade-tests`。两项同 ID 升级及一项十组 cold/warm injection 样本均通过。结构化证据在 `docs/task-execution/local/pr345-final/upgrade-evidence/`，汇总 `upgrade-supplement.json`。
- 完整 E2E：基础运行使用单 worker、零重试，报告为 221 PASS / 10 条条件跳过 / 0 FAIL / 0 flaky；耗时 438.558 秒。随后把原先因缺旧包而跳过的两项升级和一项 injection 样本在相同候选、相同包上实际补跑，3/3 PASS。按测试身份合并后为 **224 PASS / 7 SKIP / 0 FAIL**，不是把两次运行误报成单次 224/7。完整日志 `full-e2e-base.log`、JSON `docs/task-execution/local/pr345-final/full/reports/report.json`、去重汇总 `docs/task-execution/local/pr345-final/full/e2e-aggregate-23bb8275.json`。
- 全量套件第一次启动因隔离目录缺一份仓库已有的合成 dictionary baseline，在测试加载阶段退出，0 个测试执行；补齐该合成 baseline 后完整重跑通过。它记为一次环境准备阻塞，不计作代码失败或通过。首次尝试没有删改任何断言。

本地任务索引维护不属于产品测试矩阵。`node scripts/local-task.mjs index` 最初因历史目录缺少 `docs/tasks/browser-native-language/state.json` 失败；没有为无关任务补造状态。历史核对显示，本地状态流程由 2026-10-03 的 #280 引入；`browser-native-language` 档案在 2026-10-15 的 #333 添加时没有 `state.json`。索引脚本原先无条件读取每个目录，超出了文档“从 state.json 生成投影”的约定。当前隔离工作树的最小修正是只索引实际存在 `state.json` 的目录，并将 `validation-report.md` 加入当前任务元数据归档白名单；`node --test tests/local-task.test.mjs` 17/17 PASS，`node scripts/local-task.mjs index` 成功。该修正尚未提交，改动了验收工具及其测试，因此原候选 `23bb8275608d9053d92219e55dace44cc69bb39e` 的机器门禁仍不能据此宣称通过。随后实际运行 `node scripts/local-task.mjs gate cache-system-v1`，退出码 1，提示 `Uncommitted code/test/build input; freeze again`。现存 acceptance 还含 `durationMs: null`，部分 E2E 命令带有 state.json 未声明的 reporter/output 参数；不能手工补造耗时或把不同命令改写成精确匹配。上述门禁/归档问题不改变已经完成的产品测试结果。

7 项最终 SKIP 都是测试自身已有的外部输入/发布条件：缺 CC-CEDICT 原始 MDX/MDD；未提供 1.63 GB 合成 MDD fixture；未提供本地真实 MDX/MDD；没有锁定的真实 ECDICT MDX；未构建 Core/Technical release packs；真实 ECDICT MDX gate 缺 MDX；一键 ECDICT MDX 安装 gate 未启用或没有缓存归档。升级相关的原 3 项 SKIP 已在补跑中转为 PASS。Chrome 102、真实 YouTube timedtext 和其它浏览器 NOT RUN；用户人工体验验收于 2026-10-19 PASS。

## C. 发现与修复

本轮验证没有发现仍未修复的 PR #345 缓存缺陷。下列问题由候选提交序列修复，并在最终候选验证；本轮没有再改生产代码，也没有修改测试来降低要求。

| 触发与根因 | 修复范围 | 回归证据 |
| --- | --- | --- |
| 存储写入失败发生在译文已生成之后，Page、Selection、Chrome 本地模型或 Subtitle 可能丢掉结果、显示失败或重发 Provider；cache-only 读取失败提示也可能丢失。 | Page/Selection/Subtitle 保留已验证译文并显示可恢复的未保存提示；只恢复限定的存储错误码；Cache-only 不调用 loader；自动翻译提示复用现有限频。相关实现位于 `src/content/auto.js`、`src/content/*`、`src/content/selection/*`、`src/background/cache/*`。 | `tests/cache-system-persistence-failure.test.mjs`、`tests/cache-system-auto-feedback.test.mjs`、`tests/native-client.test.mjs`；MV3 写失败 6 项中的对应场景通过。 |
| 缓存身份和实际请求文本可能漂移；调用方可在启动后修改输入；额外身份字段可覆盖 envelope 版本；跨实例失效后新请求可能加入旧 single-flight；普通原文里的 `⟦TF:…⟧` 可能被推断为协议。 | 固定协调器输入和实际 `providerText`，显式投影 envelope 字段，用持久读代次隔离迟到结果；纯文本默认身份，仅显式结构化格式走 marker 校验。 | `tests/cache-system.test.mjs`、`tests/cache-system-domains.test.mjs`、`tests/cache-system-integration-review.test.mjs`；缓存定向组 148/148。 |
| 缓存清理曾在全局 LRU 下把独立 AI explanation 与翻译共同淘汰，或清理后旧请求尝试写回。 | 翻译与字幕共用翻译预算，AI explanation 使用独立 namespace；清理令牌阻止旧写入。 | Memory/IndexedDB 合同、Native IDB 中“translation namespace quota never evicts independent explanation entries”和“two independent clients share durable invalidation fences”通过。 |
| Selection/词典 Worker 的 READY/sourceId/提交协议、安装状态刷新代次、权限拒绝恢复 UI 与本地未命中 Provider 边界不一致；同文档 URL 更新和完整导航取消边界也曾错误。 | 修复 Worker 消息提交、状态刷新与 UI 恢复；将 Provider 请求限定为用户动作；区分锚点变化和真正页面生命周期变化，并拒绝旧上下文结果。 | `src/background/selection/resolve.js`、`src/content/selection/controller.js`、词典 Options/Worker 实现；相关 Selection、词典与导航 E2E 保留原安全断言并通过完整套件。 |
| Reading/词典回归中有真实历史定位问题，也有测试 fixture 在新安装默认值提交前写配置、React 进度节点尚未挂载即被观察、共享 harness profile 串扰等前置条件漂移。 | Reading 片段返回关联原记录且只存有界 metadata；测试先等待默认值、以真实节点启动观察、每例隔离 profile；SSE mock 按真实 HTTP close 工作。 | `e2e/reading-*`、`e2e/stardict-import-worker.spec.mjs`、`e2e/support/extension-fixture.mjs`、`e2e/support/mock-server.mjs` 和对应 Node/Vitest 回归均通过。 |

初始完整基线曾有 58 个失败和 2 个 suite errors。修复分类和历史候选逐项结果详见本文件 `review.md` 的既有记录；最终候选全量与补跑结果不复用早期失败候选的 PASS。最终候选提交 SHA：`23bb8275608d9053d92219e55dace44cc69bb39e`。

## D. 数据及安全检查

- DB4 原生 IndexedDB 测试覆盖全新库、DB2→DB4、DB3→DB4、非空 explanation 搬迁、事务回滚、blocked 后重试、并发事务原子性、读代次失效、TTL/LRU/容量、跨连接失效、关闭/重开和未来版本拒绝；19 项全部通过。
- 两个真实同 ID 升级场景都使用独立临时 Profile、固定扩展目录，运行旧包→新 WXT 包→扩展 reload→浏览器重启。每个场景中旧包和新包的 Extension ID 完全一致（分别为 `oaacjgnlhbfgkjbgfflmnlhpajpnekbp`、`mnpbngnhigcdjcgkcolahmjbnbfaplga`），旧译文 3 条被清理，非空 explanation 1 条保留，独立 ReadingRecord 1 条保留，词典 OPFS 与用户设置保持；旧运行时失效，新运行时恢复。`paidProvider=NOT RUN`，`unauthorizedProviderCalls=0`。测试中仅有本地 mock 请求和一次明确触发的合成请求，不使用用户凭据。
- ECDICT 安装用例的浏览器证据为 `direct-upstream`，公开锁定 CSV 65,933,428 字节，Git blob SHA-1 `c4ade63ea08cf39d9c3475e96929036d64d94c94`，`interceptionCount=0`。较早 `review.md` 记载的 verified-source-replay 描述属于更早一次运行；本报告按最终完整运行的浏览器附件更正，不把词典下载说成 Provider 验证。
- 未调用真实收费 AI Provider；未使用真实 API Key、Cookie、私人页面或真实 Chrome Profile；没有清理真实翻译记录/ReadingRecord。测试使用合成页面、合成数据、仓库 Mock Provider 和临时 Profile。
- `.output/chrome-mv3` Manifest 权限数组与 `main` 相同；版本差异仅 WXT 生成的 `content_scripts`。没有扩大扩展权限。包里 0 个符号链接，未发现 tests/e2e/docs/scripts、`.map`、`.pem`、`.key`、`.env` 或 `node_modules`；`lexicalBytes=0`。WXT 包内的 `src/` 路径仅为架构审核过的精确 runtime raw-asset closure。

## E. 构建产物

| 项目 | 结果 |
| --- | --- |
| WXT 安装目录 | `.output/chrome-mv3` |
| Manifest 版本 / 扩展格式 | `0.8.20` / Chrome MV3 |
| 文件数 / 解包总大小 | 128 / 2,916,095 bytes |
| 词典资源 | 0 bytes（默认包未打入词典） |
| 安装压缩包 | `docs/task-execution/local/pr345-final/TranslateFlow-0.8.20-pr345.zip` |
| ZIP 大小 / SHA-256 | 855,581 bytes / `12c809b3e91c9507eae7d75356be94148ff78c644bffd74a227f9f688ad97bb1` |
| 包树 SHA-256 / 来源 | `c3b444aed6277b4741c0a10637cfe85a0941476582973a8a535685422f02e664` / candidate `23bb8275608d9053d92219e55dace44cc69bb39e` |

逐文件清单与 SHA-256：`docs/task-execution/local/pr345-final/artifact-inventory-23bb8275.json`。检查结果 `disallowedPathOrFileMatches=[]`、`symlinkCount=0`、`permissionsMatchMain=true`。

## F. 剩余问题与结论

**BLOCKED**。产品自动化、真实 Chromium/IndexedDB、实际 WXT/MV3、同 ID 升级、支持条件下的完整 Chromium E2E 和用户人工验收均为 PASS；保留 7 项原有条件性 SKIP，真实收费 Provider 调用按要求 `NOT RUN`。索引脚本对缺失历史 state 文件的处理已在隔离工作树修正并通过 17/17 定向测试，但该工作流代码改动尚未进入 PR 候选。Gate 当前因未提交的验收工具改动退出 1；随后还须解决 acceptance 中没有实测耗时的记录和未与合同命令精确匹配的参数，不能伪造数据。PR 保持 Draft；本地验收仍未达到可同步/合并状态，任务不得标记 completed。`npm ci` 退出码为 0，npm 报告 `esbuild@0.27.7` 安装脚本尚未列入 allowScripts；紧随其后的完整 validate 与构建均成功。`npm run validate` 有一个现有平台代码体积 advisory（2,138,926 / 1,576,595 bytes，超 562,331 bytes），未作为失败且不在本缓存验收范围内。

用户于 2026-10-19 明确确认人工验收通过：页面首次翻译与刷新后恢复、重复 Selection 翻译、缓存统计只读刷新、YouTube 字幕翻译与刷新后恢复均报告正常。Provider 请求次数未由用户端日志核对；不把人工观察记作请求计数证据，相关安全断言以自动化结果为依据。未要求用户清理缓存、翻译记录、ReadingRecord 或词典数据。

PR #345 保持 Draft、不合并；任务状态保持 `reviewing`，不得标为 completed。索引缺失状态文件的问题已通过只索引含 state.json 的目录修复，但修复未提交；门禁要求和旧验收记录尚未收敛，仍需在确切候选上重新绑定可复用证据并通过本地 Gate。


PR 公开摘要证据：[PR #345 测试证据评论](https://github.com/CoderLambert/translateflow-plugin/pull/345#issuecomment-6252829682)。未上传原始测试日志或个人数据。
