# TranslateFlow v0.8 Release Gate

This file is the release-certification record for Issue #28.

## Candidate

- Release version: **0.8.0**
- Baseline before #28 release metadata: `main@3805797172f916d7cf0f8616f9284ff21d5ee70b`
- #26 YouTube corrective merge: `155c93fef0231e0b732229500dde6ca7d45bebba`
- #45 automatic cache restore merge: `a9825e8da11c956586577dab16f3553c5c41a1ed`
- UI certification merge: `3805797172f916d7cf0f8616f9284ff21d5ee70b`

## Automated regression matrix

| Area | Evidence | Status |
| --- | --- | --- |
| Web reading | `e2e/translateflow.spec.mjs` manual/auto/selection, structured content, cache/provider counts | PASS on integrated main |
| Cache restore | persistent restore, dynamic hits, cache miss never invokes Provider, Quick-Control-only isolation | PASS on integrated main |
| Popup | `e2e/ui-redesign.spec.mjs` + `e2e/release-gate.spec.mjs` | exact #28 head CI required |
| Quick Control | task state, retry/cancel, selection precedence, Escape/click-outside, dark/reduced motion | PASS on integrated main |
| Commands | `e2e/commands.spec.mjs` first-use injection, translate, visibility, Quick Control, protected pages | PASS on integrated main |
| Settings | `e2e/settings-ia.spec.mjs` + UI certification responsive/focus coverage | PASS on integrated main |
| YouTube acquisition | `e2e/subtitles.spec.mjs` MAIN timedtext, human/ASR, track change, A→B stale reject, fallbacks | PASS on integrated main |
| YouTube pipeline/renderer | subtitle pipeline + renderer cache/failure/preset/size tests | PASS on integrated main |
| Permissions | production manifest + registration/command tests | PASS; no broad required site permission |

Integrated main evidence before the release-metadata commit:

- quality #135 — PASS on `3805797172f916d7cf0f8616f9284ff21d5ee70b`
- e2e #105 — PASS on `3805797172f916d7cf0f8616f9284ff21d5ee70b`

The final #28 branch must rerun both workflows on its exact head.

## Maintainer live evidence already completed

The maintainer reported the requested live validation groups as normal:

| Check | Result |
| --- | --- |
| Previously translated page reopens from cache with Provider unavailable | PASS |
| Cache miss in restore-only mode remains untranslated and does not call Provider | PASS |
| Persistent Quick Control alone does not auto-restore translations | PASS |
| Real YouTube human-caption bilingual flow | PASS |
| Real YouTube auto-generated/ASR flow | PASS |
| YouTube late-injection recovery | PASS |
| YouTube SPA A→B switch without stale subtitle leak | PASS |

These PASS rows are based on maintainer-provided real-browser results, not fixture substitution.

## Remaining interactive release rows

The following rows have **not** been explicitly evidenced in this release record and therefore remain manual release checks:

| Check | Result |
| --- | --- |
| Popup + Settings open normally in unpacked Chrome | PENDING manual |
| Normal page hide/show + remove/restore + selection/Quick Control coexistence in one live session | PENDING manual |
| Persistent Quick Control Origin permission prompt occurs only after explicit Popup action | PENDING manual |
| Protected Chrome page shows actionable unsupported behavior without injection | PENDING manual |
| Popup visual smoke in normal light mode | PENDING manual |
| Popup visual smoke in dark mode | PENDING manual |
| YouTube original-only and TranslateFlow off restore expected native behavior | PENDING manual |
| YouTube language/track switch | PENDING manual |
| YouTube theater mode | PENDING manual |
| YouTube fullscreen | PENDING manual |
| YouTube Provider failure keeps original caption visible | PENDING manual |
| YouTube repeat/cache path creates no unnecessary Provider call | PENDING manual |

Do not convert a PENDING manual row to PASS from deterministic fixtures alone.

## Permissions/privacy

Production `manifest.json` remains intentionally narrow:

- required permissions: `storage`, `activeTab`, `scripting`;
- required host permission: DeepSeek API only;
- site/API origins are declared optional and granted after user action;
- no required `<all_urls>`;
- no required YouTube host permission;
- no third-party subtitle service;
- API keys remain local/BYOK.

## Merge gate

Before PR #43 can merge:

1. `npm run validate` passes on the exact final PR head.
2. `npm run test:e2e` passes on the exact final PR head.
3. All required interactive rows above are either supported by real-browser evidence and marked PASS, or the release remains Draft/PENDING.
4. The PR diff contains only #28-owned release metadata/docs/tests and small release regressions.
5. After merge, main quality + E2E must pass.
