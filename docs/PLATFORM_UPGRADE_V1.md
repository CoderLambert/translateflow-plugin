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
status. No Provider retry is automatic: one explicitly seeded localhost call
and zero additional Provider calls. The original upgrade report's zero external
counter came from late page routing and did not cover MV3 worker startup; it is
not accepted as zero-egress proof. The #266 correction below replaces it with
startup-inclusive proxy rejection evidence and explicitly reports attempts.

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
there is no enforced speed threshold or speed-improvement claim. These earlier
reports did not prove execution of the replaced WXT background before sampling;
they remain historical Content observations, with corrected activation below.

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

### Resumed integrated stage-1 evidence

The resumed worktree merged actual main
`20df027e41445c779485c5cdb1c709a10642709d` normally, including #249 and #232.
Production artifacts were frozen at code input
`5117dcf0cdb027790f276b23b6c62468c0c9575c`. Later commits change only the
upgrade test, its opt-in fixture observer and dedicated Node assertions; the
complete production runtime/build inputs remain identical. The bounded
upgrade and validation input before the subsequent #265 integration is
`ef046807f921d7128959daddbe6c42ad3af84249`. This documentation is a later
evidence update, not a claim that earlier commands ran against a later head.
The lock SHA-256 remains
`917e568cc2f4cde346972f0297dda56241e1bec1e5a686222993a33425756c80`.

All resumed evidence below exists under
`/tmp/translateflow-release-a-resume-20261002/evidence/`; immutable packages are
under `248-final-artifacts/`. The fixed old artifact was rebuilt from a detached
worktree at the exact pre-switch commit, without a hidden fixture build.

| Actual artifact | Files | Code bytes | Dictionary bytes | Tree SHA-256 |
| --- | ---: | ---: | ---: | --- |
| `fixed-old-19e89b6` | 237 | 1,508,511 | 0 | `5714bb2fecfd86d5384ac0369f5cffe667804ba7733cccf6b76bdb48b0c92cce` |
| `current-legacy-5117dcf` | 254 | 1,582,442 | 0 | `2ba2e4c02655337b729451e35e573c81a857623acc516799cba90c9f910e9795` |
| `current-wxt-5117dcf` | 149 | 1,456,604 | 0 | `075cf55d9a203aef5fe685b972688d4b8011792fe7576ded9dfca82d78cf8e3f` |
| `current-wxt-release-1e955c7` | 227 | 1,456,604 | 36,830,492 | `7bd0fbb1d4aab14a7404d960efb88df76fc0cf3011cddc144004023ada97f8c7` |

The unchanged WXT code ceiling is **1,576,595 B**. The current legacy comparison
has grown with upstream locale/Reading code; its observed size is retained and
does not raise the WXT ceiling. The WXT background closure is 366,557 B; Popup /
Options compiled UI closure including 26,217 B HTML is 415,166 B. Release and
development WXT non-dictionary files match byte for byte. Current legacy and
WXT Manifests are semantically identical. Compared with fixed `19e89b6`, only #249's
name/description/action-title/command-description placeholders and
`default_locale: "en"` differ. Permissions, shortcuts, stable runtime paths,
background type and declared Chrome 102 minimum do not change. File inventories
and allowed Manifest differences are in `248-current-production-inventories.json`
and `248-current-release-inventory.json`.

The actual full runs discovered the same 118 cases. Their results remain
separate from subsequent bounded corrections:

| Executed command / input | Observed result | Evidence |
| --- | --- | --- |
| `npm run validate`, `5117dcf` | PASS: 486 checked source files, 926 Node tests, strict typecheck, 4 Vitest tests / 3 files, legacy build | `248-5117dcf-validate.log` |
| `npm run build:extension:wxt`; `npm run test:wxt:smoke`, `5117dcf` | PASS: actual WXT production audit and limited native smoke | `248-5117dcf-wxt-build.log`, `248-5117dcf-wxt-smoke.log` |
| `npm run test:e2e -- --reporter=line,json --output <unique-wxt-output>`, actual current WXT, `5117dcf` | **FAIL**: 113 PASS / 4 SKIP / 1 FAIL, 4.7 min; missing-locale upgrade initially expected an unobserved default write | `248-5117dcf-wxt-full.json`, `.log`, `-results/` |
| Same full discovery with actual current legacy and matching locale artifact | PASS: 111 PASS / 7 SKIP, 5.2 min | `248-5117dcf-legacy-full.json`, `.log`, `-results/` |
| Bounded upgrade corrections at `1e955c7`, `141dbab`, `16f4e7f` | **FAIL**: respectively 1 PASS / 1 FAIL, 2 FAIL, 2 FAIL; original reports/traces remain | corresponding `248-<head>-upgrade.*` and `-results/` |
| `npm run test:e2e -- e2e/wxt-upgrade.spec.mjs --reporter=line,json --output <unique-output>`, `ef04680` | PASS: 2 real upgrade/restart scenarios, 27.2 s | `248-ef04680-upgrade.*`, `248-ef04680-upgrade/`, `248-current-upgrade-summary.json` |
| `npm run validate`, `ef04680` | PASS: 486 checked source files, 927 Node tests, strict typecheck, 4 Vitest tests / 3 files, legacy build | `248-ef04680-validate.log` |
| Native compiled-router probe against unmodified actual current WXT | PASS: valid v2 fixed-open NOT_READY; v1 UNSUPPORTED_VERSION; Options history request FORBIDDEN; package before/after hashes unchanged, zero external requests/page errors | `248-current-compiled-router/compiled-router.json` |
| `npm run certify:lexicon`; `TRANSLATEFLOW_WXT_REQUIRE_LEXICON=1 npm run build:extension:wxt` | PASS: zero certification failures, actual production closure/descriptor/Manifest audit | `248-current-certify-lexicon.json`, `248-1e955c7-release-wxt-build.log`, `248-current-release-inventory.json` |
| Actual release `npm run test:e2e -- e2e/release-lexicon.spec.mjs --reporter=line,json --output <unique-output>` | PASS: 1 native story, 3.1 s; only test Manifest changed; zero Provider calls | `248-1e955c7-release-e2e.json`, `.log` |

Both full runs include five #232 native **source-oracle** stories using their
explicit synthetic repository/collector fixture. Those are counted separately
from actual WXT consumers and do not certify a persisted ReadingRecord or React
learning center. The five locale stories select exactly the same artifact as
their matrix entry through `TF_I18N_ARTIFACT`. The four common skips require
unprovided real private/ECDICT corpus or the separately built release lexicon;
the legacy run additionally skips the two explicitly opt-in upgrades and one
40-sample comparison. No new skip, weakened business assertion, real paid
Provider, or missing-source supplementation produced these results. The legacy
full started at `5117dcf`; its three skipped upgrade-only files changed during
that run. All applicable legacy story files and the immutable legacy package
were unchanged. It is not mislabeled as a full test-source freeze at that SHA.

The corrected permission control also passed in the actual current WXT full
run: never-granted localhost was one native call with the exact host Error;
withheld access was one PENDING call observed for 1,009 ms / 159 live samples;
grant was one FULFILLED call with an actual frame result and marker; revocation
was one PENDING call observed for 1,009 ms / 137 samples. Both negative windows
had zero markers and absent production receivers. The native registration
union, zero Provider calls and same-profile restart/pruning passed. PENDING
still does not mean denial or settlement. The production tree is the current
`075cf55…` artifact, not the earlier `7d727f…` input.

The resumed 40-sample comparison retained every cold/warm observation against
the exact ordered 48 classic files. Fixed old cold median/range was
33.30 / 32.10–35.80 ms and warm was 13.55 / 12.50–14.30 ms; current WXT cold was
33.50 / 32.00–39.80 ms and warm was 13.25 / 12.40–18.40 ms. Every sample retained
the app identity/module count, zero translation/Provider calls and document
cleanup. These measurements have no new threshold or speed-improvement claim;
the raw report is `248-5117dcf-upgrade/injection-samples.json`. Its WXT background
activation was not proven by that sampler and is superseded by the bounded
#266 activation/compiled-router comparison below, without deleting raw history.

Locked public source inputs were copied read-only into the isolated source
cache, and an offline rebuild explicitly rejected any download. Revision
`406bf83b3c507a3d1f26e88252d5d66893fd36bf` rebuilt Core 61,340 records and
Technical 10 records; all 78 generated files matched the reused cache, tree
SHA-256 `34905ee08fd6f90bb9219bdef18e689f9ca80d570ba059f597d93e0a094e540e`.
Certification used 2,100,111 B decoded cache within the existing 4 MiB bound;
dictionary bytes remain within the existing 40 MiB bound. The separate isolated
actual WXT validator controls explicitly reported development missing packs
and rejected release missing packs, a damaged shard and an incompatible format.
See `248-current-release-source-rebuild.json` and
`248-current-lexical-failure-controls.json`; no directory-exists test is called
release certification.

### Same-ID activation and user upgrade procedure

The resumed native experiment found a material unpacked-upgrade detail:
replacing files at the same version/path and merely restarting the browser can
retain the **old cached background**. Both initial workers lacked the new test
observer and returned the exact fixed-old unknown-message response to a valid
v2 fixed-open request. This phase is explicitly
`PRE_UPGRADE_CACHED_OLD_RUNTIME`, not a new-WXT background PASS. Its full snapshot
still exactly matches the old snapshot; a missing locale remains absent and
Options displays auto without writing storage.

The supported verified sequence is: retain the same unpacked directory and ID,
replace its package bytes, use **Reload** on that extension in Chrome's
extensions page with Developer mode enabled, then restart the browser. Do not
uninstall, clear data, change the directory, or add a new key to perform this
upgrade. Chrome's official
[unpacked extension behavior](https://developer.chrome.com/docs/extensions/reference/api/runtime#unpacked-extension-behavior)
describes reload as an update. The experiment independently observed this
event on the genuinely new worker, with `reason: "update"` and
`previousVersion: "0.8.0"`, and then observed the current compiled v2 NOT_READY
response. Only that proven update authorizes exactly the new missing
`uiLocale: "auto"` setting. Every other old setting, DB version/store/row,
OPFS byte/hash/pointer, preference and registration is compared strictly.
The existing zh_CN scenario preserves its value throughout.

After actual activation, the new background restores all three seeded cache
translations with no additional Provider calls. Management reload invalidates
the old native message channel; a real document refresh and reinjection restore
status. Browser restart then proves the new observer and current native v2
response again and compares the full post-recovery snapshot exactly. Chromium's
CLI-loaded profile reports an actual `install` event at that final restart;
it is retained as observed, is not relabeled as update, and is not used to derive
any expected data. The same extension ID, profile, OPFS files and database remain
continuous.

Lifecycle instrumentation is limited to the explicit WXT upgrade test copy.
It adds one native read-only listener before the actual background entry,
records at most four events in memory, and performs zero storage writes/API
mocks. Production auditing remains unmodified. The recorded background SHA-256
changes from `3d9dba21b9c5effd87d4d301875d92ac4e532ec5856614cdba4829e87c27b3a4`
to `0fc675c8e1aca8a14d3444141efee197ba5586a88331a5c7073f19cb840c1ae7`
only in that test copy. The report separately lists this `background.js`
observation, explicit synthetic dictionary assets and test Manifest host access.
Failure reports, when emitted by the final test, carry status FAIL and retained
partial phases, never partial PASS.

The code review input inventory is `248-ef04680-review-inputs.json`: it lists all
18 changed files against main `20df027…`, with before/after Git blobs. The four
upgrade/fixture/Node files changed since the original full-run input are listed
separately; test inputs are explicitly not all identical. No production or build
file changed between `5117dcf` and `ef04680`. Independent review must cover the
whole candidate, with any later documentation delta reviewed precisely.

The earlier failed assumptions remain visible: `5117dcf` required auto before
any proven update; `1e955c7` wrongly required locale absence after management
reload; `141dbab` assumed the initial worker executed replaced bytes;
`16f4e7f` required an uncontracted empty restart event list. The final two
bounded PASS results do not rewrite the original full WXT FAIL, the historical
legacy page crash, or native keyboard/60-second permission expectation failures.
Current-head CI, independent verification and independent review are still
required before stage 1 can merge. Default switching is a later authorized
phase. Chrome 102 binary, real public YouTube, other browsers, native keyboard
shortcuts, browser permission prompts, human settlement of pending injections,
paid Providers, arbitrary private dictionaries, ReadingRecord persistence and
React learning-center flows remain **NOT RUN** in this scope.

### #265 integration and affected-path revalidation

The reviewed stage-1 candidate merged actual main
`708d3a52c0ebce00fa6dabe4544e2a39acaaced5` normally, producing clean code input
`b9bc404094186a9562a3e55b0cbcf995c12dabe6`. The previous `ef04680 → 7a8c4b7`
delta is documentation only. New main contributes exactly eight approved files:
the Reading access README/E2E, four background files (`exports`, `operations`,
`runtime`, `subscriptions`), the concurrency test and new postmerge test. No
unmerged #233 changes are included. Exact deltas and source hashes are in
`248-b9bc404-input-binding.json`.

Independent whole review passed for exact `ef04680`, recorded in
`248-ef04680-independent-whole-review.json`. Independent verification then ran
the corrected actual WXT full stories with **114 PASS / 4 SKIP / 0 FAIL** and
the real release audit/certification/native story, recorded in
`248-ef04680-verifier-independent/summary.json` and
`248-ef04680-verifier-release/summary.json`. These are independent results for
that earlier input, not author self-review or replacement of the original
`5117dcf` FAIL. New background inputs require fresh packages and affected-path
evidence; old `ef04680` packages do not certify the new input.

The author's 78 generated dictionary files were verified against tree
`34905ee…`, moved intact to an isolated backup, and restored after developer
verification. No tracked file or user data was deleted. Developer packages have
**zero dictionary bytes**, while release packages contain 36,830,492 B. Frozen
packages have separate paths under `248-b9bc404-artifacts/`;
`.output/chrome-mv3` currently contains the release build and must not be called
the zero-dictionary developer package.

| Actual package at `b9bc404` | Files | Code bytes | Dictionary bytes | Tree SHA-256 |
| --- | ---: | ---: | ---: | --- |
| `current-legacy-dev` | 254 | 1,585,271 | 0 | `4c59a75b584dce05013262b3851b4f9c523510ff6c6704d65c19d5908a0dc28e` |
| `current-wxt-dev` | 149 | 1,457,777 | 0 | `132155ef917cec892d2a14ae903e0635a086e86722fabe687f26ea508ef22fbe` |
| `current-wxt-release` | 227 | 1,457,777 | 36,830,492 | `67a55ff45a6224435c9bcc101f9cf7a8375f89d52d02c1ee2749925baa5dcbc1` |

Only compiled `background.js` differs from the earlier developer WXT package,
adding 1,173 B. The code ceiling stays 1,576,595 B; background closure is
367,730 B and UI closure remains 415,166 B, including 26,217 B HTML. New legacy
and WXT Manifests remain equal. The new release's 149 non-dictionary files are
byte-for-byte equal to the new developer package. Complete audits are in
`248-b9bc404-{dev,legacy,release}-inventory.json`.

| Actual command at `b9bc404` | Result | Evidence |
| --- | --- | --- |
| `npm run validate` in developer mode | PASS: 487 checked files, 950 Node tests, strict typecheck, 4 Vitest tests / 3 files, legacy developer build | `248-b9bc404-validate.log` |
| `npm run build:extension:wxt`; `npm run test:wxt:smoke` | PASS: actual unmodified developer package/audit and finite native smoke | `248-b9bc404-dev-wxt-build.log`, `248-b9bc404-wxt-smoke.log` |
| Unmodified current compiled-router native probe | PASS: NOT_READY / UNSUPPORTED_VERSION / FORBIDDEN, all package bytes unchanged, zero external requests/page errors | `248-b9bc404-compiled-router/compiled-router.json` |
| `npm run test:e2e -- e2e/reading-access.spec.mjs e2e/wxt-upgrade.spec.mjs e2e/wxt-platform-permissions.spec.mjs --reporter=line,json --output <unique-output>` | PASS: 10 stories / 31.5 s; seven native Reading source oracles, two actual new-WXT upgrades/restarts, one actual new-WXT permission contrast | `248-b9bc404-native-impact.json`, `.log`, `-results/` |
| `TRANSLATEFLOW_WXT_REQUIRE_LEXICON=1 npm run build:extension:wxt` | PASS: actual new release closure/Manifest/descriptor audit, no missing packs | `248-b9bc404-release-wxt-build.log`, `248-b9bc404-release-inventory.json` |
| Actual new release `npm run test:e2e -- e2e/release-lexicon.spec.mjs --reporter=line,json --output <unique-output>` | PASS: one native story / 3.1 s; test copy changes only Manifest, zero Provider calls | `248-b9bc404-release-e2e.json`, `.log` |
| `npm run test:e2e -- --list` | 120 discovered stories / 39 files; not an execution PASS | `248-b9bc404-discovery.log` |

Browser commands use the isolated downloaded Chromium 153.0.8010.12, task-owned
XDG directories and fresh temporary profiles. Reading's seven source oracles
explicitly use the current source, synthetic repository and owned-collector /
learning-page fixtures; they are not WXT persisted-record or React acceptance.
Actual compiled-package proof remains separate. Upgrade/permission consumers
select frozen new developer package `132155ef…`; upgrades retain immutable fixed
old `5714bb2…`, the same profile/path/ID, real UI settings/imports/cache seed,
native update proof, exact storage/OPFS/registration continuity and new runtime
after browser restart. Management Reload and the cached-old initial phase remain
part of the verified upgrade procedure.

`248-b9bc404-native-permission.json` again records one hard-denied native
REJECTED call, one withheld PENDING call, one granted FULFILLED call and one
revoked PENDING call. Negative windows have no marker or production receiver;
registration union/rejection, same-profile startup pruning of all three site
lists and zero Provider calls pass. Pending consent settlement remains NOT RUN.

All 135 Content/MAIN/Worker raw closure files retain the earlier source SHA-256;
the 48 ordered Content files were unchanged at this input. The earlier 40 raw
samples remain historical observations. Input equality alone did not prove
which background Chrome executed at the same profile/path/version; the #266
correction below performs a fresh comparison after actual new-worker activation.
Locale runtime/Manifest/generator inputs and every
non-background compiled developer file are unchanged, retaining earlier locale
evidence precisely. The same 78 dictionary files, source locks and generators
bind the earlier zero-failure certification to this release's data. Fresh
current release build, descriptor audit, developer/release code equality and
native lookup nevertheless ran; the earlier release package is not substituted.

Local ordinary full WXT/legacy reruns at `b9bc404` are **NOT RUN**. The
current-head PR's required dual-artifact matrix will execute applicable stories
from the 120-case discovery. New-head independent delta review/verification,
automatic review, required CI and protected merge remain coordinator gates.
Historical FAILs retain their exact inputs. This remains phase 1: default /
release-engine switching is not implemented, #248 is not closed and #235 is not
unlocked. Previously listed Chrome 102, real public YouTube, other browsers,
native keyboard/permission prompt/pending consent, paid Provider, private
dictionary, ReadingRecord and React NOT RUN limits remain unchanged.

### #266 current-head CI and automatic-review corrections

PR #266 at input `8c03ca5f74ceb8151298b920bd5820d051e7c787` exposed
two actual CI FAILs: MDD and real ECDICT workflows consumed a missing
`dist/extension`, because the explicit production fixture no longer builds a
package secretly. The logs remain `266-mdd-ci-fail.log` and
`266-ecdict-ci-fail.log`. Automatic review also identified the same missing
producer in rich-lookup cancellation, cached-old sampler execution, and late
page routing's lack of worker-startup coverage
([producer](https://github.com/CoderLambert/translateflow-plugin/pull/266#discussion_r4166976311),
[sampler](https://github.com/CoderLambert/translateflow-plugin/pull/266#discussion_r4166976324),
[network](https://github.com/CoderLambert/translateflow-plugin/pull/266#discussion_r4166976335)).
Earlier independent approvals and test results retain their earlier exact
inputs; they do not approve these corrections.

The bounded correction was frozen before execution at
`813d6479ab3a272687b026f52cb88a6633c1b7d0`. Only three workflows, dedicated
migration tests/support and a dedicated Node failure-path test changed.
Production sources, build scripts/configuration, package/lock, Manifest and
permissions are unchanged from `8c03ca5`. The actual WXT developer package is
the already audited `b9bc404` package, still 149 files / 1,457,777 code B /
zero dictionary B, tree
`132155ef917cec892d2a14ae903e0635a086e86722fabe687f26ea508ef22fbe`.
The immutable old package remains
`5714bb2fecfd86d5384ac0369f5cffe667804ba7733cccf6b76bdb48b0c92cce`.
Fresh inventories and explicit production-input binding are recorded in
`248-813d647-input-binding.json`; no old package is renamed as a new build.

Each of `mdd-resources.yml`, `rich-mdict-compatibility.yml` and
`rich-lookup-cancellation.yml` now explicitly runs `npm run build:extension`
before its browser gate and passes `TF_E2E_ARTIFACT: dist/extension` with
`TF_E2E_ARTIFACT_SOURCE_HEAD: github.sha`. This remains the stage-one legacy
producer. Pinned independent writer regeneration, real upstream checksum/corpus
checks, `ECDICT_MDX_ONE_CLICK_GATE: "1"`, cancellation/security assertions
and job timeouts are retained. Other fixture workflow consumers already have an
explicit build or `validate` producer. Existing PyYAML 6.0.3 parsed all three
workflows and checked producer order and artifact inputs;
`248-813d647-workflow-audit.json` records that PASS and the initial optional
Node-parser FAIL (`yaml` package absent; no dependency added).

The upgrade tests await an isolated HTTP proxy listener before launching
Chromium. Only the exact mock `http://127.0.0.1:<port>` is forwarded to that
fixed loopback destination. Other HTTP requests, every CONNECT and WebSocket
upgrade are rejected; logs contain origins only. Listener failure prevents
browser launch. Chromium receives a single fixed proxy with no DIRECT fallback,
`proxy.bypass: "<-loopback>"` and QUIC disabled. The
[Chromium manual-proxy documentation](https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md)
documents subtracting the implicit loopback bypass and HTTPS CONNECT behavior.
This affects only the isolated test profile, with no system network or real
profile changes.

Explicit old/new test copies prepend three native fetch controls to the worker
entry: HTTP and HTTPS at a unique `.invalid` origin, plus the non-allowed
`localhost` alias of the mock port. They neither mock APIs nor write extension
storage, add permissions, or supply missing runtime files. Every old-start,
cached-old replacement, management-reload and browser-restart worker must settle
all three calls in the existing bounded assertion window; each corresponding
origin must have a fresh proxy rejection after that phase's observation boundary.
Both HTTP controls actually returned 403; HTTPS actually rejected after CONNECT
was denied. Across both stories this verifies 24 native startup calls. Production
artifacts stay unmodified; test-copy background before/after hashes, control
metadata and lifecycle-observer changes are recorded in each report.

| Upgrade scenario | Outside-mock attempts | Rejected | Outside-mock forwarding | Additional Provider calls |
| --- | ---: | ---: | ---: | ---: |
| Missing stored UI locale | 70 | 70 | 0 | 0 |
| Existing stored `zh_CN` | 71 | 71 | 0 | 0 |

Twelve attempts per story are deliberate startup controls. Other rejected
origins include browser ambient traffic. Origin-only evidence cannot attribute
every other attempt to Chrome or production code, and does not claim OS-level /
all-protocol isolation or zero attempted external requests. Both stories retain
the same ID/path/profile, all original storage, DB v2 stores/rows, all OPFS byte
hashes and active pointers, enabled/preferred settings and native registrations.
Management Reload still proves the real update event and new v2 runtime before
recovery; restart proves the new runtime and exact recovered snapshot. The sole
locale initialization exception requires the observed native update; existing
`zh_CN` stays intact. One explicit localhost translation seeds three cache
rows, with no later Provider call.

The sampler also performs isolated management Reload before the WXT phase.
The initial WXT marker was actually absent, confirming the cached-old hazard.
Before any samples, the new worker must execute a test-copy marker equal to the
selected production package tree and return the real compiled v2 fixed-open
`READING_NOT_READY` response. A marker prefix alone cannot pass. Production
background SHA stays
`58298b000e722120b5b5cf986ae0c677dfa94a06d5cb46a6e6e28a0c87f394fb`;
only this sampler copy's marker changes it to
`571efee26cb43f123b3253736b3c8e88991ccb741b59b29ae1f7d5fcc6af0c0f`.

| Fresh raw samples | Cold median / range (ms) | Warm median / range (ms) |
| --- | --- | --- |
| Fixed old: 10 cold + 10 warm | 19.20 / 17.70–23.20 | 8.55 / 6.40–9.90 |
| Activated actual WXT: 10 cold + 10 warm | 19.60 / 16.80–22.20 | 8.25 / 6.70–9.50 |

All 40 observations, native activation, package/test-copy hashes, same-app/module
counts, zero translated nodes/Provider calls and document cleanup are retained
in `248-813d647-upgrade/injection-samples.json`. Same profile/path/ID,
viewport and ordered 48 raw files remain the comparison contract. No threshold,
best-run selection or speed claim is introduced.

| Command at frozen `813d647` test input | Actual result | Evidence |
| --- | --- | --- |
| `node --test tests/wxt-closed-network.test.mjs` | PASS: 3 tests; exact-origin forwarding, HTTP/CONNECT/alternate-loopback denial, origin-only logs, listener conflict, absent native results/late evidence/overflow/forwarding fail closed | Node output and full validate log |
| `npm run build:extension` | PASS: actual legacy producer; existing generated dictionaries present, 332 files / 38,415,763 total B / 1,585,271 code B / 36,830,492 dictionary B | `248-813d647-explicit-legacy-build.log`, `-inventory.json` |
| `npm run test:e2e -- e2e/wxt-upgrade.spec.mjs e2e/wxt-injection-samples.spec.mjs --reporter=line,json --output <unique>` with explicit immutable old/current WXT inputs | PASS: 3 stories / 21.1 s; two continuity stories, worker-startup controls and all 40 samples | `248-813d647-native.json`, `.log`, `-results/`, `-upgrade/` |
| `npm run test:e2e -- e2e/mdd-resources.spec.mjs e2e/rich-mdict-product.spec.mjs e2e/selection-rich-lookup-cancel.spec.mjs --reporter=line,json --output <unique>` against the freshly frozen explicit legacy build | PASS: 4 stories / 24.1 s; native resources/import/security/cancellation assertions retained | `248-813d647-specialty.json`, `.log`, `-results/` |
| `npm run validate` | PASS: 489 checked files, 953 Node tests, strict typecheck, 4 Vitest tests / 3 files, actual legacy build | `248-813d647-validate.log` |

Fresh legacy tree is
`7297d6e83f074d90171611d6f583def1f211c95a80ff85768b2c118ebaae2121`;
its non-dictionary files equal the prior current legacy developer package.
Fixture adapters replace only explicit synthetic dictionary assets and test
Manifest host access; no production source is appended to a compiled package.
Local specialty stories use existing synthetic independent-writer fixtures.
Fresh locked-writer regeneration / 100 MiB evidence and real ECDICT corpus /
one-click stories are **NOT RUN locally** for this correction; unchanged required
workflow gates must pass on the new PR head. Ordinary full dual-artifact
current-head CI, independent incremental review and verification remain
coordinator gates. All earlier CI/full-suite FAILs, timeouts and sampling-proof
limitations remain recorded, and prior NOT RUN limits remain. Default switching
has not occurred; this is not #248 completion, #235 activation or
React/ReadingRecord acceptance.

### #266 second current-head correction and locale installation race

The implementation freeze for this correction is
`5ba585c3434e7989c3b82e7651ad0fe1bf8683ef`. Native execution below binds to
`7481d254153b1ebc16602f72741d82e45c6f7802`; the only later implementation
delta is five explicit artifact/source-head environment lines in
`lexicon-release.yml` and `dictionary-library-vnext-certification.yml`.
All native test/fixture inputs and production sources are byte-identical
between those heads. The final evidence commit changes only this document.
`248-5ba585c-input-binding.json` records Git input blobs, package inventories
and report/log SHA256 values under the existing local evidence directory.
This binding does not label a previous native run as a new-head execution.

The five additional automatic-review findings at the previous `7be055b` head
are addressed within the existing stage-one test/build-consumer boundary:

- `4167584953`: `test:e2e` and `test:e2e:rich-mdict` now use the explicit
  `scripts/run-e2e.mjs` wrapper. Its default is the documented actual
  `.output/chrome-mv3` WXT package. An explicit `TF_E2E_ARTIFACT` selects a
  legacy package; it also supplies the matching locale input unless
  `TF_I18N_ARTIFACT` is explicitly provided. Empty/missing selected inputs
  fail before execution; there is no builder, existence fallback or residual
  `dist/extension` selection. Test discovery does not execute a package.
- `4167584955`: all existing applicable event path filters in the three
  specialty workflows cover `e2e/support/**`, including the production
  adapter and frozen mapping. Their existing explicit legacy producers and
  strong corpus/writer/security/cancellation gates remain. Both release
  workflow consumers now explicitly select their existing `dist/extension`
  producer with `TF_E2E_ARTIFACT_SOURCE_HEAD: github.sha` and matching locale
  input. Default production build selection has not changed.
- `4167584959`: server/proxy startup, manifest reads and version checks are
  inside the upgrade test's protected region. Nested cleanup covers partial
  startup and evidence-write failures. Native `TCPServerWrap` counts are
  recorded before and after closure. Missing old/new manifests and version
  conflict each actually fail and return to zero listeners without a browser
  launch, Provider call or supervisor timeout.
- `4167584963`: the immutable `19e89b6` package uses its own frozen mapping,
  including both source-file SHA256 values and Git blob IDs. Current packages
  still use the complete current mapping. The sampler uses each selected
  generation's injection order. Future current-only resources cannot become
  requirements for the old package; missing old workers still fail.
  `19e89b6-runtime-mapping.json` has SHA256
  `21eb874a9db5abf840537398dbf4fe9ed49b3338defed1b4e76ad1ed0dde1d35`.
- `4167584969`: recovery now compares every database name/version,
  store, row and field against the pre-upgrade snapshot before accepting the
  restart baseline. Only valid monotonic `lastAccessedAt` updates on existing
  translation/page rows are allowed within the observation time. The
  three-translation assertion remains. Eighteen corrupt snapshots retaining
  three translations are rejected, covering content, identity, configuration,
  timestamps, pages, selection rows and database/store changes.

The release locale CI FAIL at `7be055b` remains a FAIL
(113 PASS / 6 SKIP / 1 FAIL). A bounded diagnostic copy of the unchanged
actual WXT release package captures the native install event and defers its
real defaults callback. Before releasing that callback, native storage is
`{}` and the synthetic read failure shows the disabled UI and Retry button.
After clearing the failure flag and releasing the real callback, native
`onChanged` observes `uiLocale: auto`; the UI recovers and Retry disappears.
The original retry-click visibility assertion actually fails.
`248-locale-install-race-probe.json` records `REPRODUCED_FAIL`, zero probe
storage writes, zero permission changes and production/test-copy hashes.
This demonstrates the fixture race; it does not uniquely reconstruct the
original CI scheduling and is not unmodified-package acceptance.

The final locale fixture instead waits, before opening Options, for native
installation defaults to reach `{ uiLocale: "auto" }` in the unmodified actual
package. This ten-line readiness change retains the original read-error,
disabled-control and retry assertions, existing timeout and production
`onChanged` behavior. No production locale controller change was needed.

| Executed command/input | Actual result | Local evidence |
| --- | --- | --- |
| Focused Node tests for entry selection, versioned mapping and upgrade expectations | PASS: 8 tests; residual legacy/missing WXT, future current resources, absent old workers and 18 same-count corrupt database controls | `tests/wxt-e2e-entry.test.mjs`, `tests/wxt-runtime-mapping.test.mjs`, `tests/wxt-upgrade-expectations.test.mjs`; validate logs |
| `npm run test:e2e -- e2e/wxt-upgrade.spec.mjs e2e/wxt-injection-samples.spec.mjs e2e/ui-locale.spec.mjs --reporter=line,json --output <unique>` at `7481d25` with explicit immutable old/current WXT and release-locale inputs | PASS: 8 stories / 30.0 s / 0 SKIP / 0 FAIL; two same-ID continuity stories, all 40 samples and five release locale stories | `248-7481d25-native.json`, `.log`, `-results/`, `-upgrade/` |
| Real upgrade CLI with missing old manifest / missing new manifest / conflicting version | Expected FAIL: exit 1 in 1161 / 1035 / 1072 ms; all listener counts 0 → 0, no timeout, no phase or Provider call | `248-7481d25-negative-cleanup.json` and three `-negative-*.log/json` reports |
| `npm run validate` at `7481d25` and again at `5ba585c` | PASS at each: 493 checked files, 958 Node tests, strict typecheck, 4 Vitest tests / 3 files, actual legacy build | `248-7481d25-validate.log`, `248-5ba585c-validate.log` |
| `npm run test:e2e:rich-mdict -- --grep 'corrupt key-info' --reporter=line,json --output <unique>` at `5ba585c`, artifact overrides unset | PASS: 1 native story / 1.6 s; wrapper actually selected WXT `.output/chrome-mv3` | `248-5ba585c-default-alias.log/json` |
| Existing PyYAML checks at `5ba585c` | PASS: five workflow producer orders and explicit artifact/source-head inputs; all existing specialty path-filter events covered | `248-5ba585c-workflow-audit.json` |
| First `npm run test:wxt:smoke` at `5ba585c` | FAIL before browser launch: developer output lacked generated lexicons while restored source assets required them | `248-5ba585c-wxt-smoke.log` |
| Same `5ba585c` input, own generated assets temporarily preserved outside the source tree, `npm run build:extension:wxt` then `npm run test:wxt:smoke` | PASS: same-mode actual developer build, strict audit and native smoke; generated assets then restored intact | `248-5ba585c-dev-build.log`, `-dev-smoke.log`, `-browser-smoke.json` |

The freshly built `5ba585c` developer package is frozen at
`248-5ba585c-current-wxt-dev`: 149 files, 1,457,777 code/total bytes,
zero dictionary bytes, tree
`132155ef917cec892d2a14ae903e0635a086e86722fabe687f26ea508ef22fbe`.
It equals the native-test WXT production package file for file. The unchanged
release tree remains
`67a55ff45a6224435c9bcc101f9cf7a8375f89d52d02c1ee2749925baa5dcbc1`:
227 files, 38,288,269 total bytes, 1,457,777 code bytes and 36,830,492
dictionary bytes. Own generated source assets were restored to tree
`34905ee08fd6f90bb9219bdef18e689f9ca80d570ba059f597d93e0a094e540e`.
The code ceiling stays 1,576,595 bytes; lockfile, production Manifest,
permissions, Provider/cache/schema and runtime sources are unchanged.

Both fresh continuity stories retain management Reload activation and current
compiled v2 runtime proof before WXT recovery. They compare all database
content, OPFS bytes/pointers, settings and registrations, then the complete
recovered snapshot after browser restart. Each records 68 outside-mock attempts,
all blocked, zero outside-mock forwarding and zero additional Provider calls.
The native startup controls and origin-attribution limitations above remain.
The new 40 observations use the correct old/current mappings and real WXT
activation; all raw observations remain in the `7481d25` report. Earlier
`813d647` timings and network counts describe only that earlier run.

New-head cloud workflow execution, ordinary full dual-artifact E2E, pinned
writer regeneration and real ECDICT corpus/one-click gates are **NOT RUN
locally** in this bounded correction. Required current-head CI and independent
review remain coordinator gates. Chrome 102, real YouTube, native keyboard
commands, pending click-to-run recovery, other browsers and React/ReadingRecord
product acceptance remain **NOT RUN**. Earlier failures, timeouts and partial
evidence retain their original status. All local processes ended; no default
switch, release publication or #248 completion is claimed.
