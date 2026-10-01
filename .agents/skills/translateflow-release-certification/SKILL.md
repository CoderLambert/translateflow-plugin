---
name: translateflow-release-certification
description: Certify a TranslateFlow milestone or release by freezing shipped scope, mapping acceptance criteria to evidence, closing only release-critical gaps, validating browser/security/privacy/package boundaries, and verifying the exact merge result. Use for release-gate Issues, not ordinary feature development.
---

# TranslateFlow release certification

## Principle

Certification verifies **what actually shipped**. It does not expand the release merely to make every planned Issue non-empty.

## Freeze scope first

Before adding tests or code:

1. refresh main, open PRs, blocking/open Issues, and current release dependencies;
2. record required shipped capabilities;
3. record conditional/optional capabilities that actually shipped;
4. record intentionally absent capabilities;
5. reject runtime/UI claims that exceed the frozen scope.

## Build an evidence map

Map every acceptance item to existing evidence:

- unit/integration tests;
- Chromium E2E;
- security tests;
- benchmark/corpus/certification reports;
- package inspection;
- source/provenance evidence;
- manual/local evidence when it cannot lawfully or technically live in CI.

Produce a gap report before writing new tests. Add only missing release-critical coverage.

## Required gate dimensions

Apply those relevant to the release:

- functional journeys and recovery;
- accessibility, narrow viewport, dark mode, reduced motion;
- permission/network/privacy behavior;
- storage/cache/message migration;
- cancellation/stale-result/concurrency behavior;
- dictionary/parser/viewer security;
- provenance/license/trust/freshness semantics;
- realistic performance regression ceilings based on measurement;
- production allowlist and artifact-content boundary;
- absence of proprietary/user/private validation data;
- zero unintended Provider/AI/network behavior.

## Validation sequence

Use the current release Issue as the exact command/evidence contract. At minimum:

```bash
npm run validate
```

Then run relevant Chromium E2E, subsystem security/certification scripts, and production release build/package checks.

Do not claim compatibility or source support beyond the evidence actually exercised.

## Independent final audit

Before merge:

- audit the exact PR head independently;
- ensure required checks pass on that head;
- resolve review threads;
- verify mergeability/main freshness according to the release Issue;
- ensure the frozen scope still matches the final diff.

After merge, observe main CI and record the merged commit/evidence.

## Failure behavior

A failed gate blocks certification; it does not justify weakening the criterion.

If a conditional capability/source did not pass its own qualification gate, certify it as absent rather than forcing it into the release.
