# Cache module self-review — 2026-10-18

Subject: main baseline 961a3757f3cad93921031b038e52e621c8c840b7 plus this cache implementation. Self-review, not independent-model audit. No merge or deployment.

## Verified isolated regressions

Four new failure cases were added to the local source overlay and observed failing before fixes:
1. A subtitle/cache locator could be sent instead of the descriptor's actual providerText.
2. Caller mutation after coordinator.run could alter the request after its key was built.
3. Extra identity properties could override recordVersion through object spread.
4. An invalidation from a second cache service could make a new read join an obsolete local in-flight producer.

Fixes pin coordinator inputs, send descriptor source.text, explicitly project envelope identity fields and add durable read epochs to the load-sharing key. The four new tests then passed with the existing suite: **108/108 under Node22.16.0**. The guarded offline patch-transform tests also passed **15/15**. These are local overlay checks, not the complete remote candidate's Node24/WXT validation.

## Test boundaries

- Actual command: `node --test tests/cache-system*.test.mjs` against the isolated source overlay.
- Native browser attempt: navigation denied with ERR_BLOCKED_BY_ADMINISTRATOR; **0 native cases executed**. No policy bypass attempted.
- Full repository npm ci/validate/Node24 and WXT installation package: **NOT RUN**, no available Node24/download environment.
- Remote source/call-site integration is part of this branch, but exact candidate freeze and full proof remain outstanding.
- No actual paid Provider calls or user's real browser data used.

## Remaining work before final acceptance notification

Keep status working; do not mark ready_to_sync/completed from test counts alone. Resolve existing-test/mocks and historical WXT upgrade expectations under the new token/envelope contract. Validate all consumers' storage-failure display behavior. Run native-IDB and production compiled-extension checks in a permitted environment, build/fingerprint a candidate, and only then ask for the user's product acceptance. PR #342 is not a dependency that may be silently merged; its MT code must later adapt to this cache module.


## Continuation: Content UI persistence fallback (2026-10-18)

The original isolated overlay result (108 tests on Node22) remains historical. Additional remote-branch edits now cover storage-response failures in the actual classic Content modules.

**Reproduced before the fix using fetched Content IIFEs and a deterministic synthetic runtime:**
- Page cache-only restoration with an unavailable database lost the lookup warning and incorrectly reported a genuine cache miss.
- A successful Page translation followed by `CACHE_STORE {ok:false,errorCode:CACHE_QUOTA}` marked the task failed.
- Selection with the same storage response never displayed its already-verified translation.
- The Chrome local translator's native plan threw on an equivalent cache failure; lookup warnings were omitted from the plan response.

**Implemented on the existing PR branch:**
- Propagate Page cache-read warnings through cache-only / no-uncached early returns.
- Classify only `CACHE_QUOTA`, `CACHE_STORAGE`, `CACHE_STORAGE_BLOCKED`, and `CACHE_STORAGE_TIMEOUT` as recoverable persistence faults in the classic Content runtime; a parity test keeps the classifier aligned with Background. Never downgrade `CACHE_INVALID_TOKEN`, `CACHE_INVALIDATED`, `CONFIG_SNAPSHOT_EXPIRED`, or `CANCELLED`.
- Page and Selection preserve valid generated translations and show an explicit unsaved-cache warning when a cache-store response reports a recoverable fault.
- Chrome local Selection and Subtitle retain the verified local-model result on a cache-store error; native lookup forwards a storage warning and skips tokenless writes. No automatic Provider rerun.
- Extended `tests/cache-system-persistence-failure.test.mjs` and `tests/native-client.test.mjs` to capture these cases.

**Executed this turn**: fetched exact remote Content IIFEs and invoked them with an isolated, deterministic V8 mock runtime, yielding **20/20 Page+Selection scenarios PASS** and **9/9 Chrome-local scenarios PASS**, covering both recoverable storage errors and fail-closed identity/config/cancellation outcomes. These are targeted source execution checks with mock dependencies, **not** Node project's `npm test`, TypeScript, compiled MV3, native IDB, or browser E2E. There were no live Provider calls.

**Outstanding**: Node24/npm11 `npm ci && npm run validate`, actual WXT/Chromium/IndexedDB DB2/3→4 upgrade and rollback, existing full tests/mocks, actual UI smoke with real browser extension, build fingerprint, user acceptance. Current environment contains Node22.16.0/npm10.9.2 and cannot resolve github.com/npm downloads; the earlier managed Chromium `ERR_BLOCKED_BY_ADMINISTRATOR` remains unresolved. Keep task `working` and PR Draft; do not promote this report to whole-module acceptance.


## Continuation: incremental warnings and explicit plain/rich source contract (2026-10-18)

**New source fixes submitted after the UI storage-failure work:**
- `src/content/auto.js` now surfaces a rate-limited cache failure toast for incremental automatic translation or cache-only restoration. It reuses `state.lastAutoErrorAt` (5-second throttle), keeps successful auto tasks successful, and never turns cache-only restoration into a Provider request.
- `src/shared/translation-cache-identity.js` now defaults to `format: 'plain'` unless the caller explicitly requests `tf-markers`. Previously a literal `⟦TF:...⟧` example in a user paragraph could be misclassified as structured or rejected on a missing closing marker. Real Page/Selection/Subtitle callers already supply explicit formats; explicit rich still receives marker-tree validation and isolated cache identity.
- Added `tests/cache-system-auto-feedback.test.mjs` (4 Node cases) and two marker-protocol cases in `tests/cache-system-domains.test.mjs`.

**Executed source-only checks this turn:** five actual auto.js IIFE scenarios using an isolated V8 fixture (auto warning, cache-only warning, two silent-success scenarios, throttled repeat) **5/5 PASS**; after source contract change, seven translation-cache-identity.js V8 scenarios (balanced/unbalanced user literal tokens, explicitly structured input, protection rejection, malformed rich rejection, rich/plain separation) **7/7 PASS**. Earlier 29/29 mock-driven Content cases were verified against the previous candidate; they are not a substitute for complete tests of the new head. These checks neither install WXT nor exercise native IndexedDB.

**Still NOT RUN:** this exact remote candidate's `npm run validate` on required Node24/npm11; actual Node `--test` for the newly added files; native Chromium IDB upgrade and rollback; compiled WXT/MV3 behavior; installation package and user acceptance. No paid Provider requests. Remain Draft / working until full verification is available. Not an implementation-wave completion.


## Continuation: namespace-isolated capacity pruning (2026-10-18)

**Reproduced** against the actual Memory driver code in an isolated V8 harness: the old globally scoped `pruneCache` used all namespaces as a shared LRU. With a small translation budget and an older `selection-explanation` record, the explanation was evicted before translation entries. This changed the old explanation-retention behavior and undermined the new independent-domain policy.

**Fix**: `pruneCache(maxBytes)` now supplies the two explicit translation namespaces (`translation` and `subtitle-translation`) as a combined quota scope. Both storage drivers implement the same optional `namespaces` filter for `prune`; the original single-`namespace` and global modes remain. Mixed/empty/duplicate/overly large or malformed namespace filters are rejected. No DB layout, migration, existing cache record reader or general cache policy changes are required. `clearAllCache` remains intentionally global.

**Tests added**:
- `tests/cache-system-domains.test.mjs`: a 6-entry cross-namespace over-budget regression with an older independent AI explanation record; asserts eviction and explanation preservation.
- `tests/cache-system-browser-cases.js`: actual native IndexedDB equivalent covering combined budget, explanation isolation, and mixed-filter rejection (committed but **NOT RUN**).

**Executed isolated checks**: latest Memory store code with three namespaces and an over-budget translation set passed explanation preservation, combined translation-byte-budget and invalid-filter cases (**PASS**); latest application.js transmitted exactly the two requested translation namespaces (**PASS**). Parsed latest application.js, storage-memory.js and storage-indexeddb.js function bodies in the V8 runtime without syntax errors. Native IDB, actual Node suite, E2E and compiled extension remain **NOT RUN** due to environment restrictions. These mock and parse checks do not prove the native IndexedDB behavior.

**Rollback consideration:** reverting the application-only scoping restores former global LRU semantics; reverting the optional driver filter as well is safe only after the application no longer passes `namespaces`. No stored record schema changes or data-clearing side effects are introduced.
