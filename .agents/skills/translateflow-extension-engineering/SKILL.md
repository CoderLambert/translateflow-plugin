---
name: translateflow-extension-engineering
description: Implement or review TranslateFlow Chrome MV3 runtime changes involving content/background messaging, permissions, providers, effective config, cache/storage, translation tasks, YouTube, or extension packaging. Use for normal extension engineering outside dictionary-specialist work.
---

# TranslateFlow extension engineering

## Read the governing contract

Use:

- current GitHub Issue for scope and acceptance;
- `AGENTS.md` for repository invariants;
- `docs/ARCHITECTURE.md` for dependency boundaries;
- `docs/PROVIDERS.md` for provider/config/cache rules when relevant;
- current tests for behavioral compatibility.

## Preserve runtime boundaries

Do not bypass established ownership:

- shared code stays free of `chrome.*`;
- external Provider HTTP stays in Background provider code;
- Content does not own retry/backoff/provider policy;
- IndexedDB access stays behind the existing cache boundary;
- permissions are explicit product/security behavior;
- root entrypoints stay thin;
- Content Script loading remains compatible with the build-free classic-script architecture;
- effective translation config used for network and cache must remain identical.

Treat message values, storage shapes, cache identity, URL/text normalization, Provider identity, and endpoint fingerprinting as migration-sensitive.

## Implementation workflow

1. Identify the existing owner of the behavior/state.
2. Extend that owner rather than creating a parallel mechanism.
3. Trace failure, cancel, retry, stale result, reload, and permission-revocation paths.
4. Verify privacy/network impact.
5. Add regression coverage at the lowest useful layer.
6. Add Chromium E2E for user-visible cross-context behavior.
7. Check release-package impact.

Avoid unrelated refactors and do not weaken architectural checks.

## Security/product checks

For relevant changes verify:

- no model-produced HTML reaches unsafe rendering;
- page-world bridges expose no privileged extension operations;
- optional host permissions remain origin-scoped and user-triggered;
- cache identity changes cannot cross-contaminate providers/configurations;
- cancellation prevents stale or incomplete writes;
- automatic behavior cannot unexpectedly trigger Provider calls where a cache-only/local-only contract exists.

## Validation

Run:

```bash
npm run validate
```

For user-visible runtime changes also run the relevant Playwright coverage, normally:

```bash
npm run test:e2e
```

Use `npm run build:extension:release` when package/runtime-asset boundaries are affected.

Report exactly which checks ran.
