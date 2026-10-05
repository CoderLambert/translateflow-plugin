# Reading Loop #229 audit

## Scope

Audit base: `origin/main` at `66cb7b876f8df4c8fea6eb645cb66cb101b6299a`. The local metadata preparation commit was `cf68b90ad5f595c14f413d13130a8fba8821f69e`; it is not a product-code candidate. This review separates historical PR evidence from the current local Selection cancellation correction.

The inspected Selection route is `selection-resolve` → `cache-lookup` → `translate-batch` when no cache hit exists → `cache-store` → current-selection check → result display and Reading record acceptance. The result and Reading record are published only after a successful store and a current task/page check. Dismissal and a changed selection locally invalidate the old task; the existing snapshot, request-version, source-revision, and page checks suppress late results.

## Finding: P2 Selection Stop raced cache commit

Before the correction, `Stop` always called `cancelTask`, which immediately changed the task to `cancelled` and displayed a cancelled message. Once `CACHE_STORE` had been sent, the background request could already be outside the translation cancellation registry. Storage could therefore commit while the content task was marked cancelled, suppressing the completed result and Reading artifact.

The deterministic test reproduced this on the unchanged implementation: it observed a committed cache write followed by task state `cancelled` instead of `completed`. The initial failing result is preserved in [acceptance-pre-fix.json](acceptance-pre-fix.json). This was a real race, not a rerun of PR #302 evidence.

The correction is Selection-only. At `storing`, the Stop control is disabled and its handler defensively ignores explicit Stop. Before storage begins, Stop still cancels. Dismissal, navigation, and replacement selection still cancel the old task locally. The old completion path now returns before updating a replaced task or publishing UI/Reading output. Cache errors, including quota failures, remain on the existing failure path. No rollback of an already committed cache write is claimed.

## Verification

The post-fix focused Selection test passes five cases: Stop during storage completes once; Stop before storage cancels; a replacement selection suppresses old completion and Stop callbacks; dismissal suppresses a late result after permitting the store commit; and quota failure remains visible. The targeted Reading E2E asserts the English UI selected by its fixture and includes a live English↔Chinese check of the page-history label. An earlier targeted run passed Reading return-location but timed out because the page-marker test expected the wrong English retry label; the test now uses the catalog's exact “Check location again” text.

Final code candidate `d530056d57ab3be64d05af0995a8a49aaf963079` is based on `66cb7b876f8df4c8fea6eb645cb66cb101b6299a` and was tested with Node `v24.21.0`, npm `11.19.0`, and Chromium `153.0.8010.12`.

| Candidate check | Result |
| --- | --- |
| `npm run validate` | PASS, 1,099/1,099 Node tests, typecheck, 9 Vitest files / 29 tests, and packaged build |
| Selection cancellation matrix | PASS, 5/5 |
| Reading return-location and page-markers E2E, including en↔zh marker label | PASS, 2/2 |
| WXT extension build | PASS, 189 files, 38,786,374 bytes |

The preceding candidate `8205dbcabdb81cf2fcee72a2fe4ac304be422607` failed `npm run validate` because the generated classic Reading projection was stale. That candidate's full evidence is preserved in `acceptance-candidate-8205.json`; earlier attempts are in `acceptance-pre-fix.json` and `acceptance-before-label-fix.json`. Exact `d530056` checks and command logs are in `acceptance.json`.

## Classic Reading projection diagnosis

The stale-projection test was rerun from an exact `git archive` of base `66cb7b876f8df4c8fea6eb645cb66cb101b6299a` (sharing only the installed `node_modules`): `node --test tests/reading-content-classic.test.mjs` passed 1/1. Therefore the base did not have this failure; it was introduced when the candidate changed a source imported by the classic projection. `scripts/reading-record-entry.mjs` imports `src/content/selection/controller.js`. The repository-owned `node scripts/reading-content-classic.mjs` generator changed only `src/content/reading-record.js`; `node scripts/reading-content-classic.mjs --check` then passed. Commit `d530056` contains only that generated file and records the base diagnosis in its commit message. The generated file was not hand-edited.

## Historical evidence kept distinct

PR #302 candidate `a3812cf06fd26f07963ed9536e446ff4615f5e97` passed Actions run `37255823698`. Final PR head `902cdacfe796c4067a2c1d325c927dfdd8b50138` removed only the temporary workflow; merge is `66cb7b876f8df4c8fea6eb645cb66cb101b6299a`. There was no independent post-merge CI run. Those results are historical and are not evidence for this Selection correction.

## State calibration noted

Local task state records already mark #248/#250/#251/#252 completed with merged PRs #284/#296/#298/#299. Prior GitHub review found their Issues still had stale working/blocked state. #253 was already closed externally; its local state was reconciled to completed with PR #302 and the merge head. #234–#244 are locally completed/implemented while their Issues remain open. No Issue labels or closure state were changed in this audit.

## Not run / post-merge close-out

PR [#303](https://github.com/CoderLambert/translateflow-plugin/pull/303) was merged by expected-head squash at `638e9c2e906072a87ed9f6b1d6228681f74928e5`; its source head was `dc383a6afef1c0ee7509d2a6afb8f76579d67fc6`. After one fetch, `origin/main` is `638e9c2e906072a87ed9f6b1d6228681f74928e5`, and its tree `345458ea5746544744477e865bd285f9b38e768b` matches the PR sync tree. The tested Selection product candidate remains `d530056d57ab3be64d05af0995a8a49aaf963079`; the latest PR head only adds task evidence/state files beyond that product candidate. No full A–D suite was rerun after #303.

The existing A–D acceptance records PASS for its scoped same-WXT-artifact Chromium 153 flows. The acceptance document explicitly leaves Firefox/Safari, incognito, real paid-model quality, real private dictionaries, desktop native IME, browser UI zoom, final file-dialog persistence, and store publication NOT_RUN or NOT_AUTHORIZED. The #229 contract says to avoid claims of broad support for unverified platforms/models/dictionaries. More importantly for Epic close-out, `docs/READING_LOOP_ACCEPTANCE.md` says the main-agent self-check is not an independent human review; `docs/tasks/229/task.md` requires independent audit before closing the Epic. Therefore #229 remains blocked for that review; this merge and the A–D PASS do not satisfy the independent-audit requirement by themselves.

Close-out for previously merged platform tasks (read-only GitHub check, no Issue mutation):

| Issue | Local task record / merged PR | Current Issue | Parent close-out action |
| --- | --- | --- | --- |
| #248 | completed; PR #284 candidate `e722652a1c5df3b73bb11c73602ab0b5534cc366`, merge `d5246cae6469e4a876fc122b229a2e0ddf115709` | open; stale `state:working` label | Verify PR/acceptance link, remove `state:working`, close as completed |
| #250 | completed; PR #296 candidate `20122c85e9a21ebdcd9ca475c66d3ca2eb037e76`, merge `47f5be76293a335ac6e11b7fae0ea5f0a01a1a99` | open; stale `blocked` label | Verify PR/acceptance link, remove `blocked`, close as completed |
| #251 | completed; PR #298 candidate `53041c66b1caddb3049bc6754c7c563e36ebc9a3`, merge `fc387587fe447d804ab031eb39a9882066b14918` | open; stale `blocked` label | Verify PR/acceptance link, remove `blocked`, close as completed |
| #252 | completed; PR #299 candidate `70ad25d89ffc859a1404cb0d062649d8d10872b0`, merge `29d4c2e6f08530d03352c06653db43942b88c2cc` | open; stale `blocked` label | Verify PR/acceptance link, remove `blocked`, close as completed |

No Issue labels or state were changed here. #253 remains locally completed from PR #302/merge `66cb7b8`; its Issue is already closed but has a stale `blocked` label, also untouched.

Real paid Provider calls, private dictionaries, and non-Chromium browser coverage remain NOT_RUN. `gh auth status` had reported invalid `GH_TOKEN`; it was not retried and no credentials were changed. The authorized GitHub connector was used for PR #303; no PR or Issue operation remains pending for the Selection code. Store publication, CSP changes, permission expansion, and credential configuration were not performed.

The runtime model and reasoning level are not observable from this environment and remain UNKNOWN.
