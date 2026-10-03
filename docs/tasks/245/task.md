# [Platform][PF-00][P0] 冻结渐进升级基线、工具链兼容矩阵与迁移验收合同

历史引用：[#245](https://github.com/CoderLambert/translateflow-plugin/issues/245)。2026-10-03 一次迁入；后续以本目录任务和本地证据为准。

## 流程迁移决策

下方是迁入的产品/工程合同。历史合同中的 Issue 评论/标签、远端 CI、自动 GitHub Review 和旧状态流不再是日常执行动作；统一采用 [LOCAL_WORKFLOW.md](../LOCAL_WORKFLOW.md) 的本地完整验收、真实浏览器/产物要求、具名独立审核及受保护代码同步。安全、数据、硬依赖与人工验收保持有效。原有“规划待启动”限制以用户本轮授权和 state.json 为准。

## 执行状态
Parent #191。规划已拆分，**等待用户明确启动；本次不执行、不加 agent-ready/state:working**。创建任务不等于批准发布或合并。
难度 L3；主执行 platform-lead（高推理，架构/构建），独立 reviewer 高推理；轻量 agent 只整理清单和合成 fixture。角色是后续分工，不代表已启动子 Agent。
硬依赖：无代码依赖；启动授权独立于依赖。规划读取 main@6c9347db79c538b2660e9009847ce362a3578261；执行必须重新读取当前 main、open PR 和相关 Issue。

## 结果
后续实现者得到一套可验证的迁移合同，而不是重新选择框架或各自设计目录。本任务只做一次有界收口，不扩建研究/审核平台。

## 范围与交付
1. 提交 `docs/PLATFORM_UPGRADE_V1.md`，冻结 WXT（使用其兼容 Vite）+ React（仅指定扩展 UI）+ 渐进 TS + Vitest + 现有 node:test/Playwright 的边界。React 第一条产品路径复用 #235；ReadingRecord/隐私/锚点仍由 #230–#240 负责，平台不再建一套。
2. 核对 `manifest.json`、package/lock、`scripts/check.mjs`、`scripts/build-extension.mjs`、`src/shared/constants.js`、auto-sites、background/index、所有实际 Worker/MAIN-world/iframe/资源入口以及 E2E/认证脚本的构建调用点。形成源文件→产物路径→加载者→执行上下文表。
3. 冻结 Node 24 LTS 系列为首选开发/CI 基线；在执行日核实并记录具体 patch、npm、WXT/Vite、React/types、TS、Vitest、Playwright 的 engines/peer 兼容组合。用隔离实验实际安装、构建/类型/测试 smoke 后才称版本可用；不靠同时安装 latest，不用 --force/legacy-peer-deps 掩盖冲突。版本锁定由 PF-01 落到主工程；本任务实验依赖不进入正式产品。
4. 既有 Chrome minimum 102 是声明基线，不等于全部新能力已实测。分别冻结 JS/CSS target、原生 API feature-detect、实际测试浏览器版本；不能只调整编译 target 就宣称 API 兼容，也不默认提高 minimum。若依赖确实无法满足，给出明确升级决策而非静默改 manifest。
5. 冻结保持项：permissions/optional grant 语义、commands、脚本运行世界/时机/注册 owner、配置/消息值、缓存身份、原 DB/store/version、OPFS 路径/活跃指针、词典内容。版本/产物文件布局允许按清单变动，不要求字节相同。
6. 冻结过渡方案：WXT 是唯一新构建 owner；未转换的 classic Content/MAIN/Worker 资源暂用精确 allowlist 从唯一源码复制，保持旧加载路径；禁止复制整个仓库到 public。该兼容桥仅桥接源码，不是第二个独立产品。后续 PF-05 负责模块化收口。
7. 记录 #227/#228 的未合入缺陷与共享文件冲突、#222 的未合并规则差异。不擅自合并其他 PR、不把未合入代码当 baseline；现有可复现缺陷与迁移回归分开。影响取消/数据安全的缺陷须在切换前修复或明确 NO-GO，不能复制旧认证 PASS。
8. 同一 fixture/环境冻结包体与注入成本的测量方法：基础运行时代码、内置词典、各入口依赖分别统计；无 React 进入 Content/MAIN/Worker/后台。迁移阶段基础代码预算暂定旧基线 + max(10%, 100 KiB)，不含不变词典；这是拟定阈值，须在实验中报告实测并冻结，不能为过线事后放宽。UI 包体另在 #235 记录，不用臆造速度提升百分比。

## 验收
- [ ] 单一规范列全实际入口、硬编码路径和旧构建消费者，无遗漏的 Worker/词典资源通道。
- [ ] 工具版本/Node 兼容性有实际安装与 smoke 结果，或明确失败项及阻断范围。
- [ ] 权限、数据、脚本生命周期、包体、兼容与回退各有明确验收方法/责任任务。
- [ ] 与 #230/#233/#235 的职责及执行顺序无循环依赖；不要求先完成四浏览器发布。
- [ ] 实验结果和静态判断分开，未运行不写 PASS。

## 验证与所有权
文档/隔离实验 PR；主写 docs/PLATFORM_UPGRADE_V1.md 与实验记录；不改产品功能、缓存 schema、AI 请求或用户文件。沿用当前 npm run validate；临时实验的实际命令单独记录。不因缺少真实词典或商店账号阻塞无关的 Chrome 工程合同。

## 官方依据（执行时复核）
https://wxt.dev/guide/resources/migrate.html
https://wxt.dev/guide/essentials/entrypoints.html
https://wxt.dev/guide/essentials/target-different-browsers.html
https://vite.dev/guide/
https://nodejs.org/en/about/previous-releases
https://playwright.dev/docs/chrome-extensions
