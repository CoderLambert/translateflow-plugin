# Reading AI 保存竞态与悬停恢复修复

- 日期：2026-10-12
- 分支：`fix/selection-popover-ux-closeout-20261009`
- PR：[#324](https://github.com/CoderLambert/translateflow-plugin/pull/324)
- 验证基线：`39bd25c973c156e5e8be1f43aaf935867fe10a86` 加本记录以外的当前任务 diff
- 范围：修复已完成 AI artifact 在关闭或换选区时丢失的竞态，恢复同页同词 related record 的本地历史，并修正 Selection/hover 弹窗的视口裁切。

## 问题与目标

已完成且被 UI 接纳的 assistant artifact 原先仍依赖当前卡片存活状态。普通关闭会清理 selection 状态并取消 operation，导致 `APPEND_ASSISTANT` 在自然操作节奏下不发送；旧测试等待 saved 状态后才关闭，未覆盖此竞态。页面 marker 也只读取主 record，无法在同一精确词项的合法 related record 中恢复 AI 历史。窄视口下 CSS 和 JS 的边距/尺寸计算不一致，实际变换后的面板仍可能越界。

本次目标是让已接纳的 completed artifact 使用冻结的原身份继续提交，同时让未完成生成和真实导航、暂停、排除、删除等负例继续失败关闭。hover 恢复必须只读本地 ReadingRecord，不增加 Provider 调用。

## 实际改动

| 文件或区域 | 改动 |
| --- | --- |
| `src/content/selection/record-access.js`、`record-client.js` | 在可信 operation 仍有效时同步固定 accepted proof、source capture、document generation、页面身份和语言；`accept()` 返回本 artifact 的 Promise，重复 accept 复用结果。关闭或新选区只隐藏旧 UI，已接纳 completed artifact 继续用同一 operation/artifact 提交；旧 ACK 只更新内部 ref。 |
| `src/content/selection/{controller,popover,record-status,result-model,selection}.js` | 接入 assistant 提交 Promise 和真实保存状态；未开启或站点排除时给出对应原因与管理入口，不把未授权结果写入 ReadingRecord。 |
| `src/shared/reading/{artifact,constants,dto,list,record,response}.js` | 为页面摘要加入精确 `itemKey`，定义有界 `relatedRecords` DTO；保持主/related record 各自的 revision、snapshots、artifacts，并按 thread/turn/parent/branch/createdAt 稳定排序 assistant 历史。 |
| `src/background/reading-record/{handoff-target,previews,query,repository,service}.js` | PREVIEW_CREATE/READ 全链路验证 related record 身份和 revision；只读取同页、同站点、同 `itemKey` 的 assistant artifact，并保留每个 artifact 自身的 `sourceSnapshotId` 语境。 |
| `src/content/reading-page-markers.js` | marker 按精确 `itemKey` 关联本地 related record，不做单复数、连字符、路由或相似词模糊合并；hover 仍只走 Reading preview。 |
| `src/learning-center/ReadingPreview.tsx`、client、样式与 i18n | hover 展示词典、翻译、保存语境、AI action、问题、完整回答与追问；成功读取但无 AI 时正文只显示“暂无 AI 记录 ⓘ”，原因在 tooltip；读取失败单独显示并可重试。 |
| Selection/hover 布局与样式 | 统一 `visualViewport` 8px padding；先按可用宽高限尺寸，再用实际 `getBoundingClientRect()` 和变换比例二次 clamp，保持关闭按钮及主要操作可达。 |
| `tests/`、`e2e/`、文档 | 增加关闭/换选区、policy/BEGIN 延迟、ACK 延迟或丢失、相同 artifact 重试、负例、related record 重启恢复、空态/完整历史及窄视口真实 rect 回归；同步架构和学习中心合同。 |

## 生命周期与数据边界

- accepted proof 只对单个已接纳 completed artifact 生效，并受 owner、operation、source revision、document generation、页面身份、token 和 TTL 约束；没有把 `isCurrent` 全局改为 true。
- BEGIN 和 APPEND 继续使用后台 consent、站点 policy、data/page/site generation 与 IndexedDB 事务。暂停、排除、真实导航或删除在不可逆提交点前仍阻止写入。
- ACK 必须匹配同一 `artifactId`、`recordId` 且 revision 前进；丢失 ACK 时只用相同 operation/artifact 重试，后台幂等合同防止重复落库。
- related record DTO 有数量上限；主 record 和 related record 不合并存储对象。每个 assistant 使用自身 source snapshot 恢复语境。
- hover 没有 Provider 路由；E2E 断言刷新、浏览器重启和 hover 前后 Provider 增量为 0。
- 未修改 manifest 权限、Reading 数据库 schema、缓存身份、Provider 配置或用户凭据。

## 验证

环境：Node `v24.21.0`、npm `11.19.0`、Chromium `153.0.8010.12`。没有重新安装依赖，没有调用真实模型或用户 Key。

| 命令或检查 | 结果 |
| --- | --- |
| `npm run validate` | PASS；647 个源码文件通过检查，i18n 879 keys，Node `1239/1239`，严格 typecheck，Vitest `9` files / `40/40`，默认 WXT 开发安装包构建成功。平台代码预算仍有既有 advisory：超出 153,081 bytes。 |
| `node scripts/reading-content-classic.mjs --check`、`node scripts/reading-record-entry.mjs --check` | PASS；两个生成的 classic Reading 文件与唯一源码一致。 |
| `npm run build:extension:wxt` | PASS；`.output/chrome-mv3` 为 197 files / 39,231,591 bytes。 |
| `npm run test:wxt:smoke` | PASS；Chromium `153.0.8010.12`，Popup/Options/background/Workers/Content smoke 通过，无页面错误、外部请求或意外动态注册。 |
| `npm run test:e2e -- e2e/selection-assistant-ui.spec.mjs e2e/reading-preview.spec.mjs e2e/reading-page-markers.spec.mjs e2e/selection-reading-record.spec.mjs e2e/learning-center.spec.mjs` | 候选 `15dd395` 上 PASS，`18/18`，单 worker。覆盖自然关闭竞态、Stop 负例、restart hover、related record、刷新稳定性、完整历史与窄视口 BCR。使用 mock Provider 与临时 profile。 |
| `npx playwright test e2e/reading-page-markers.spec.mjs` | 最终候选 PASS，`1/1`。旧词节点保持 connected 且留在原位，只改变其上下文；另一个正式投影完全相同的段落得到高亮，Provider 调用为 0。 |
| `git diff --check` | PASS。 |

`dist/extension` 与 `.output/chrome-mv3` 的逐文件 tree SHA-256 均为 `0801b649a7984b8b414d6a842c7427b44c7ecc016461213daa5ccc6e16186eed`，Content SHA-256 均为 `757bd9c7e8f40bee3c08577cc76a899f6cb66517e699b1da6beb852f5e1222e9`。E2E 使用临时测试副本并加入合成词典与 localhost 权限，不能把临时副本当作用户安装包。

## 限制与真实 profile 状态

- **REAL ACCEPTANCE: BLOCKED**。现有 Chrome profile 配置的固定 unpacked 目录已安全切换为上述 `0801b649…86eed` 候选，但浏览器控制策略明确禁止访问 `chrome://extensions`，因此无法点击 reload，也不能证明浏览器进程已加载 Content `757bd9c7…1222e9`；没有在未确认 reload 的状态下调用真实 Provider 或伪造 `APPEND → artifact → refresh/restart hover` 证据。
- 没有以临时 profile、mock Provider 或自动测试替代上述真实 profile 结论；真实 Provider 增量也因此记为 `UNKNOWN`。自动 E2E 中 hover 的 Provider 增量为 `0`。
- 没有修改用户 IndexedDB、Reading 开关、站点排除、API Key、模型配置或私人词典，没有清空数据。最终候选切换前的 `ee57e413…1925` 原目录完整保存在 `extension.backup-20261012T141513Z`；先前的 `extension.backup-20261012T140454Z` 与 `extension.backup-20261012T215500Z` 也保留；没有执行扩展 reload。
- 未运行 Chrome 102、其它浏览器、真实 YouTube timedtext、真实付费 Provider、发布词典认证、商店发布或 main 合并。

完成真实 profile 验收所需的最小人工步骤是：在现有 Chrome 的扩展管理页对该固定 ID 点击一次“重新加载”，刷新目标页；随后可在不等待 saved selector 的节奏下执行“完成后立即关闭 → 直接 hover”，再刷新和正常重启核对。该操作不应清空 profile 或 Reading 数据，也不需要新增扩展权限。

## 复审断连回归修复

独立复审发现 Selection invalidation port 的 `onDisconnect` 仍调用已删除的 `refreshSiteMarkers`。当当前卡已有已保存 ref、后台 service worker 重启或端口异常断开时，该残留调用会抛出 `ReferenceError`，既不能重连，也不能校验保存引用。

- 断连回调现改用既有 `refresh(true)` 路径：重新读取 recording/site policy、重建 invalidation subscription，并通过当前页摘要校验 ref；不读取详情、不更新 viewed revision，也不调用 Provider。
- `tests/selection-record-client.test.mjs` 新增带已保存 ref 的断连回归，断言回调不抛错、连接数从 1 增至 2、只执行一次 `GET_PAGE_SUMMARY` 且当前 ref 未被阻断。

## 独立复审后续收口

同一轮独立复审另发现七项边界回归，均在一次候选中修复：

| 边界 | 修复与证据 |
| --- | --- |
| 已绑定 preview 读取失败后 Retry | 前端记住本 `previewId` 已成功绑定，重试只再次 `PREVIEW_READ`，不重复已被后台禁止的 `PREVIEW_CLAIM`。Vitest 断言首次读取失败后第二次读取成功，claim 始终恰好一次。 |
| 最大转义 `itemKey` | 统一按版本前缀、JSON 固定包络和每个 UTF-16 unit 最坏 6 字符转义推导 `itemKeyChars=12491`；页面摘要和 handoff 共用同一上界。控制字符、引号、反斜杠和 surrogate-pair 边界均有回归。 |
| marker Range 迁移 | `sameLocations` 同时比较新旧 Range 的两端节点和 offset，不再只验证旧 Range；渲染保留本次 Range 的原始文本作轻量存活校验，支持规范化空白。真实 Chromium 保留旧节点 connected、把合法 anchor 移到新节点后，高亮几何迁移到新位置。 |
| 不可定位 related AI | assistant 候选先按完整有界页面摘要和精确 `itemKey` 聚合，再单独筛选可定位 marker；旧 AI record 即使失去定位，同页同词的可定位 record 仍能 local-only 恢复完整 AI 历史。E2E 中高亮从 3 降到 2 后，第二个同词 marker 仍恢复回答与追问，Provider 增量为 0。 |
| 富媒体 IntersectionObserver 根 | `.tf-rich-viewer` 已非滚动容器，Observer 改用浏览器 viewport root，让 `.tf-selection-result` 的实际祖先裁切参与交叉计算。真实外层滚动回归确认离屏 Blob URL 从 1 回收为 0，回到可见区后恢复为 1，布局高度/滚动位置不塌缩，Provider 为 0。 |
| 富文本 metadata 误过滤 | 只过滤独立资源标签、完整受控方括号占位和明确组合 metadata；`BrE`/`NAmE` 使用大小写敏感词边界，普通定义 `image of a person` 与 `surname and given name` 在 Reading 与生词本草稿中均保留。 |
| 规范化空白 fast path | root 候选使用与投影一致的空白规范化，并用投影 round-trip 校验 Range；两个原始空白不同但投影相同的 block 返回 `ambiguous`，不会静默选择第一个。 |

新增/修改回归的最终结果：Node 定向 `43/43`、ReadingPreview 组件文件 `11/11`、Reading preview 浏览器文件 `3/3`、marker 迁移 `1/1`、富媒体外层滚动 `1/1`。第一次沙箱内 `npm run check` 因检查器派生 Node 子进程被统一 `EPERM` 阻止；使用同一仓库命令在获批工作区权限下重跑后通过，未把该环境阻塞记作源码失败。

## 最终独立复审修复

最终复审又定位并修复两处会丢失合法本地结果的边界，同时收紧 marker 迁移证据：

- `reading-anchor-resolver` 的 verified-block fast path 不再用原始 DOM 文本预筛。它会对全部候选根执行与正式扫描相同的投影策略；遇到无法证明完整、预算耗尽或 revision/root 集变化时直接回退正式全页扫描。`hidden`、`aria-hidden`、`display:none`、`visibility:hidden`、`content-visibility:hidden`、`opacity:0` 和正式排除标签均覆盖“投影后重复必须 ambiguous”的参数化回归。
- Rich Reading 和 `ReadingPreview` 不再把独立的“图片”或 `image` 当作媒体 metadata 删除；只过滤受控方括号占位、明确加载/播放提示和组合 metadata。Reading artifact、生词本草稿及 hover 组件均断言合法短释义保留，`[图片资源未导入]` 仍被过滤。
- marker E2E 中旧 `#word` 节点保持 connected 且不离开原 DOM 位置，只修改其上下文；新匹配内容另行插入并滚入视口，最终高亮几何必须迁移到新节点而不是继续依赖旧 Range。

最终候选验证为：`npm run validate` PASS（Node `1239/1239`、Vitest `40/40`），两个 classic 生成器 `--check` PASS，显式 WXT build 与 smoke PASS，marker Chromium E2E `1/1` PASS。没有新增 manifest 权限、远程请求或 Provider 调用。

严格 marker 场景第一次运行时，迁移几何断言已通过，但最终 SPA 返回使用了旧 `#word` 定位；Chromium BFCache 保留变异 DOM 后该节点不是当前合法匹配，导致末尾高亮断言失败。测试改为返回后优先滚动仍存在的 `#current-word`，没有修改生产代码或放宽迁移断言；最终同一命令重跑 `1/1` PASS。

## Fast path 唯一性收口

最终完整性复审指出，`rootCandidates` 只枚举 `ROOTS`，但正式 `contextRoot` 合同允许 `closest(ROOTS) || element`。因此页面在 `body` 下同时存在一个匹配 `p` 和一个正式投影等价的普通 `div` 时，fast path 只能看到 `p`，不能据此证明唯一。

收口后 fast path 只提前返回已经找到两个独立 Range 的 `ambiguous`；单匹配不再返回 `resolved`，一律进入完整正式扫描。新增 `p + div`、无共同 ROOTS 祖先的回归会验证第二个正式 context root 并返回 `ambiguous`；原有规范化空白以及 hidden、ARIA、CSS 排除测试继续证明可确定的重复仍由 fast path 提前拒绝。最终 `npm run validate`、WXT build/smoke 和 marker Chromium E2E 均 PASS，marker Provider 调用为 0。
