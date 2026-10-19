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

**Next:** user-confirmed real provider check using built-in public test sentence only, one attempt per provider, plus candidate installation/UX verification; if Tencent remains unavailable, request explicit scope decision. Until then remain Draft/reviewing; do not merge/publish/start M1–M3.
