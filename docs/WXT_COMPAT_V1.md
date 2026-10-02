# WXT compatibility build v1

This is the opt-in PF-01 / #246 implementation of the [tested migration contract](./PLATFORM_UPGRADE_V1.md). The default `build:extension`, release command, aggregate `validate`, old E2E builder and certification consumers still use the existing `dist/extension` package. Their final switch and same-ID upgrade proof belong to #248. This document records implementation evidence, not independent review or release approval.

## Build ownership and reproduction

Use the root lock with Node **24.21.0**, npm **11.19.0**, WXT **0.21.4** and Vite **7.3.1**. The only direct development dependencies in this slice are WXT, Vite and existing Playwright **1.63.0**. React, TypeScript and Vitest production integration remains with the later authorized slices.

```bash
npm ci
npm run validate
npm run build:extension:wxt
npm run test:wxt:smoke
```

`prepare` invokes `wxt prepare`. `dev` invokes the WXT Chrome MV3 development server; its helper permissions/connections are development-only. `build:extension:wxt` invokes the actual WXT production build and then the required artifact audit. Its destination is `.output/chrome-mv3/`, separate from `dist/extension/`; neither package is repaired by editing generated files. Source checking excludes only root generated `.wxt/`, `.output/`, `dist/` directories while keeping all actual JS sources subject to the existing boundary checks.

Normal builds do not download lexical data. If Core/Technical resources have not been generated, the WXT development build explicitly warns and reports both missing paths. To make a user installation with built-in dictionaries, run the existing source-lock/bootstrap/certification flow first. The unchanged default release command still requires its existing resources. The WXT lexical gate `TRANSLATEFLOW_WXT_REQUIRE_LEXICON=1` fails closed when a generated pack is absent; it does not substitute for source/release certification.

## One source and stable installed paths

| Input | Installed output | Loading contract |
| --- | --- | --- |
| `entrypoints/background.js` → existing `src/background/index.js` | `background.js` plus WXT-generated shared chunks | Static import; synchronous `initializeBackground()` in `defineBackground.main`; no fake globals, eval or delayed listener registration |
| Existing root `popup.html` and its original modules/CSS | `popup.html`, compiled chunks/CSS | Registered directly through `entrypoints:found`; no copied second HTML template |
| Existing root `options.html` and its original modules/CSS | `options.html`, compiled chunks/CSS | WXT unlisted-page compilation plus original Manifest `options_page`; no `options_ui` behavior change |
| Current `CONTENT_SCRIPT_FILES` / `CONTENT_STYLE_FILES` | Identical source paths and source bytes | Existing classic-script order, manual injection, optional site grants and `auto-sites.js` single registration owner |
| Three mapped YouTube MAIN files | Identical paths and bytes | Protocol → timedtext → MAIN bridge order; existing `world: MAIN` boundary |
| Six mapped module Workers and their relative imports | Identical paths and bytes | Existing `getURL()` Worker loading; browser-safe importer/shared/provider closures; existing OPFS lifecycle |
| Generated Core/Technical manifests and descriptors | `assets/lexicon/core` / `technical` | Only manifest plus registered directory/shards/notices; shape, fingerprint, descriptor hashes and confinement checked; stray inputs are excluded |

`src/shared/runtime-assets.js` is the pure path contract shared by runtime consumers, WXT bridge and tests. This slice replaces only path literals in six Worker callers, YouTube bridge, Options sender-path check and bundled lexical roots. Provider behavior, sender authorization, cache/OPFS schema, import cancellation and Selection lifecycle are unchanged. Content lists remain authoritative in `constants.js`; newly approved Content entries enter the bridge automatically, without fixing the original experiment's file count forever.

`scripts/wxt-assets.mjs` computes the exact closure from those roots. The build adds individual `absoluteSrc`/`relativeDest` assets; it never exposes all of `src/`, the repository or `node_modules` as public. A nonempty undeclared public directory fails the build. The bridge is transitional and its removal remains PF-05; compiled extension UI uses WXT instead of a raw UI source copy.

The generated production Manifest is deep-equal to root `manifest.json`: **zero allowed differences** in this slice. MV3, version, commands, root page identities, module background, minimum Chrome **102**, required/optional permissions and host scopes are unchanged. There is no static Content registration, WAR, new key, sandbox or CSP exception. Both compiled JS and CSS explicitly target `chrome102`; this is not a runtime/polyfill claim. React is absent from all compiled and raw runtime closures.

## Actual verification evidence

The initial implementation base is `c458d894ea3e4f82b187ca053731ac97f08fd8b9`. The current verified runtime normally merges #227 main `103e39cddfb0b816279e32310c1655bd6a4af25a` at source head `d2e192c1c30ac025d9976d335084954bffb707db`. Machine-readable evidence is in [verification.json](./wxt-compat-v1/verification.json), [exact bridge map](./wxt-compat-v1/asset-map.json), [compiled source/import closures](./wxt-compat-v1/compiled-closures.json), [production asset audit](./wxt-compat-v1/production-audit.json), [artifact file digests](./wxt-compat-v1/artifact-fingerprint.json) and [actual Chromium smoke](./wxt-compat-v1/browser-smoke.json). The root lock is the production dependency resolution; its digest is recorded in verification evidence.

- Clean `npm ci` / WXT prepare: **PASS**, exit 0, 131 packages. npm reported an unapproved esbuild postinstall; its existing optional platform binary built successfully, without changing global script policy or forcing dependencies.
- `npm run validate` after #227 integration: **PASS**, exit 0, **686 Node tests** and 420 source checks; old package **224 files / 1,444,864 bytes**. New bridge/Manifest negative tests are seven of those tests and do not require WXT-generated artifacts for discovery.
- Actual integrated WXT production build plus mandatory audit: **PASS**, exit 0, 143 files / **1,371,155 bytes** of code, **0 lexical bytes**. This is below the frozen **1,576,595-byte** platform code budget. Background import closure: **314,360 bytes**; compiled Popup/Options closure including HTML/CSS: **403,901 bytes**. These closure figures overlap in shared chunks and are not additive package partitions.
- Isolated Chromium **153.0.8010.12**: **PASS**. Background `CACHE_STATS`, Popup/Options controls, all six module Worker invalid-input responses, 44 ordered Content files and the three-file MAIN bridge loaded. Core local lookup returned two candidates with zero Provider requests. Three body segments translated through a deterministic localhost Provider, preserved link/code semantics, and restored all three cache hits after DOM clearing; Provider count remained one. No extra dynamic registrations, page errors or unexpected external requests were observed.
- Actual artifact negative checks: extra required permission, unregistered synthetic file and missing Worker each **rejected**. WXT's missing-lexicon gate failed with exit 1 as expected; the complete old package tree digest was unchanged. The final normal build and browser smoke were rerun after that expected failure.
- #246's scoped diff against integrated main (`git diff 103e39cddfb0b816279e32310c1655bd6a4af25a HEAD --check`): **PASS**. The complete diff from the original c458 base is **FAIL**, exit 2, for the EOF blank line already present in main's `src/background/packs/rich-mdd-resources.js:405`; that inherited formatting is recorded and untouched.

Browser verification copies the audited **WXT** package into a new temporary directory/profile. Its only changes are the synthetic Core fixture, the existing reviewed local Technical extract/source-lock compiled into a Technical test pack, and a localhost required host grant in that test copy. No production JS/CSS/HTML/Worker is patched, no old builder is invoked, no private dictionary or real paid Provider is used, and the user's profile is untouched.

Corrected failures remain explicit: the first closure assertion used a nonexistent parser filename and was corrected to the actual importer; the first browser test lacked Technical data and received the existing gateway error; the first old regression run still expected path literals in the lexical source after those literals moved to the shared map. The final assertions retain exact paths, valid candidates, required bundled-before-OPFS ordering and Provider counts rather than accepting the failures.

### Build-path review repair

The independent review of `14cdf04106ec15153b90016ad2550c8918a20f07` found that Windows `relative()` can return an absolute path for a different drive. Both bridge and generated-lexicon copy entrypoints now use one pure `isInsideSourceRoot` guard that also rejects absolute relative results, without relaxing parent/root confinement. `path.win32` tests cover same-drive valid children, siblings, different drives and UNC shares; real POSIX symlink tests reject escapes through both copy entrypoints.

Repair validation: seven affected tests **PASS**, aggregate `validate` **658/658 PASS**, and actual WXT rebuild/audit **PASS**. The complete production audit report is equal to the initial evidence: 143 files / 1,365,037 bytes, identical path/size/import-closure information and zero Manifest differences. Browser smoke was **NOT RUN again** for this build-only repair; the retained smoke is bound to `14cdf04106ec15153b90016ad2550c8918a20f07`, with no runtime source or dependency changes. Actual Windows filesystem symlink execution is **NOT RUN**; the shared algorithm was exercised using Node's real `path.win32` implementation. Revision details are recorded separately in `verification.json`.

### Verified #227 integration

The subsequent normal merge of `103e39cddfb0b816279e32310c1655bd6a4af25a` had no manual conflicts. Four files merged automatically: vNext CI, router, MDict controller and StarDict controller. Against that main, their #246 diff consists only of the original Node24/npm-ci CI segments and stable page/Worker path imports; #227's cancellation behavior, sender/resource ownership and trusted frozen-scope baseline resolver remain intact. Neither the frozen scope nor certification gate is changed.

Because the runtime changed, the actual WXT build and Chromium smoke were both rerun at `d2e192c1c30ac025d9976d335084954bffb707db`; the current report is not copied from the original 14cdf smoke. The updated artifact digest and every installed file's digest are recorded in `artifact-fingerprint.json`, with the same production digest attached to the new browser report. Only evidence documentation changes follow that tested source head; production packaging excludes them. The earlier 657/658-test results and original package-size observations remain historical checkpoints in `verification.json`; the current acceptance figures are the integrated results above.

## CI compatibility and remaining scope

WXT prepare requires Node >=22. The six existing workflows that actually install root dependencies now use Node 24.21.0 and locked `npm ci`; relevant filters include the lockfile. The existing E2E workflow also exercises the separate WXT build and finite smoke before its retained old-package E2E. Data workflows that do not install root dependencies are unchanged. The quality workflow's expanded install/type/unit/default-artifact integration remains #247; this slice does not claim to have completed it.

**NOT RUN:** Chrome 102 runtime; real YouTube timedtext; full WXT E2E (including the complete cancellation browser matrix); same-ID old package → WXT → restart; release Core lexical generation/certification; real paid Provider; other browsers; browser dev/HMR workflow. #248 must consume these actual WXT bytes for full E2E, update the existing build consumers and prove settings/cache/synthetic dictionary continuity before the default switch. #227 is integrated here; the remaining upgrade and default-switch gates still apply. React learning-center functionality, ReadingRecord storage and Release A acceptance are not delivered by this build task.
