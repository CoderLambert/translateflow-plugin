# [Platform][PF-02][P0] 渐进 TypeScript、Vitest 与源码边界检查接入现有 CI

历史引用：[#247](https://github.com/CoderLambert/translateflow-plugin/issues/247)。2026-10-03 一次迁入；后续以本目录任务和本地证据为准。

## 流程迁移决策

下方是迁入的产品/工程合同。历史合同中的 Issue 评论/标签、远端 CI、自动 GitHub Review 和旧状态流不再是日常执行动作；统一采用 [LOCAL_WORKFLOW.md](../LOCAL_WORKFLOW.md) 的本地完整验收、真实浏览器/产物要求、具名独立审核及受保护代码同步。安全、数据、硬依赖与人工验收保持有效。原有“规划待启动”限制以用户本轮授权和 state.json 为准。

## 执行卡
Parent #191；硬依赖 #246。规划待启动；无自动开发授权。
难度 L2，架构检查与跨上下文合同由 L3 reviewer 审核。主执行 platform-test；package/lock/CI 配置由 coordinator 单写。本任务与 PF-04 可并行，但不得同时覆盖共享配置。

## 目标
新 TS/React 模块具备快速反馈，旧回归仍完整运行；不把测试迁移本身变成长期项目。

## 实现范围
1. 按 #245 冻结版本接 TS、Vitest 与 WXT 集成。新 entrypoints/platform/learning-center 使用严格 TS；旧 JS 允许渐进接入，跨边界以真实 JSDoc/声明/适配器补类型，不用全局 any、ts-nocheck 或整仓转换。
2. 类型不能替代运行时校验。请求/响应复用现有消息值、显式 unknown 输入校验；#230 的 Reading DTO 是唯一模型源，不在 UI 再复制一份。此任务只提供测试/类型设施，不重做 reading protocol。
3. 保留 `node --test tests/*.test.mjs`。新增 `tests/unit/**/*.test.ts`、组件 `*.test.tsx` 等明确互斥的 Vitest 发现范围，排除 legacy node tests、e2e 和生成目录。完成迁移的单个测试才能删除旧版，记录对应关系，不用测试总数变化掩盖覆盖丢失。
4. 新纯函数用 node 环境；组件用明确 DOM 环境和 Testing Library（仅 devDependencies）。mock chrome/WXT API 仅模拟依赖，不声称验证权限、Service Worker 或 OPFS 的真实行为。生产 UI 不因测试加入运行时代码。
5. 实際新增 `typecheck`、`test:unit` 命令；`validate` 保持总入口，聚合源检查、旧 Node tests、新类型/单测及当前默认 build。接入 WXT prepare，CI 从原来“无需安装”改为固定 Node/npm + npm ci，再执行同一命令；Playwright 保留独立 E2E workflow。
6. 改造 `scripts/check.mjs` 的扫描边界：忽略 .wxt/.output/dist/node_modules 等产物；TS/TSX 由类型/语法工具检查。不得把生成 bundle 的长度当源文件职责，也不得漏掉新增源码。旧 classic Content 区域继续限制 ESM，明确迁移区域再开放；保持 shared 无 browser/chrome 副作用、network/IDB/register owner、入口轻量与包体隔离。
7. 给边界检查加正/反例：Content 直接 fetch/IDB、React 从 background/worker/shared 被引入、未批准 runtime dependency 必须失败；合法新 UI/批准 adapter 能通过。#233 新 IDB adapter 例外仍由该任务精确登记，本任务不可提前放开全部 background。
8. 新依赖审核按运行时/开发时分开，提交 lock；不同时引入多个 linter/formatter、状态库、路由库或另一套构建。继续现有代码风格，规则新增只解决当前升级需要。

## 验收
- [ ] npm ci 后一次 validate 实际执行新旧所有适用检查；故意类型错/错误架构 import 能令 CI 失败。
- [ ] Vitest 不运行 node:test 文件，Node 不发现 TS/组件文件，E2E 不被重复发现。
- [ ] 一项真实现有纯函数用例证明 TS 互操作，一项测试专用组件证明 React test 环境；不是空测试/allow-no-tests 假绿。
- [ ] 普通构建产物无 Vitest/Testing Library/DOM mock 依赖；没有 React 进入非 UI runtime。
- [ ] 旧回归未被批量删减，边界规则没有被直接关闭。

## 交付
更新 E2E/贡献说明中命令区别与新增测试目录；记录准确 head、各 runner 结果、运行时长基线及未测内容。完整实际安装包与升级 E2E由 PF-03 接续。纯测试接入不改变用户数据，不迁移所有旧测试。

## 官方依据
https://wxt.dev/guide/essentials/unit-testing.html
https://wxt.dev/guide/essentials/frontend-frameworks.html
https://vitest.dev/guide/
https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html
