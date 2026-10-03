# [P1][Audit] fix local import commit semantics and MDD cancellation gaps

历史引用：[#227](https://github.com/CoderLambert/translateflow-plugin/issues/227)。2026-10-03 一次迁入；后续以本目录任务和本地证据为准。

## 流程迁移决策

下方是迁入的产品/工程合同。历史合同中的 Issue 评论/标签、远端 CI、自动 GitHub Review 和旧状态流不再是日常执行动作；统一采用 [LOCAL_WORKFLOW.md](../LOCAL_WORKFLOW.md) 的本地完整验收、真实浏览器/产物要求、具名独立审核及受保护代码同步。安全、数据、硬依赖与人工验收保持有效。原有“规划待启动”限制以用户本轮授权和 state.json 为准。

## Context

Code-level audit of current main `7bb36e60c41728cb7600c0dc8161ea1f56e21f55` found three correctness/performance gaps not covered by the existing release certification.

### 1. Local import commit-point cancellation race
`local-import-transaction.js` treats the pointer update as final, but `manager.cancel(requestId)` can still abort/report `cancelled: true` until cleanup finishes. MDict/StarDict controllers may then surface AbortError even though the new active pointer is already committed; TFLex can report successful commit after cancel returned true.

Required:
- introduce explicit non-cancellable commit-point semantics for generic local imports;
- make cancel report `cancelled:false, phase:commitpoint` after the pointer is committed;
- align MDict, StarDict and TFLex UI/controller behavior;
- add deterministic regression coverage around the commit/cleanup race.

### 2. Duplicate-dictionary protection fails open
`refreshInstalledCandidates()` uses `Promise.all`; failure of either installed-state query resets all candidates to `[]`. Import then proceeds as if no duplicate exists.

Required:
- track installed-state availability separately from an empty installed set;
- use per-source/all-settled refresh;
- fail closed for the relevant family when duplicate state cannot be verified;
- add tests for Rich/TFLex status read failures.

### 3. In-flight MDD resource reads are not cancellable
Selection teardown only removes queued MDD reads. Already dispatched `RICH_MDD_RESOURCE` work continues through OPFS/decode/base64 and can occupy the per-pack serialized queue.

Required:
- add request identity + narrow Selection-owner cancellation;
- propagate AbortSignal through MDD lookup/block/range reads;
- cancel running reads on Selection/resource-session close while preserving late-result invalidation;
- add unit/Chromium coverage proving no post-cancel range/decode work.

## Boundaries
- no parser capability expansion;
- no catalog/provider behavior changes;
- preserve local-only/privacy guarantees;
- preserve existing Rich lookup cancellation protocol semantics where reusable.

