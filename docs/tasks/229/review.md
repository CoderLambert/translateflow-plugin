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

## Not run / handoff

Real paid Provider calls, private dictionaries, and Edge/Safari coverage were not run. `gh auth status` reported the active `GH_TOKEN` invalid; it was not retried and no credentials were changed. The connected GitHub app independently confirmed `main` at exact base `66cb7b876f8df4c8fea6eb645cb66cb101b6299a`, found no open PRs or same-name branch before sync, and created draft PR [#303](https://github.com/CoderLambert/translateflow-plugin/pull/303) from `audit/229-state-calibration-20261005`. Its initial tree matched the local candidate handoff tree. No Issue labels or closure state were changed. The PR remains a draft; no merge, store publication, CSP change, permission expansion, or credential configuration was performed.

The runtime model and reasoning level are not observable from this environment and remain unknown.

## 合并后状态校准（2026-10-09）

PR #303 已合入 `main`，merge commit 为 `638e9c2e906072a87ed9f6b1d6228681f74928e5`。旧 Draft PR #304 只记录该合并事实和人工审计缺口，其内容由本次最新 main 上的状态校准取代。Epic #229 仍缺合同要求的独立人工审计，因此不标 completed。
