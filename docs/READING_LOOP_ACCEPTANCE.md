# Reading Loop Release A acceptance

Task [236](tasks/236/task.md) validates the shipped #234/#235 product on WXT `learning-center.html`. #235 is merged through PR #285 at `b606cfd556792d9764d0b15461b7a142fcd99575`; its main tree equals the locally validated sync tree. Exact Release A candidate, package fingerprint, command results and raw-evidence hashes belong to [236 acceptance.json](tasks/236/acceptance.json).

## Decision

**NO-GO / READING_LOOP_A_PASS is not recorded.** The current Chromium test environment accepts a quota override for the extension origin but still commits an incompressible native IndexedDB transaction above that quota. Therefore physical extension-origin `QuotaExceededError` recovery is **NOT VERIFIED**. The required browser assertion remains a failure; it is not skipped or weakened. The native localhost repository quota test and explicitly injected UI quota-error boundary are separate evidence and cannot replace this requirement.

This is an acceptance evidence gap, not a proved product data-loss defect. Current runtime/product and canonical-corpus results below remain useful; they are not relabelled as a complete Release A pass. No production permission, storage budget or test threshold was expanded. No store publication or later Reading task is authorized by this result.

## Evidence matrix

| Scope | Evidence and status |
| --- | --- |
| Real creation and restart | PASS in targeted actual-product story: unauthorised local lookup → fixed LC → trusted Enable → current-card explicit save; new-query automatic save, local hit/no-hit, explicit translation, cache hit and completed Explain. A full browser/profile restart preserves immutable snapshots/artifacts and lookup counts. This story uses no database seed. |
| Paid/upload boundary | PASS with local deterministic mock only: 0 Provider requests for local dictionary/no-hit/history; 1 explicit translation + 1 explicit Explain; translation requery uses cache. Removing test dictionary assets and Provider configuration, then going offline, does not prevent historical read or trigger resources. Real paid model quality NOT RUN. |
| Consent/refusal/native access | Existing actual Selection/Reading authority cases cover Not now, closed/changed/navigated card, trusted collector, cross-page/old document/private/sensitive/excluded and forbidden global authorization. They are separately labelled when native authority uses a synthetic repository. |
| Storage/commit/races | Existing native tests cover idempotent artifacts, late Rich, two tabs, lost ACK, transaction abort, pause/delete/clear ordering, receipts and exact byte billing. These source-probe cases are not falsely presented as React creation. |
| Lists/detail | Product uses 30-item backend summaries, no row get-record requests. #235 covers recent/page/search, distinct contexts, invalid/deleted deep links and delayed-read discard. #236 real restart opens saved full answers/source, while a labelled native-row corpus exercises capacity. |
| Near-budget export | Actual compiled product UI exports >62 MiB canonical rows through one sequential next at a time. Every full response is checked against 1 MiB, contiguous sequence, exact UTF-8 chunk/file totals and all downloaded record/source/artifact references. Unicode, quotes, slash escaping and newlines round-trip. This large-input corpus is explicitly seeded and supplements real creation. |
| Export termination | Actual product worker is stopped with CDP while a delivered chunk is held. Restricted port disconnect aborts the UI export; reconnect restores reading; no partial download occurs. Page exit revokes the owned export. #235 covers user cancel, cross-tab content changes and successful finish/cancel ordering. |
| Capacity and delete | Canonical 10,000-row corpus produces the real capacity message. Actual UI deletion restores 9,999 rows without changing enabled consent. Existing native probes verify cache/OPFS/exclusion separation and exact bytes/orphans. |
| Physical quota | **FAIL / NOT VERIFIED for extension origin**: override acknowledged, quota active, 512 KiB random native transaction nevertheless commits. Actual old Reading read/export/delete remains usable. Localhost native-IDB refusal PASS and an injected `QuotaExceededError` UI boundary (truthful not-saved → explicit storage-only retry) PASS are separate. |
| Safety and interaction | Browser test verifies hostile saved script/image strings remain text, no remote image requests, Escape/focus return, browser composition-Enter guard, zh_CN/en snapshot invariance, dark/reduced-motion and CSS 200% zoom. Actual desktop IME and native browser zoom UI NOT RUN. |
| Real DOM performance | Ten samples use native `performance.now` around the shipped synchronous capture and completion promise on an ordinary fixture; normal input resolves position. A 1.1-million-character node has bounded context/fallback; dynamic replacement recovers. Raw samples, input size and measured timings are retained; simulated-clock slice tests are labelled separately. |

## Reproduction

Use the actual audited `.output/chrome-mv3` package; the test adapter verifies the copy before adding only synthetic lexical assets/localhost permission. It never supplies a missing product LC page/chunk. `e2e/reading-loop-release-a.spec.mjs` uses temporary profiles and the unchanged compiled background. Seed modules are added only for separately labelled corpus/probe cases. The physical quota database is disposable and contains random synthetic bytes only.

Run the frozen candidate's configured commands from `state.json`. The full E2E run includes the required quota assertion. A failed run must retain its logs and trace and must not generate `READING_LOOP_A_PASS`. Source tests and fixture changes do not require rebuilding unchanged production inputs; copied #235 package integrity is independently verified.

User flow for a supported current Chrome: open an ordinary synthetic/public article → query a local word → open learning center from the invitation → explicitly enable → return to the still-valid card → Save this result → open LC recent/search/page/detail → restart Chrome → reread snapshot → pause/exclude/delete/export. Original-page links are page-level only. Precise revisit, automatic markers, new streaming assistant, SRS and further releases remain outside A.

## Limitations and next action

Chrome 102, other browsers, actual desktop IME, real paid model quality, file-dialog/disk save outcome and store release are not certified. Primary-agent self-check follows current LOCAL_WORKFLOW and is not an independent reviewer approval. Only actual protection/human acceptance applies outside this local process.

Physical quota must be verified with a supported native extension-origin refusal mechanism or an explicitly reviewed acceptance decision about this environmental gap. Do not fill the host filesystem, broaden permissions, reset user data or substitute a forged error for native refusal. Until then task 236 cannot be marked Release A passed/completed.
