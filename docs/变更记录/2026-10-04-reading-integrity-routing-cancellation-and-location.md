# 阅读历史路由、保存一致性与页内定位修复

- 日期：2026-10-04
- 分支：`fix/reading-integrity-20261004`
- 交付范围：修复阅读历史的可信 Provider 路由、Stop 与持久化事务一致性、页面隐私和长文章定位，并核验升级与权限边界。

## 变更目标

历史追问必须依赖后台保存并验证的站点身份，不能因回访 URL 为空而误用全局 Provider。Stop 必须与 IndexedDB 真实提交点一致。网页只显示通用历史状态和经当前 Range 验证的内容。长页面定位应在有界扫描中区分已定位、歧义、缺失和未完成。

## 实际改动

| 文件或区域 | 模块 | 改动 |
| --- | --- | --- |
| `src/background/config.js`、`src/shared/provider-config.js`、`src/background/selection/assistant-stream.js`、`src/background/selection/reading-result.js` | 配置与历史追问 | 以存储记录的站点身份解析已有配置链；请求和 provenance 共用相同有效配置及兼容指纹。 |
| `src/background/selection/explain.js`、`src/background/router.js`、`src/background/cache-db.js` | Provider 与请求编排 | 将历史记录解析出的可信身份贯穿请求路径；保持现有缓存和端口规范。 |
| `src/background/reading-record/{idb,repository,runtime,service,write}.js` | 阅读记录事务 | 内部传递取消 signal，在事务取消时真实 abort，并在唯一提交点后报告实际终态。 |
| `src/content/text-projection.js`、`src/content/text-projection-builder.js`、`src/content/reading-anchor-resolver.js` | 页面投影与定位 | 增加可续扫的有界定位、缓存复用和不完整覆盖状态；保留同步投影合同。 |
| `src/content/reading-return-card.js`、`src/content/reading-page-markers.js`、`src/content/reading-source.js`、`src/content/reading-record.js` | 页面历史界面 | 清理过期 Range 和异步结果；只在当前验证范围内展示内容；标记滚入视口后才显示。`reading-record.js` 由生成器更新。 |
| `e2e/reading-return-location.spec.mjs`、`e2e/reading-page-markers.spec.mjs` | 浏览器验收 | 覆盖历史定位、sentinel 页面隔离、页尾长文扫描、DOM/SPA 变化与无 Provider 调用。 |
| `tests/{assistant-history-service,cache-context,effective-config-site,provider-config,reading-anchor-resolver,reading-idb-cancellation,reading-result-provenance,selection-assistant-stream}.test.mjs` | 定向测试 | 覆盖身份路由、旧指纹兼容、取消屏障、真实事务 abort 和投影边界。 |

## 关键实现

- 历史追问使用后台从已验证 Reading 记录取得的 `siteKey`/`pageKey`。回访 URL 只用于可选导航；缺失或无效身份在 Provider 请求前拒绝。Provider 和来源指纹共享同一解析配置。
- 内存 `AbortSignal` 经过 stream、runtime、service、repository 到 IDB 适配器，不进入 RPC 或存储 DTO。提交前取消通过事务 abort 回滚；最终同步检查和提交之间不 `await`，提交后如实报告已提交结果。
- 页内历史列表不渲染未定位的存储 quote、上下文或回答。扫描每片遵守 16,000 UTF-16 字符、500 节点和 8ms 预算，并受总预算约束；未完成的扫描不会误报为唯一命中或缺失。

## 行为与兼容性

未修改 manifest 权限、数据库 schema、来源 ID、缓存指纹语义、私人词典或全局运行时设置。端口规范化、空 glossary 兼容和既有 Provider/Profile/Preset/glossary 解析链保持原有合同。

## 验证

| 命令或检查 | 结果 |
| --- | --- |
| `npm ci` | 通过；使用仓库锁定依赖。 |
| `npm run validate` | 最终完整重跑通过：578 项源码检查、Node 1083/1083、typecheck、Vitest 16/16、WXT 构建。首次运行有一个测试文件进程异常退出；该文件单独 3/3 通过，随后完整重跑通过。 |
| `node scripts/reading-content-classic.mjs --check` | 通过；生成的 Reading classic 文件与 authored source 一致。 |
| `npm run build:extension:wxt`、`npm run test:wxt:smoke` | 均通过；Chromium `153.0.8010.12`。 |
| 聚焦 Reading/Provider/Popup E2E 命令 | 通过，24/24。覆盖工具栏 Popup、普通页面静态注入、页面历史、隔离 profile 的原生 host 权限控制。 |
| Reading storage E2E（digest barrier 与暂停/排除/清空） | 通过，2/2。 |
| 同 ID 旧包更新及重启 E2E | 通过，2/2 场景；设置、缓存、OPFS、偏好和注册状态得到验证。 |
| 实际 Chromium 页尾扫描 | 通过；前置页面约 58,310 字符，扫描 57,705 字符、185 节点，12.2ms 工作时间、0ms 等待，Provider 调用 0 次。 |

## 限制与后续审查

- 未运行 Chrome 102、非 Chromium 浏览器、Chrome 原生权限提示 UI、真实付费 Provider、实时 YouTube timedtext、发布词典认证或私人词典。
- 当前 `origin/main` 在候选验证后前进到 `29d4c2e`（#298/#299 React UI 迁移）。本分支仍以当时最新的 `a4dab12` 为基线；从共同基线比较，生产源码无文件重叠。远端已经用 `docs/tasks/251` 记录另一项任务，因此本变更记录使用独立路径，避免覆盖远端任务状态。审查时请以当前 `main` 为目标并关注更新后的 UI 集成和任务文档差异。
- 本地浏览器产物为 `.output/chrome-mv3`，111 个文件、1,740,762 字节；原始 WXT 包 local-task tree SHA-256 为 `7103c3086500d83df578bdd6774f70cca7809f4c03e79ada55d4c091091bb836`。E2E 临时副本另含合成词典文件和 localhost 测试权限，不是原始安装包。

## 最新 main 前置集成与四项审查修复（2026-10-04）

### 集成基线

- 开始时本地分支为 `fix/reading-integrity-20261004`，HEAD `11817a169786f38ab3f3ab5441b1be4611f75adf`，工作区干净。
- fetch 后 `origin/main` 为 `29d4c2e6f08530d03352c06653db43942b88c2cc`，共同基线为 `a4dab127c95f4f1d3b37375fc5a7b1b5241419f9`。已将 main 合并到本分支，合并提交 `9dcdc044d3b5ac98f1713b529c34b0310fb2e21b`，ort 策略无冲突。
- 两侧净变更没有同路径文件。保留了 main 的 `docs/tasks/251` 和 `docs/tasks/252`；没有合并或 cherry-pick localization 分支。本记录仍放在独立变更记录路径。

### 修复

- `reading-anchor-resolver.js` 现在在扫描返回值中携带对应扫描状态；取消一个 single/batch 消费者只结束它自己的等待，不清空另一个消费者正在使用的扫描或根投影缓存。DOM 变更只会丢弃仍为当前共享状态的扫描。
- `reading-page-markers.js` 在 DOM 变更时立即清除旧 Range 和 marker，保留通用历史入口、未定位状态与“重新检查位置”按钮。自动重试预算限于当前 Content 文档生命周期，焦点、手动重试和 SPA 路由不会重置；耗尽后不再自动扫描。
- `assistant-stream.js` 的错误终态现在采用真实异常码，不会因为 signal 已 aborted 把 `READING_QUOTA` 等失败改成 `CANCELLED`。提交点后的已保存响应仍以 `complete`/`saved` 返回。
- `reading-record/idb.js` 的 request error 使用首因语义，不覆盖已记录的取消或失败。新增回归覆盖原生 request error 先于 transaction abort 的事件次序。

### 最终候选和验收

- 最终产品/测试候选 `c479b969942e32beb72ecff8505c1dbe3954fe49`，分支工作区在此候选上干净。以下结果都在此 HEAD 上执行；先前 `30d155b` 的验收仅作为历史结果，不计入本轮通过项。
- 环境：Node `v24.21.0`、npm `11.19.0`。本轮未重跑 `npm ci`；依赖目录沿用之前成功的锁定安装，`package.json` 与锁文件没有本轮差异。
- `npm run validate`：PASS；595 项源码检查、Node `1087/1087`、严格 typecheck、Vitest `8` 个文件 / `26/26`、默认 `dist/extension` 构建通过。
- `npm run build:extension:wxt`：PASS；`.output/chrome-mv3` 为 111 个文件、1,738,656 bytes，tree SHA-256 `1fedeb9c117bd85158232764dd3ce8a062fdefe8afac854f8dcf8878a3b5d472`。smoke 在 Chromium `153.0.8010.12` 通过；无页面错误、外部请求或意外动态注册。
- 定向 E2E：Reading marker/return 与普通 assistant stream `3/3`；Reading commit、真实 Chromium request-error/transaction-abort 次序和 quota `3/3`；React 学习中心实际产品流程 `1/1`。另对最终长页 marker 证据运行 `1/1`。
- 四轮独立 mutation 回归确认第 4 轮后历史入口仍存在、旧 marker 已清除，并可手动重新定位。共享长扫描回归只取消 marker 一方，return-card 消费者仍成功定位。Stop/quota 回归确认 quota 错误不变成取消，提交点后成功返回 saved；React 学习中心对 `READING_QUOTA` 呈失败终态。
- 最终长页测量：Chromium `153.0.8010.12`，页面目标前 58,310 字符；扫描 57,705 字符、185 节点，实际工作 `14.6ms`、等待 `0ms`，结果 `resolved`，Provider 调用 `0`。记录见本地忽略证据 `docs/task-execution/local/reading-integrity-20261004-integration/reading-page-marker-scan.json`。
- 原始 WXT 安装包指纹为上列 `.output/chrome-mv3` SHA。E2E 临时副本另含合成 Core/Technical 词典和测试 manifest：119 个文件、1,750,950 bytes，tree SHA-256 `78650a065c253d9331cfc894869741637d4f8a49cd71685b0abdc48a8a63fb8c`；此指纹不代表原始安装包。完整本地验收摘要在 `docs/task-execution/local/reading-integrity-20261004-integration/evidence-summary.json`，这些本地文件受 Git 忽略规则保护。

本轮未运行 Chrome 102、非 Chromium、原生权限提示 UI、真实 YouTube timedtext、付费 Provider、发布词典认证，也未重新跑 same-ID 升级/撤权完整场景。未推送、未创建 PR，未合入 main。后续文档归档 HEAD 与测试候选不同；归档只记录结果，不改变 `testedHead` `c479b969942e32beb72ecff8505c1dbe3954fe49`。

## 复审 P2 刷新窗口修正

- 复审指出在既有历史列表触发 focus/手动刷新后，后台响应期间旧 Range 仍可被定位按钮使用。现于每次 `load()` 起始立即以通用 `not-loaded` 状态重绘列表，同步清除旧 Range 与 marker；历史入口和手动重试保留，成功响应再渲染新定位结果。
- `e2e/reading-page-markers.spec.mjs` 新增挂起 GET_PAGE_SUMMARY 的回归：刷新等待期间原文本节点保持连接且内容改变，点击旧行不触发滚动；后台响应后显示新的未找到状态。
- `tests/reading-idb-cancellation.test.mjs` 另覆盖 signal 取消后 pending request 抛 AbortError、随后 transaction abort，最终原因仍是 `CANCELLED`。
- `validate` 首次运行发现 `src/content/reading-record.js` 与唯一 owned-source 生成结果不一致；已用 `node scripts/reading-content-classic.mjs` 重建，不手改生成文件，并纳入本候选检查。
- 最终补丁候选 `2401928de615a1260047576390bfda7c8a9ae314`，在此前 `e07e714` 已推送审查分支上追加 5 个本地提交；本次复审补丁尚未推送或合入。旧候选 `c479b96` 的验收不替代本候选证据。
- `npm run validate`：PASS；595 项源码检查，Node `1088/1088`、typecheck、Vitest `8` 个文件 / `26/26` 与默认构建均通过。首次运行只因 classic Reading 生成物不一致而在 Node 测试处停止；运行唯一生成器后重跑完整链通过。
- `node scripts/reading-content-classic.mjs --check`、`git diff --check`：PASS。`node --test tests/reading-idb-cancellation.test.mjs`：PASS，`7/7`，新增 signal 取消、request AbortError、transaction abort 事件序列最终保留 `CANCELLED`。
- `npm run build:extension:wxt`、`npm run test:wxt:smoke`：PASS；Chromium `153.0.8010.12`。默认 `dist/extension` 与 `.output/chrome-mv3` 逐文件一致，均为 111 个文件 / 1,738,667 bytes，tree SHA-256 `0bf2e4b44c861105f22306e064f260e36bde1c3abb0362ec00eb14678a9756ff`。
- `TF_E2E_ARTIFACT_SOURCE_HEAD=2401928de615a1260047576390bfda7c8a9ae314 npm run test:e2e -- --workers=1 e2e/reading-page-markers.spec.mjs`：PASS，`1/1`。Chromium `153.0.8010.12`；刷新屏障期间旧定位未触发滚动，恢复响应后为未找到，Provider 调用 `0`。实测扫描 57,705 字符 / 185 节点，工作 10.2ms / 等待 0ms。
- 定向 E2E 在稳定通过前有三次测试 harness 失败：首次从网页主世界访问扩展隔离状态，随后分别修正重复 URL 目标标签选择和打开隐藏面板后的点击步骤；这些失败没有作为 PASS 计入，最终结果绑定本候选并通过。
- 此场景 E2E 临时副本单列 fingerprint：119 个文件 / 1,750,961 bytes，tree SHA-256 `099f5372eda98e95c4ca17c58dced313d526b459f4d30dfd3d31e3cf4a63a368`，含合成 Core/Technical 词典与测试 manifest localhost 权限；不代表原始安装包。证据 JSON：`test-results/e2e/reading-page-markers-autho-4d020-anges-without-Provider-work/reading-page-marker-scan.json`（本地测试产物，Git 忽略）。
- 测试绑定代码候选 `2401928de615a1260047576390bfda7c8a9ae314`；本节为其后的文档记录提交，不改变测试输入。Chrome 102、其它浏览器、真实权限 UI、真实 YouTube timedtext、付费 Provider、same-ID 升级/撤权和发布词典认证仍未运行。
