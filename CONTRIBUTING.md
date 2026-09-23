# Contributing to TranslateFlow

## Before coding

- Keep permissions minimal.
- Prefer extending an existing module boundary over cross-layer calls.
- Never commit API keys, `.env`, Chrome signing keys (`.pem`) or captured private page data.
- Avoid mixing feature behavior, broad formatting changes and storage migrations in one PR.

## Required validation

```bash
npm run validate
```

There are no npm runtime/dev dependencies. The command uses Node built-ins for syntax checks, architecture guards and unit tests.

## Module rules

- Pure shared contracts/helpers: `src/shared/`
- Provider/network code: `src/background/providers/`
- IndexedDB: `src/background/cache-db.js` only
- Dynamic site registration: `src/background/auto-sites.js` only
- DOM extraction/rendering: `src/content/dom.js`
- Grouping/batching: `src/content/batch.js`
- Cache-first translation flow: `src/content/processor.js`
- Automatic scrolling/dynamic-content behavior: `src/content/auto.js`

Keep entry files thin. If `background.js` or `content.js` starts accumulating business logic, extract it.

## Message protocol

Add new message identifiers to the shared contract first. Avoid new ad-hoc strings across Popup, Options and background code.

The content-script runtime currently mirrors message values because content modules are classic scripts with no build step. Treat this mirror as compatibility-sensitive.

## Cache changes

The translation cache is user data. Do not bump `DB_VERSION`, rename stores/indexes, or alter cache-key semantics in an unrelated change.

A cache migration requires:

1. migration strategy
2. rollback/backward compatibility consideration
3. explicit schema/version update
4. tests for URL/text/config identity

## Permissions

Adding a required host permission must include rationale in the PR. Prefer optional per-site permissions whenever possible.

## Commits

Use focused conventional-style messages:

- `feat: add openai-compatible provider`
- `refactor: isolate content batching`
- `fix: preserve cache across whitespace changes`
- `docs: document cache migration rules`
