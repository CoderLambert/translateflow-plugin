# Candidate validation report

Candidate: `e94303b309ecbb6f3eaa32c094de831e5a3fe50c`
Branch: `codex/browser-basic-translation-20261020`
Pull request: [#353](https://github.com/CoderLambert/translateflow-plugin/pull/353), open and not merged.

## Scope

Chrome browser translation is eligible for page, selected-word, and subtitle surfaces when AI is not configured. A configured AI service remains preferred; switching after an AI failure requires an explicit user click. E2E uses a local mock and sends no requests to Microsoft or Tencent.

## Candidate-bound checks

| Command | Result |
| --- | --- |
| `node --test tests/browser-translation.test.mjs` | PASS, 19/19 |
| `node --test tests/versioned-commit.test.mjs tests/release-gate.test.mjs` | PASS, 10/10 |
| `npm run check` | PASS |
| `npm run typecheck` | PASS |
| `npm run test:unit -- tests/unit/options-react.test.tsx tests/unit/react-locale.test.tsx` | PASS, 22/22 |
| `npm run build:extension:wxt` | PASS |
| `npm run build:extension` | PASS |
| `node scripts/run-e2e.mjs e2e/browser-basic-translation.spec.mjs` | PASS, 8/8 on Chromium 153.0.8010.12 |

The installed-package fingerprint recorded by `local-task.mjs` is `9ccbfe5beaf4bd5b6b0447f1447e12df995ffb4e6f2edab668fd694f2ad188ef` for `.output/chrome-mv3` (130 files, 2,965,925 bytes). The E2E runner reports a separate `treeSha256` of `cfdeedeaf462dc4949b19077fecf680572af03696a8b2eee980a9acdf8abf98e`; the two hashes use different algorithms and are not interchangeable.

## Limits and review

Real Chrome Translator model preparation, actual translation, offline behavior, and translation quality were not tested on this candidate. The mock E2E proves routing, explicit preparation, AI priority/fallback, cancellation, and local result handling only. No real Microsoft or Tencent service requests were made.

Main-agent self-check: the page and subtitle surface is retained through engine settings, cache lookup, and execution; explicit free online translation keeps its existing route; cache-only restoration does not initialize browser models. No schema or permission changes are in this diff.
