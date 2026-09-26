# Contributing to TranslateFlow

## Required validation

提交前：

```bash
npm run validate
```

项目没有第三方 npm 运行依赖；校验使用 Node 内置能力。

涉及真实 Chrome/MV3/DOM/交互行为的改动还应运行适用的浏览器 E2E：

```bash
npm run test:e2e
```

## Issue-driven development workflow

TranslateFlow 的开发任务以 GitHub Issue 为执行单元。开始编码前，Issue 必须足够具体，至少包含：

- Goal / Scope
- Dependencies
- Architecture constraints
- Acceptance criteria
- Verification / test requirements
- Non-goals（适用时）

每个可执行任务还应带至少一个功能区域或类型 label（例如 `area:youtube`、`area:ui-ux`、`type:foundation`）以及适用的优先级 label。

### Scheduling labels

- `agent-ready`：规格已明确，所有硬依赖已满足，可以立即从当前 `main` 开发。
- `blocked`：至少一个硬依赖尚未合入 `main`，当前不得开始实现。

同一个 Issue 不得同时拥有 `agent-ready` 和 `blocked`。当最后一个硬依赖合入后，删除 `blocked` 并添加 `agent-ready`。

### Execution state labels

执行状态使用以下互斥状态：

- `state:working`：正在开发。
- `state:implemented`：实现 PR 已合入 `main`，等待审核。
- `state:auditing`：正在审核已合入实现。
- `state:audited`：审核通过。
- `state:changes-requested`：审核发现明确问题，需要修改。
- `state:improving`：正在处理审核后的修改。
- `state:improved`：修改 PR 已合入 `main`，等待重新审核。

不要用执行状态替代调度状态：`agent-ready` / `blocked` 只描述“能否开始”，`state:*` 描述当前执行阶段。

### Starting an Agent task

1. 再次读取 Issue、依赖、open PR 和当前 `main`，避免重复开发。
2. 从最新 `main` 创建独立 branch。
3. 在 Issue 评论中记录 branch 名称和 Implementation Plan。
4. 真正修改代码前设置 `state:working`，并移除过期的执行状态 label。
5. 不得领取 `blocked`、`state:working`、`state:auditing` 或 `state:improving` 的 Issue。

### Development log

开发过程中的重要结果必须同步回 Issue，而不是只在 PR 结束时总结。至少记录适用的：

- architecture / data-model decisions
- scope adjustments
- compatibility findings
- permission / privacy changes
- cache identity or migration implications
- discovered risks or blockers
- meaningful validation / E2E results

### Pull request and completion

1. 完成 Issue acceptance criteria。
2. 运行 `npm run validate` 和适用的 `npm run test:e2e`。
3. PR 必须以 `main` 为 base，并在 body 中包含 `Closes #<issue>`。
4. PR 说明 What changed、Architecture decisions / compatibility、Verification。
5. Required CI 未通过时不得 merge。
6. 使用仓库约定的 squash merge 合入 `main`。
7. 在 Issue 中记录最终 PR、merged commit、测试/CI 结果和 remaining risks。
8. 删除 `state:working`，添加 `state:implemented`；由后续审核决定是否进入 `state:audited`。
9. 检查依赖该 Issue 的任务：当所有硬依赖都已合入时，将其从 `blocked` 转为 `agent-ready`。

`Closes #<issue>` 由 PR merge 关闭 Issue；“Issue 关闭”和“审核通过”是两个独立事实，因此已关闭 Issue仍可继续使用 `state:implemented` / `state:auditing` / `state:audited`。

### Audit and improvement loop

审核开始时将待审任务置为 `state:auditing`，并按 Issue acceptance criteria、架构边界、权限/隐私、缓存/配置兼容性、UI/UX、测试/E2E、文档以及实际 `main` diff 进行检查。

- 通过：删除 `state:auditing`，添加 `state:audited`。
- 发现问题：删除 `state:auditing`，添加 `state:changes-requested`，并在 Issue 中列出可执行的修改项。
- 开始修复：设置 `state:improving`，从最新 `main` 建修复 branch；不要与 `state:working` 的开发者并发修改同一任务。
- 修复 PR 合入：删除 `state:improving` / `state:changes-requested`，添加 `state:improved`。
- `state:improved` 必须再次审核，只有重新通过后才能成为 `state:audited`。

## Module ownership

- shared contracts/pure helpers: `src/shared/`
- Provider/network: `src/background/providers/`
- effective config: `src/background/config.js` + `src/shared/provider-config.js`
- IndexedDB: `src/background/cache-db.js`
- dynamic site scripts: `src/background/auto-sites.js`
- DOM extraction/render: `src/content/dom.js`
- batching: `src/content/batch.js`
- cache-first orchestration: `src/content/processor.js`
- observers/auto queue: `src/content/auto.js`

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
npm run test:e2e
```

约束：

- E2E 依赖只能放在 `devDependencies`；扩展生产运行时继续保持零第三方依赖、零打包。
- 使用 Playwright bundled Chromium 的 persistent context 加载 unpacked MV3 扩展。
- 不使用真实 Provider/API Key；统一走 `e2e/support/mock-server.mjs`。
- fixture 与 mock 必须确定性，缓存断言优先检查 Provider 调用次数，不用固定 sleep 猜测。
- 测试需要额外 Host Permission 时，只修改测试临时副本的 manifest，不扩大生产 manifest 权限。
- `npm run validate` 保持快速，不包含浏览器启动；`npm run test:e2e` 由独立 CI workflow 运行。
- 新增核心用户流程时，优先在 E2E 中覆盖“成功、缓存命中、错误恢复”至少一个真实 MV3 路径。
