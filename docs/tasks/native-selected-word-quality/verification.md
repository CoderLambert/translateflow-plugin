# Verification — native model completeness

Date: 2026-10-15. Parent: `81690dae770fb7ea01ad33b7ce87cd099dee19ba` (PR #339), based on main `7cc6002fb575ccbd2e11044defcb88de6be4b62c`.

## Executed against the actual modified source

```sh
node --test tests/native-*-completion.test.mjs \
  tests/native-models.test.mjs tests/native-selection-improvements.test.mjs
```

**83 PASS; 0 failed/cancelled/skipped.**

- Runtime:20; language evidence:15; preparation controller:9; Port broker/host/fallback:21.
- Existing model lifecycle:10; previous selected-word improvements:8.
- `node --check`:23 JS/MJS files PASS, including both locale modules and existing adapted fixtures.
- TypeScript5.8.3 `transpileModule`:2 changed TSX files PASS (syntax only).
- JavaScript declaration emission for the runtime/preparation/transport interfaces completed using the available TypeScript compiler; this is not the repository's full typecheck.

The tests exercise actual production functions with mocked Chrome native APIs and linked in-memory Port endpoints, not rewritten pseudocode. They cover sync dual create, matching detected language, empty output, shared creation/cancellation, capacity/deadlines, late cleanup, stream-only results, context conflicts, privacy, host/source/ownership checks, cancellation during asynchronous preference reads, corrupt session state, lost host fallback and prohibition on silent downloads.

The inherited PR #339 Chinese catalog had a missing comma after BROWSER_VERIFY_FAILED. It is fixed. Previous incomplete syntax checks must not be treated as proof that that older revision loaded correctly.

## Not executed

- Full repository `npm test`, `npm run validate`, locked TypeScript check, WXT build and versioned pre-commit build: NOT RUN.
- `tests/browser-translation.test.mjs` full execution: NOT RUN; its original assertions are retained and fixture injection is adapted to the shared runtime factory.
- React mounted component tests, Playwright E2E, actual Chrome models/downloads/offline/semantic quality: NOT RUN.

Execution environment: Node22.16.0/npm10.9.2 and globally available TypeScript5.8.3. The project requests Node24.21.x/npm11.19.x and its lockfile TypeScript/WXT dependencies. This working area is a source slice, not a full dependency-installed checkout; direct GitHub DNS access is unavailable, so repository access uses the connector. Do not describe the 83 tests as a full project/build/real-model acceptance.

## Product / architecture limits

- User-run Chrome acceptance owns real downloads, offline operation and semantic translation quality.
- Shared models live in the user-opened Options page. Closing it ends cross-tab sharing; fallback remains the original per-page execution environment. This is not Offscreen parity and does not promise permanent cross-origin model activation.
- Chrome-only modern APIs remain the target; no legacy experimental API adapter, franc-min corpus, separate model engine or change to page/subtitle/long-selection AI scope.
- No new permission, dependency, database schema or credential storage. Session preparation status contains only normalized language codes and timestamps.

At this original verification snapshot, PR #339 remained Draft because the actual repository typecheck and build had not run. Follow-up results for the updated candidate are recorded below.

## Follow-up — repository verification

Date: 2026-10-16. Candidate: `53b2b35473f94dc34f1214ceed9c54968fbf15e6` on PR #339, based on main `7cc6002fb575ccbd2e11044defcb88de6be4b62c`.

Executed in the repository checkout using Node v24.22.0 and npm 11.19.0:

| Command | Result |
| --- | --- |
| `npm run check` | PASS — 745 JS/TS/TSX files; 1,095 locale keys |
| `npm run typecheck` | PASS — WXT prepare and strict `tsc --noEmit` |
| `npm run build:extension` | PASS — WXT package at `dist/extension`, version 0.8.9, 128 files |

The build reports the existing platform-code advisory over budget by 533,585 bytes (2,110,180 / 1,576,595). The build still completes and audits the output. The 83 targeted tests recorded above cover the implementation before a follow-up JSDoc-only type contract fix; this follow-up did not alter runtime behavior. The final candidate's full repository unit suites, Playwright E2E and actual Chrome model/download/offline checks remain NOT RUN. Real model behavior and semantic quality remain for user acceptance as stated in the task contract.
