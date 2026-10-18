# Candidate verification

## Executed

- `node --test tests/native-*.test.mjs`: **40 PASS**, 0 failed, 0 skipped, 0 cancelled. Tests cover language evidence, candidate validation, Chinese refinement, source priority, model creation/reuse/cancellation, grouped native cache routing, worker-snapshot recovery, page/selection skip behavior, preparation interaction and bilingual strings.
- `node --check` on each delivered `.js` / `.mjs` file: **PASS**.
- User source is pinned to remote main `0ebd54fa9397ce76cf3d1bfe217522cc13f36550`. The work area contains the changed-source slice, not a full checkout.

First unit run exposed a missing Traditional Chinese discriminator; this was corrected and re-run. Adding strict request ownership exposed a missing requestId in the subtitle store call; the implementation was fixed and its affected tests re-run. Final result above refers to the final candidate, not the earlier runs.

## Not executed

- Existing full repository test suite / `npm run validate`: **NOT RUN**. `tests/browser-translation.test.mjs` fixtures were adapted to the new source-decision and content-plan contracts; its unrelated config/cache regression assertions were retained.
- WXT build, TypeScript project check, repository versioned pre-commit build: **NOT RUN**.
- Playwright E2E, actual LanguageDetector/Translator downloads, real translation quality or offline acceptance: **NOT RUN**, intentionally reserved for the user's product acceptance / later functional-test authorization.

Environment: Node **22.16.0**, whereas this repository specifies Node **24.21.x** and npm **11.19.x**. The executed tests use Node built-ins and actual changed JS modules with mock browser APIs. The container cannot resolve GitHub or download dependencies; repository reads/writes use the GitHub connector. Do not describe these checks as a full production-runtime or built-artifact validation.

No production permission, database schema, API credential, Provider protocol, version or generated package was changed. This is a source-only Draft candidate; do not merge/release or claim the repository's automatic version/build hook has run.

## Commands for the existing local checkout (not run here)

```sh
node --test tests/browser-translation.test.mjs tests/native-*.test.mjs
```

The current request does not authorize a new E2E campaign. Actual product acceptance remains the user's next step after building/loading their checkout.
