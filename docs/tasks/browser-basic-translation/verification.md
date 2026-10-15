# 实现与验收记录

基线为 `feat/api-key-provider-connections` / `e7b847326c8a87b41c66d9028b58cd515fd03217`，保留进入任务时已有的未提交划词保存改动。本次没有创建 commit、PR、合并或发布；candidateHead / syncHead / mergeHead 均未冻结。当前版本为 0.8.1。

实现包括：共享语言映射与引擎选择；后台浏览器配置快照及独立缓存身份；ISOLATED Translator / LanguageDetector 准备、执行与取消；页面/划词/字幕共用客户端；源语言纠正、准备进度和失败重试；AI 失败后的明确切换；可选词典与富文本命中优先；设置、中英文文案和用户说明。DB schema、AI 缓存 hash payload、MAIN 桥和生产权限保持原契约。

用户追加的提交自动化已落实：当前仓库 `core.hooksPath=.githooks`。pre-commit 从暂存区快照构建，递增 patch（保留已明确暂存的更高版本），同步 Manifest/package/lock/README。只改索引中的版本字段，保留其它未暂存改动；失败不创建提交。临时 Git 测试仓库中的合成 commit 不属于本仓库提交。

| 实际命令 / 检查 | 结果与范围 |
| --- | --- |
| `npm test` | 初次全量 1556 PASS、2 FAIL。失败为 Reading classic 投影过期及硬编码 0.8.0 断言；均修复，并以受影响测试复验。未再次运行全量。 |
| `node --test tests/reading-content-classic.test.mjs tests/release-gate.test.mjs tests/provider-config.test.mjs tests/effective-config-snapshots.test.mjs tests/selection-rich-outcome.test.mjs tests/selection-v2.test.mjs tests/browser-translation.test.mjs` | 58 PASS（当时新增引擎测试数较少）。后续新增引擎测试单独执行。 |
| `node --test tests/browser-translation.test.mjs` | 最终 14 PASS：配置/语言/缓存身份、无隐式初始化、代码与标记保护、关闭/导航/字幕取消及立即重试、检测失败恢复。 |
| `node --test tests/versioned-commit.test.mjs tests/release-gate.test.mjs` | 9 PASS：含版本递增、手动版本、暂存/未暂存隔离、构建失败和并发暂存保护。 |
| `node --test tests/selection-ui-contract.test.mjs` | 6 PASS。同步了本次有意移除的必需内置词典 notice 链接断言。 |
| `npm run check` / `npm run typecheck` | PASS。 |
| `npm run test:unit -- tests/unit/options-react.test.tsx tests/unit/react-locale.test.tsx` | 18 PASS。 |
| `npm run build:extension:wxt` / `npm run build:extension` | PASS；两个最终输出完全一致：128 文件、2,775,951 bytes、词典数据 0 bytes。保留既有 advisory 平台代码预算警告，不宣称预算达标。 |
| `node scripts/run-e2e.mjs e2e/browser-basic-translation.spec.mjs` | 6 PASS：准备重试、翻译/复制入口、缓存、AI 优先及手动回退、站点/轨道语言、关闭/迟到结果、源语言纠正与不可用恢复。最终准备面板样式修复后复验相关首项 PASS。 |
| `node scripts/run-e2e.mjs e2e/browser-basic-translation.spec.mjs e2e/rich-mdict-product.spec.mjs --grep 'without AI\|page translation preserves\|AI stays\|subtitle language\|closing Selection\|source correction\|Settings install persists'` | 7 PASS，包含真实本地合成 MDX 安装、富文本命中、安全展示、收藏和删除。 |
| `node scripts/run-e2e.mjs e2e/selection-lexicon-error.spec.mjs e2e/selection-lexicon-corrupt.spec.mjs e2e/subtitle-pipeline.spec.mjs` | 4 PASS：缺失/损坏词典不阻断翻译；AI 字幕缓存、语言及视频身份隔离。 |
| `npm run test:wxt:smoke` | PASS；未替代完整 E2E。后续仅准备面板样式改变，复用其它 smoke 证据。 |
| `node scripts/prepare-versioned-commit.mjs --preview`（临时独立索引） | 真实暂存快照编译 PASS；实际索引、版本与安装包未被预览修改。 |
| `git diff --check` / `node scripts/reading-content-classic.mjs --check` | PASS。 |

最终包 fingerprint（按排序 path/size/file SHA256 JSON 计算）：`31fe059a563e18b7132028da49ecac0cd49c39db634ec22be455d16df7791c40`。E2E fixture 自带的 treeSha256 算法不同，记录在原始日志中，不与这里的摘要混用。

真实 Chromium 152 HTTPS ISOLATED 可探测 Translator，英语→简体中文 availability 为 downloadable。真实点击准备后等待 180 秒仍在 preparing，未获得译文，因而实际翻译及断网能力为 **BLOCKED / 未验证**。单词、短句、专业段落和字幕质量/耗时，以及与真实 AI 的比较为 **NOT RUN**，没有真实 AI 凭据测试。本机另行实际验证：普通 HTTP 页面 Translator 缺失；HTTPS `Permissions-Policy: translator=()` 返回 unavailable。Mock 不构成模型能力或质量证明。

主 Agent 自查（非独立审核）：核对了配置错误不会伪装成无 AI、关闭基础能力不初始化/下载、不取消已执行中的 AI 请求、结构化 markers/code 不进入浏览器模型、语言对冻结与 AI 缓存隔离、迟到结果在写缓存前被拒绝、已导入词典和显式关闭偏好保留、生产包不含开发/词典数据，以及钩子不夹带未暂存内容。375px、暗色、减少动画的准备面板截图已实际查看，修复了原生配置按钮对比度和面板透底问题。

原始日志、hash、截图与真实探测仅在 Git 忽略的 `docs/task-execution/local/browser-basic-translation/`。用户说明见 `docs/BROWSER_TRANSLATION.md`。剩余验收为真实模型准备、实际译文和离线/质量比较；无需为此发送真实 Provider 测试请求或扩大生产权限。
