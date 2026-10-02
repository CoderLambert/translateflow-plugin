# PF-00 execution evidence

Baseline: `main@6c9347db79c538b2660e9009847ce362a3578261`, inspected 2026-10-02. Working branch: `docs/245-platform-upgrade-contract`. Production source and root dependencies were not modified. No paid Provider or real user profile/data was used.

The isolated project and raw logs are at `/tmp/translateflow-release-a-20261002/pf245-experiment/`; these paths are local, temporary artifacts. The committed inventory/toolchain/build/browser JSON and experiment lock preserve the reviewable evidence when that directory is removed.

## Executed commands and results

| Working directory | Command | Result and evidence |
| --- | --- | --- |
| Task worktree | `npm run validate` before document edits | **PASS**, exit 0; source check, 651 Node tests / 651 pass / 0 fail, old build 221 files / 1,433,269 B / lexical 0 B. Raw log `logs/baseline-validate.log`. |
| Task worktree | `node docs/platform-upgrade-v1/prepare-experiment.mjs . /tmp/translateflow-release-a-20261002/pf245-experiment` | **PASS**, exit 0 after preparation-script correction; 176 exact bridge files, 97 background source files, 6 module Worker roots. |
| Experiment | `npm install --no-audit --no-fund --fetch-retries=0 --fetch-timeout=20000` | **FAIL**, exit 1; `ERESOLVE`, `vite@undefined`, following metadata connection failures. This did not prove a package peer incompatibility. Raw log `logs/install.log`. No force/legacy-peer retry. |
| Experiment | `timeout --signal=TERM --kill-after=5s 120s npm install --no-audit --no-fund --no-update-notifier --prefer-offline --fetch-retries=0 --fetch-timeout=15000 --loglevel=http` | **PASS**, exit 0; 191 packages in 41 s. Metadata requests recovered; global npm config was unchanged. Raw log `logs/install-retry.log`. |
| Experiment | `npm ls --depth=0` | **PASS**, exit 0; all 12 direct dependencies at the exact versions in toolchain.json, no peer/engine error. |
| Experiment | `npm run prepare` | **PASS**, exit 0; WXT generated types. Raw log `logs/prepare.log`. |
| Experiment | `npm run build` | **PASS**, exit 0; WXT 0.21.4, Vite 7.3.1, Chrome MV3 production output in `.output/chrome-mv3`. Initial build 2.741 s; final dependency-audit build 3.169 s. Raw logs `logs/build.log`, `logs/build-final.log`. |
| Experiment | `npm run typecheck` | **PASS**, exit 0; TypeScript 5.9.3 `tsc --noEmit`. Raw log `logs/typecheck.log`. Legacy JS is `allowJs`, not whole-repository checkJs migration. |
| Experiment | `npm test` | **PASS**, exit 0; Vitest 5.0.3, one TS test file / 2 tests. These exercise existing pure text/schema/injection-list contracts, not product acceptance. Raw log `logs/vitest.log`. |
| Task worktree | `node docs/platform-upgrade-v1/browser-smoke.mjs /tmp/translateflow-release-a-20261002/pf245-experiment` first attempt | **FAIL**, exit 1; the probe wrongly assumed every Worker error type ended `_ERROR`. Existing ECDICT protocol is exactly `curated-ecdict-mdx:error`. Raw log `logs/browser-smoke.log`. |
| Task worktree | Same browser-smoke command after correction | **PASS**, exit 0; exact existing per-Worker error values and requestId asserted. Chromium 153.0.8010.12, generated Manifest deep-equal to baseline, Popup/Options/background message/6 module Worker rejection responses/React mount successful, zero page errors and external HTTP requests. Raw log `logs/browser-smoke-final.log`; browser-report.json. |

The preparation script initially followed every HTML `href`, including a notice link to absent generated lexicon content. It failed before installing anything. It was corrected to follow only executable `<script>`/`<link>` dependency paths; generated lexicon assets remain a separate explicit release contract. The browser probe was corrected to assert each existing protocol value exactly; no product code or existing test assertion was weakened.

npm 11 reported esbuild's postinstall as unapproved. The optional platform binary already supported all successful build/test commands, so no global or package-level approval change was needed. The initial WXT config also redundantly set `manifest_version`; the final preparation script uses explicit `--mv3` and removes that ignored config field.

## Actual artifact and size evidence

`experiment-report.json` is from the final WXT output and Rollup module audit, not the old builder. Baseline files are independently hashed in baseline-inventory.json.

- Old development package: **1,433,269 B**, 221 files, no generated lexicon.
- Frozen non-dictionary platform budget: **1,576,595 B**.
- WXT platform code: **1,488,230 B**, +54,961 B: **PASS**.
- Separate React probe UI closure: **222,939 B**; complete probe package **1,711,169 B**.
- Background: **306,171 B**, 99 modules, zero React modules.
- Content ordered 44-file set plus style: **305,486 B**; MAIN three-file set: **30,190 B**. This is static byte cost, not a timing benchmark.
- No actual dictionary release assets were generated or certified. Their measured byte count is zero, not a claim that release dictionaries are free.

The lock's SHA-256 is `08f125301771f4691d72b3d78dfe39e70cacce0e0a3f99042d8c912f5105e9cd`. The experiment lock is retained solely to reproduce this probe; #246 must introduce the production root manifest/lock under its own reviewed changes.

## Reproduction

Use Node 24.21.0 / npm 11.19.0 and a new directory outside the repository, beneath an existing parent directory. Preparation refuses an existing destination (including symlinks), creates its own `logs` directory, and copies baseline source closure into build inputs; it does not alter root package.json/lock or use the user's browser profile.

```bash
node docs/platform-upgrade-v1/prepare-experiment.mjs . /tmp/translateflow-pf00-reproduction
cp docs/platform-upgrade-v1/experiment-lock.json /tmp/translateflow-pf00-reproduction/package-lock.json
cd /tmp/translateflow-pf00-reproduction
npm ci --no-audit --no-fund
npm run prepare
npm run build
npm run typecheck
npm test
```

Then, from the repository, run `node docs/platform-upgrade-v1/browser-smoke.mjs /tmp/translateflow-pf00-reproduction`. This requires Playwright's Chromium for the pinned package. **`npm ci` was NOT RUN in the original probe**; actual installation used the recorded install retry. During independent review, the coordinator reproduced a fresh project at `/tmp/translateflow-release-a-20261002/pf245-reproduction`: `npm ci --offline --no-audit --no-fund` (191 packages), `npm run build`, `npm run typecheck`, and `npm test` (2 tests) all passed. This verifies the retained lock and newly created `logs` directory on a fresh destination. No detached work continues after handoff.

Independent review found two preparation defects: missing `logs` creation and output containment that could accept an internal `..probe` name or a symlinked parent. Preparation now canonicalizes the existing parent, checks path segments, and refuses an existing destination before writing. A coordinator scratch check exercised a fresh destination, the internal dot-prefix case, symlinked parent and existing symlink; rejection left the original repository package unchanged. This fixes experiment reproduction, without changing production code or relaxing assertions.

## Not run / not verified

**NOT RUN**: Chrome 102 runtime; Content/MAIN-world integration; same-ID old → new → restart preservation; runtime injection timing distribution; release lexicon/setup/certification; real Provider; Edge/Firefox/Safari; WXT dev/HMR browser session. These belong to subsequent tasks or outside this release scope. The observed feature availability only proves the tested Chromium version, not minimum-version API compatibility.

**Pending independent review**: this documentation/probe change. No implementation self-check is an independent review, and no merge/Issue state change is performed by this worker.

**NO-GO for #248 final switch**: #227/#228 unmerged cancellation/data-safety fixes and current failing certification/E2E gates, plus actual artifact/same-ID proof still required. These do not block #246's authorized build preparation.

Final worktree validation is recorded in final-validation.json after the last documentation edits; it does not replace the later current-head PR required CI.
