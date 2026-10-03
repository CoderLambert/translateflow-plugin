# Reading Loop Release A acceptance

Task [236](tasks/236/task.md) validates the shipped #234/#235 product on WXT `learning-center.html`. #235 is merged through PR #285 at `b606cfd556792d9764d0b15461b7a142fcd99575`; its main tree equals the locally validated sync tree. Exact Release A candidate, package fingerprint, command results and raw-evidence hashes belong to [236 acceptance.json](tasks/236/acceptance.json).

## Decision

**Local Release A candidate validation PASS; remote merge/Release A final recognition pending.** The previous physical extension-origin quota gap is resolved by reopening the complete browser/profile before applying the override. The renderer/worker-only restart did not reliably clear IndexedDB's bucket-space allowance cache. The Chromium 153.0.8010.12 implementation uses that allowance before asking the quota manager again; the source and controlled restart comparison support this diagnosis, without claiming direct observation of the private cache value.

The corrected native transaction refuses the same 512 KiB incompressible input with `QuotaExceededError`. A second native-quota stage runs the shipped trusted Selection collector and compiled Reading backend: actual `reading.begin-query` returns `READING_QUOTA`, the result card truthfully says not-saved, the old record remains, and restoring space plus explicit retry saves once with zero Provider calls. No `DOMException`/IDB prototype is injected in this native case. Existing native localhost and injected-boundary cases stay separately labelled.

The earlier full-run FAIL is retained under its original head/log. Since only this quota case and acceptance documentation changed, the unchanged production package and other PASS results are reused; the failed case is rerun at the new exact candidate. Consolidated coverage is 149 PASS / 0 unresolved FAIL / 6 SKIPPED, derived from the prior 148-PASS full run plus its passing replacement, **not a claim of a new complete 155-case run**. `READING_LOOP_A_PASS` and completed status await actual main integration and the project's final acceptance boundary.

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
| Physical quota | **PASS for extension origin after full browser/profile restart**: 512 KiB random native transaction aborts with `QuotaExceededError`; shipped collector/compiled Reading also returns actual `READING_QUOTA`, retains old rows and succeeds on explicit retry after restoring quota, with 0 Provider calls. Old read/export/delete remains usable. Earlier cache-affected FAIL, localhost engine and injected-boundary evidence keep their separate original labels. |
| Safety and interaction | Browser test verifies hostile saved script/image strings remain text, no remote image requests, Escape/focus return, browser composition-Enter guard, zh_CN/en snapshot invariance, dark/reduced-motion and CSS 200% zoom. Actual desktop IME and native browser zoom UI NOT RUN. |
| Real DOM performance | Ten samples use native `performance.now` around the shipped synchronous capture and completion promise on an ordinary fixture; normal input resolves position. A 1.1-million-character node has bounded context/fallback; dynamic replacement recovers. Raw samples, input size and measured timings are retained; simulated-clock slice tests are labelled separately. |

## Reproduction

Use the actual audited `.output/chrome-mv3` package; the test adapter verifies the copy before adding only synthetic lexical assets/localhost permission. It never supplies a missing product LC page/chunk. `e2e/reading-loop-release-a.spec.mjs` uses temporary profiles and the unchanged compiled background. Seed modules are added only for separately labelled corpus/probe cases. The physical quota database is disposable and contains random synthetic bytes only.

Run the frozen candidate's configured commands from `state.json`. The full E2E run included the required quota assertion. Its original failure log and trace are retained, and the repaired case keeps the refusal assertion plus native compiled-Reading checks. Only that changed case is rerun; tests/docs changes do not rebuild the unchanged production package. Product integrity is independently verified with the exact existing fingerprint.

User flow for a supported current Chrome: open an ordinary synthetic/public article → query a local word → open learning center from the invitation → explicitly enable → return to the still-valid card → Save this result → open LC recent/search/page/detail → restart Chrome → reread snapshot → pause/exclude/delete/export. Original-page links are page-level only. Precise revisit, automatic markers, new streaming assistant, SRS and further releases remain outside A.

## Limitations and next action

Chrome 102, other browsers, actual desktop IME, real paid model quality, file-dialog/disk save outcome and store release are not certified. Primary-agent self-check follows current LOCAL_WORKFLOW and is not an independent reviewer approval. Only actual protection/human acceptance applies outside this local process.

Physical quota now has native extension-origin refusal and product recovery evidence. No production budget/permission was changed, no host disk was filled, and no synthetic thrown error was substituted. Local readiness is not main delivery or store release: task 236 is ready_to_sync, with actual remote synchronization/merge still requiring authorization. The focus repair remains on the task branch until merged.

## Native quota diagnosis sources

The exact browser-version implementation is [BucketContext space checking and cache](https://chromium.googlesource.com/chromium/src/+/153.0.8010.12/content/browser/indexed_db/instance/bucket_context.cc) and [Transaction quota abort](https://chromium.googlesource.com/chromium/src/+/153.0.8010.12/content/browser/indexed_db/instance/transaction.cc). This change adjusts only the test's context lifecycle; it does not modify Chromium or extension storage policy.
