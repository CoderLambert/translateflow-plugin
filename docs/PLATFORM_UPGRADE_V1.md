# TranslateFlow platform upgrade v1: PF-00 migration contract

Status: **contract and isolated compatibility probe**, for #245 / parent #191. This is not the production build switch, Reading Loop acceptance, a browser support claim, or release approval. The active user authorization starts #245–#249 and Reading Loop Release A; the earlier “awaiting start” text in the planning Issues is superseded only for that scope.

## Baseline, ownership, and evidence

Inspected `origin/main@6c9347db79c538b2660e9009847ce362a3578261`, clean isolated branch `docs/245-platform-upgrade-contract`, on 2026-10-02. Current source is Chrome MV3, native JS/HTML/CSS, `package.json` Node `>=18`, no checked-in lockfile, and Playwright `1.63.0` as the only npm development dependency. CI currently uses Node 20. The declared Chrome minimum is **102**.

This task owns this contract and [the probe assets](./platform-upgrade-v1/). It does not change production source, manifest, package/lock, storage, permissions, CI, or existing architecture rules. #246 owns the first production toolchain/entry/asset changes, #247 the test/type/source-rule integration, #248 the actual artifact/upgrade proof and default switch, and #249 the new UI language contract. Each must update only the rules that its reviewed migration actually supersedes.

- [Baseline inventory](./platform-upgrade-v1/baseline-inventory.json): all 221 allowlisted runtime files, sizes and SHA-256; ordered Content list, MAIN list, Worker list, configuration keys, existing message values, exact 176-file probe bridge.
- [Installed toolchain metadata](./platform-upgrade-v1/toolchain.json): actual package engines/peers and resolved versions, not inferred from an install command.
- [Probe lock](./platform-upgrade-v1/experiment-lock.json): exact isolated npm resolution, SHA-256 `08f125301771f4691d72b3d78dfe39e70cacce0e0a3f99042d8c912f5105e9cd`; it is evidence, not the root production lock.
- [Build/size/module evidence](./platform-upgrade-v1/experiment-report.json) and [browser evidence](./platform-upgrade-v1/browser-report.json): actual probe outputs, explicit unverified scope.
- [Reproduction and results](./platform-upgrade-v1/RESULTS.md), [preparation script](./platform-upgrade-v1/prepare-experiment.mjs), [browser smoke](./platform-upgrade-v1/browser-smoke.mjs).

The main Agent registered a real `dev_specialist` assignment and checked its role TOML separately. This thread can observe its task/worktree/file scope and the tool environment (`danger-full-access`, approval `never`), which overrides the role's stated workspace defaults. It cannot independently observe model/reasoning runtime metadata; model self-report is not evidence. No role or global configuration is changed here.

## Frozen engineering choices and compatible versions

WXT is the new build owner, using its compatible Vite integration. React first enters the ordinary extension learning-center page in #235. No independent Vite application, global store/router framework, full JS-to-TS conversion, or React Content/MAIN/Worker/background migration is part of this phase.

The following **fixed combination is usable for the tested install/build/type/unit smoke**, under Node **24.21.0 LTS**, npm **11.19.0**. Node 24 is the preferred development/CI major; #246 records these patches and root lock, #247 updates affected CI installation and Node jobs. Do not leave migrated WXT jobs on Node 20: WXT's engine is `>=22`.

| Package | Pinned version | Relevant engine / peer compatibility |
| --- | --- | --- |
| `wxt` | `0.21.4` | Node `>=22`; Vite `^6.3.4 \|\| ^7.0.0 \|\| ^8.0.0-0`; optional TS `>=5.4` |
| `vite` | `7.3.1` | Node `^20.19.0 \|\| >=22.12.0` |
| `@wxt-dev/module-react` | `1.2.2` | WXT `>=0.19.16`, Vite includes 7 |
| `@vitejs/plugin-react` | `5.1.4` | Node as Vite; Vite peer includes 7 |
| `react` / `react-dom` | `19.3.0` / `19.3.0` | React DOM peer `^19.3.0` |
| `@types/react` / `@types/react-dom` | `19.3.0` / `19.3.0` | DOM types peer `^19.3.0` |
| `typescript` | `5.9.3` | Node `>=14.17`; satisfies WXT's TS peer |
| `vitest` | `5.0.3` | Node `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`; Vite includes 7 |
| `@types/node` | `24.10.1` | Satisfies Vite/Vitest Node types peers |
| `@playwright/test` | `1.63.0` | Existing production development version; Node `>=20` |

The choice retains Vite 7 / plugin-react 5 and TS 5.9 rather than combining every newly published major; actual npm resolution supplies the compatibility evidence. There was no `--force`, `--legacy-peer-deps`, or engine override. Optional test environments/coverage packages and `web-ext`/ESLint are not installed just to satisfy optional peers.

npm 11 reported an unapproved `esbuild@0.27.7` postinstall script. The platform optional binary already worked: WXT preparation/build, TS and Vitest all passed without changing global `allowScripts`. If a later environment requires that script, inspect it and authorize only that package in the task installation; do not disable script safety globally.

The first install failed with `ERESOLVE` / `vite@undefined` after metadata connection timeouts. That is not evidence of a real Vite peer conflict. A bounded retry with `--prefer-offline` installed 191 packages in 41 seconds; `npm ls --depth=0` subsequently succeeded. Failure and corrected results are retained separately in RESULTS.

## Source → production path → loader → execution context

The old builder copies the root runtime allowlist and all `src`, with optional generated `assets/lexicon`. The new bridge must use a **reviewed exact file allowlist**, not copy the repository or entire `src` into `public`. Each bridge item maps the single source to the same relative output path. The probe demonstrates WXT's `build:publicAssets` hook for this mapping; no public staging duplicate is required. Build-source copies inside the isolated probe are not public extension assets.

| Source | Phase-A output / loading path | Loader and context | Required continuity |
| --- | --- | --- | --- |
| `background.js` → `src/background/index.js` | generated `background.js` | Manifest MV3 ES-module service worker | Thin WXT `defineBackground({ type: "module", main() { initializeBackground(); } })`; listeners register synchronously. Static imports were actually build-tested; no fake `chrome`, `eval`, or delayed runtime `import()` initialization. |
| `popup.html`, `popup.js`, `popup-appearance.js`, `popup.css` + relative imports | unchanged root paths during bridge | `action.default_popup`; extension-page ESM | Preserve UI and permission-request flow; no React rewrite in #246. |
| `options.html`, `options.js`, `options.css` + its additional module scripts | unchanged root paths during bridge | `options_page`; extension-page ESM | Also loads `src/options/rich-mdict-import-ui.js`, `curated-dictionary-ui.js`, `local-dictionary-import-ui.js`. `router.js` checks sender against `getURL("options.html")`; retain this identity. |
| `src/ui/styles/tokens.css`, `components.css` | unchanged paths | Popup/Options `<link>` | Reuse tokens; new UI CSS is separate. |
| All **44 ordered** `CONTENT_SCRIPT_FILES`, then `content.css` | same individual classic-script paths | `commands.js` and `popup.js` manual `executeScript`/`insertCSS`; `auto-sites.js` persistent optional-origin registrations | ISOLATED default world; manual user invocation and persistent `document_idle` are different paths. Preserve order, existing bootstrap/idempotence and CSS lifecycle. The exact list is in inventory; `src/content/runtime.js` first, `content.js` last. |
| `youtube-bridge-protocol.js`, `youtube-timedtext.js`, `youtube-main-bridge.js` under `src/content/subtitles/` | same three paths, same order | `src/background/youtube-bridge.js` `executeScript({ world: "MAIN" })` | Protocol/timedtext are also in ISOLATED Content list. Keep validated sender, videoId/generation envelopes, player-owned response observation, fallback ordering and cleanup. No signed URL replay. |
| `src/options/workers/curated-dictionary-worker.js` + relative closure | same Worker URL | `curated-dictionary-ui.js` `getURL`, module Worker | Existing download Provider boundary, granted exact upstream origins, request/cancel/token lifecycle. |
| `src/options/workers/curated-ecdict-mdx-worker.js` + relative closure | same Worker URL | `curated-ecdict-mdx-ui.js` `WORKER_PATH`, module Worker | Same local/downloading split, limits and source-lock semantics. |
| `src/options/workers/mdict-import-worker.js` + relative closure | same Worker URL | `mdict-import-controller.js`, module Worker | Keep quarantine before commit and actual cancellation/commitpoint behavior. |
| `src/options/workers/stardict-import-worker.js` + relative closure | same Worker URL | `stardict-import-controller.js`, module Worker | Keep gzip/dictzip capabilities, bounded imports and same commit owner. |
| `src/options/workers/rich-mdict-import-worker.js` + relative closure | same Worker URL | `rich-mdict-import-controller.js`, module Worker | Preserve rich MDX source/index and untrusted-content checks. |
| `src/options/workers/mdd-resource-import-worker.js` + relative closure | same Worker URL | `mdd-resource-import-controller.js`, module Worker | Preserve MDD companion/index/reservation ownership and rollback semantics. |
| generated `assets/lexicon/core/**`, `technical/**` | unchanged package paths, including notices | `lexical/index.js` bases → `tflex-reader.js` → `package-assets.js` via `chrome.runtime.getURL`; Core notice link in `options.html` | Generation/source-lock rules stay separate. Copy only generated runtime packs; `--require-lexicon` must still fail if absent. Preserve manifest/directory/shard relative references and fingerprints. |
| Future `entrypoints/learning-center/index.html` and TSX | `learning-center.html`, ordinary unlisted extension page | Explicit navigation; extension page only | WXT's normal directory entry emits `learning-center.html`; freeze that exact runtime path for #232's global-page allowlist and #235's navigation. Do not name it `history`/`newtab` or add an override. UI consumes #233 service/DTO; no storage adapter inside React. |

There is **no runtime iframe/sandbox HTML entry, bundled font, WASM asset, remote font fetch, static manifest Content registration, or web-accessible resource declaration** in this baseline. Rich dictionary display uses the existing controlled DOM/Shadow host; `iframe` and active tags are rejected. The `Inter` name is a system/fallback font-family, not a downloaded font. MDD images/audio/CSS resources go through the existing bounded background lookup and sanitized resolver, not `web_accessible_resources`. Do not create iframe/WAR/CSP permissions as a missing-resource fix.

The raw Worker closure includes shared contracts and browser-safe importer code under `src/background/packs/importers/`, and curated Worker network code under the existing providers path. This is intentional reuse, not a new background runtime or arbitrary network escape. Package-level relative imports must resolve after copying. React/npm UI dependencies may not enter these raw closures.

## Manifest, permissions, and lifecycle invariant

Compare the **generated production** Manifest against this baseline: MV3, `permissions = [storage, activeTab, scripting]`, required host only `https://api.deepseek.com/*`, optional `http://*/*` and `https://*/*`, all three command values/shortcuts/descriptions, root Popup/Options identity, module background and minimum 102. Version/file layout may change when explicitly implemented; permission meanings may not. The probe's whole Manifest deep-equality check passed.

No new `key`, static `<all_urls>` injection, host grant, `tabs` permission, WAR, or permissive CSP is authorized by a build migration. WXT development/HMR privileges are not production privileges. Keep automatic restoration cache-only: cache misses cannot trigger Provider work. Keep manual `activeTab` and persistent optional origin grant separate.

`auto-sites.js` remains the sole registration owner. It unions `cacheRestoreSites`, `autoSites`, visible `quickControlSites`, filters by existing permissions, uses `tf_site_` + first 20 characters of the origin SHA-256, and removes stale `tf_site_` / `tf_auto_` / `abt_auto_` registrations. `persistAcrossSessions: true`, `runAt: document_idle`, default single-frame ISOLATED semantics are preserved. `background/index.js` keeps `onInstalled` defaults/legacy-v1 cleanup and `onStartup` registration sync. Do not introduce another WXT registration owner.

Existing message values, Effective Translation Config, provider endpoint fingerprint, prompt/glossary precedence, URL/text normalization, task/requestId/generation and signal ownership remain authoritative. Updating an old open tab may require an explicit refresh; no silent duplicate paid request is acceptable.

## Storage contract and upgrade/rollback

| Storage / owner | Frozen identity and shape | Upgrade evidence required in #248 |
| --- | --- | --- |
| `chrome.storage.local`, config/defaults + glossary/auto-sites/UI owners | All keys in inventory; `siteProfiles`, glossary/siteGlossaries version 1, Provider credentials in the existing unified config | Prepopulate synthetic settings; defaults add only missing keys. Compare settings and effective cache identity before/after/restart; never publish credentials. |
| `chrome.storage.session`, `preset-session.js` | `temporaryPresetOverrides`; session-only origin overrides | Extension update semantics and new page behavior tested separately; browser restart may intentionally end session state. Do not convert it into durable history. |
| `cache-db.js` IndexedDB | DB `ai_bilingual_translator`, version **2**, cache schema **2** | Existing cache lookup survives update/restart. No delete/recreate migration. |
| IDB stores/indexes | `translations` keyPath `cacheKey`, indexes `pageKey`, `pageConfigKey`, `lastAccessedAt`; `pages` keyPath `pageKey`, `lastAccessedAt`; `selection_explanations` keyPath `cacheKey`, `lastAccessedAt` | Validate stored values and deterministic config/page/source identities, not only store existence. |
| Structured dictionary state | `tfDictionaryPackStateV1`, version 1, `packs`, `catalogSequences`, optional `reservations` / `resourceReservations`; active/previous descriptors | Keep active pointer/fingerprint/version and bounded cleanup; never replace state with an empty object to resolve compatibility. |
| Structured OPFS | `dictionaries/<packId>/<version>/<validated relative files>` | Synthetic installed dictionary still resolves, rollback still uses its preserved descriptor. |
| Rich MDX state/preferences | `tfRichMdictStateV1`; `tfRichMdictPreferencesV1`, version 1 | Keep enabled/order/expanded preferences, installed descriptors and owner checks. |
| Rich MDX/MDD OPFS | `rich-mdict-dictionaries/<packId>/<version>/source.mdx`, `index.json`; resource snapshots refer to `resources/000.mdd`, `resources/000.index.json` etc. under their resource version | Retain rich source/index, resource snapshot and bounds; import/cancel/commit/uninstall failure paths use synthetic inputs. |
| Import quarantine | `dictionary-import-quarantine/import-<uuid>/<validated staged files>` | TFLex stages only `entries.dat`, `index.dat`, `manifest.json`. Rich MDX/MDD Workers stage uncommitted versions directly under their separate rich OPFS root, protected by their existing reservations; they do not use the TFLex quarantine. Do not delete another live owner's token or committed version on restart/cancel. |
| ReadingRecord | **#233 owns its independent repository and adapter** | Platform must not infer history from caches or define a second schema. Cache deletion and record deletion stay independent. |

Same extension ID means the same storage origin. #248 must use an isolated test profile and the **same unpacked installation path/ID** for old package → new package → browser restart, seed synthetic settings/cache/dictionaries, verify values and actual lookup, and retain hashes/ID evidence. Do not add a new manifest key to existing installs, uninstall, clear storage, or claim automatic transfer between two different extension IDs. The user's real profile is outside scope.

The old control is built from a fixed merged commit/artifact, not an independently maintained old engine. Retain that artifact/digest for controlled unpacked rollback in the same path, with no schema change. Store rollback restrictions differ from local unpacked reload; forward fixes may be necessary. During #246 the old default remains until #248's gates pass. After #248, `build:extension`/release have one WXT owner; a legacy helper may only delegate, not rebuild a separate package.

## Old build consumers and required rewiring

| Existing consumer | Actual call / coupling | Owner and required change |
| --- | --- | --- |
| `package.json` build/validate/release | `scripts/build-extension.mjs`; `validate = check + node:test + old build` | #246 adds WXT build while preserving old default; #247 adds type/unit validation; #248 switches default/release and keeps `dist/extension` as install destination. |
| `e2e/support/extension-fixture.mjs` | Imports/calls `buildExtension`; mutates temp fixture dictionary/permissions and optionally cached ECDICT Worker | #248 consumes an already generated WXT artifact. Audit unchanged package separately; fixture augmentation must never supply missing production code. Record all test-copy changes. |
| `scripts/measure-extension-footprint.mjs` | Direct `buildExtension`, raw-byte reconciliation and builder string | #248 measures actual WXT artifact and preserves separate lexical budgets. |
| `scripts/certify-vnext-dictionary-library.mjs` | Direct `buildExtension`, production package scan and builder assertions | #248 consumes WXT package and updates provenance truthfully; old PASS reports cannot certify new bytes. |
| `scripts/certify-dictionary-ecosystem-v2.mjs` | Direct `buildExtension` in production-package evidence | #248 uses the same reviewed package source/digest. |
| `scripts/certify-offline-dictionary-beta.mjs` | Expects footprint `packageBoundary.builder = scripts/build-extension.mjs` | #248 updates supported provenance contract and corresponding fixtures, not its required checks. |
| `tests/ecdict-mdx-package-boundary.test.mjs`, `wiktextract-ingest.test.mjs` | Direct builder imports/calls | #247/#248 integration retains package exclusion assertions; no old-build-only green claim. |
| `tests/selection-release-certification.test.mjs` | Requires fixture source `buildExtension(` | #248 replaces with the real artifact contract; preserve semantic certification checks. |
| `tests/certify-vnext-dictionary-library.test.mjs`, `offline-dictionary-beta-certification.test.mjs` | Fixtures contain old builder identity | #248 aligns fixture/provenance with actual builder. |
| `.github/workflows/quality.yml` | Node 20; validate without dependency installation | #247 Node 24 + root `npm ci` + expanded validate. |
| `.github/workflows/e2e.yml` | Node 20/npm install; existing E2E source path filter | #247/#248 include lock/config/entry/asset build changes, actual production build first. |
| `rich-mdict-compatibility.yml`, `dictionary-library-vnext-certification.yml` | Node 20/npm install, old builder paths in filters | #247/#248 update relevant jobs/filters and retain required safety evidence. |
| `lexicon-release.yml` and its certifiers | Node 20/npm install, footprint/validate/E2E chain | #247/#248 real artifact/Node/lock wiring. Lexicon builders/source locks remain their existing owners. |

Other current Node workflows are `rich-lookup-cancellation`, `mdd-resources`, `wikimedia-wiktionary-source-lock`, `wiktextract-ingest`, `freedict-source-audit`, and `wiktextract-rich-poc`. #247 must examine which invoke the root install/toolchain before moving them to Node 24; it must not make unrelated dataset pipelines a new M1 prerequisite. `playwright.config.mjs` currently discovers only `e2e/**/*.spec.mjs`.

`scripts/check.mjs` recursively checks `.js/.mjs`, skips only `.git` / `node_modules`, requires root background manifest identity, classic `src/content` imports, thin entries, and sole owners for `fetch`, IDB and registrations. #247 explicitly excludes generated `dist` / `.output` / `.wxt` from source checking, checks approved new TS/TSX source separately, and preserves the runtime boundary checks. #233 coordinates only its exact ReadingRecord IDB exception. Test/fixture paths are not runtime privileges.

## Test discovery and compatibility contract

Keep existing Node tests `tests/*.test.mjs`; add Vitest only in a distinct new TS test directory/glob (for example `tests/unit/**/*.test.ts` / `.tsx`); E2E stays `e2e/**/*.spec.mjs`. #247 freezes the chosen new glob and explicitly excludes Node/E2E/generated files. No test is silently discovered twice. `validate` remains the aggregate entry and includes source checks, old Node regressions, new type/unit checks and the selected default production build. Type checking does not replace message runtime validation; Vitest does not replace browser permissions, OPFS or Worker integration.

Production JS **and CSS target `chrome102`** are frozen for new compiled paths. Raw classic bridge resources retain their baseline source bytes and are not magically transpiled by a Vite target. Do not describe this target as a polyfill or proof that every native API works on Chrome 102. WXT dev/HMR's current-browser assumptions are separate from production compatibility.

Native capability checks remain explicit: storage/scripting/session, WebCrypto, OPFS `getDirectory`/writable handles, `DecompressionStream` formats, module Worker and safe resource formats. Existing decompression adapters already reject unavailable capability; OPFS operations currently wrap missing API/storage failures. #246 retains these failures instead of substituting an in-memory success or clearing data; any newly introduced API needs a guarded unsupported path. `sender.documentId` is optional in the router and falls back to existing sender identity. New CSS requiring capabilities beyond the declared target needs supported fallbacks/`CSS.supports`, not a silent minimum bump.

The actual isolated browser smoke used **Chromium 153.0.8010.12**. Chrome 102 itself, Edge, Firefox and Safari are **NOT RUN**. If a dependency demonstrably requires raising the minimum, stop the affected migration and present the exact capability/decision; do not modify the manifest to make a green test.

## Package and injection budget

Measure both old and WXT production packages with the same synthetic/environment inputs, enumerate actual bytes, and separate non-dictionary platform code, bundled dictionary bytes, and new UI dependency closure. Compare packaged bytes without HMR/test/source corpora and without real private inputs. Do not derive a speed claim from minification or build time.

The measured development baseline has no generated dictionaries: **1,433,269 B / 221 files**. Freeze the platform threshold as `floor(old + max(old × 10%, 100 KiB)) = 1,576,595 B`. Do not raise it after measuring. Existing dictionary raw/ZIP-proxy ceilings remain **37,000,000 B / 4,000,000 B**; no dictionary contents are changed by this contract.

The actual WXT probe is **1,711,169 B** total: **1,488,230 B** platform code (+54,961 B, within budget), **222,939 B** separate React UI smoke closure, and **0 B** dictionary assets. New learning-center UI size must be recorded by #235 using its actual closure; this tiny smoke app is not a learning-center budget or speed benchmark. The WXT background is **306,171 B**, 99 bundled modules, with **zero React modules**. Raw Content/MAIN/Worker code comes only from the reviewed baseline JS closure. Content's 44 ordered files plus stylesheet total **305,486 B**; MAIN's three files total **30,190 B** (overlapping helper files are intentionally counted in each world's injected set).

For #248/#235 measure injection on the same local fixture, browser/profile, viewport, cold/warm setup and invocation path, with at least ten samples: elapsed execute/insertion/bootstrap-ready time, request count, DOM outcome, registered-file order and resource cleanup. Report median/range and raw sample method. No runtime injection timing distribution or dictionary release cost was measured in this PF-00 probe: **NOT RUN**. #248 supplies the actual migration comparison.

## Known blockers, responsibilities, and acceptance gates

At inspection, #228 is OPEN at `122fe8de31ccde764fbcb6f4a942fdf018046faa`, not baseline. Its `validate`, rich lookup cancellation, real ECDICT, and independent MDD checks pass; `chromium-smoke`, `certify`, and Dictionary Library vNext final certification fail. Main Agent inspection attributes current helper failures to missing MDD requestId/ownerToken and flags additional cancellation/commitpoint evidence for independent review; these remain reported findings, not PF-00 fixes. Shared conflict paths include `src/shared/constants.js`, `src/background/router.js`, importer/state API paths, Content runtime/resource resolver, and local import UI/controllers. Rebase the later platform changes after reviewed #227/#228 fixes; do not overwrite those message/security changes from this older baseline.

**#248 final switch is NO-GO until #227 is resolved on merged main**, current-head required CI and independent review pass, and actual WXT artifact/same-ID preservation evidence exists. Build preparation/type/test work does not depend on #228 being merged. Baseline defects and migration regressions must be reported separately. Never reuse an older certification PASS to waive this gate.

#222 remains OPEN at `9a77b133e29e292393e4a57a40d641aff56c81de`; it proposes project Skills plus AGENTS routing changes and is not merged or a prerequisite. This task follows the actual main rules. #246/#247/#248 may precisely update their authorized build/source rules; no unmerged rule set is silently activated.

| Gate / evidence | Responsible task | Failure / rollback response |
| --- | --- | --- |
| Exact Manifest/asset path/import closure and packaging exclusions; WXT build/dev on fixed tools | #246 | Keep existing default builder; fix source/bridge, never patch output or broaden WAR/permissions. |
| Node + TS + Vitest + mutually exclusive discovery + boundary checks + CI lock installation | #247 | Retain Node regressions and runtime constraints; do not skip assertions/checks. |
| Actual unchanged production package audit, fixture-copy provenance, old/new same-ID data and registration proof, #227 fix | #248 | NO-GO default switch; retain fixed old artifact and resolve specific failures. |
| `browserLocale` / `uiLocale` / targetLanguage / dictionaryLanguages separation | #249 | UI-language change cannot change prompt/cache identity or saved artifacts. |
| ReadingRecord domain/privacy/access contract and its storage service | #230 / #232 / #233 | React consumes service; platform does not implement a duplicate record system. |
| Projection/source identity and real recording entry | #231 / #234 | Explicit record authorization; no passive cache-derived history. |
| React learning center on real #233 data, loading/error/empty states and UI closure | #235, after #233 + #248 + #249 | No completed claim from frozen DTO/mock-only UI. |
| Real query → explicit record → saved → view/search/pause/delete/export | #236, after #234 + #235 | Deliver exact package/commit and user steps; unverified precise revisit/AI/full-browser support stays excluded. |

The temporary bridge is owned by WXT from #246 and has an explicit exit task #250 (after its own dependencies). It is not a second product. This phase does not start #237–#244 or #250–#256, and no four-browser/shop gate is introduced before the real #236 outcome.

## Official sources checked on 2026-10-02

- [Node release schedule](https://nodejs.org/en/about/previous-releases) and [24.21.0 LTS release](https://nodejs.org/en/blog/release/v24.21.0): Node 24 LTS selection and concrete patch.
- [WXT migration](https://wxt.dev/guide/resources/migrate.html): entry/manifest/assets migration and generated Manifest comparison.
- [WXT entrypoints](https://wxt.dev/guide/essentials/entrypoints.html): build-time Node import behavior, `main` lifecycle, ordinary unlisted pages and emitted paths.
- [WXT assets](https://wxt.dev/guide/essentials/assets.html): as-is public assets and `build:publicAssets` mappings. The documented Content WAR requirement applies to direct page resource access, not these background scripting/extension Worker loaders.
- [WXT targets](https://wxt.dev/guide/essentials/target-different-browsers.html): explicit Chrome MV3 and other-browser target flags do not imply runtime certification.
- [Vite guide](https://vite.dev/guide/) and installed Vite 7 metadata: Node/transform target differs from runtime API support.
- [Vitest guide](https://vitest.dev/guide/) and installed metadata: fixed Vite/Node combination; no claim that unit tests certify extension behavior.
- [Playwright extension testing](https://playwright.dev/docs/chrome-extensions): persistent isolated Chromium context; sideloading and service-worker lifecycle evidence.
- [Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting): scripting permissions, file/world execution and dynamic registration semantics.

Package-specific engine/peer facts come from actual installed package manifests, collected in toolchain.json after the registry-based install; optional peers are preserved in that report. The live documentation may describe newer major defaults, so this contract's exact installed versions/configuration and reproduced outputs are the implementation authority.

## #248 stage 1: real artifact consumers and isolated upgrade evidence

This stage retains the current default/release build engine. The E2E fixture no
longer runs a builder: `TF_E2E_ARTIFACT` selects an already generated production
package (`dist/extension` by default during this transition). Missing artifacts
or Content/MAIN/Worker mappings fail before fixture augmentation. The adapter
hashes every supplied file, copies exact bytes, then records every changed path.
Normal test copies may change only host permissions and explicit lexicon
fixtures. The optional cached ECDICT Worker and actual registered-command
callback probe are separately identified test-copy overrides; they are neither
unmodified-package certification nor native keyboard evidence.

CI uses separate `legacy` and `wxt` matrix jobs with the same applicable stories,
independent output directories, the existing 12-minute bound, and matching
`TF_I18N_ARTIFACT`. Both artifacts are built explicitly before consumers run.
The WXT job's upgrade comparison is built from fixed pre-switch commit
`19e89b65fd3600073410407392da82ffa666ffc8` in a temporary detached worktree. That
fixed comparison does not make the old engine a future formal build entry.
`TF_UPGRADE_OLD_ARTIFACT` and `TF_UPGRADE_NEW_ARTIFACT` explicitly enable the
upgrade and sampling stories; their absence is a reported SKIP, never an upgrade
PASS. Unmodified WXT auditing remains independent of fixture copies.

The baseline development artifacts at that fixed commit were measured with no
bundled lexicon:

| Artifact | Files | Platform bytes | Tree SHA-256 |
| --- | ---: | ---: | --- |
| Fixed legacy | 237 | 1,508,511 | `5714bb2fecfd86d5384ac0369f5cffe667804ba7733cccf6b76bdb48b0c92cce` |
| Actual WXT | 147 | 1,392,614 | `7d727f5cdbc4d96465613100eca41e383edb53e69b297b7d4e480399a6938db1` |
| Actual WXT with locked release packs | 225 | 1,392,614 | `0ea72f49e9e2191d65a9010485bcf461dd73b82bb177441b2cb59be9b35c91e6` |

The release artifact has 36,830,492 dictionary bytes and 38,223,106 total bytes.
Its generated packs were reproduced offline from the current locked original
inputs and matched the reused cache byte for byte (zero downloads); the actual
full descriptor/fingerprint/path audit and `certify:lexicon` ran, followed by the
native release-lexicon E2E. That E2E changed only the Manifest's test host access,
not dictionary bytes. This is generated bundled-pack evidence, not certification
of arbitrary private MDX/MDD inputs or public distribution authorization.
Manifest differences between the unmodified development legacy and WXT packages
were empty. The platform ceiling remains **1,576,595 B**; dictionary budgets and
future React closure accounting remain separate.

The same-ID test uses one isolated `userDataDir` and one stable unpacked path,
without adding a production key, uninstalling the extension, clearing storage,
or touching a real browser profile. The old Options page actually saves the
localhost Provider configuration, imports two synthetic MDX dictionaries with
MDD attachments, disables one dictionary, chooses the other as personal preferred,
and produces three translation cache rows. Old → actual WXT → browser restart
compares all original storage values, DB name/version/store rows, OPFS file sizes
and SHA-256 hashes, active pointers, enabled/preferred state, and the exact native
registration file order. Native extension management reload invalidates the old
message channel; refreshing that document and reinjecting restores normal
status. No Provider retry is automatic: one explicitly seeded localhost call,
zero additional Provider calls and zero external requests.

For local unpacked upgrades, retain the original loading directory and ID.
Loading a different directory or adding a new key can create a different origin;
it cannot access the previous origin's data. Existing store IDs retain their
original identity. The testing profile enables Developer mode through Chromium's
own management interface so the unpacked extension remains supported after a
reload. A stale tab needs a document refresh; hot replacement is not promised to
keep every old script alive. Rollback keeps the fixed comparison artifact and
preserves data; default switching remains gated on the merged stage-1 head's CI,
independent verification/review, and the already merged #227 fix.

Chromium **153.0.8010.12** native site-access testing exercises withheld access,
specific-origin grant, revoke, registration union and restart pruning without
stubbing `chrome.permissions`. Independent review found that the original
`61f45a2` scripting-denial assertion was invalid: after revocation, tab URLs were
not visible, URL lookup returned no tab, and the broad catch accepted a
`TypeError` before any native injection call. That historical PASS is not evidence
of denied scripting. Browser prompt interaction is **NOT RUN**. The management
API is test instrumentation in the isolated profile, not a runtime product
dependency. A true headless keyboard experiment failed to dispatch the configured
Chrome shortcut; Commands E2E therefore reports the actual registered-callback
probe, not native shortcut PASS.

The resumed permission test captures and validates a unique native tab ID while
access is granted, retains it after revocation and document reload, and checks
the native tab still exists. Each probe first records independently readable
`nativeCalls: 0` / `NOT_STARTED` state in the service worker, then invokes the real
`chrome.scripting.executeScript` once and attaches settlement observers without
blocking the evaluator. Every control uses the same native function, whose result
and DOM marker make actual execution observable. Tab lookup errors, invalid
arguments, TypeErrors and timeouts cannot be accepted as host denial.

Independent source review corrected the assumption that a withheld request must
immediately reject. Current Chromium main/HEAD permits `kWithheld` through the
programmatic precheck and the renderer can wait for permission; see the official
[permission data implementation](https://raw.githubusercontent.com/chromium/chromium/main/extensions/common/permissions/permissions_data.cc)
and [renderer injection state handling](https://chromium.googlesource.com/chromium/src/+/HEAD/extensions/renderer/script_injection.cc).
That source analysis is not certification of a particular Chromium binary.
The test therefore separates an origin never requested/granted from declared
but withheld/revoked access. Only the first control must deliver an explicit host
Error; a pending withheld/revoked promise is recorded as **PENDING**, not denied
or successfully settled. The no-`tabs`-permission host error is checked exactly
against the generic form in the official
[scripting permission-error implementation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/extensions/browser/scripting_utils.cc).

One bounded actual contrast ran on Chromium **153.0.8010.12** against a freshly
built, unmodified WXT artifact with tree SHA-256
`7d727f5cdbc4d96465613100eca41e383edb53e69b297b7d4e480399a6938db1`.
The purpose-built mock HTTP server served both `127.0.0.1` and `localhost` URLs;
the latter had never been granted and no hard-denied host was added to the
Manifest. The native-created `localhost` tab provided its ID directly.

| Native control | Permission contains | Calls | Observed API state | Execution marker |
| --- | --- | ---: | --- | ---: |
| Never-granted `localhost` | false | 1 | REJECTED, exact host-permission Error | 0 |
| Declared but withheld `127.0.0.1` | false | 1 | PENDING, 1,024 ms / 107 live samples | 0 |
| Granted `127.0.0.1` | true | 1 | FULFILLED, actual frame result matches marker | 1 |
| Revoked `127.0.0.1`, fresh document | false | 1 | PENDING, 1,015 ms / 149 live samples | 0 |

The negative observations checked the live DOM throughout their explicit
measurement window, zero extension UI/translated nodes, and absence of the
production bootstrap receiver through native `tabs.sendMessage`. The grant
control returned the marker from the actual injection and rendered that marker
in the document. Registration commands were rejected while withheld/revoked.
The exact registration union, zero Provider calls, same-profile browser restart,
revoked permission, empty native registrations and all three pruned site arrays
remained required and passed. The revised native contrast was **PASS (1 test,
6.8 s)** for this scope. Pending-request completion through a human click-to-run
action and browser permission-prompt interaction are **NOT RUN**; this result
does not claim those pending promises settled or all Chromium versions behave
identically. The 60-second test deadline was unchanged; no fixed sleep,
permission expansion, mocked permissions or swallowed error produced this result.

The original red counterexample was reproduced in the resumed directory:
`contains: false`, `tabFound: false`, `nativeCalls: 0`, `errorName: TypeError`,
while the old assertion returned true. The subsequent popup and service-worker
attempts expecting immediate rejection each exceeded the unchanged deadline and
remain **FAIL**. Their final call counter/denial receipt and restart-pruning steps
were not returned. A separate read-only profile check found the extension
ENABLED in all five phases with no disable reasons; Developer mode was not
changed. These failures remain evidence of the incorrect earlier expectation,
not accepted denial results. The red counterexample, failed traces, profile
check and new native contrast log/report are under
`/tmp/translateflow-release-a-resume-20261002/evidence/248-*`.

Ten cold and ten warm injections per artifact use the same profile/path,
1280×720 viewport and local `/article` fixture. Each cold sample measures native
CSS insertion → the 48 ordered classic files → bootstrap/status round trip;
the warm sample repeats those files on the same document and checks the same app
object, unchanged module count, zero translation/provider calls, and page cleanup.
The first measured medians were old cold 35.90 ms / warm 14.60 ms and WXT cold
35.05 ms / warm 14.60 ms. Ranges and all 40 raw samples are recorded separately;
there is no enforced speed threshold or speed-improvement claim.

The original session's local `evidence/248-*` directory was removed with its
temporary workspace. The artifact inventories, source-lock rebuild and native
release audit, same-ID snapshots, injection samples, command results and traces
summarized above are historical evidence; their old local files are no longer
present. Committed documentation and GitHub CI remain historical references.
Rebuilding the same artifact does not rerun the old upgrade profile. New resumed
evidence is explicitly recorded separately. Early failures included a shared-output trace collision,
source-module imports unavailable after compilation, an absent preference button,
reload with Developer mode disabled, and a new scripting context incorrectly used
to inspect an old message binding. These runs are not final-head PASS evidence.
Minimum Chrome 102, real public YouTube, other browsers, real paid Providers,
store upload/publication, ReadingRecord persistence and React learning-center
flows are **NOT RUN** in this stage. The final accepted head and current CI are
tracked on the task/PR; implementation alone does not mark #248 audited or complete.

Official references rechecked for this stage: [Playwright persistent extension
contexts](https://playwright.dev/docs/chrome-extensions), [Chrome extension
identity](https://developer.chrome.com/docs/extensions/reference/manifest/key),
and [WXT migration](https://wxt.dev/guide/resources/migrate.html). The lock file,
installed versions and actual artifact bytes remain the reproducibility contract.
