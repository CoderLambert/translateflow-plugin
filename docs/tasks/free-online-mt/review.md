# MT01 / MT02 自查与证据边界

主体：本次实现主 Agent 自查，不是独立模型审核。基线 main@961a375。

已修复：MT 不解析坏的 AI 凭据；快照缺失不进入付费路径；MT 源语言与代码保护身份独立缓存；代码/标记不上传；腾讯检查业务状态；响应正文纳入超时；导航取消按真实 tab 消费者隔离；站点保存和读取沿用现有 normalizeOrigin（包括端口规则）。

新增浏览器测试实际使用生产 WXT 字节，只有两个固定服务的网络传输为合成响应。覆盖网页/划词/Reading 保存、缓存恢复和切换、无 AI 的 Popup 入口、设置确认、取消和坏结果。无真实用户页面、Key、词典或 Cookie。

开发期间全量 Node 1,713 项、定向旧功能 48 项、新增 MT 23 项、修复定向 19 项、严格类型、Vitest 53 项及 MT MV3 6 项已通过。完整 npm run validate 的首次调用因执行环境时限中断，且曾暴露三个已修复的集成断言；不能将该调用标为 PASS。最后的 staged build 和候选级测试另行归档，开发数字不冒充候选 SHA 绑定结果。

未验证：真实供应商在用户网络中的长期可用性、Google、B站、免费字幕、商店发布、全量真实词典兼容。本次不合并，不宣称本地 gate 或发布验收完成。原始日志/合成截图位于被忽略的 docs/task-execution/local/free-online-mt/；PR 仅交付源码和简短事实，不上传完整日志。

本地任务索引生成在既有 `docs/tasks/browser-native-language/` 缺少 `state.json` 处失败（该目录在基线已存在）。本次保留原索引，不补造其它任务状态、不修改工作流脚本；local-task gate 未通过/未完成，不据此自动合并。该问题不阻断代码分支备份或用户试用包。

## 2026-10-19 最新 DB4/main 集成复审（未达到最终候选验收）

- 本任务不是旧 DB3 开发分支：原 #342 已在保留所有原提交历史的前提下，将 main `1ddae0504a7478480253723d9f5fb43d13b77b88` 纳入 PR 分支，并逐项移植免费 MT 的有效功能；GitHub `mergeable=true`、`mergeable_state=clean`（仅说明无文本冲突）。`src/background/cache-db.js` 保持 #345 唯一稳定门面、DB4 `entries/epochs`、record envelope v1、请求隔离/写入 token，无旧 DB3 parser、hash 或迁移；不恢复 #346 移除的内置词典。
- 既有 Selection `snapshot.text` 不含原始 DOM 标签/保护信息。现有免费 MT 路由 fail-closed：code/kbd/pre/samp 或无法验证的选区不再发送外部；新增 `tests/machine-translation-selection-protection.test.mjs` 覆盖代码内起始、跨标签和未知 range；非 MT 仍保持旧行为。
- `src/background/providers/machine-translation.js` 现在只有明确 `format: "tf-markers"` 的输入才解释控制标记；普通选区里的字面 `⟦TF:0:S⟧` 一律拒绝而非误解结构/上传。超长文本按原生 `Intl.Segmenter` 字素分割，保护 ZWJ emoji。
- 连接检查是用户点击固定公开测试短句，`src/options/machine-translation-client.ts` 发送 `consent`；`src/background/machine-translation-settings.js` 再次检查确认和特定 origin permission。添加不经同意/无权限的零外发负例。
- 实际源码在独立 V8 模拟中校验了 Rich marker/code 本地保留、纯文字符号 fail-closed、emoji 分界及后台拒绝无同意/无权限，结果 PASS；该检查**不属于仓库 Node24/npm validate 或编译 MV3 测试**。GitHub 当前 head 可能随用户其他提交变化；候选与测试必须重新绑定最新 SHA。
- 保留原 PR 中历史 0.8.14 构建/Mock E2E/微软单次成功与腾讯网络失败记录，但**这些均不是当前 0.8.29/DB4 候选的实测**。Node24 全仓、真实 WXT 安装包、浏览器同 ID 升级、真实微软/腾讯、本机最终人工验收均为 **NOT RUN 或待验收**。
- 下一步只运行当前模块的 MT Node、选区保护、相关 Popup/Options/MV3 和 DB4 回归；定向通过后在冻结 candidateHead 上集中执行一次 `npm run validate` 和 WXT 双目录构建/Smoke。无需因一处小改动重复完整 CI，也不得用合成响应宣告真实 Tencent 可用。

## 2026-10-19 URL 划词安全补丁（待正式 Node24/Chromium 验证）

- 免费 MT 增加链接 DOM (a[href]/area[href])、跨链接选区、可见 URL/域名/IP、选区文字变化及已断开 Range 的拒绝条件；均在 TRANSLATE_BATCH 前处理，不改变现有 AI/本地路线。
- 新增零外发的负例测试及普通文字成功路径回归；模拟行为验证不等于 Node24 全量测试或真实浏览器验证。
- 已修正 task.md 中遗留的“再次清空旧译文缓存”条件：不得破坏 #345 的 DB4 现有数据。
- 当前准确候选尚无 Node24/npm validate、WXT/Chromium 运行证据，Microsoft/Tencent 真实服务及用户人工验收均未完成。状态继续 working/Draft，不合并。

## 2026-10-19 Node24 真实验证迭代 1

- 工作流：https://github.com/CoderLambert/translateflow-plugin/actions/runs/39200177197 ，HEAD `5eef0c4ab127c89a610d946691738578e10baef3`，GitHub Ubuntu / Node v24.21.0 / npm v11.19.0。
- MT/Selection/DB4 相关 6 个 Node 文件的定向测试 **114 PASS / 0 FAIL**（运行日志有逐项证据）。
- `npm run validate` **FAIL** 于 `npm run check`：`src/content/quick-control-view.js` 因 MT UI 集成增加至门禁 420 行以上；后续 Node 全量/typecheck/Vitest/WXT/Chromium 均未执行，不能标为失败或通过。
- 修复该单一门禁：将 MT preset 状态改为 `machineMode` 分支，固定 machine mode 时选择 `inherit` 并继续禁用 AI preset 选择；代码不改变 Quick Control 位置、拖动或扩展权限。复核脚本行数限制后重试同一候选的连续 gate（第 2 轮）。

## 2026-10-19 最终源码候选与真实自动化验证（**主 Agent 自查，非独立验收**）

- **准确已测试源码候选**：`c8742f9728e0b0dfbe00c910553ce0575fbe7c90`，Git tree `ee64def47ff0c7e593b690a8907fa25f900c9928`；GitHub 以 lease 原子更新并核对 `git/commits` 的 tree。后续仅允许当前任务的状态/评审/验证报告归档变更，源码变更必须重新验证受影响项。
- GitHub Ubuntu Node **24.21.0** / npm **11.19.0**。首次运行 [#39200177197](https://github.com/CoderLambert/translateflow-plugin/actions/runs/39200177197)：定向 114/114 PASS；Quick Control 行数门禁 FAIL；已修复。第二次 [#39200499677](https://github.com/CoderLambert/translateflow-plugin/actions/runs/39200499677)：1870/1872 Node PASS，剩余临时 workflow/manual-only 门禁与生成 Reading 脚本过期；已修复。
- 第三次 [#39201010519](https://github.com/CoderLambert/translateflow-plugin/actions/runs/39201010519)：在临时 CI 文件已从执行工作树删除且 Reading 兼容源码重新生成后，**`npm run validate` PASS（Node 1872/1872 PASS、静态检查、严格 TypeScript、Vitest、默认 WXT 构建）**，显式 WXT 构建 PASS；Smoke 因 Chromium 依赖尚未安装而未完成，后续测试被跳过，非产品断言失败。
- 第四次 [#39201493588](https://github.com/CoderLambert/translateflow-plugin/actions/runs/39201493588)：同一 prospective Git tree，定向 Node PASS、默认及显式 WXT 构建 PASS、**两个 Chromium WXT Smoke PASS、MT + DB4 Chromium E2E 13/13 PASS**（6 MT、6 compiled MV3 cache、1 native cache）；Chromium `153.0.8010.12`；原生 IndexedDB 子检查 **19/19 PASS / DB_VERSION=4**。
- 第四次 E2E 在实际编译扩展（`.output/chrome-mv3`）上执行，**只有机器翻译外网 transport 用 mock**，不是微软/腾讯真实网络成功；E2E 包指纹 SHA-256 `005ee1f2c295aa1dc2ec27cb726cc938e897160ba57bd181e2313b39ddc246a2` / 129 文件；产物 [Actions ZIP](https://github.com/CoderLambert/translateflow-plugin/actions/runs/39201493588/artifacts/12164102054)，压缩包 SHA-256 `2a60ba6f7dd47c47c40840f1497d25beee94ba7852550baed9cc1d243132817c`，仅为本轮 CI 产物而非用户已验收发布包。
- **未通过门槛**：当前 Microsoft/Tencent 真实联网 NOT VERIFIED，真实用户安装/操作人工验收 NOT RUN；完整旧包同扩展 ID 升级 E2E NOT RUN，`scripts/local-task.mjs gate` / 签名 acceptance.json NOT RUN（GitHub CI 是辅助证据，不自动等于本地任务 gate）。
- **界限**：PR 保持 Draft；没有向 main 合并/发布，没有修改 DB4 物理协议/ReadingRecord DB owner、恢复旧 DB3/内置词典或扩大权限。旧 0.8.14/DB3/历史 17/17 不是该候选的证据；本节证据以 SHA 与以上日志为准。

## 2026-10-19 DB4 -> MT 同 ID 升级回归（新增测试，尚未运行）

- 新增 `e2e/machine-translation-db4-upgrade.spec.mjs`：要求两个真实构建包（`TF_DB4_OLD_ARTIFACT` / `TF_DB4_NEW_ARTIFACT`），从当前主线 DB4 WXT 升级到 M0 候选 WXT，而非仅测试旧 DB2/3 的迁移。
- 测试在一次性 Chromium profile、同一解包路径、真实扩展 ID 下，使用合成 MDX/MDD、Reading fixture 和 DB4 cache 写入数据；升级后比较用户配置、Reading IDB、缓存 `entries/epochs`、OPFS 完整内容、缓存 `cacheOnly` 命中，并由封闭网络控制证明 Provider 0 请求。
- 没有实际执行新测试，结果 **NOT RUN**；缺少构建包应标 SKIP，不能被当成 PASS。该测试本身未改生产源码、生产权限或 DB4 物理版本。
- 本次变更触及冻结测试输入，`state.candidateHead` 清空并改回 `working`。旧实现候选 `c8742f9728e0b0dfbe00c910553ce0575fbe7c90` 的 Node24 完整验证仍是有效历史证据；新 HEAD 需独立测试/重新冻结，不能沿用旧 candidate SHA 冒充新测试通过。

### 同版本包替换与商店更新的证据区分

- 已核对 `main@1ddae050` 与本 PR package version 都是 **0.8.29**。新增测试使用 Chromium 管理页 `developerPrivate.reload` 强制重载同路径实际替换的包，**只验证同 ID、同 profile 和真实 DB4/Reading/OPFS 数据保留**，不是扩展商店随递增版本触发的自动更新。
- 未来准备发布时须单独核对版本递增与真实更新触发，再重测对应验收；当前不擅自提升版本或宣称用户升级完成。由于 test-only 变动，还没有可归属此 HEAD 的 Node24/Chromium 结果。

- 新增 `scripts/verify-mt-db4-upgrade.mjs` 和任务验证命令：严格要求来自 main DB4 与 PR 的真实 WXT 安装包，Playwright 不允许 SKIP 冒充 PASS；此命令截至当前仍 NOT RUN。

## 2026-10-19 MT 429/403 冷却容错补丁

- `src/background/providers/machine-translation-transport.js`：冷却写入失败时保留内存围栏，不掩盖真实 `MT_BLOCKED` / `MT_RATE_LIMIT`；冷却读取失败时回退内存状态，避免存储损坏时对用户显示不相干的错误或无谓重试。未改变固定服务/权限/Key/网络终点。
- `tests/machine-translation.test.mjs`：新增 storage GET 失败但正常翻译仍可完成，以及 403 + storage SET/GET 失败仍按 `MT_BLOCKED` 且重复请求数保持 1 的负例。
- 本次修改属于生产 Provider 代码，旧 c8742f 已通过的全量 gate 不能宣称覆盖此变更。最新定向 Node24、浏览器/升级相关测试均待准确候选重验；当前只是源码变更和本轮审核，**NOT RUN**。

### 2026-10-19 HTTP 错误响应体清理

- 免费 MT Provider 的 HTTP 403/429/非 2xx 和超大 Content-Length 错误分支，不再等待可能失败或永不 settle 的 `ReadableStream.cancel()`。通过 `discardResponseBody` best-effort 丢弃内容，保留原始 `MT_BLOCKED`、`MT_RATE_LIMIT`、`MT_HTTP`、`MT_RESPONSE`，及时释放队列槽位，防止下一个请求无谓超时。
- 测试添加错误流取消拒绝时仍返回 `MT_HTTP`、后续请求可成功，以及超过 512KiB 返回 `MT_RESPONSE` 两条负例。无新增 Provider、付费回退、缓存格式或权限。
- 本轮新增生产改动准确 Node24 测试、Chromium E2E 尚 NOT RUN；之前通过的项目全量证据不能用于宣称本轮新增用例已经通过。

## 2026-10-19 M0 网页正文 URL 隐私保护完成实现（待正式回归）

- 生产补丁 [`805333fa`](https://github.com/CoderLambert/translateflow-plugin/commit/805333fa7c2b84123c54f5a233cfc18c65bdd0e5)：`src/background/providers/machine-translation.js` 增加 `splitMachineVisibleUrls`，以不丢字的方式保留 Page 普通文本中的完整 URL、邮箱和 IPv4 链接本地字面值，仅外发前后安全文字；空请求不调用免费 MT Provider。已有受保护 code/kbd/HTML marker 的原结构合同不变，Selection 保留更严格的拒绝逻辑。
- `tests/machine-translation.test.mjs` 新增 Page 混合文字（翻译周围文字但 Provider body 无可见地址）、纯 URL 0 网络调用、拆分前后字节重建三条定向负例。当前提交的 provider 逻辑在 V8 隔离模拟行为 4/4 PASS；其 `fetch` 是测试替身，不是微软/腾讯真实联网。
- 连同前两次 HTTP 修复，本轮共新增 7 个 Node 回归用例和 3 个真实源码的隔离 HTTP 行为检查。**准确 HEAD 的 Node24 项目测试、WXT、Chromium 和升级 gate 仍 NOT RUN**；旧 `c8742f` 的 PASS 不覆盖最新代码。无 DB4/Reading/词典/Quick Control/权限改动。

## 2026-10-19 免费 MT 隐私策略修订与 DB4 身份围栏

- 可见 URL/邮箱/IP 从远程 Provider payload 中移除后，旧免费 MT 缓存可能包含此前不遵守此策略的结果；本次将 `MACHINE_INPUT_VERSION` 定向提升为 `mt-slots-v2`，因此新旧 MT 请求的 `configFingerprint`/`request identity` 隔离。保护此前缓存的物理记录、不删 DB4 entries/epochs、不迁移 Reading/词典、不改 AI 缓存身份。
- 新增测试证实旧 `mt-slots-v1` 与新 v2 的 `getConfigHash`、`createTranslationIdentity` 和 `buildTranslationRequestKey` 不相等；原本使用 v2 作为“虚拟变更版本”的断言移至 v3。
- Node24/Chromium 运行验收仍 **NOT RUN**；静态合同修改不能替代构建与真实用户网络检测。
