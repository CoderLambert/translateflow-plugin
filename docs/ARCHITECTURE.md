# TranslateFlow Architecture

## Dependency direction

```text
UI (popup/options) ───────┐
                         v
                 shared contracts
                         ^
                         |
content scripts -> runtime messages -> background router
                                      |       |       |
                                      v       v       v
                                    cache   provider  auto-sites
```

## Hard boundaries

1. `src/shared/` contains pure contracts/utilities and must not access `chrome.*`.
2. External HTTP calls live only in `src/background/providers/`.
3. IndexedDB access lives only in `src/background/cache-db.js`.
4. Dynamic content-script registration lives only in `src/background/auto-sites.js`.
5. `background.js` and `content.js` are composition/bootstrap entries, not feature modules.
6. New runtime message values are defined centrally before use.
7. Permissions are treated as API surface: do not broaden them incidentally.

These rules are partially enforced by `scripts/check.mjs`.

## Background

- `config.js`: defaults and storage-backed configuration.
- `providers/`: translation-provider adapters.
- `cache-db.js`: persistent translation cache and LRU pruning.
- `auto-sites.js`: optional site permission and persistent content-script registration.
- `router.js`: message routing only.
- `index.js`: service-worker lifecycle wiring.

Provider contract:

```text
translateBatch(segments, config) -> [{ id, text }]
test(config) -> string
```

A new provider should not know about DOM nodes, IndexedDB records or Popup state.

## Content scripts

Chrome content scripts remain build-free. Ordered classic scripts attach modules to the isolated-world namespace `globalThis.__TRANSLATE_FLOW_CONTENT__`.

Order:

1. `runtime.js`
2. `dom.js`
3. `batch.js`
4. `processor.js`
5. `auto.js`
6. `content.js`

Both manual injection and persistent site registration consume `CONTENT_SCRIPT_FILES`; do not duplicate the list.

Responsibilities:

- runtime: state, URL/page identity, runtime message helper
- dom: scan/extract/render/remove
- batch: group identical text and create API-sized batches
- processor: cache-first orchestration
- auto: observers, incremental queue, retry/backoff
- bootstrap: message and storage-change listeners

## Cache compatibility boundaries

Treat these as migrations:

- IndexedDB DB version/name
- object-store/index shape
- cache schema version
- URL normalization
- source-text normalization
- provider/model/prompt/target-language fingerprint

v0.4 intentionally keeps the v0.3 cache identity for DeepSeek.

## Message protocol

There are two channels:

- UI/content -> background
- UI -> content

ES-module contexts import constants from `src/shared/constants.js`. The build-free content runtime mirrors the values internally. If a value changes, update both sides and add tests.

Future option: if a build pipeline is introduced, generate the content runtime contract from the shared source rather than maintaining a mirror.

## Adding features

### New provider

Only add files under `src/background/providers/`, register it in `providers/index.js`, then expose configuration in Options. Do not add provider-specific branches to content/cache modules.

### Selection translation

Create a dedicated content module. Reuse runtime messaging/provider routing. Do not put selection UI into `dom.js` if it has independent state/lifecycle.

### PDF

Treat PDF extraction/rendering as a separate surface. Reuse provider and cache primitives where identities remain meaningful; do not force PDF DOM behavior into the webpage scanner.

### Cache schema change

Require a migration plan, version change, rollback consideration and tests before changing persistent storage.
