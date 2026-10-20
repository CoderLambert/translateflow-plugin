# WXT production build and compatibility evidence

`build:extension` and `build:extension:release` use the sole WXT engine and stable install directory `dist/extension/`. `build:extension:wxt` emits the same engine's package at `.output/chrome-mv3/`. Every production build excludes dictionary content. Local generated files cannot enable another dictionary packaging mode.

## Build and audit

Use the root lock and package.json Node/npm constraints:

```bash
npm ci
npm run validate
npm run build:extension:wxt
npm run test:wxt:smoke
```

WXT compiles Background, Content, Popup, Options and the learning center from their existing owners. Only mapped MAIN/Worker relative-import closures and locales remain raw assets. `src/shared/runtime-assets.js` owns the stable runtime paths. The package audit rejects undeclared public assets and preserves source confinement, exact Worker/MAIN bytes, manifest permissions and compiled React boundaries. Source locks, corpora, compilers, docs and tests stay outside the package.

Package size, platform code size and runtime/UI closure sizes are reported as measurements. Builds have no package-size threshold or advisory budget; the former #245 platform-code budget and its overage warnings are retired. Historical budget figures below remain evidence of the original migration.

The default empty dictionary library is normal. Users explicitly download or import dictionaries; production never probes missing bundled resources. Smoke and browser tests start from actual audited production bytes and explicitly prepare synthetic user dictionaries in isolated storage for tests requiring hits. They do not add runtime dictionary assets to the extension copy.

Content remains an ISOLATED classic/IIFE registry compiled to `content-scripts/content.js/.css`; MAIN and Workers retain their existing contexts. Permissions, OPFS schemas and user settings are unaffected by dictionary content removal.

## Historical evidence boundary

The records below and the linked `wxt-compat-v1/` JSON capture the original migration candidate. Built-in dictionary gates, counts and fixture arrangements in that historical evidence are retired; they are not current build requirements or current verification results. Existing SHA, timestamps and measurements remain unchanged. Current evidence is recorded per task under `docs/tasks/`.

## Actual verification evidence

The initial implementation base is `c458d894ea3e4f82b187ca053731ac97f08fd8b9`. The final build source normally merges reviewed main `f5ca42745a36aa70a6882b1b34753aa44ceb30ea` at `f955045b5782189f1f5d5a9463ffdfc1d000a817`, including #227 and #230. Its complete installed bytes are identical to the actual browser-tested runtime `d2e192c1c30ac025d9976d335084954bffb707db`. Machine-readable evidence is in [verification.json](./wxt-compat-v1/verification.json), [exact bridge map](./wxt-compat-v1/asset-map.json), [compiled source/import closures](./wxt-compat-v1/compiled-closures.json), [production asset audit](./wxt-compat-v1/production-audit.json), [artifact file digests](./wxt-compat-v1/artifact-fingerprint.json) and [actual Chromium smoke](./wxt-compat-v1/browser-smoke.json). The root lock is the production dependency resolution; its digest is recorded in verification evidence.

- Clean `npm ci` / WXT prepare: **PASS**, exit 0, 131 packages. npm reported an unapproved esbuild postinstall; its existing optional platform binary built successfully, without changing global script policy or forcing dependencies.
- Final `npm run validate` after reviewed #227/#230 main integration: **PASS**, exit 0, **742 Node tests** and 434 source checks; old package **233 files / 1,486,999 bytes**. New bridge/Manifest negative tests are seven of those tests and do not require WXT-generated artifacts for discovery.
- Actual integrated WXT production build plus mandatory audit: **PASS**, exit 0, 143 files / **1,371,155 bytes** of code, **0 lexical bytes**. This is below the frozen **1,576,595-byte** platform code budget. Background import closure: **314,360 bytes**; compiled Popup/Options closure including HTML/CSS: **403,901 bytes**. These closure figures overlap in shared chunks and are not additive package partitions.
- Isolated Chromium **153.0.8010.12**: **PASS**. Background `CACHE_STATS`, Popup/Options controls, all six module Worker invalid-input responses, 44 ordered Content files and the three-file MAIN bridge loaded. Core local lookup returned two candidates with zero Provider requests. Three body segments translated through a deterministic localhost Provider, preserved link/code semantics, and restored all three cache hits after DOM clearing; Provider count remained one. No extra dynamic registrations, page errors or unexpected external requests were observed.
- Actual artifact negative checks: extra required permission, unregistered synthetic file and missing Worker each **rejected**. WXT's missing-lexicon gate failed with exit 1 as expected; the complete old package tree digest was unchanged. The final normal build and browser smoke were rerun after that expected failure.
- #246's scoped diff against final integrated main (`git diff f5ca42745a36aa70a6882b1b34753aa44ceb30ea HEAD --check`): **PASS**. The complete diff from the original c458 base is **FAIL**, exit 2, for the EOF blank line already present in main's `src/background/packs/rich-mdd-resources.js:405`; that inherited formatting is recorded and untouched.

Browser verification copies the audited **WXT** package into a new temporary directory/profile. Its only changes are the synthetic Core fixture, the existing reviewed local Technical extract/source-lock compiled into a Technical test pack, and a localhost required host grant in that test copy. No production JS/CSS/HTML/Worker is patched, no old builder is invoked, no private dictionary or real paid Provider is used, and the user's profile is untouched.

Corrected failures remain explicit: the first closure assertion used a nonexistent parser filename and was corrected to the actual importer; the first browser test lacked Technical data and received the existing gateway error; the first old regression run still expected path literals in the lexical source after those literals moved to the shared map. The final assertions retain exact paths, valid candidates, required bundled-before-OPFS ordering and Provider counts rather than accepting the failures.

### Build-path review repair

The independent review of `14cdf04106ec15153b90016ad2550c8918a20f07` found that Windows `relative()` can return an absolute path for a different drive. Both bridge and generated-lexicon copy entrypoints now use one pure `isInsideSourceRoot` guard that also rejects absolute relative results, without relaxing parent/root confinement. `path.win32` tests cover same-drive valid children, siblings, different drives and UNC shares; real POSIX symlink tests reject escapes through both copy entrypoints.

Repair validation: seven affected tests **PASS**, aggregate `validate` **658/658 PASS**, and actual WXT rebuild/audit **PASS**. The complete production audit report is equal to the initial evidence: 143 files / 1,365,037 bytes, identical path/size/import-closure information and zero Manifest differences. Browser smoke was **NOT RUN again** for this build-only repair; the retained smoke is bound to `14cdf04106ec15153b90016ad2550c8918a20f07`, with no runtime source or dependency changes. Actual Windows filesystem symlink execution is **NOT RUN**; the shared algorithm was exercised using Node's real `path.win32` implementation. Revision details are recorded separately in `verification.json`.

### Verified #227 integration

The subsequent normal merge of `103e39cddfb0b816279e32310c1655bd6a4af25a` had no manual conflicts. Four files merged automatically: vNext CI, router, MDict controller and StarDict controller. Against that main, their #246 diff consists only of the original Node24/npm-ci CI segments and stable page/Worker path imports; #227's cancellation behavior, sender/resource ownership and trusted frozen-scope baseline resolver remain intact. Neither the frozen scope nor certification gate is changed.

Because the runtime changed, the actual WXT build and Chromium smoke were both rerun at `d2e192c1c30ac025d9976d335084954bffb707db`; the current report is not copied from the original 14cdf smoke. The updated artifact digest and every installed file's digest are recorded in `artifact-fingerprint.json`, with the same production digest attached to the new browser report. The subsequent evidence commit `8d8715742a5d33d3b3fb5431244b7c71d4c7b338` changed only documentation excluded from production packaging; the later pure-contract main merge is verified separately below. The earlier 657/658/686-test results and original package-size observations remain historical checkpoints in `verification.json`; the current acceptance figures are the integrated results above.

### Final reviewed-main integration

The final normal merge of main `f5ca42745a36aa70a6882b1b34753aa44ceb30ea` added only its 17 pure Reading contract files, with no conflicts or new #246 implementation changes. Actual WXT build/audit was rerun at `f955045b5782189f1f5d5a9463ffdfc1d000a817`. Every one of the 143 installed files has exactly the same path, size and SHA-256 as the previous browser-tested package; the complete directory fingerprint remains **`a1efd882ce51597284f08b1b7fef4edda425354d31ee8f549098e22647622453`**. Asset map, compiled module/import closures and production audit are also equal. The pure contracts therefore do not enter this WXT runtime closure.

Browser smoke was **NOT RUN again** for this final merge. Its report preserves the actual tested d2 source and main103 identities, and separately records the all-file byte-equality proof for the new source/main. This does not claim a new browser run. `validate` includes the 56 new Reading contract tests and now passes 742/742. Only evidence documentation changes follow the verified f955 source; no future task's main changes are folded into this frozen candidate.

## CI compatibility and remaining scope

WXT prepare requires Node >=22. The six existing workflows that actually install root dependencies now use Node 24.21.0 and locked `npm ci`; relevant filters include the lockfile. The existing E2E workflow also exercises the separate WXT build and finite smoke before its retained old-package E2E. Data workflows that do not install root dependencies are unchanged. The quality workflow's expanded install/type/unit/default-artifact integration remains #247; this slice does not claim to have completed it.

**NOT RUN:** Chrome 102 runtime; real YouTube timedtext; full WXT E2E (including the complete cancellation browser matrix); same-ID old package → WXT → restart; release Core lexical generation/certification; real paid Provider; other browsers; browser dev/HMR workflow. #248 must consume these actual WXT bytes for full E2E, update the existing build consumers and prove settings/cache/synthetic dictionary continuity before the default switch. #227 is integrated here; the remaining upgrade and default-switch gates still apply. React learning-center functionality, ReadingRecord storage and Release A acceptance are not delivered by this build task.
