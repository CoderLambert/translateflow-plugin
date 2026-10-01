# TranslateFlow agent instructions

This file contains repository-wide invariants for coding agents. Keep task-specific scope in GitHub Issues and reusable specialist workflows in `.agents/skills/`.

## Sources of truth

Use each source for a different purpose:

- GitHub Issue: current problem, scope, dependencies, acceptance criteria, and non-goals.
- `AGENTS.md`: repository-wide invariants that apply across tasks.
- `docs/ARCHITECTURE.md`: runtime dependency direction and hard architectural boundaries.
- `docs/LEXICAL_DATA_BOUNDARIES.md`: normative policy for dictionary data, lexical sources, and package boundaries.
- `docs/PROVIDERS.md`: provider configuration, permission, and cache-identity rules.
- `.agents/skills/**/SKILL.md`: reusable workflows for specialized work.
- Code and tests: current implementation behavior.

If these disagree, do not silently choose one. Preserve repository invariants, avoid expanding the Issue scope, and surface the mismatch in the PR or task report.

## Repository invariants

1. The production extension is Chrome Manifest V3.
2. Runtime code stays build-free and keeps zero third-party runtime dependencies unless a separately approved migration changes that policy.
3. `src/shared/` must stay free of `chrome.*`.
4. External HTTP belongs in `src/background/providers/`, except narrowly documented extension-package reads.
5. IndexedDB access belongs in `src/background/cache-db.js`.
6. Dynamic content-script registration belongs in `src/background/auto-sites.js`.
7. Root `background.js` and `content.js` remain thin composition/bootstrap entrypoints.
8. Runtime message values stay centralized.
9. Permissions are part of the product/security API. Do not broaden required or optional permissions as a convenience.
10. Provider calls and cache reads/writes must use the same Effective Translation Config.
11. Migration-sensitive storage, cache, normalization, provider-identity, and message-contract changes require explicit compatibility analysis.
12. Production packaging is allowlist-based. Tests, E2E fixtures, build inputs, source locks, research corpora, and private dictionary material must not leak into `dist/extension`.
13. Lexical work follows: **Source-driven data → Rule-driven retrieval → Context-driven ranking → User-driven AI**.
14. Project-authored word/translation rows and query-specific sense hacks are not a coverage strategy.
15. AI dictionary detail is explicit user action and never becomes authoritative local lexical data.
16. User-owned local dictionary inspection/lookup remains local-only unless an Issue explicitly defines another reviewed behavior.

## Working rules

- Read only the task-relevant canonical docs; do not load every document for every change.
- Inspect current implementation and tests before changing an established contract.
- Do not redesign neighboring systems merely because the current task exposes technical debt.
- Prefer extending an existing state/config/lifecycle model over creating a parallel one.
- Treat accessibility, cancellation, stale-result rejection, error isolation, and recovery as product behavior, not polish.
- Keep user-visible terminology product-oriented; do not expose OPFS/parser/worker internals in normal UX.
- Never add proprietary or user-owned dictionary bytes to the repository, CI artifacts, or release package.
- Do not weaken validation just to make a task pass.

## Skills

Use a relevant project skill when the task matches it:

- `translateflow-product-design`: feature definition, UX/state-flow design, Issue shaping.
- `translateflow-benchmark-research`: competitor/open-source product and architecture research.
- `translateflow-extension-engineering`: MV3 runtime, permissions, messaging, storage, translation/provider work.
- `translateflow-dictionary-engineering`: lexical pipeline, TFLex, MDict/MDD, StarDict, OPFS, catalog/import/viewer work.
- `translateflow-pr-audit`: independent implementation review against exact Issue scope and repository invariants.
- `translateflow-release-certification`: release-scope freeze, evidence mapping, E2E/security/package certification.

Do not force a skill when the task is a trivial edit outside its workflow.

## Validation defaults

For code changes, start with:

```bash
npm run validate
```

Add the narrowest relevant deeper validation:

- user-facing browser/runtime flow: `npm run test:e2e`
- release package boundary: `npm run build:extension:release`
- dictionary/lexical changes: run the specific benchmark, security, projection, or certification scripts defined by the affected subsystem and Issue
- release certification: follow `translateflow-release-certification`

Do not claim a check passed unless it was actually run and completed successfully.

## Completion standard

A completed task should have:

- implementation limited to the agreed scope;
- relevant tests/regressions;
- documentation updated when a contract or operator workflow changes;
- no unexplained permission, storage, cache, package, or network-boundary changes;
- a concise PR/task summary describing behavior, validation performed, and remaining known limitations.
