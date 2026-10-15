# Native selected-word quality: verification status

Base: `main@7cc6002fb575ccbd2e11044defcb88de6be4b62c`.

## Completed (direct execution with the actual edited source, not a complete checkout)

- Parsed four changed classic/IIFE JavaScript files through V8 `Function` constructor: PASS.
- Parsed the new Node test module after removing ESM imports and top-level file reads for syntax only: PASS.
- Executed edited `src/shared/browser-language.js` against four selection-context cases: PASS.
- Executed edited `src/content/browser-translation.js` in a mocked V8 runtime:
  - Two active model pairs; third pair waits until a resource is released: PASS.
  - Cancelling a queued third pair returns `CANCELLED` and creates no model: PASS.
  - Real nonempty sample translation required before `ready`: PASS.
  - Empty verification rejects, retires the model, and next preparation may retry: PASS.

The source above was loaded from exact Git blob SHAs and executed with synthetic Chrome Translator objects; no real browser model was invoked.

## Not executed

- `node --test tests/native-selection-improvements.test.mjs` and existing repository tests: NOT RUN.
- `npm run check`, `npm run typecheck`, WXT build: NOT RUN.
- Playwright/real Chrome/actual language-model download/offline test: NOT RUN.

Reason: The available container runs Node 22.16.0 / npm 10.9.2, whereas this repository requires Node 24.21+ / npm 11.19+; the container cannot resolve github.com and does not contain a complete checkout. Source edits were applied using the GitHub connector.

## Manual acceptance owner

The user verifies real Chrome behavior. Test German/English ambiguous selected words in their own sentence, prepare a new language pair and observe verification, cancel/retry model preparation, and confirm page/subtitle/long-text tasks remain AI-only.

No permissions, external dependencies, cache DB schema or browser execution context were added.
