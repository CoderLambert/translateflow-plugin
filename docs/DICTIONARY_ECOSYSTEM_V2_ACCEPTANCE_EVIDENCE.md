# Dictionary Ecosystem v2 release evidence map

This is the final evidence map for frozen scope manifest
[`DICTIONARY_ECOSYSTEM_V2_RELEASE_SCOPE.json`](DICTIONARY_ECOSYSTEM_V2_RELEASE_SCOPE.json).
The original product evidence inventory was collected at main
`acbfa12a079a73d6eab0a1c17e7a8f63d856295b`; required runtime follow-up #224 has
since shipped. Final certification scope is frozen at main
`39b3bb4d8def18ad8332f6a807c2b8f3a6f63a0f`.

## Frozen product scope

Required shipped slices are #199, #200, #202, #203 (consuming #215), #204, and
#224 (active Rich lookup cancellation).
No #187 parser/container capability or #201 rich-document semantic capability
is promoted. #205 is NO-GO for new catalog sources; #206 is not planned. #122
remains independently open and blocked, and its Official row/pack is absent.
ECDICT MDX 1.0.28 is reviewed-compatible, with release date 2017-09-20 and
content date 2017-06-03. User-owned commercial dictionaries without lawful
local reports remain `NOT_TESTED`.

## Acceptance → existing evidence → release-critical gap

| Acceptance area | Existing evidence at original frozen base | Final certification requirement |
| --- | --- | --- |
| #199 compatibility claims and no commercial overclaim | `docs/MDICT_REAL_WORLD_COMPATIBILITY.md`; `scripts/certify-rich-mdict-corpus.mjs`; vNext certifier checks the pinned ECDICT decode/range report and locked independent MDD fixture. | Aggregate binds #199's report/capability claims to the frozen promoted set, requires ECDICT plus the independent fixture, and preserves `NOT_TESTED` for unavailable private/commercial inputs. No commercial fixture is required or acquired. |
| #187/#201 conditional scope | #199 report and compatibility document identify no promoted parser/container or rich semantic gaps; Issues are closed not-planned. | Freeze empty promoted capability arrays and reject changes without corresponding measured evidence. |
| #200 generic Catalog v2, origins, update and migration | `tests/dictionary-catalog-v2.test.mjs`, `tests/curated-dictionary-recipes.test.mjs`; `scripts/certify-vnext-dictionary-library.mjs` covers ECDICT install permission pair, failed/cancelled update preservation, exact lock and package boundary. | Require a same-run vNext certifier PASS and Catalog v2 unit evidence. Existing tests cover contract-level origin/schema/migration behavior; no new product behavior is indicated. |
| #202 source/release/content/review/install dates, trust and lifecycle | `e2e/dictionary-library-v2-product.spec.mjs`, `tests/dictionary-library-v2-presentation.test.mjs`; vNext Settings trust/narrow-width test and source metadata assertions. | Require the v2 Library case and assert the old ECDICT content date plus curated/user-owned/Official distinctions; Official remains absent. |
| #203 unified import/preflight | `e2e/rich-mdict-product.spec.mjs` covers the MDX-only default Rich journey through import, Selection safe lookup and delete; `e2e/local-dictionary-import-v2-product.spec.mjs` covers MDX+base/numbered MDD, unrelated/ambiguous association, typed unsupported LZO, partial status, duplicate decision, preflight cancellation, MDD attachment cancellation, TFLex validation/reimport and atomic failure; `e2e/mdict-import-product.spec.mjs` proves explicit EN→zh-CN semantic confirmation, structured preflight rerun, strict importer result, Selection lookup and delete; `e2e/stardict-import-product.spec.mjs` covers unified-picker StarDict semantic confirmation, install/Selection/delete; `e2e/mdd-resources.spec.mjs` verifies persisted local resource access, replacement, reload, cleanup and zero external requests. | The release E2E verifies Rich MDX index cancellation without partial activation, MDD cancel/retry while preserving existing resources, and actual bytes from automatically associated numbered MDD. Require the existing MDX-only Rich, structured MDX and StarDict product cases. |
| #204 preferred rich dictionary and structured lane coexistence | At the original base, `e2e/multi-dictionary-viewer.spec.mjs` covered persisted order/preference, first/open state, unchanged structured primary, no-hit fallback, delete/disable fallback, corrupt-card isolation, narrow/dark/reduced motion; `tests/selection-multi-dictionary.test.mjs` checked max 3 concurrent lookups, stale queued work drops, and isolated responses. | Require repeated preferred-first/total latency samples and a separate stale-response invalidation/fresh-dispatch baseline. Treat these as UI invalidation evidence only; #224 has separate runtime and range-cancellation evidence. |
| #224 in-flight Rich lookup cancellation | At the original base, #204 tests suppressed stale responses but did not cancel already-dispatched RPCs. | Shipped by PR #225 at main `39b3bb4`. Exact-head audit verified Chrome 102–105 ownership across same-document URL changes and distinct document isolation. CI measured 10 active-range SPA cancellations (five each `pushState` and `replaceState`), ending after native cancellation and OPFS range cleanup; the aggregate will bind fresh report details to the pinned baseline and runner. |
| Parser/MDD/Rich viewer security | `tests/mdd-security.test.mjs`, `tests/rich-mdict-security.test.mjs`, `e2e/rich-viewer-security.spec.mjs`, `e2e/mdd-resources.spec.mjs`; vNext requires sanitized hostile fixture report, inert script/remote URLs and object-URL cleanup. | Bind these subreports and zero remote request evidence into the same ecosystem report. No additional parser or viewer semantics are promoted. |
| Network/privacy and explicit AI | Import, StarDict, MDD, real ECDICT and multi-dictionary E2Es assert zero Provider calls; security/MDD product tests capture external requests; local lookup runs without Provider. | Ecosystem-focused E2E must capture requests across preflight/import/index/lookup, assert zero external dictionary requests and zero Provider calls, and emit no dictionary contents. |
| Production package/data boundary | `tests/ecdict-mdx-package-boundary.test.mjs`; vNext builds the production extension and scans package inventory/permissions against the pinned MDX size. Research/corpus workflows keep real assets in runner temporary paths and publish only sanitized summaries. | New gate must run or consume a fresh vNext package-boundary PASS and run an explicit ecosystem boundary scan that rejects MDX/MDD/ZIP/private report files in release/package artifacts. |
| UX/accessibility | Existing #202/#203/#204 Chromium coverage checks 390px, dark mode, reduced motion, text-only reasons/statuses, keyboard semantic confirmation in StarDict, and keyboard preference promotion in Selection. | Integrated E2E requires responsive/theme cases, accessible button names, preflight/progress live regions, keyboard import activation/cancellation, and keyboard-accessible Selection dismissal. |
| Performance and bounded I/O | vNext ECDICT cert fixes parser range counts/bytes and memory ceiling; MDD cert fixes 100 MiB synthetic range behavior; Selection unit caps concurrency at 3; StarDict cost tool measures synthetic imports. | Require repeated preferred-first/total lookup and a 10-sample unchanged-main stale-response invalidation/fresh-dispatch baseline. This measures fresh dispatch and stale suppression, not cancellation of an already-sent message; #224 has a separate cancellation report and measured contract. |
| Optional new source / Official | `docs/DICTIONARY_SOURCE_QUALIFICATION_2026-10-01.md` and machine lock record all candidates NO-GO; #206 is not planned; #122 remains blocked. | Require the frozen #205 NO-GO/#206 not-planned/#122 absent records. No source is added. |

## Certification-only test plan

Only the release-critical gaps above will be added. Product behavior from the
already-shipped slices is covered with end-to-end assertions, fresh evidence
aggregation, and a workflow gate. #224 is a separate release-critical runtime
slice already shipped in PR #225; this #207 lane consumes its evidence and will
not modify its content-side cancellation implementation. Any additional product defect
will be reported as a narrowly scoped blocker instead of expanding this release
certification lane.

Commercial user-owned MDX/MDD assets are unavailable in this environment and
are not necessary to exercise the public/synthetic baseline. Their status is
`NOT_TESTED`, never an implied compatibility pass. No dictionary bytes or
extracted record text will be written to this report.

## Pre-change preferred-lookup performance baseline

Before changing the E2E measurement, the existing vNext preference case was run
10 times with Playwright `--repeat-each=10` on the same synthetic Alpha/Beta
MDX pair and local Chromium. All 10 attempts passed, with zero retries,
failures, flakes, Provider calls, and exactly two dictionary lookups per
selection. The sanitized timing samples and run metadata are retained in
[`DICTIONARY_ECOSYSTEM_V2_PREFERRED_BASELINE.json`](DICTIONARY_ECOSYSTEM_V2_PREFERRED_BASELINE.json);
they were extracted from the local Playwright JSON report for unchanged
`main` at `acbfa12a079a73d6eab0a1c17e7a8f63d856295b`. The exact command and
case identity are recorded in that evidence file. Each repeated test resets
extension storage/cache, installs fresh random-ID Alpha/Beta packs, and performs
the first lookup against those new pack IDs and versions. Timings use the
existing test's `Date.now()` points: from selection
chip activation to the preferred rich result, and then until both rich cards
finish.

| Metric | Samples | Min | Median | Nearest-rank p95 | Max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Structured primary visible (ms) | 10 | 255 | 271 | 283 | 283 |
| Preferred rich result visible (ms) | 10 | 337 | 370.5 | 385 | 385 |
| Both rich cards complete (ms) | 10 | 350 | 388 | 402 | 402 |
| Rich lookups per selection | 10 | 2 | 2 | 2 | 2 |

The ecosystem certifier will set preferred-first and both-rich ceilings at 2×
the measured nearest-rank p95: 770 ms and 804 ms. The observed maxima were 385
and 402 ms, respectively. This explicit factor tolerates substantial runner
variance while treating a doubling of the measured p95 as a release-visible
regression; it is not a parser throughput or real-dictionary latency claim.
The certification E2E will take 10 fresh selection samples with the same
one-entry encrypted fixtures and a new pair of random pack IDs/versions per
sample, record actual maximum simultaneous rich lookups, and separately
measure selection-change stale-response invalidation/fresh-dispatch latency.
This baseline does not claim that already-dispatched worker RPCs are cancelled.
That runtime behavior shipped separately in #224 and has its own measured
cancellation contract. These synthetic measurements do not substitute for an
unavailable lawful commercial corpus.

## Pre-change selection-change invalidation/fresh-dispatch baseline

On unchanged `main` at `acbfa12a079a73d6eab0a1c17e7a8f63d856295b`, the
synthetic Alpha/Beta stale/fresh fixture was measured in 10 fresh stale→fresh
selection transitions. Each transition first dispatched two stale dictionary
lookups. The harness delayed their callbacks by 1,200 ms and asserted that zero
had returned at the selection-change point; after fresh lookups completed, both
old callbacks were observed and their stale results remained suppressed. The
measurement uses a separate three-entry pair (`persistent`, `stalequery`,
`freshquery`) so the one-entry preferred-latency workload remains comparable to
its own baseline. It ends when both fresh lookups are dispatched. All 10 samples passed,
with no retry, failure, or Provider call.

| Metric | Samples | Min | Median | Nearest-rank p95 | Max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fresh lookup dispatch after selection change (ms) | 10 | 235 | 288.5 | 295 | 295 |

Set the stale-invalidation/fresh-dispatch ceiling to 2× the measured p95:
590 ms. The factor follows the preferred-first latency rule above and allows
runner variance beyond the observed 60 ms range. This is a baseline for UI
invalidation and fresh work scheduling while prior callbacks are pending. It
does not show that the background worker or range reads were aborted; the
separate #224 runtime evidence proves that contract.

## Certification-lane evidence added after the frozen-base map

The release E2E adds keyboard-only import and dismissal checks plus live
region, accessible-name, 390px, dark-mode, reduced-motion, zero Provider and
zero external-request assertions for the unified MDX-only Rich route. Its
performance cases use the exact one-entry encrypted fixture above with 10
fresh installations, 20 distinct installed pack IDs and versions, and a
separate three-entry stale/fresh workload. The aggregate checks the baseline
record ID, file identity, unchanged-main SHA, exact command, run outcome counts,
all recorded timing samples, and the derived 2x ceilings.

The unified-import E2E now resolves both base and numbered MDDs to their actual
local CSS bytes after one-picker installation. It also observes cancellation
during Rich MDX index construction, verifies no partial activation, then retries
successfully; and cancels/retries MDD attachment while proving the previous
resource bytes remain active. These are synthetic fixtures and do not broaden
the supported parser contract.

PR #225 shipped the separate #224 runtime slice at main
`39b3bb4d8def18ad8332f6a807c2b8f3a6f63a0f`. Its exact-head audit passed; the
sanitized CI report had 10 active OPFS-range samples, five per History API
method, route p95/max 2.2002 ms against a 52 ms conservative ceiling, and zero
post-cancel reads/decodes, stale renders, Provider calls, or external requests.
All six post-merge main workflows passed.

On the rebased certification branch, `npm run validate` passed 617
JavaScript/architecture checks, 651/651 unit tests, and the 299-file release
build. The full repository E2E suite passed 87 cases with three configured
unavailable-corpus/release cases skipped; all ecosystem-specific release cases
passed. Detailed Playwright, corpus, and browser reports remain in private
temporary directories; the workflow uploads only filtered certification
summaries. This evidence map is now frozen at the post-#224 main SHA. The final
`npm run certify:dictionary-ecosystem-v2` result remains the release gate and
must pass in the #207 PR before merge.
