# Independently evolving cache module

Status: implementation branch, not release acceptance. The user explicitly asked to finish this cache module before resuming other translation modules. This document supersedes earlier DB3-only cache implementation details; it does not authorize a merge or release.

## Boundaries

| Layer | Files | Owns |
|---|---|---|
| Pure identity | `src/shared/cache/identity.js` | Bounded canonical JSON, namespace/scope/revision key, SHA-256; no database version or business assumptions |
| Record/policy | `src/shared/cache/record.js` | One JSON envelope, TTL, validation and byte budgets |
| Request sharing | `src/shared/cache/single-flight.js` | Consumer cancellation and in-flight lifetime, not persistence or network |
| Cache service | `src/background/cache/service.js` | Read/write/load modes, validation, namespace policy, bounded retry of storage and diagnostics |
| Storage | `src/background/cache/storage-indexeddb.js`, `storage-memory.js` | Driver contract, atomic writes, durable invalidation fences, LRU/expiry |
| Business identity | `src/shared/translation-cache-identity.js` | Actual source, engine/model/endpoint/languages/prompt/parameters/strategy/format |
| Business adapters | `src/background/cache/application.js` | Translation, subtitle and explanation namespaces and current UI-facing result contracts |
| Stable facade | `src/background/cache-db.js` | Existing exported API, no direct IndexedDB or request identity logic |
| Translation execution | `src/background/cache/translation-coordinator.js` | Pinned inputs, final-prompt grouping and existing Provider gateway |

The sole general-cache IndexedDB owner moves from `cache-db.js` to the exact driver file. `scripts/source-boundaries.mjs` enforces that one path, not a wildcard. ReadingRecord retains its independent storage owner. No new runtime dependencies, network permissions, model download mechanism or Provider service are introduced.

## Three independent versions

- **Physical database layout = 4**: `ai_bilingual_translator` contains generic `entries` and `epochs`, replacing the old translation-specific tables. This is an actual layout change, not a prompt version bump.
- **Record envelope = 1**: all current namespaces use one parser and one envelope; namespace-specific values are validated by registered policies.
- **Domain strategy revision**: extraction, prompt/format protocol, actual model settings and source policy affect keys. These changes do not increment DB4 or introduce another record parser.

`CACHE_SCHEMA_VERSION` remains only an exported alias of the current record version for existing imports; it is not used to define translation request semantics.

Old ordinary translation rows and their page index are discarded exactly once on DB upgrade. There is no old translation decoder, fallback key or dual write. Independent explanation results are moved once as opaque values in the upgrade transaction, then the old store is removed. Reading records, dictionary files and settings are untouched. Invalid opaque data aborts the transaction rather than silently losing it. A downgrade to an old application that only opens DB2/3 is not a supported rollback; a maintenance rollback must understand DB4.

## Stable service contract

Register a namespace and a synchronous JSON-value validator with TTL/count/bytes policies. Construct its identity from a non-sensitive scope ID and the exact domain input. Use `read/readMany`, `write/writeMany`, `getOrLoad`, `invalidate`, `prune` and `stats`.

Every stored write must use the token returned by the earlier read. The token records global, namespace, scope and key invalidation epochs. Read-token comparison and the data write occur in the same backend transaction. Clearing a page while a Provider is in flight therefore cannot be undone by the old answer returning later. A caller that has no token must perform its read before generation; it must not silently get a new token just before writing an old answer.

`prefer-cache` reads then invokes the caller's loader on miss. `cache-only` never invokes a loader. `reload` invalidates only the requested key before generating. `no-store` bypasses storage. There is no automatic stale-while-revalidate or network fallback; a Provider is invoked only through an authorized caller's loader or existing translation flow.

The first consumer cancellation does not cancel other consumers. The final cancellation evicts the old entry before aborting it. A producer that ignores abort cannot capture an immediate retry or remove a newer in-flight entry in its `finally`. Cross-client invalidation epochs are also included in load-sharing identity.

TTL is absolute, not extended by reads. Policies cap namespace entries, bytes, single-value bytes and aggregate writes.

The user-facing translation quota (`pruneCache(maxBytes)`) applies a **combined** budget only to the `translation` and `subtitle-translation` namespaces. It must not evict the independent `selection-explanation` namespace simply because an old explanation is least recently used. Both storage backends accept `prune({ namespaces: [...] })` to enforce this aggregate filtered budget. The explicit clear-all operation is still global, while namespace policies and physical DB layout remain independent of translation strategy revisions. One quota failure can prune affected namespaces and retry storage once; never regenerate an expensive answer to retry a database write. Raw text, URLs, keys, prompts and credentials are excluded from generic event counters.

## Existing scenario integration

- Page batches capture format/protected IDs with the original source; lookup tokens accompany later stores.
- Selection supplies explicit plain input and propagates its read token.
- Chrome plans retain the original token across a background snapshot refresh; a clear during language-model preparation must not be undone.
- Subtitle locator identity and actual Provider text are separate; subtitle entries use a different namespace.
- AI explanation keys include the actual system prompt, payload and nonsecret configuration fingerprint; its read token is retained.
- Mixed plain/rich requests are grouped by the final effective prompt. The key is built from the same prompt configuration used by execution, and request inputs are pinned before asynchronous dispatch.

Provider credentials and UI appearance do not participate in generic cache records or telemetry. Provider/model/connection revision, actual language pair, prompt, meaningful generation parameters, input strategy and format do participate in the business identity. Temporary request IDs and database versions do not.

## Validation and unresolved acceptance work

Core, memory backend and business/coordinator tests have been executed against the local reviewed source overlay under Node 22.16.0: 108/108 passed after four explicit failing regressions were fixed. This is not a Node24 complete-repository run or native IndexedDB proof. Some formatting/comments and call-site integration were transferred afterward; the final remote candidate still requires its own scoped checks.

`e2e/cache-system-native.spec.mjs` serves only a fixed source-module allowlist and runs real IndexedDB upgrade, rollback, blocked-open, cross-client, expiry, quota-adjacent transaction and reopen contracts. `e2e/cache-system-mv3.spec.mjs` exercises the actual compiled extension facade and storage. Neither is substituted by the memory driver.

Required before user final acceptance:
1. Node24 complete repository validation and affected existing tests; inspect mocks that wrote cache without a preceding lookup token.
2. Finish the historical WXT upgrade fixture adaptation for DB2/3→4 and test same extension identity/restart with settings, dictionary and Reading preservation.
3. Run the native suite and actual WXT/MV3 cache/UI scenarios, including Page, Selection, local-model plans, subtitles and explanation.
4. Verify storage-write failures leave safe generated content available with explicit cache status in all actual UI paths, not merely in the generic `getOrLoad` tests.
5. Build one exact candidate installation package and record its fingerprint. Do not install an unverified package into the user's existing profile.

The earlier source-overlay environment was blocked by Node22/download and managed-browser restrictions. The subsequent PR #345 validation uses an isolated worktree, Node24/npm11 and real Chromium; current candidate results and limitations belong in `docs/tasks/cache-system-v1/validation-report.md` and `acceptance.json`, rather than extending historical overlay counts. The module remains unmerged and requires user acceptance.
