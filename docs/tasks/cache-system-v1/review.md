# PR #345 全量失败修复记录 — 2026-10-18

当前修复范围按用户追加授权覆盖全部回归失败，包含 main 同样存在的既有故障。本文件后半部分保留早期缓存工作的历史检查，不得把当时的环境限制、Node22 overlay 结果或 NOT RUN 状态当成最新候选结论。

## 本轮完整基线与归因

已在 Node24.21.0 / npm11.19.0 / Playwright1.63.0 / Chromium153.0.8010.12 上，使用源提交 `e9ddbbb119270d4b84fe6ff3051e026a44f2506c` 对应的实际 WXT 包重建完整基线。230 个不同用例各执行一次：**165 PASS / 58 FAIL / 7 SKIP，另有 2 个套件错误**。使用单 worker、零重试。包指纹为 `96bf96756e9a9b84b535782368b631f0968c6a14a6c68653af046ec69ddd3de6`。用户此前的 169/54/7 属于另一次运行，本轮不把差异误记为修复。

主要生产修复包括：精选词典 Worker READY 的 sourceId/提交协议；完成统计与权限拒绝恢复信息；词典安装状态刷新代次和偏好保存的 UI 状态；Selection 本地未命中/错误的显式 Provider 边界；同文档 URL 更新与完整导航的 AI 取消边界；双语插入的自有属性不再污染原文 revision；过期来源捕获与隔离词典 fragment 导航。

测试方面修正原生新安装默认设置与语言/Provider 迁移的先后顺序，并为每个共享 harness 用例使用独立 profile；合成 Reading authority Worker 通过现有 Vite 构建；最小 Reading DTO 与被动 collector 按当前协议断言；使用可控制 SSE 验证真实 HTTP 关闭；下载事件和点击同时处理 rejection；按现行 UI/权限合同修正过期 locator。原有用例未删除，原 7 个外部数据/发布条件跳过未改变；新增一项真实完整导航和刷新取消回归。

58 条完整原始失败及 2 条套件错误的关联保存在本地 `docs/task-execution/local/pr345-baseline/failure-index.json`。逐项根因与修复描述在 `docs/task-execution/local/pr345-final/failure-dispositions.json`，实际最终结果须与 `full.json` 按用例身份独立匹配。

## 环境与证据边界

ECDICT 公共源完整 CSV 已按现有 source lock 验证（65,933,428 bytes，Git blob `c4ade63ea08cf39d9c3475e96929036d64d94c94`）。由于本环境 Chromium 到上游 HTTPS 的信任链受阻，产品安装用例采用精确 URL 的 verified-source-replay；实际权限申请、生产 Worker、转换、OPFS、后台提交、查询与删除均真实执行。该证据不等于 Chromium 本轮直接连接上游下载成功。没有更改生产 TLS、CSP 或权限。将 CA 导入持久 root 浏览器信任库的尝试被自动审批拒绝，未执行，后续使用上述测试边界替代。

7 项私有 MDX/MDD、大 MDD 与真实发布词典 gate 尚无所需文件/环境开关，不能称为已验收。真实付费 Provider、人工体验验收、商店发布亦未包含在本轮自动化范围。

## 当前候选验证

修复已完成定向验证；统一冻结候选的完整验收正在收敛。首个候选 `27be3865ad4b9326174c41ed895e8216f8f0702e` 的缓存/原生客户端 Node 定向检查 **148/148 PASS**，随后静态检查明确指出 Selection controller 与 popover 超过既有 420 行门槛；已中止后续验收并保留失败记录。之后把恢复按钮收口到现有 empty-state 实例，把冻结来源操作收口到现有 ProjectionGuard，删除重复的导航判定；既有 420 行规则不变。增量静态检查和 7 个受影响 Node 文件通过，将据此重新冻结。不得将此阶段记为最终全量 PASS。

后续候选 `5e1cfffcad4f802cf72518cb8d258a1d98ea27ed` 已通过静态门槛，Node 全量为 **1839/1840 PASS**；唯一失败指出 Reading classic legacy 投影过期。已通过仓库唯一 `scripts/reading-content-classic.mjs` 从源码再生 `src/content/reading-source.js` 和 `src/content/reading-record.js`，一致性回归 **1/1 PASS**，未手改生成代码或删除断言。这些投影继续不进入当前 WXT 生产包。该候选的失败也独立留档，浏览器全量尚未执行。

候选 `504047da69aae47cb46b123d9d8d2bfb1bf0c274`（0.8.18）完成了第一轮统一验收：缓存/原生客户端 Node **148/148 PASS**，`npm run validate` 包含 Node **1840/1840 PASS**、Vitest **59/59 PASS**、静态/i18n/TypeScript/build 均通过；WXT build、smoke、原生 IndexedDB 19 条合同、MV3 6 条、真实旧包到新包同 ID 升级 2 条通过。全量 Chromium 为 **222 PASS / 2 FAIL / 7 SKIP，0 suite errors、0 flaky、0 retries**，共 231 项，耗时约 11.2 分钟。实际生产包 E2E tree SHA-256 为 `050f1fb44df91d1078d9780f6510547ea5e144357fb1a02318c69c7ebe72c094`。原始 JSON、所有日志、trace、安装包和完整指纹已保存在 `docs/task-execution/local/pr345-final/attempt-504047d-full/`，不得覆盖为通过。

独立的结果集合核对（不是模型代码审核）确认原 230 项全部一对一保留：224 项原身份、6 项明确改名，新增 1 项原生完整导航/刷新取消回归；原 7 个 skip 身份与注释不变。基线 58 个失败在该候选为 **57 PASS / 1 FAIL**；原本通过的 Oxford adapter 出现 1 个新失败。两项后续处理如下：

- Oxford 返回导航是本轮真实回归：本地片段在当前记录定位时绕过导航器，导致片段未写入历史。修复恢复受控导航记账，并验证动作所属 host 必须仍属于当前词条当前记录。历史只额外关联整数记录位置，不保留 DOM/HTML/AST，仍最多 20 条 metadata；返回时原记录缺失则报告片段未找到，不能退回别的同名记录。原 Oxford 与多记录隔离 E2E **2/2 PASS**，原 Oxford 断言未修改；新增 Node 回归已证明修复前失败、修复后通过。
- 原 F043（Selection → Reading consent）本轮卡在普通 `#new-source` 变化后要求整个面板关闭的断言。Selection 的 canonical 页面生命周期保留普通锚点，而 Reading 保存仍要求 raw URL/来源身份有效。修复测试前提时保留真正路由离开的面板关闭断言，并补充普通锚点保留展示、Reading collector 失效、启用后旧结果零保存/零 Provider 的真实验证；原关闭、拒绝、站点排除与 Provider 断言保留。单例在同一冻结生产包上已证明旧断言失败、修正前提后通过；完整 7 条 Selection → Reading 加既有锚点用例共 **8/8 PASS**，最终统一候选仍须重新验收。

候选 `27bd900225df0712c7caddb42b10257c3bc8a281`（0.8.19）的八项统一检查中，前七项全部通过，Node 全量增加到 **1842/1842 PASS**（含 Oxford 历史回归），Vitest **59/59 PASS**。本轮全量 Chromium 实际为 **221 PASS / 3 FAIL / 7 SKIP，0 suite errors、0 flaky、0 retries**，共 231 项，约 13.6 分钟；包 E2E tree SHA-256 为 `dd0cd110314a6471b2bc7d3fc2945c3ae2243b8c8d5d28403d395627579ab24d`，运行前后指纹一致。完整原始结果与安装包归档在 `docs/task-execution/local/pr345-final/attempt-27bd900-full/`，完整 JSON SHA-256 为 `9e4daf5cab84e3452755b07aacb734f1ceec2e25f18df489f3091ee784f06b28`。

结果集合核对继续通过：原 230 项保留、仅原 7 项跳过，新导航取消例通过。上一轮 Oxford 和 F043 本轮均通过；原 58 项当前 **56 PASS / 2 FAIL**（F028、F049），另有原通过的 Reading preview 第三例失败。实际 trace 定位如下，不能将定向通过拼成该候选全量通过：

- Reading preview 第三例仍使用即时 `isVisible()`，在 Learning Center 尚未挂载时返回 false，于是从未点击 Enable recording，后续正确显示 `invite`。最小修复等待 Enable、点击并确认 Pause；同一冻结生产包的整组 **3/3 PASS**，原 `saved`、高亮、历史与预览稳定性断言保留。
- F028 Reading return 120 秒超时在等待英文 Enable recording 时发生，尚未进入原文查找。独立 fixture 在原生安装默认值提交前写入英文配置，随后被默认 `zh_CN` 覆盖。已核实应先等待默认值提交，再写入显式测试配置并确认 Pause；其他同型独立 fixture 也按相同前提修复，Reading handoff、页面高亮、返回原文和 Vocabulary 四个原用例整组 **4/4 PASS**（16.2 秒），真实 trace 确认原生默认值读取完成先于显式英文写入。具体 Range、歧义/缺失拒绝、历史卡片与零 Provider 断言继续保留。
- F049 StarDict 在导入开始前失败：文档 `load` 已完成，但 React 进度节点尚未挂载，`MutationObserver.observe(null)` 抛错。改为 Locator 等待并直接提供真实进度 Node；真实 Worker 与产品导入/查询/卸载目标组 **2/2 PASS**，transfer、完整阶段、文件路径、单次 commit 和零 Provider 断言保留。

上述修复未延长超时、增加重试或增加跳过。最终合并后的候选仍须按现有任务合同绑定准确提交和实际安装包验收。

最终自动化结果以同一准确候选的 `acceptance.json`、实际包指纹和 PR #345 最新说明为准。此处是主 Agent 自查及真实执行记录，不是独立模型审核；任务保持 working，人工最终验收与受保护合入仍待后续。

---

## 历史缓存阶段记录

# Cache module self-review — 2026-10-18

Subject: main baseline 961a3757f3cad93921031b038e52e621c8c840b7 plus this cache implementation. Self-review, not independent-model audit. No merge or deployment.

## Verified isolated regressions

Four new failure cases were added to the local source overlay and observed failing before fixes:
1. A subtitle/cache locator could be sent instead of the descriptor's actual providerText.
2. Caller mutation after coordinator.run could alter the request after its key was built.
3. Extra identity properties could override recordVersion through object spread.
4. An invalidation from a second cache service could make a new read join an obsolete local in-flight producer.

Fixes pin coordinator inputs, send descriptor source.text, explicitly project envelope identity fields and add durable read epochs to the load-sharing key. The four new tests then passed with the existing suite: **108/108 under Node22.16.0**. The guarded offline patch-transform tests also passed **15/15**. These are local overlay checks, not the complete remote candidate's Node24/WXT validation.

## Test boundaries

- Actual command: `node --test tests/cache-system*.test.mjs` against the isolated source overlay.
- Native browser attempt: navigation denied with ERR_BLOCKED_BY_ADMINISTRATOR; **0 native cases executed**. No policy bypass attempted.
- Full repository npm ci/validate/Node24 and WXT installation package: **NOT RUN**, no available Node24/download environment.
- Remote source/call-site integration is part of this branch, but exact candidate freeze and full proof remain outstanding.
- No actual paid Provider calls or user's real browser data used.

## Remaining work before final acceptance notification

Keep status working; do not mark ready_to_sync/completed from test counts alone. Resolve existing-test/mocks and historical WXT upgrade expectations under the new token/envelope contract. Validate all consumers' storage-failure display behavior. Run native-IDB and production compiled-extension checks in a permitted environment, build/fingerprint a candidate, and only then ask for the user's product acceptance. PR #342 is not a dependency that may be silently merged; its MT code must later adapt to this cache module.


## Continuation: Content UI persistence fallback (2026-10-18)

The original isolated overlay result (108 tests on Node22) remains historical. Additional remote-branch edits now cover storage-response failures in the actual classic Content modules.

**Reproduced before the fix using fetched Content IIFEs and a deterministic synthetic runtime:**
- Page cache-only restoration with an unavailable database lost the lookup warning and incorrectly reported a genuine cache miss.
- A successful Page translation followed by `CACHE_STORE {ok:false,errorCode:CACHE_QUOTA}` marked the task failed.
- Selection with the same storage response never displayed its already-verified translation.
- The Chrome local translator's native plan threw on an equivalent cache failure; lookup warnings were omitted from the plan response.

**Implemented on the existing PR branch:**
- Propagate Page cache-read warnings through cache-only / no-uncached early returns.
- Classify only `CACHE_QUOTA`, `CACHE_STORAGE`, `CACHE_STORAGE_BLOCKED`, and `CACHE_STORAGE_TIMEOUT` as recoverable persistence faults in the classic Content runtime; a parity test keeps the classifier aligned with Background. Never downgrade `CACHE_INVALID_TOKEN`, `CACHE_INVALIDATED`, `CONFIG_SNAPSHOT_EXPIRED`, or `CANCELLED`.
- Page and Selection preserve valid generated translations and show an explicit unsaved-cache warning when a cache-store response reports a recoverable fault.
- Chrome local Selection and Subtitle retain the verified local-model result on a cache-store error; native lookup forwards a storage warning and skips tokenless writes. No automatic Provider rerun.
- Extended `tests/cache-system-persistence-failure.test.mjs` and `tests/native-client.test.mjs` to capture these cases.

**Executed this turn**: fetched exact remote Content IIFEs and invoked them with an isolated, deterministic V8 mock runtime, yielding **20/20 Page+Selection scenarios PASS** and **9/9 Chrome-local scenarios PASS**, covering both recoverable storage errors and fail-closed identity/config/cancellation outcomes. These are targeted source execution checks with mock dependencies, **not** Node project's `npm test`, TypeScript, compiled MV3, native IDB, or browser E2E. There were no live Provider calls.

**Outstanding**: Node24/npm11 `npm ci && npm run validate`, actual WXT/Chromium/IndexedDB DB2/3→4 upgrade and rollback, existing full tests/mocks, actual UI smoke with real browser extension, build fingerprint, user acceptance. Current environment contains Node22.16.0/npm10.9.2 and cannot resolve github.com/npm downloads; the earlier managed Chromium `ERR_BLOCKED_BY_ADMINISTRATOR` remains unresolved. Keep task `working` and PR Draft; do not promote this report to whole-module acceptance.


## Continuation: incremental warnings and explicit plain/rich source contract (2026-10-18)

**New source fixes submitted after the UI storage-failure work:**
- `src/content/auto.js` now surfaces a rate-limited cache failure toast for incremental automatic translation or cache-only restoration. It reuses `state.lastAutoErrorAt` (5-second throttle), keeps successful auto tasks successful, and never turns cache-only restoration into a Provider request.
- `src/shared/translation-cache-identity.js` now defaults to `format: 'plain'` unless the caller explicitly requests `tf-markers`. Previously a literal `⟦TF:...⟧` example in a user paragraph could be misclassified as structured or rejected on a missing closing marker. Real Page/Selection/Subtitle callers already supply explicit formats; explicit rich still receives marker-tree validation and isolated cache identity.
- Added `tests/cache-system-auto-feedback.test.mjs` (4 Node cases) and two marker-protocol cases in `tests/cache-system-domains.test.mjs`.

**Executed source-only checks this turn:** five actual auto.js IIFE scenarios using an isolated V8 fixture (auto warning, cache-only warning, two silent-success scenarios, throttled repeat) **5/5 PASS**; after source contract change, seven translation-cache-identity.js V8 scenarios (balanced/unbalanced user literal tokens, explicitly structured input, protection rejection, malformed rich rejection, rich/plain separation) **7/7 PASS**. Earlier 29/29 mock-driven Content cases were verified against the previous candidate; they are not a substitute for complete tests of the new head. These checks neither install WXT nor exercise native IndexedDB.

**Still NOT RUN:** this exact remote candidate's `npm run validate` on required Node24/npm11; actual Node `--test` for the newly added files; native Chromium IDB upgrade and rollback; compiled WXT/MV3 behavior; installation package and user acceptance. No paid Provider requests. Remain Draft / working until full verification is available. Not an implementation-wave completion.


## Continuation: namespace-isolated capacity pruning (2026-10-18)

**Reproduced** against the actual Memory driver code in an isolated V8 harness: the old globally scoped `pruneCache` used all namespaces as a shared LRU. With a small translation budget and an older `selection-explanation` record, the explanation was evicted before translation entries. This changed the old explanation-retention behavior and undermined the new independent-domain policy.

**Fix**: `pruneCache(maxBytes)` now supplies the two explicit translation namespaces (`translation` and `subtitle-translation`) as a combined quota scope. Both storage drivers implement the same optional `namespaces` filter for `prune`; the original single-`namespace` and global modes remain. Mixed/empty/duplicate/overly large or malformed namespace filters are rejected. No DB layout, migration, existing cache record reader or general cache policy changes are required. `clearAllCache` remains intentionally global.

**Tests added**:
- `tests/cache-system-domains.test.mjs`: a 6-entry cross-namespace over-budget regression with an older independent AI explanation record; asserts eviction and explanation preservation.
- `tests/cache-system-browser-cases.js`: actual native IndexedDB equivalent covering combined budget, explanation isolation, and mixed-filter rejection (committed but **NOT RUN**).

**Executed isolated checks**: latest Memory store code with three namespaces and an over-budget translation set passed explanation preservation, combined translation-byte-budget and invalid-filter cases (**PASS**); latest application.js transmitted exactly the two requested translation namespaces (**PASS**). Parsed latest application.js, storage-memory.js and storage-indexeddb.js function bodies in the V8 runtime without syntax errors. Native IDB, actual Node suite, E2E and compiled extension remain **NOT RUN** due to environment restrictions. These mock and parse checks do not prove the native IndexedDB behavior.

**Rollback consideration:** reverting the application-only scoping restores former global LRU semantics; reverting the optional driver filter as well is safe only after the application no longer passes `namespaces`. No stored record schema changes or data-clearing side effects are introduced.


## 最终候选验收 — 2026-10-19

PR #345 刷新后的 head 与当前候选均为 `23bb8275608d9053d92219e55dace44cc69bb39e`，tree `9957c71f0c98b679eda9a852c03e7dab151e8580`。该 tree 与本地执行验证的 `dc7a15ec3dfb918cf160b2366677eeb7f302a95e` 完全一致；远端提交只传递已验证 tree，没有源码、测试或构建输入漂移。`origin/main` 为 `961a3757f3cad93921031b038e52e621c8c840b7`。

按锁文件完成 `npm ci --no-audit --no-fund` 后重跑 `npm run validate`，退出码 0：768 源文件检查、1,106 个 i18n keys、Node 1,842/1,842、typecheck、Vitest 59/59 和默认扩展构建全部通过。缓存定向 Node 148/148；WXT build/smoke、真实 Chromium Native IndexedDB 19 项、编译后 MV3 6/6 均通过。Node/npm 为 24.22.0/11.19.0，Playwright/Chromium 为 1.63.0/153.0.8010.12。

完整 Chromium 回归的基础批次为 221 PASS / 10 条条件 SKIP / 0 FAIL / 0 flaky / 0 suite errors / 0 retries。基础批次里因旧包环境缺失而跳过的两个同 ID 升级和一个 injection cold/warm 场景，随后用真实旧包（提交 `19e89b65fd3600073410407392da82ffa666ffc8`）、实际 WXT 包、同 Profile/扩展路径补跑，3/3 PASS。按用例身份合并为 224 PASS / 7 条原有词典/发布资产条件 SKIP / 0 FAIL。不得把它描述成单次 Playwright 运行的 224/7。

最终 ECDICT 浏览器证据为 direct-upstream：锁定公开 CSV 65,933,428 字节，Git blob SHA-1 `c4ade63ea08cf39d9c3475e96929036d64d94c94`，无网络拦截。更早本 review 中关于 verified-source-replay 的句子说明的是较早运行；它不代表最终候选运行。

两项同 ID 升级各清除旧译文 3 条、保留 explanation 1 条、保留独立 ReadingRecord 1 条，并验证词典、设置、旧 Content 运行时失效、重启恢复和 cache-only 无 Provider 请求；均使用独立临时 Profile，没有触碰用户 Chrome 数据。真实收费 Provider 为 NOT RUN。产物清单、hash、测试日志及完整结果见 `validation-report.md` 和忽略的 `docs/task-execution/local/`。

**产品验证：自动化 PASS，用户人工验收 PASS；最终收口结论：BLOCKED。** 用户于 2026-10-19 确认页面翻译/刷新缓存恢复、Selection 重复翻译、缓存统计只读刷新、YouTube 字幕翻译/刷新恢复均正常。Provider 请求数以 Mock 自动化断言核对：页面恢复不增加请求；本地词典命中不请求 Provider；AI explanation 缓存命中不增加请求；同 ID 升级 cache-only 恢复无未授权请求；真实收费 Provider 未调用，人工端请求日志未提供。任务状态继续为 `reviewing`，PR 保持 Draft，不合并，不标记 completed。

收口时实际执行 `node scripts/local-task.mjs gate cache-system-v1`，退出码 1：`validation-report.md` 不在 local-task 元数据归档白名单，脚本拒绝该未提交文件。此前 `node scripts/local-task.mjs index` 因无关目录缺少 `docs/tasks/browser-native-language/state.json` 而 BLOCKED，未伪造该任务状态。另有既存 acceptance 记录不满足 Gate 的精确命令/实测耗时字段，不能通过手改元数据冒充通过。同步与正式合并条件尚未满足。此文是主 Agent 对实际运行记录的整理，不是独立模型审核。完整逐项报告及矩阵见 [`validation-report.md`](validation-report.md)。

干净安装复验补充：`npm ci --no-audit --no-fund` 后再次 `npm run validate` 仍为 0（Node 1842/1842、Vitest 59/59）；并重建 `.output/chrome-mv3`、重跑 WXT smoke 均通过，WXT 包 tree 与已测包相同。索引生成命令因另一项任务缺 `docs/tasks/browser-native-language/state.json` 返回 ENOENT；未创建或改写那项无关任务。


PR 公开摘要证据：[PR #345 测试证据评论](https://github.com/CoderLambert/translateflow-plugin/pull/345#issuecomment-6252829682)。未上传原始测试日志或个人数据。

## 用户人工验收更新 — 2026-10-19

用户明确确认 PR #345 人工验收通过。人工实际使用反馈：页面翻译/刷新后缓存恢复、重复 Selection 翻译、缓存统计只读查看、YouTube 字幕翻译/刷新后恢复均正常。Provider 请求数量没有人工日志证据，仍只引用 Mock 自动化断言。未清理用户数据。收口 Gate 实际失败；验收归档尚未同步。PR 维持 Draft，未合并；任务状态维持 `reviewing`，不标记 completed。

## 收口工作流核对 — 2026-10-19

`state.json` 规则来自仓库级本地任务流程，不来自 `browser-native-language` 自身的提交历史。该流程与 `local-task.mjs` 在 2026-10-03 的 #280 引入，规定任务索引是 `state.json` 的投影；`browser-native-language` 任务档案后来在 #333 增加，但未带 `state.json`。因此这是历史任务资料未初始化，而索引实现又假定所有任务目录都已初始化，并非过去曾存在后又删除了该文件。

隔离工作树中已作最小修正：索引仅包含存在 `state.json` 的目录；当前任务允许将 `validation-report.md` 作为元数据归档；`tests/local-task.test.mjs` 新增缺状态目录和报告归档测试。`node --test tests/local-task.test.mjs` 17/17 PASS，`node scripts/local-task.mjs index` 成功。Gate 随后实际退出 1，提示这些工作流脚本/测试改动尚未提交，需重新冻结候选。当前结论仍为 BLOCKED；不把原候选的缓存测试结果改写成新候选结果，也未提交、推送或合并工作流修正。


## 最终提交与合并验收 — 2026-10-19

本节取代前述收口 BLOCKED 的当前结论，保留历史记录。用户授权清理不适用提交规则并提交合并；修正提交 `4545d8ce19a808a0ef940d61f64ca43dceb97e53` 已普通推送、冻结并实际执行全部9项合同检查。Node 1844/1844、Vitest 59/59、缓存148/148、工作流/提交24/24、Native IDB 19条、MV3 6/6、同ID升级2/2、全量Chromium 224 PASS /0 FAIL /7条件SKIP；全部退出0，零重试/零flaky。完整validate、WXT build/smoke均PASS。原始日志、实测耗时和hash均在acceptance.json；归档前实际Gate退出0。

正常commit不再自动升版本/编译，轻量hook仍检查暂存diff；显式版本准备仍可用。没有削弱产品断言、Gate输入/祖先/日志/产物校验，没有虚构无状态任务。报告及索引均可合法归档。最终元数据提交只包含五个允许的归档文件，归档后再次检查Gate与远端head。

用户已确认人工验收，生产包fingerprint与原包相同。真实付费Provider未调用，人工请求计数未验证；Mock请求边界已由本轮实际自动化验证。主Agent对本轮diff自查：只增加已授权工作流/提交规则修正，没有新产品实现或权限变化；不把本节标为独立模型审核。当前结论READY_FOR_USER_ACCEPTANCE，任务ready_to_sync，实际合并并核对tree后才本地completed。
