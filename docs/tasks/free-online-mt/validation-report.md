# Free online MT — candidate validation report

**Date:** 2026-10-19 UTC. **Status:** automated verification complete for tested source tree; **human acceptance pending**.

## Candidate identity
- Repository: `CoderLambert/translateflow-plugin`, Draft PR [#342](https://github.com/CoderLambert/translateflow-plugin/pull/342)
- Tested implementation commit: `c8742f9728e0b0dfbe00c910553ce0575fbe7c90`
- Exact Git tree: `ee64def47ff0c7e593b690a8907fa25f900c9928`
- Base verified: `main@1ddae0504a7478480253723d9f5fb43d13b77b88`
- Source commit excludes temporary push workflow and includes the legitimately rebuilt generated `src/content/reading-record.js`. CI tested the *same tree* using `git write-tree`; only subsequent task metadata is appended in the PR.

## Executed verification (GitHub hosted Ubuntu; Node 24.21.0; npm 11.19.0)

| Command / scope | Verdict | Evidence |
| --- | --- | --- |
| `node --test tests/machine-translation.test.mjs tests/machine-translation-selection-protection.test.mjs tests/selection-translation-query.test.mjs tests/cache-system.test.mjs tests/cache-system-review.test.mjs tests/cache-system-integration-review.test.mjs` | **PASS, 114/114** | [#39200177197](https://github.com/CoderLambert/translateflow-plugin/actions/runs/39200177197); reconfirmed [#39201493588](https://github.com/CoderLambert/translateflow-plugin/actions/runs/39201493588) |
| `npm run validate` (check / all Node / strict typecheck / Vitest / default WXT build) | **PASS**, Node 1872/1872, no failures | [#39201010519](https://github.com/CoderLambert/translateflow-plugin/actions/runs/39201010519), same validated tree |
| `npm run build:extension:wxt` | **PASS** | [#39201010519](https://github.com/CoderLambert/translateflow-plugin/actions/runs/39201010519), again [#39201493588](https://github.com/CoderLambert/translateflow-plugin/actions/runs/39201493588) |
| `TF_SMOKE_ARTIFACT=dist/extension npm run test:wxt:smoke` | **PASS**, budget advisory only | [#39201493588](https://github.com/CoderLambert/translateflow-plugin/actions/runs/39201493588) |
| `TF_SMOKE_ARTIFACT=.output/chrome-mv3 npm run test:wxt:smoke` | **PASS**, budget advisory only | same |
| `npm run test:e2e -- e2e/machine-translation.spec.mjs e2e/cache-system-mv3.spec.mjs e2e/cache-system-native.spec.mjs --workers=1 --retries=0` | **PASS, 13/13** actual Chromium compiled-extension/mock-MT transport; native DB4 19/19 subchecks | same, Chromium 153.0.8010.12 |

**Errors resolved during real validation:** check 420-line Quick Control limit; generated Reading legacy projection mismatch; temporary push workflow contrary to manual-only repository policy; smoke executed before browser installation. The temporary workflow was removed from the final tested source tree; no project-wide CI policy was weakened.

## Produced artifact

- CI bundle/report archive: [run #39201493588 artifact #12164102054](https://github.com/CoderLambert/translateflow-plugin/actions/runs/39201493588/artifacts/12164102054)
- ZIP SHA-256: `2a60ba6f7dd47c47c40840f1497d25beee94ba7852550baed9cc1d243132817c`
- E2E compiled artifact fingerprint SHA-256: `005ee1f2c295aa1dc2ec27cb726cc938e897160ba57bd181e2313b39ddc246a2` (129 files)
- No API credentials or private user content were used. E2E has synthetic provider HTTP responses only.

## Not verified / remaining acceptance conditions

| Check | Status |
| --- | --- |
| Actual Microsoft free web endpoint availability from user's browser/network | **NOT VERIFIED** (historical single success belongs to an older SHA) |
| Actual Tencent Transmart endpoint availability from user's browser/network | **BLOCKED / NOT VERIFIED** (older single `MT_NETWORK` without HTTP response; current not probed) |
| User installs this exact candidate and verifies Page/Selection, Settings, Popup, history/cache restore, code/URL protection, cancel/retry | **NOT RUN** |
| Full same-extension-ID old-package upgrade preserving user dictionary / Reading / configuration in actual Chromium | **NOT RUN** (DB4 native migration + compiled MV3 cache tested separately) |
| `scripts/local-task.mjs gate`, reproducible local acceptance receipts and physical user device evidence | **NOT RUN** |
| Merge and publication | **BLOCKED** pending user acceptance and above checks |

**At the time of this c8742f report:** provider network and user installation checks remained open. This turn was explicitly limited to local Mock testing; no real Microsoft/Tencent request was made. Any future real-service check requires a separate scope decision. Do not merge/publish/start M1–M3 from this historical report.

## 2026-10-19 local final verification after refreshed PR head

The remote PR branch was refreshed before verification and again afterward; both reads returned `198a50525b78516135aa5a0d59817a446d82f64d`. Base remained `main@1ddae0504a7478480253723d9f5fb43d13b77b88`. The production packages below were built from those commits. At test time, only the two E2E specs differed from the remote HEAD; the specs and task evidence/metadata are now modified locally. This is local evidence, not a frozen/committed candidate receipt.

Environment: Node `v24.22.0`, npm `11.19.0`, Chromium `153.0.8010.12`.

| Command / scope | Result |
| --- | --- |
| `npm ci` in main and PR worktrees | **PASS**; npm reported 2 dependency advisories (1 low, 1 high), not investigated in this task. |
| `node --test tests/machine-translation.test.mjs tests/machine-translation-selection-protection.test.mjs tests/selection-translation-query.test.mjs tests/cache-system.test.mjs tests/cache-system-review.test.mjs tests/cache-system-integration-review.test.mjs` | **PASS, 127/127**; includes URL/email/IPv4/IPv6/localhost/Git SSH protection, HTTP failures/cooldown, stalled cancellation, identity fencing and DB4 cache contracts. |
| `npm run check` | **PASS**; 778 JS/TS/TSX files and 1,146 locale keys. |
| `npm run build:extension:wxt` from main and PR worktrees | **PASS**. Main artifact: 128 files, 2,905,325 bytes, tree SHA-256 `649a05c8e11ce26e0faa52dce551216c1318d0b3f5ca141797736b6f357194a1`. PR artifact: 129 files, 2,947,518 bytes, tree SHA-256 `3d73082c2b838bf27362ebfcee1dfad380a036e1026d884c456ee9601f683d48`. Both report zero bundled lexicon bytes; builds emit the existing advisory size-budget warning. |
| `TF_TEST_WORKERS=1 npm run test:e2e -- e2e/machine-translation.spec.mjs e2e/cache-system-mv3.spec.mjs e2e/cache-system-native.spec.mjs --retries=0` | **PASS, 14/14** on the compiled PR WXT artifact; native DB4 Chromium subchecks **19/19**, database version 4. The updated MT spec was then rerun after adding Tencent Selection coverage: **7/7 PASS**. |
| `TF_DB4_OLD_ARTIFACT=... TF_DB4_NEW_ARTIFACT=... node scripts/verify-mt-db4-upgrade.mjs` | **PASS, 1/1** on separately built main and PR packages. Same extension ID `kbphcdibilabamhpjlogfhghmidfikoc`, isolated profile and unpacked path; DB4 entries/epochs and cache-only hit, Reading data, synthetic installed MDX/MDD files in OPFS, and settings survived replacement. Provider requests: 0; closed-network proxy forwarded outside the local mock: 0. |

The upgrade test initially exposed stale test assumptions (removed `#defaultProvider` controls and a Reading list request from Options rather than the authorized Learning Center). The fixture now seeds synthetic settings through `chrome.storage.local` and reads Reading from `learning-center.html`; the strict upgrade gate passes. The new MT navigation test also immediately handles the expected message-channel close before asserting transport abort. These were E2E fixture defects; no production source changed during this verification round.

Both artifacts are version `0.8.29`. The Chromium manager reloaded the new unpacked package at the same extension ID; **store-triggered automatic update remains NOT VERIFIED**. At the user's explicit boundary, Microsoft/Tencent transport was Mock-only and no real vendor request was made. The local task remains `working`; no commit, push, merge, or publication occurred.

`npm run validate`, full-project E2E, WXT smoke, `scripts/local-task.mjs gate`, real vendor transport and user-installed manual acceptance were **NOT RUN**. The selected scope used targeted tests, static checks, real WXT builds and the requested Chromium flows; the historical `c8742f` full validation is not claimed as evidence for this HEAD.

## 2026-10-19 final versioned staged snapshot recheck

After exact staging, `npm run commit:prepare` synchronized the staged snapshot and worktree version files to `0.8.30` and built `dist/extension/`. The repository hook in this worktree only runs `git diff --cached --check`; the explicit preparation command was used to satisfy the current task's versioned commit convention. No unstaged source changes were included.

| Command / scope | Result |
| --- | --- |
| `node --test tests/machine-translation.test.mjs tests/machine-translation-selection-protection.test.mjs tests/selection-translation-query.test.mjs tests/cache-system.test.mjs tests/cache-system-review.test.mjs tests/cache-system-integration-review.test.mjs` | **PASS, 127/127** on the final `0.8.30` worktree. |
| `npm run check` | **PASS**; 778 JS/TS/TSX files and 1,146 locale keys. |
| `npm run build:extension:wxt` | **PASS**; final package `0.8.30`, 129 files, 2,947,518 bytes, zero lexicon bytes, fingerprint `b455a1703e52637d80ade71edacdfa822b50693ca9f4049dea71ebe77ef19d20`. Existing platform-code advisory budget warning remains. |
| `TF_TEST_WORKERS=1 npm run test:e2e -- e2e/machine-translation.spec.mjs e2e/cache-system-mv3.spec.mjs e2e/cache-system-native.spec.mjs --retries=0` | **PASS, 14/14** on the final compiled WXT package; native DB4 Chromium subchecks **19/19**, DB version 4, Chromium `153.0.8010.12`. |
| `TF_DB4_OLD_ARTIFACT=/home/lambert/githubRepos/lambert/translateflow-plugin-pr342-main/.output/chrome-mv3 TF_DB4_NEW_ARTIFACT=.output/chrome-mv3 node scripts/verify-mt-db4-upgrade.mjs` | **PASS, 1/1**; main `0.8.29` artifact fingerprint `649a05c8e11ce26e0faa52dce551216c1318d0b3f5ca141797736b6f357194a1` → MT `0.8.30` artifact fingerprint above. Same extension ID, profile and unpacked path; DB4 cache, Reading, synthetic user dictionary and settings preserved; provider requests 0. Store-triggered update remains **NOT VERIFIED**. |

The browser tests used local Microsoft/Tencent mocks only. The closed proxy forwarded no outside traffic; Chromium attempted blocked browser control-plane connections, which are not attributed to the extension. `npm run validate`, full-project E2E, WXT smoke, local task gate, real vendor transport, user-installed manual acceptance and store auto-update were **NOT RUN / NOT VERIFIED**. Task state remains `working`; no completion, merge or publication is implied.
