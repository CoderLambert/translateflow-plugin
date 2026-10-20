# YouTube 字幕可靠性切片的实现与验证

日期：2026-10-21。结论：**本切片本地验证 PASS，完整字幕升级尚未验收或发布。**

用户在独立审查后授权开始开发，并明确选择“暂缓 GPL 源码接入，先交付当前修复”。本次修复 TranslateFlow 自有链路；没有把 FluentRead 源码或独立提取包放入生产模块图。原生控制栏菜单、完整滚动轨道归并和生产预取没有纳入本切片，不把它们标为完成。原 [独立审查](superpowers-review.md) 和 [首批验证](validation-report.md) 保留原候选绑定，不能直接当作当前工作树的验收。

## 交付位置与绑定

- worktree：隔离 worktree（本机路径未归档）
- branch：`fix/youtube-subtitle-reuse-20261021`
- 实现基线/当前 Git HEAD：`bf37935f04ef6271ef8d3b5780142ac8d65c3600`；以下修复均未提交，`candidateHead=null`，没有冻结或运行正式 local-task gate。
- 原工作区仍在 `fix/chatgpt-native-host-development-setup` / `5f8bac7453f475c551a9cb4b9f07ef03d59a436c`，未切分支或覆盖用户内容。
- 23 个变更源码/测试/检查脚本的路径与 SHA-256 清单位于本地 `docs/task-execution/local/youtube-subtitle-reuse-v1/working-tree-evidence.json`；清单 JSON 摘要：`d953084baa69d26f58ba464d4e1ce4cb34b51a32f1695ea85567e2fcc9318dea`。这是工作树输入标识，不是 Git 提交。
- 最终 WXT 包：`.output/chrome-mv3`，131 文件，3,067,635 字节，未包含可选词典资源。E2E `inventoryArtifact` 摘要：`520fc1aaf15e6eac1c6953448d17817eb135f153e3e76a97218cef9fe7ab6eff`；全部最终字幕 E2E 日志均绑定该摘要，`sourceHead=null`。
- 同包使用 `scripts/local-task.mjs:fingerprint` 的摘要为 `4486d9d7c9e5f3b0c0b4bce3d2139b6785720174c1584111a6b8f1bb9b25c4a0`。两种既有算法的行尾拼接不同，不能互换；本报告的浏览器绑定采用 E2E 算法。

未提交、推送、修改 PR #366 状态、合并或发布；安装包版本仍为 0.8.43，不能仅靠版本号识别本修复。

## 已实现的行为

| 修复 | 实现位置（本工作树） | 回归证据 |
| --- | --- | --- |
| DOM 字幕 A → 空档 → A、A → B → A 和原文 → 双语恢复成功结果，避免重复调用 | `src/content/subtitles/pipeline.js:181`，局部 fingerprint 使用文本/媒体/轨道/位置；DB4 仍使用原位置/sequence 合同 | `tests/subtitle-controller-currentness.test.mjs:191` 起；生产入口 E2E `e2e/youtube-subtitles.spec.mjs:193` |
| 首次配置读取之前登记可取消消费者，配置/缓存/Provider 等待后检查资格 | `src/background/cache/translation-coordinator.js:13` 的 `withRequest`；`src/background/subtitle-requests.js:27` 的 `assertCurrent` | `tests/subtitle-request-lifecycle.test.mjs:14` 起：配置/缓存/Provider 取消、全局配置取消、修订变化、取消缓存命中 |
| 配置、临时 preset、页面/全部缓存清理撤销前台旧结果 | `src/content/subtitles/controller.js:55,76`；`src/background/index.js:44`；`src/background/cache/message-handler.js:80`；`content.js:18` | controller 同步失效/慢上下文/不主动重译；生产入口 E2E 从存储更新目标语言并实际清页面缓存 |
| 字幕配置摘要与字幕既有 AI/Chrome-local 路由一致，不借用页面 free-MT 方式 | `src/background/config.js:91`；router 的 `surface` / `translationRevision`；controller 传 `surface:"subtitle"` | `tests/effective-config-site.test.mjs`；Chrome-local fixture 的既有 11 项浏览器回归 |
| 同一 cue 失败按 2/5/15/30 秒冷却；旧 cue 失败不阻塞已排队的新 cue；部分成功只补缺失 cue | `src/content/subtitles/pipeline.js:218` 的有界 failures 表及批处理收尾 | `tests/subtitle-controller-currentness.test.mjs:211,239,250` |
| MAIN 响应保留请求开始的 track/trackRevision，拒绝同视频切轨迟到和 human/ASR 错配 | `src/content/subtitles/youtube-main-bridge.js:133,145,155,176` | `tests/youtube-bridge.test.mjs:255` 起：fetch、XHR、A → B → A、异语言、同语言 human/ASR、坏 URL 保留原 fetch |
| 保留显式 ASR 元数据；暂停/seek 时不运行下一边界墙钟定时器 | `src/content/subtitles/source.js:60`；`src/content/subtitles/sources/youtube.js:172` | `tests/subtitles.test.mjs` 的显式 ASR 与 pause/play 定时器用例 |
| 缺失/null/空白 pageUrl 的页面清理请求不会变成清全部 | `src/background/cache/message-handler.js:66` | `tests/subtitle-request-lifecycle.test.mjs:45`，先 FAIL 后修复 PASS |

## 架构与取消语义

沿用同一 coordinator consumers 表及现有 single-flight，没有新建任务系统、持久化缓存或 Provider。配置读取、缓存访问和 Provider 使用同一有效配置，并复用既有配置修订失效机制。DB4 schema、身份规范化、存储 owner、Manifest 权限、MAIN/ISOLATED 消息 schema 和依赖锁均未改变。

取消在下一异步阶段边界生效，可以阻止尚未开始的 Provider 和存储；它不会强制中断已经执行的配置/缓存读取。DB4 store 已开始后，由原有写入 fence 决定提交，不能宣称取消能回滚成功提交。消费者 Promise 返回不表示不响应 abort 的 Provider 已释放执行资源；本轮没有修复或声称满足生产预取的物理执行预算，所以没有开启预取。

缓存删除先完成持久化操作，再尽力通知标签页。通知失败不把已成功删除报告成存储失败；页面级通知按既有 URL 身份过滤。通知本身不触发翻译，后续字幕事件仍可按当前已授权模式请求翻译。失败退避没有新增定时重试或按钮，需要后续观察或切换模式恢复。

MAIN 的精确闭包变更触发既有 `scripts/source-boundaries.mjs` 独立审核要求，完成聚焦只读安全复核后才更新固定摘要；见 [MAIN 审核记录](main-bridge-review.md)。这是该边界的审核，不是最终工作树的全分支独审。验收后由主 Agent 自查，没有追加通用模型审核。

## 实际执行的验证

环境：Node `v24.22.0`，npm `11.19.1`，Playwright Chromium `153.0.8010.12`。以下命令退出码均为 0；日志在本地忽略目录 `docs/task-execution/local/youtube-subtitle-reuse-v1/`，不会自动进入生产包或远端。

| 命令 | 结果与适用输入 | 日志 |
| --- | --- | --- |
| `npm ci` | PASS；依照锁文件安装，无依赖变更 | 临时本地日志（未入库） |
| `npm run check` | 最终源码 PASS；823 JS/TS/TSX 文件，1250 i18n key | `check-final.log` |
| `npm test` | 2024/2024 PASS、0 SKIP；在最后页面清理输入防护前执行，其它输入未变 | `node-suite.log` |
| `node --test tests/subtitle-request-lifecycle.test.mjs tests/cache-system-persistence-failure.test.mjs tests/cache-system-domains.test.mjs` | 最后清理防护及受影响缓存域回归 61/61 PASS；包含新增负例，不将旧全量计数冒充当前 2025 项全量执行 | `clear-input-green.log` |
| `npm run typecheck` | PASS | `typecheck.log` |
| `npm run test:unit` | 14 文件、80/80 PASS；相关 TS/TSX 输入此后未变 | `vitest.log` |
| `npm run build:extension:wxt` | 最终源码 PASS，生成上述准确 WXT 包 | `build-final.log` |
| `npm run test:e2e -- e2e/youtube-subtitles.spec.mjs e2e/subtitle-pipeline.spec.mjs e2e/browser-basic-translation.spec.mjs --retries=0` | 16/16 PASS（3 workers）；在最后清理防护前的包运行，包括 11 项 Chrome-local mock 回归 | `e2e.log` |
| `TF_TEST_WORKERS=1 npm run test:e2e -- e2e/youtube-subtitles.spec.mjs e2e/subtitle-pipeline.spec.mjs --retries=0` | 最终包受影响字幕/缓存流程 5/5 PASS（1 worker，5.4 秒），0 重试 | `e2e-final.log` |
| `git diff --check` | PASS | 本轮终端输出 |

完整 Node/Vitest 通过后，仅重验最后清理输入防护影响的缓存/字幕路径；其它未变输入复用前述证据。没有在最终包上重跑那 11 项本地翻译 mock E2E，因此不能把初次收口结果说成重新通过全部 16 项。初次收口时 `npm run validate` 聚合命令及默认 `dist/extension/` 构建未执行；之后的完整校验与 E2E 结果记录于 [测试报告](test-report.md)。

用户随后要求编译供手测：`npm run build:extension` **PASS**，退出码 0，输出本 worktree 的 `dist/extension/`，版本 0.8.43。131 文件 / 3,067,635 字节；E2E 算法摘要仍为 `520fc1aaf15e6eac1c6953448d17817eb135f153e3e76a97218cef9fe7ab6eff`，逐文件核对与上述浏览器测试包完全一致，因此复用既有浏览器证据，未重新运行测试。日志及核对结果：本地 `build-manual-test.log` / `manual-test-artifact.json`。没有覆盖原工作区的安装包。

构建有 #245 平台体积 advisory：2,257,401 / 1,576,595 字节，超出 680,806 字节；构建未失败。没有通过增加预算或改门禁消除此警告，也没有做无关体积重构。

E2E 使用独立临时扩展副本、profile、合成页面和 mock Provider。测试副本按既有 fixture 修改 Manifest；生产 Manifest 未改。新增生产入口场景拦截 `https://www.youtube.com/watch?v=tf-reliability` 返回合成播放器 DOM，由实际 content 入口自动启动控制器，未用工厂替换；这仍不是访问真实 YouTube 播放器。其它既有场景的边界 double 保持原状。

## 主 Agent 验收后自查

对照实际 diff、调用链与回归，确认下列边界：

1. 前台 completed 表只恢复当前作用域内的成功结果；配置/缓存通知能同步撤销显示，旧回调受 generation/frame/live-time 校验。
2. 取消沿用同一个 requestId，准备阶段不再落在未登记窗口；不会借本切片取消同页非字幕消费者。持久化提交点和物理资源释放仍按上述限制处理。
3. 部分失败不会把一条译文冒充完整重叠字幕，成功项不重新上传；失败表有界且取消不累计失败。
4. MAIN 保留原 fetch Promise、XHR 方法、wrapper teardown、2MiB 校验与纯观测边界；没有主动 fetch 字幕或重放签名 URL。
5. 自查发现页面清理入参可误入 all 分支，已先补失败测试并修复；最后定向测试、检查、重建、字幕 E2E 均重新通过。
6. 没有清用户数据、触碰真实凭据、修改权限、引入 React 到内容链路、复制上游 GPL 源码或增加依赖。

## 剩余边界与下一步

### 真实页面验收补充

用户要求直接操控真实浏览器后，已在当前已登录 Chrome 用户配置打开并播放真实 YouTube 页面。当前 DOM 探针确认 `paused=false`、`currentTime=462.73s`、TranslateFlow host 已挂载、字幕模式为 `original`，并读取到实际原字幕 cue；译文节点为空。另用有头 Playwright 临时 profile 加载了本次 `dist/extension` 并打开同一真实 URL，确认候选包可注入真实页面，但该无登录态 profile 的视频停在 `readyState=0`、没有字幕可测。已登录配置的活动扩展版本未能通过扩展管理页核对，所以实播证据不绑定候选包。截图虽见中英字幕，但中文行无法归因给 TranslateFlow；不将其计为真实译文验收。详见 [测试报告](test-report.md)。已登录页面保持播放及“原字幕”模式供用户检查。

- **NOT RUN**：真实 YouTube human/ASR 轨道、同语言切轨、连续 SPA 切视频、seek/倍速/暂停、全屏/控制栏重建；真实 AI Provider 与真实 Chrome Translator；浏览器刷新/重启后的真实配置与缓存恢复。单测和合成 MV3 不能替代这些验收。
- YT-01/02 的本切片修复已实现并通过上述本地检查；YT-04 仅提前修复 track 身份与定时器，完整滚动归并没有实现。YT-03、YT-05 和完整 YT-06 不标为完成。
- 按用户决定暂缓 GPL 源码接入。参考其行为/测试不等于已完成上游复用；未来若实际移入源码，再针对具体代码和分发范围处理。该事项不阻塞本切片交付。
- 生产预取仍需解决实际执行完成/释放预算，以及跨层取消回归；保持当前字幕路径，不为此重写通用系统。
- 当前状态 `reviewing`，不是 `completed` 或 `ready_to_sync`。后续提交/推送、正式候选冻结与 gate、PR 更新/合并/发布均需相应授权；此报告不授予这些动作。发布前须在准确候选/包上完成真实 YouTube 验收。
