# Contributing to TranslateFlow

## Required validation

开发阶段按最新 diff 执行受影响检查，不因修改、提交或冻结自动执行全量测试。PR 后、合入前针对实现候选执行一次完整验收：

```bash
npm run validate
```

后续修复只重跑失败项及其受影响依赖；源码、测试、配置及产物输入未变的 PASS 复用并保留原 testedHead、命令和日志。纯文档和元数据归档只校对 diff。条件与限制见 [最小执行与证据复用](docs/tasks/LOCAL_WORKFLOW.md#最小执行与证据复用)。

使用 `package.json` 的 Node/npm 约束和 `npm ci` 安装锁定依赖；当前校验保留 Node 内置测试与默认 WXT 构建。WXT 工程依赖只参与构建，现有业务仍复用原 JS 模块。

`validate` 依次执行源码/架构检查、旧 Node 回归、严格 TypeScript、Vitest 单元测试和默认 WXT 构建。可分别运行 `npm run typecheck`、`npm run test:unit`；两者先生成 WXT 类型。旧 Node 仅发现 `tests/*.test.mjs`，Vitest 仅发现 `tests/unit/**/*.test.ts(x)`，Playwright 仍仅发现 `e2e/**/*.spec.mjs`。纯函数默认 Node 环境；组件测试必须明确声明 jsdom 环境，组件 fixture 不进入生产包。

新 TS/TSX 及本仓声明文件必须通过严格编译；旧 JS 保持 `allowJs`、`checkJs:false`，用真实 JSDoc 或 unknown 输入加现有运行时 validator 逐步互操作。完整 WXT `import.meta.env` 生成声明仍存在上游冲突，当前产品不使用它；未来使用必须先解决该边界，不能扩大本仓类型排除范围。实际编译域与失败证据见 [docs/TYPES_TESTS_V1.md](docs/TYPES_TESTS_V1.md)。

WXT 产物或构建输入发生变化时执行相关构建/产物验证；已有相同输入的证据直接复用：

```bash
npm run build:extension:wxt
npm run test:wxt:smoke
```

默认产物位于稳定安装目录 `dist/extension/`，显式 WXT 入口输出到 `.output/chrome-mv3/`；两者使用同一 WXT 引擎和产物审核。有限 smoke 从实际 WXT 包制作临时测试副本，使用合成 Core 词典、本地审核 Technical 词典与确定性 localhost Provider；不替代完整 E2E、同 ID 升级或发布认证。构建、精确资源映射和后续切换边界见 [docs/WXT_COMPAT_V1.md](docs/WXT_COMPAT_V1.md)。

涉及真实 Chrome/MV3/DOM/交互行为的改动还应运行适用的浏览器 E2E：

```bash
npm run build:extension:wxt
npm run test:e2e
```

完整 E2E 包含直接读取 `.output/chrome-mv3` 的语言专项，运行前需显式构建 WXT 包；`validate` 生成的 `dist/extension` 也是 WXT 包；仍需为显式消费者生成指定路径。旧包对照只能从固定提交 `19e89b65fd3600073410407392da82ffa666ffc8` 构建，再显式设置 `TF_I18N_ARTIFACT` 为其产物路径，见 [UI_LOCALE.md](docs/UI_LOCALE.md)。fixture 不会为缺失产物自动构建或补文件。

## Local task workflow

[docs/tasks/LOCAL_WORKFLOW.md](docs/tasks/LOCAL_WORKFLOW.md) 是唯一执行流程。任务合同在 `docs/tasks/<id>/task.md`，主 Agent 单写 `state.json`；索引由脚本生成。验收绑定准确候选，验收后由主 Agent 自查，不自动调用审核 Agent。日常不读写 GitHub Issue、评论、标签、CI 状态或 GitHub Review API。历史 Issue 仅保留引用；新增任务直接建本地任务卡。

以下步骤用于实现任务；纯文档与符合条件的元数据归档只执行本地流程规定的适用步骤。

1. 读取本地任务合同、状态和依赖；核对 Git branch/head/修改/worktree，按需要一次 fetch。保留用户修改，有占用先协调。
2. 明确文件所有权与验收，聚焦实现并运行受影响本地测试。并行实现必须独立 worktree；共享文件单写。
3. 提交候选并建立 PR；按 diff 定向验证。合入前执行一次完整验收，已有完整证据时只补新增变化/失败项的相关检查。冻结负责绑定证据，不自动扩大验证范围。未运行写 NOT RUN，失败写 FAIL。
4. 主 Agent 对照任务验收和实际 diff 自查；修复后仅重跑受影响验证，不自动增加模型审核。自查不宣称独立审核。
5. 归档简短验收/自查结果，生成索引并执行本地 gate。仅证据归档提交可与候选 SHA 不同，脚本必须证明源码、测试、构建与任务合同输入一致；主 Agent 核对归档准确性，不再启动模型审核。合并后完成记录按本地流程的归档条件处理。
6. PR 可在完整验收前建立；实现合入前仍须满足最终本地 gate。PR 只作为代码 diff 与 squash 入口。合并前核对准确远端 head，使用 `--match-head-commit`；仍遵守 GitHub 实际保护、必需审查和人工门槛，不能忽略被保护的失败/未运行检查。
7. 合并后 fetch，核对 main 的 tree 和预期同步 tree，主 Agent 更新本地任务 mergeHead/结果。completed 只表示已合入并完成该任务要求，不代表商店发布或所有历史认证。

原始事件、完整日志、截图和备份只在 Git 忽略的 `docs/task-execution/local/`。简短脱敏任务文件随代码提交。统计只在完成、暂停或用户要求时生成；Hook 只记录，不参与状态决策，不调用模型/网络、不读取完整会话或认证、不发 GitHub 评论。详见 [docs/TASK_EXECUTION.md](docs/TASK_EXECUTION.md)。

Actions 均为 `workflow_dispatch` 手动备用验证，日常验收在本地。一次流程迁移允许读取历史任务、保护与 ruleset；后续只在代码备份/合并边界使用 GitHub。若保护规则要求远端检查，必须先由有权限者正式调整，不能绕过。自动 PR 审查 App 是独立设置，Actions 改动不保证停用它。

## Module ownership

- shared contracts/pure helpers: `src/shared/`
- Provider/network: `src/background/providers/`
- effective config: `src/background/config.js` + `src/shared/provider-config.js`
- translation cache IndexedDB: `src/background/cache-db.js`
- independent ReadingRecord IndexedDB: `src/background/reading-record/idb.js`; other Reading backend modules call this adapter, while Content and extension UI use the v2 background messages. Consent/exclusions live only in Reading meta; cache and dictionary OPFS remain separate. The source checker allows only these two exact direct IndexedDB owners and rejects frontend runtime dependency chains into the Reading adapter.
- dynamic site scripts: `src/background/auto-sites.js`
- DOM extraction/render: `src/content/dom.js`
- batching: `src/content/batch.js`
- cache-first orchestration: `src/content/processor.js`
- observers/auto queue: `src/content/auto.js`

## Lexical data changes

Lexical work must first classify the change as **runtime algorithm** or **dictionary content**.

Architecture rule:

```text
Source-driven data
→ Rule-driven retrieval
→ Context-driven ranking
→ User-driven AI
```

Requirements:

- do not increase dictionary coverage by continuously adding project-authored word/translation rows;
- do not encode word-specific sense tables as ranking conditionals;
- validation/regression words belong in `tests/**` / benchmark fixtures, not runtime packs;
- dictionary facts should enter through reviewed, attributable source/import pipelines;
- project-authored overrides are temporary exceptions only and need evidence plus a replacement/removal path;
- AI detail remains explicit and is not authoritative dictionary data;
- large dictionaries belong in downloadable/imported packs, not the base extension.

For lexical PRs, include the answers to:

1. Which source owns the lexical fact?
2. Does this add bundled bytes?
3. Could this be a validation fixture instead of runtime data?
4. Is any query-specific rule acting as hidden dictionary content?
5. How will a temporary override be removed?

See `docs/LEXICAL_DATA_BOUNDARIES.md`.

## Production extension packaging

The repository root is a development workspace, not the release artifact.

`npm run validate` builds and audits the allowlisted `dist/extension` tree. A release build with generated bundled dictionaries uses:

```bash
npm run build:extension:release
```

Never add tests, E2E fixtures, build scripts, docs, raw dictionary sources, source locks, benchmark corpora or import-security samples to the production allowlist just to make runtime tests pass.

## Provider changes

新增 Provider 必须明确：

- credential storage
- endpoint format
- Host Permission strategy
- cache fingerprint fields
- JSON response behavior
- tests

不要在 Content Script 中添加 Provider 分支。

## Site profiles

站点配置应尽量只存“覆盖值”，不要复制完整全局配置。

当前允许覆盖：

- Provider
- Model
- Prompt
- Target Language

新增站点配置字段时，需要确认它是否影响缓存 identity。

## Cache changes

缓存是用户数据。不要在无关 PR 中修改：

- DB version
- stores/indexes
- cache schema
- URL/text normalization
- Provider fingerprint

需要修改时必须增加兼容/迁移测试。

## Permissions

新增 required host permission 必须有明确理由。优先使用 optional host permission，并在用户操作时按 Origin 申请。

## Commits

使用聚焦的 conventional-style message，例如：

- `feat: add site translation profiles`
- `feat: add openai-compatible provider`
- `fix: preserve provider host permission`
- `refactor: isolate provider config resolution`

## Presets

- 内置 Preset 只放在 `src/shared/presets.js`，不要在 Popup/Options 复制 prompt 文本。
- Preset 不得包含 API Key、Provider 凭据或 endpoint。
- 临时模式必须使用 session 状态，不得写入永久用户配置。
- 新增/修改 Preset 必须覆盖 prompt precedence 与 cache identity 测试。
- Site Profile 自定义 Prompt 的优先级高于 Preset。

## Browser E2E

运行：

```bash
npm install
npx playwright install chromium
npm run build:extension:wxt
npm run test:e2e
```

约束：

- E2E/单测依赖只能放在 `devDependencies`，不得进入安装包；WXT 管构建，React 仅限批准的 Popup、Options、学习中心扩展页，不能进入 Background、Content、MAIN、Worker 或 shared。Options 的 Glossary / dictionary-packs 在 #252 前仍由单一 legacy adapter 挂载既有 controller，不复制词典业务。
- 使用 Playwright bundled Chromium 的 persistent context 加载 unpacked MV3 扩展。
- 不使用真实 Provider/API Key；统一走 `e2e/support/mock-server.mjs`。
- fixture 与 mock 必须确定性，缓存断言优先检查 Provider 调用次数，不用固定 sleep 猜测。
- 测试需要额外 Host Permission 时，只修改测试临时副本的 manifest，不扩大生产 manifest 权限。
- `npm run validate` 保持快速，不包含浏览器启动；`npm run test:e2e` 在本地按变更/任务要求单独运行；手动 Actions 只作备用。
- 新增核心用户流程时，优先在 E2E 中覆盖“成功、缓存命中、错误恢复”至少一个真实 MV3 路径。
