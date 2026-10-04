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
