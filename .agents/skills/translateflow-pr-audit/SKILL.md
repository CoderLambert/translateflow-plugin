---
name: translateflow-pr-audit
description: Independently audit a TranslateFlow pull request or completed Issue against its exact scope, architecture, product behavior, security/privacy boundaries, tests, and release impact. Use after implementation and before merge; combine with the relevant domain Skill.
---

# TranslateFlow PR audit

## Independence

Review the exact PR head as an independent verifier. Do not treat the implementer's summary or self-review as evidence.

Refresh:

- Issue/Epic scope and dependencies;
- PR head/base and changed files;
- relevant canonical docs;
- tests and CI results;
- current main when merge-base freshness matters.

Use the relevant domain Skill for dictionary or extension-specific review.

## Review order

1. **Scope correctness** — does the diff implement the Issue and avoid unrelated redesign?
2. **Product behavior** — happy path, no-hit/empty, failure, recovery, cancellation, persistence, accessibility.
3. **Architecture** — ownership, dependency direction, duplicate state models, migration-sensitive contracts.
4. **Security/privacy** — permissions, network, untrusted content, local-only contracts, secret/data exposure.
5. **Correctness/concurrency** — stale results, races, retry, abort, lifecycle transitions.
6. **Compatibility** — cache/storage/config/message migration and backward behavior.
7. **Tests/evidence** — do tests prove the acceptance criteria rather than only implementation details?
8. **Packaging** — no test/source/private/proprietary assets leak into production.
9. **Maintainability** — only concrete risk-bearing complexity, not stylistic preference.

## Findings

Report findings first, ordered by severity.

Each finding should contain:

- severity;
- file/area;
- concrete behavior or failure mode;
- why it violates the Issue/contract or creates risk;
- minimal corrective direction;
- missing regression test when relevant.

Do not request changes for personal style when existing conventions are satisfied.

If no blocking findings remain, explicitly state the checks/evidence reviewed and any residual risk or unverified environment dependency.

## Merge readiness

Do not mark work ready merely because CI is green.

Before a release-critical merge, confirm as applicable:

- acceptance criteria have evidence;
- required checks passed on the exact head;
- review threads are resolved;
- branch is not unexpectedly behind main;
- no hidden scope expansion;
- no unresolved security/privacy/package concern.

Do not merge as part of an audit unless the task explicitly authorizes merge.
