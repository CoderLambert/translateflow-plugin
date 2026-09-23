---
name: Agent development task
about: Define an implementation task that can move through the Agent development and audit workflow
title: ""
labels: ""
assignees: ""
---

## Goal

<!-- State the user/product outcome, not only the code change. -->

## Dependencies

<!-- List hard dependencies by Issue number. Use `None` when there are no hard dependencies. -->

- None

> Label rule: use `blocked` while any hard dependency is unresolved. Use `agent-ready` only after every hard dependency is merged into `main`. Never apply both labels at once.

## Scope

- 

## Architecture constraints

- 

## Acceptance criteria

- [ ] 

## Verification

Automated:
- [ ] `npm run validate`
- [ ] Applicable unit/integration tests
- [ ] `npm run test:e2e` when Chrome/MV3/DOM/user-flow behavior changes

Manual (when applicable):
- [ ] 

## Non-goals

- 

## Functional labels

<!-- Add at least one area/type label, e.g. area:youtube, area:ui-ux, type:foundation, plus priority/release labels when applicable. -->

## Agent workflow

When this Issue is `agent-ready`:

1. Refresh `main`, dependencies, open PRs and Issue state; do not duplicate active work.
2. Create a dedicated branch from current `main`.
3. Comment with branch name + implementation plan.
4. Replace stale execution state with `state:working` before code changes.
5. Keep meaningful architecture, compatibility, risk and test findings synchronized here during development.
6. Run required validation/E2E.
7. Open a PR targeting `main` with `Closes #<this issue>`.
8. Merge only after required CI is green.
9. Record the merged PR/commit/test results here, replace `state:working` with `state:implemented`, and unblock dependents that now satisfy every hard dependency.

After implementation, a separate audit moves the task through `state:auditing` to either `state:audited` or the `state:changes-requested` → `state:improving` → `state:improved` re-audit loop.
