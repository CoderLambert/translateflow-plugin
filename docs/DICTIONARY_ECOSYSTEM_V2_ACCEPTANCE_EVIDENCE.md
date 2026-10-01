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
| #203 unified import/preflight | `e2e/rich-mdict-product.spec.mjs` covers the MDX-only default Rich journey through import, Selection safe lookup and delete; `e2e/local-dictionary-import-v2-product.spec.mjs` covers MDX+base/numbered MDD, unrelated/ambiguous association, typed unsupported LZO, partial status, duplicate decision, preflight cancellation, MDD attachment cancellation, TFLex validation/reimport and atomic failure; `e2e/mdict-import-product.spec.mjs` proves explicit EN→zh-CN semantic confirmation, structured preflight rerun, strict importer result, Selection lookup and delete; `e2e/stardict-import-product.spec.mjs` covers unified-picker StarDict semantic confirmation, install/Selection/delete; `e2e/mdd-resources.spec.mjs` verifies persisted local resource access, replacement, reload, cleanup and zero external requests. | Add Rich MDX indexing cancellation with no partial activation; a failure/cancel→retry success path for MDD attachment; and a direct positive assertion that automatically associated numbered MDD attachment resolves actual bytes after unified install. Require the existing MDX-only Rich, structured MDX and StarDict cases rather than duplicating their product journeys. |
| #204 preferred rich dictionary and structured lane coexistence | `e2e/multi-dictionary-viewer.spec.mjs` covers persisted order/preference, first/open state, unchanged structured primary, no-hit fallback, delete/disable fallback, corrupt-card isolation, narrow/dark/reduced motion; `tests/selection-multi-dictionary.test.mjs` checks max 3 concurrent lookups, stale queued work drops, and isolated responses. Current code ignores late stale responses but does not cancel already-dispatched lookup RPCs. | Add repeated preferred-first/total latency samples and a separate stale-response invalidation/fresh-dispatch baseline. Actual in-flight Rich lookup cancellation is now a required follow-up in #224; aggregate certification must require its final cancellation evidence and must not treat stale-result suppression as backend cancellation. |
| #224 in-flight Rich lookup cancellation | Existing #204 tests cover stale queued work and suppressing stale returned results, but the current RPC has no cancellation ID/route/signal. | Required pending runtime follow-up: cancel already-dispatched stale Rich lookups when selection changes, preserve per-dictionary isolation and the 3-request bound, and provide an E2E/certifier artifact proving cancellation plus fresh-result correctness. Once #224's pinned baseline runner is present, CI writes its raw timing evidence into the same private directory read by the browser case; the aggregate binds the report to that runner, pinned source/fixture blobs, raw-sample summary, and at least 10 high-resolution SPA route samples measured through the final underlying range stop. It recomputes sample summaries and baseline-derived ceilings. Only the filtered aggregate summary is uploaded. |
| Parser/MDD/Rich viewer security | `tests/mdd-security.test.mjs`, `tests/rich-mdict-security.test.mjs`, `e2e/rich-viewer-security.spec.mjs`, `e2e/mdd-resources.spec.mjs`; vNext requires sanitized hostile fixture report, inert script/remote URLs and object-URL cleanup. | Bind these subreports and zero remote request evidence into the same ecosystem report. No additional parser or viewer semantics are promoted. |
| Network/privacy and explicit AI | Import, StarDict, MDD, real ECDICT and multi-dictionary E2Es assert zero Provider calls; security/MDD product tests capture external requests; local lookup runs without Provider. | Ecosystem-focused E2E must capture requests across preflight/import/index/lookup, assert zero external dictionary requests and zero Provider calls, and emit no dictionary contents. |
| Production package/data boundary | `tests/ecdict-mdx-package-boundary.test.mjs`; vNext builds the production extension and scans package inventory/permissions against the pinned MDX size. Research/corpus workflows keep real assets in runner temporary paths and publish only sanitized summaries. | New gate must run or consume a fresh vNext package-boundary PASS and run an explicit ecosystem boundary scan that rejects MDX/MDD/ZIP/private report files in release/package artifacts. |
| UX/accessibility | Existing #202/#203/#204 Chromium coverage checks 390px, dark mode, reduced motion, text-only reasons/statuses, keyboard semantic confirmation in StarDict, and keyboard preference promotion in Selection. Existing imports/cancellation are primarily mouse-activated. | Require responsive/theme cases in the integrated E2E report; added route coverage will assert accessible button names, preflight/progress live regions, keyboard import activation, keyboard import cancellation, and keyboard-accessible Selection dismissal. |
| Performance and bounded I/O | vNext ECDICT cert fixes parser range counts/bytes and memory ceiling; MDD cert fixes 100 MiB synthetic range behavior; Selection unit caps concurrency at 3; StarDict cost tool measures synthetic imports. | Add repeated preference first-result/total lookup and a 10-sample unchanged-main stale-response invalidation/fresh-dispatch baseline. This measures time to dispatch the fresh selection and suppress stale results, not cancellation of an already-sent browser message. For #224 cancellation, require its own evidence and measured contract; do not infer transport or worker cancellation from this baseline. |
| Optional new source / Official | `docs/DICTIONARY_SOURCE_QUALIFICATION_2026-10-01.md` and machine lock record all candidates NO-GO; #206 is not planned; #122 remains blocked. | Require the frozen #205 NO-GO/#206 not-planned/#122 absent records. No source is added. |

## Certification-only test plan

Only the release-critical gaps above will be added. Product behavior from the
already-shipped slices is covered with end-to-end assertions, fresh evidence
aggregation, and a workflow gate. #224 is a separate release-critical runtime
follow-up, not a certification-only assertion; this #207 lane will not modify
its content-side cancellation implementation. Any additional product defect
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
This baseline does not claim that already-dispatched worker RPCs are cancelled;
that runtime gap is tracked by required pending #224 and must have independent
cancellation evidence before #207 can pass. These synthetic measurements do
not substitute for an unavailable lawful commercial corpus.

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
does not show that the background worker or range reads were aborted; #224 is
responsible for proving that separate runtime contract.

## Certification-lane evidence added after the frozen-base map

The new release E2E adds keyboard-only import and dismissal checks plus live
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

Local evidence collected against this pre-#224 worktree: the full repository
E2E suite passed 85 cases with the four allowlisted unavailable-corpus/release
cases skipped, and zero unexpected or flaky outcomes. The workflow-equivalent
focused vNext Chromium run passed 33/33; the vNext certifier passed with the
pinned ECDICT 1.0.28 corpus, locked independent MDD writer, and release package
boundary. The updated ecosystem-focused spec passed 3/3, including 10-sample
fresh-context performance and stale-response invalidation. Detailed Playwright,
corpus, and browser reports remain in private temporary directories; the
workflow uploads only filtered certification summaries. This is sub-evidence,
not a final Dictionary Ecosystem v2 certification: #224 remains required, and
the final manifest/base SHA must be frozen only after that slice is merged and
main verification passes.
