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
| `npm run validate` | PASS；647 个源码文件通过检查，i18n 879 keys，Node `1227/1227`，严格 typecheck，Vitest `9` files / `39/39`，默认 WXT 开发安装包构建成功。平台代码预算仍有既有 advisory：超出 153,494 bytes。 |
| `node scripts/reading-content-classic.mjs --check` | PASS；两个生成的 classic Reading 文件与唯一源码一致。 |
| `npm run build:extension:wxt` | PASS；`.output/chrome-mv3` 为 197 files / 39,231,900 bytes。 |
| `npm run test:wxt:smoke` | PASS；Chromium `153.0.8010.12`，Popup/Options/background/Workers/Content smoke 通过，无页面错误、外部请求或意外动态注册。 |
| `npm run test:e2e -- e2e/selection-assistant-ui.spec.mjs e2e/reading-preview.spec.mjs e2e/reading-page-markers.spec.mjs e2e/selection-reading-record.spec.mjs e2e/learning-center.spec.mjs` | PASS，`18/18`，单 worker。覆盖自然关闭竞态、Stop 负例、restart hover、related record、刷新稳定性、完整历史与窄视口 BCR。使用 mock Provider 与临时 profile。 |
| `git diff --check` | PASS。 |

`dist/extension` 与 `.output/chrome-mv3` 的逐文件 tree SHA-256 均为 `6363bfe83350ac10b076a52c13b88133bae59debbb5a624d014d6599d6116bd9`。E2E 使用临时测试副本并加入合成词典与 localhost 权限，不能把临时副本当作用户安装包。

## 限制与真实 profile 状态

- **REAL ACCEPTANCE: BLOCKED**。现有 Chrome profile 可见，但当前浏览器控制能力不允许读取 `chrome://extensions`、扩展页加载目录或运行 Content hash，因此无法证明同一实际扩展 ID 已加载上述 `6363bfe8…6bd9` 候选，也无法形成真实 `APPEND → artifact → refresh/restart hover` 证据。
- 没有以临时 profile、mock Provider 或自动测试替代上述真实 profile 结论；真实 Provider 增量也因此记为 `UNKNOWN`。自动 E2E 中 hover 的 Provider 增量为 `0`。
- 没有修改用户 IndexedDB、Reading 开关、站点排除、API Key、模型配置或私人词典，没有清空数据；也没有更新本机候选安装目录，因为无法在受控接口中确认其加载/恢复链。
- 未运行 Chrome 102、其它浏览器、真实 YouTube timedtext、真实付费 Provider、发布词典认证、商店发布或 main 合并。

完成真实 profile 验收所需的最小人工步骤是：在现有 Chrome 的扩展管理页确认该固定 ID 的加载目录为本次候选并点击一次“重新加载”，刷新目标页；随后可在不等待 saved selector 的节奏下执行“完成后立即关闭 → 直接 hover”，再刷新和正常重启核对。该操作不应清空 profile 或 Reading 数据。
