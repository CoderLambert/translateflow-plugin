# Dictionary Ecosystem v2 release evidence map

This is the pre-test release gap report for frozen scope manifest
[`DICTIONARY_ECOSYSTEM_V2_RELEASE_SCOPE.json`](DICTIONARY_ECOSYSTEM_V2_RELEASE_SCOPE.json).
It records existing evidence before any certification-only E2E changes. The
scope is frozen at main `acbfa12a079a73d6eab0a1c17e7a8f63d856295b`.

## Frozen product scope

Required shipped slices are #199, #200, #202, #203 (consuming #215), and #204.
No #187 parser/container capability or #201 rich-document semantic capability
is promoted. #205 is NO-GO for new catalog sources; #206 is not planned. #122
remains independently open and blocked, and its Official row/pack is absent.
ECDICT MDX 1.0.28 is reviewed-compatible, with release date 2017-09-20 and
content date 2017-06-03. User-owned commercial dictionaries without lawful
local reports remain `NOT_TESTED`.

## Acceptance → existing evidence → release-critical gap

| Acceptance area | Existing evidence at frozen base | Missing release-critical evidence to add |
| --- | --- | --- |
| #199 compatibility claims and no commercial overclaim | `docs/MDICT_REAL_WORLD_COMPATIBILITY.md`; `scripts/certify-rich-mdict-corpus.mjs`; vNext certifier checks the pinned ECDICT decode/range report and locked independent MDD fixture. | Ecosystem aggregate must bind #199's current report/capability claims to the frozen promoted set, require ECDICT + independent fixture, and preserve `NOT_TESTED` for unavailable private/commercial inputs. No commercial fixture is required or acquired. |
| #187/#201 conditional scope | #199 report and compatibility document identify no promoted parser/container or rich semantic gaps; Issues are closed not-planned. | Freeze empty promoted capability arrays and have the gate reject a nonempty/changed list without corresponding measured evidence. |
| #200 generic Catalog v2, origins, update and migration | `tests/dictionary-catalog-v2.test.mjs`, `tests/curated-dictionary-recipes.test.mjs`; `scripts/certify-vnext-dictionary-library.mjs` covers ECDICT install permission pair, failed/cancelled update preservation, exact lock and package boundary. | Aggregate must require the vNext certifier PASS in the same run and verify the Catalog v2 unit evidence ran. Existing tests cover contract-level origin/schema/migration behavior; no new product behavior is indicated. |
| #202 source/release/content/review/install dates, trust and lifecycle | `e2e/dictionary-library-v2-product.spec.mjs`, `tests/dictionary-library-v2-presentation.test.mjs`; vNext Settings trust/narrow-width test and source metadata assertions. | Ecosystem gate must require the v2 Library case and assert the old ECDICT content date plus curated/user-owned/Official distinctions; Official remains absent. |
| #203 unified import/preflight | `e2e/local-dictionary-import-v2-product.spec.mjs` covers MDX+base/numbered MDD, unrelated/ambiguous association, typed unsupported LZO, partial status, duplicate decision, cancellation, TFLex validation/reimport and atomic failure; `e2e/stardict-import-product.spec.mjs` covers StarDict semantic confirmation; `e2e/mdd-resources.spec.mjs` verifies persisted local resource access, replacement, reload, cleanup and zero external requests. | Missing unified MDX-only journey; explicit structured EN→zh-CN MDX route with preflight rerun and strict importer result; a failure→retry success path; a direct positive assertion that unified numbered MDD attachment resolves bytes after install. Required to ensure those paths are exercised by the ecosystem run, not inferred from helper tests. |
| #204 preferred rich dictionary and structured lane coexistence | `e2e/multi-dictionary-viewer.spec.mjs` covers persisted order/preference, first/open state, unchanged structured primary, no-hit fallback, delete/disable fallback, corrupt-card isolation, narrow/dark/reduced motion; `tests/selection-multi-dictionary.test.mjs` checks max 3 concurrent lookups, stale queued work drops, and isolated responses. | Existing browser measurement is one selection sample, with timings that must be captured before waiting for the slower card. Add repeated preferred-first/total latency samples, observed concurrency and selection-change cancellation latency. Store a local sanitized report and enforce only measured-baseline bounds. |
| Parser/MDD/Rich viewer security | `tests/mdd-security.test.mjs`, `tests/rich-mdict-security.test.mjs`, `e2e/rich-viewer-security.spec.mjs`, `e2e/mdd-resources.spec.mjs`; vNext requires sanitized hostile fixture report, inert script/remote URLs and object-URL cleanup. | Bind these subreports and zero remote request evidence into the same ecosystem report. No additional parser or viewer semantics are promoted. |
| Network/privacy and explicit AI | Import, StarDict, MDD, real ECDICT and multi-dictionary E2Es assert zero Provider calls; security/MDD product tests capture external requests; local lookup runs without Provider. | Ecosystem-focused E2E must capture requests across preflight/import/index/lookup, assert zero external dictionary requests and zero Provider calls, and emit no dictionary contents. |
| Production package/data boundary | `tests/ecdict-mdx-package-boundary.test.mjs`; vNext builds the production extension and scans package inventory/permissions against the pinned MDX size. Research/corpus workflows keep real assets in runner temporary paths and publish only sanitized summaries. | New gate must run or consume a fresh vNext package-boundary PASS and run an explicit ecosystem boundary scan that rejects MDX/MDD/ZIP/private report files in release/package artifacts. |
| UX/accessibility | #202/#203/#204 Chromium coverage checks 390px, dark mode, reduced motion, keyboard selection/preference/import/cancel controls, and text-only reasons. | Require these product cases in the integrated E2E report; capture keyboard and visual mode assertions on the added route tests if they touch new controls. |
| Performance and bounded I/O | vNext ECDICT cert fixes parser range counts/bytes and memory ceiling; MDD cert fixes 100 MiB synthetic range behavior; Selection unit caps concurrency at 3; StarDict cost tool measures synthetic imports. | Add repeated preference first-result/total lookup and cancellation latency report. Compare against the measured vNext browser observations and current concurrency contract; do not invent broader throughput claims. |
| Optional new source / Official | `docs/DICTIONARY_SOURCE_QUALIFICATION_2026-10-01.md` and machine lock record all candidates NO-GO; #206 is not planned; #122 remains blocked. | Require the frozen #205 NO-GO/#206 not-planned/#122 absent records. No source is added. |

## Certification-only test plan

Only the release-critical gaps above will be added. Product runtime behavior is
already present in the shipped slices; the changes are end-to-end assertions,
fresh evidence aggregation, and a workflow gate. Any discovered product defect
will be reported as a narrowly scoped blocker instead of expanding this release
certification lane.

Commercial user-owned MDX/MDD assets are unavailable in this environment and
are not necessary to exercise the public/synthetic baseline. Their status is
`NOT_TESTED`, never an implied compatibility pass. No dictionary bytes or
extracted record text will be written to this report.
