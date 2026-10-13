# MDX/MDD compatibility evidence

This document is the reviewed, sanitized compatibility matrix for the current
rich dictionary lane. It records observed compatibility; it does not approve a
dictionary for redistribution or claim that every observed record feature is
rendered by the product.

## Follow-up local task (2026-10-04)

The [offline-dictionary task](tasks/offline-dictionary/task.md) now owns the
follow-up plan: reproduce and repair paired MDX key-boundary compatibility,
then verify one explicitly selected real English-Chinese dictionary through
structural decoding, target-reader lookup, content quality and packaged-browser
acceptance. Task state and candidate evidence live in that task's state and
acceptance files.

The source review at `8c3ad6d8bfc528a12b4b28d3c90ab97e0e403a32` identified
that `parseKeyBlock()` compares normalized actual first/last keys with the
stored descriptors. Raw descriptors can therefore disagree at block boundaries.
The reader accepts either a complete raw endpoint pair or the legacy complete
normalized pair. It keeps descriptors unchanged, rejects mixed pairs, and
derives lookup bounds separately from the actual keys in each block. The
regression set pins four synthetic MDX files from the independent MIT
`zhansliu/writemdict` writer, covering UTF-8, UTF-16, encrypted key info and
multiple blocks; tests exercise file preflight, index construction, lookup
sentinels, legacy pairs and re-checksummed mixed-boundary failures. The product
E2E imports the independent fixture, reloads Options and looks up first/last
sentinels through Selection. This evidence covers synthetic input. The matrix
and capability decisions below retain their original corpus scope: "no measured
gap in this corpus" does not assert that no parser defect exists elsewhere.
Existing PASS evidence retains its original tested revision.

The Options import and library controls are React-owned, but continue to call the
same bounded preflight, Rich MDict/MDD controllers, OPFS transaction, quarantine
and sanitizer contracts. This UI migration neither changes the compatibility
matrix nor adds MDX/MDD capabilities; selected files remain local and remote or
active dictionary content remains blocked by the existing policy.

## Key normalization and derived index upgrades

The Rich MDX header parser accepts the standard `StripKey` and the explicitly
verified Oxford spelling `Stripkey`. The default remains false. Other attribute
names are not lowercased, and conflicting values are rejected. This is a
normalization compatibility fix, not a change to the dictionary's source text.

New compact indexes use schema 2. Strictly validated schema 1 indexes remain
readable. On a cold legacy load, a bounded read of the retained MDX header
checks whether the verified `Stripkey` alias caused the old index to preserve
punctuation incorrectly. Only affected indexes rebuild their derived lookup
bounds; unaffected legacy indexes are not rewritten. Unexpected normalization
mismatches fail explicitly rather than silently rebuilding changed source data.

The rebuilt index is written to the fixed `index-normalized-v2.json` path and
read back for size, digest and structural validation before its active pointer
changes. The original `source.mdx`, `index.json`, MDD files, resources and user
preferences remain intact. Pack serialization and an expected-pointer check
prevent a replacement or uninstall from activating a stale rebuild. A failed
write, validation or activation retains the old pointer and reports an error.
Cancellation before activation prevents the pointer change; cancellation after
an irreversible successful storage commit does not claim to roll it back.

See [the migration task](tasks/rich-stripkey-migration/task.md) for exact
candidate evidence. These mechanics do not establish the complete Oxford
layout, navigation, attachment-recovery or final-product acceptance.

## Multiple records and alias collections

Rich lookup returns `records[]` for all selected exact-spelling key entries, or
for the folded collection when no exact spelling exists. Duplicate source
positions and convergent terminal positions produce one record. Terminal
records retain their original source order. The first scalar record remains a
compatibility view; consumers normalize the array or that legacy view instead
of concatenating adjacent raw HTML strings.

Aliases resolve each path independently with an eight-link bound and source
offsets for cycle detection. A cycle branch is pruned while valid siblings
continue; bounded diagnostics record that pruning. An alias collection with no
valid terminal, a missing target, a corrupt span or exhausted work budget fails
explicitly. Folded-key visited sets are insufficient because separate records
can legitimately return to the same key collection.

The complete query shares existing range/byte/decode budgets. Candidate span
visits include initial roots, cache hits, repeated terminals and pruned cycle
branches; the initial guard is 256 actual visits, supported by a maximum 23
visits measured in the pinned Oxford alias graph. Selected matches are limited
to 64 after exact/folded precedence is decided, and actual key scans have their
own 1,000,000-entry guard. These guards are compatibility limits, not promises
about all dictionaries. Exceeding them reports a limit rather than silently
returning a partial entry.

Record and aggregate source/text bounds remain 1 MiB / 2 MiB. Sanitized Compact
expansion, nodes and resource descriptors also share the existing 2 MiB /
32,768 / 1,024 limits across the complete result. Each record uses the existing
sanitizer and a separate Shadow viewer so local IDs, fragments and styles do
not cross records. Display completion reports one bounded plain-text summary;
it does not add a Reading or vocabulary persistence channel.

Exact implementation and acceptance are recorded in
[the multiple-record task](tasks/rich-multiple-records/task.md). Original MDX/MDD files,
index schema, permissions, CSP and Provider boundaries do not change in this
slice, and its synthetic browser evidence does not replace Oxford final
acceptance.

## Controlled radio state and scoped stylesheet rules

Rich records can retain coherent radio/label relationships as bounded data.
The tokenizer and viewer both validate IDs, names, label targets and checked
states before creating controls inside that record's Shadow root. Passive nav/section
wrappers and up to eight safe class tokens preserve the relationships; the
verified go panels require a state class in the fifth position. Zero initial
selection stays zero; multiple initial checked states, duplicate identities or
incomplete radio relationships degrade that record to readable safe text with
a visible notice. Decorative orphan labels become static text without disabling
an otherwise valid group. Native label actions and bounded keyboard handling
update only the associated group; no form, dictionary handler or script runs.

Local stylesheet compilation uses the existing background css-tree path and
closed selector atoms for compounds, descendants, child/sibling relationships,
`:checked`, simple structural/focus states, `[open]` and static before/after
pseudo-elements. IDs use the same controlled targets as labels and fragments.
Pure bounded string content is allowed on the two pseudo-elements; arbitrary
functions, attribute-driven content, external URLs and Shadow escape selectors
remain rejected. Relative flex layouts and finite pixel max-width media
conditions are supported; fixed positioning cannot escape the viewer.

Source and generated CSS are each capped at 64 KiB. Source rule visits are
bounded at 1,024 and accepted output rules at 512; the existing twelve
declarations per rule and eight local asset slots remain bounded. A read-only
inspection measured 636 source rules and 463 potentially useful rules in the
verified Oxford sidecar, including state rules beyond the former 255 visits.
That projection is design evidence, not a claim of browser acceptance. Rule,
output-byte or nesting exhaustion rejects the stylesheet with diagnostics
instead of presenting a truncated stylesheet as complete.

See [the radio/CSS task](tasks/oxford-radio-css/task.md) for exact candidate and
browser evidence. This slice does not establish font/static-SVG support,
cross-entry history, Oxford-specific adapters or attachment recovery. Existing
long-entry scrolling, footer actions, pronunciation controls and details stay
under regression coverage. No stored index, source file, permission or CSP
migration is introduced.

The cumulative 1,024 resource budget counts actual descriptors using a shared
closed identity: kind, canonical path and validated presentation. Repeated
references still consume the node budget, while references to the same
descriptor share that descriptor. Each independent record keeps its own count
for the aggregate. This corrects an occurrence-count regression: the verified
go record has 1,079 resource nodes but 539 descriptors. No resource, node,
text, active-Blob or image limit is raised.

## Local TrueType fonts

Bounded local stylesheet `@font-face` declarations can be projected to an
optional `fontFaces` manifest. Each face retains a canonical local TTF path,
an anonymous family token, normal/italic style, 400/700 weight and swap/fallback
display. A single local URL and optional truetype format are accepted; local()
lookup, mixed sources, external URLs, unsupported descriptors and duplicate
variants are rejected with diagnostics. Declaration order does not affect
ordinary font-family references. Verified `%20` spaces in the four target URLs
are decoded once; all other percent escapes remain unsupported, including
encoded separators, traversal, scheme/control characters and double encoding.
Only declared families and generic fallbacks
survive; original custom family names are not returned to the viewer.

The existing eight-slot bound covers image slots and font faces together.
Source/generated CSS remain bounded at 64 KiB, including random alias expansion.
The MDD resource policy accepts only sfnt TrueType TTF with at most 64 bounded,
non-overlapping directory tables and consistent required table/glyph bounds.
The native browser decoder validates table contents. The eight-MiB resource
limit remains unchanged; this does not add OTF, WOFF, TTC or sidecar-font import.

Chromium does not load a blob @font-face inside a Shadow stylesheet in the
measured prototype. The viewer instead constructs controlled ArrayBuffer
FontFace objects and adds them to the owning document's font set. Each
stylesheet/session uses cryptographically random names referenced only by
its scoped Shadow CSS. Alias rewriting visits only actual font-family
declarations; selectors, controlled IDs and literal content remain unchanged
even when their spelling matches a family token, including fallback paths.
No dictionary font URL is emitted, and no CSP or
permission is changed. An absent native RNG, unsupported API or failed face
uses a visible display-fallback notice while preserving other stylesheet rules.

Font bytes share the existing per-view 32-MiB active-resource budget, separately
from the image byte budget. Reservation happens before native decoding and
shares the existing two-read queue. Closing deletes registered faces. Native
loads cannot be aborted; their reservations and queue slots remain until
settlement, and stale completion cannot register a face. These are logical
resource-byte bounds, not measured browser heap/RSS limits.

See [the font task](tasks/rich-local-fonts/task.md) for exact candidate and
acceptance evidence. The measured private package contains four TrueType
faces totalling 2,956,896 bytes. Its structural prevalidation is not browser
acceptance. SVG, entry/history and install recovery remain separate unfinished
capabilities; this slice alone does not close Oxford final acceptance.

## Local inspection

The inspector is a read-only local tool. It does not make network requests,
scan folders, or send reports anywhere. Pass the MDX and any associated MDD
files explicitly:

```sh
npm run inspect:mdict -- /local/dictionary.mdx /local/dictionary.mdd \
  --label my-local-dictionary --output /local/private-report.json
```

Local SHA-256 values are omitted by default. Add `--hash` to include one; it is
calculated with a streaming read so the report can be tied to a repeatable local
artifact. `--no-hash` explicitly keeps hashes omitted.
The output omits full file names and paths, dictionary titles, headwords,
definitions, examples, raw resource paths, and resource bytes. An optional
label is stripped of path separators and control characters and capped at 80
characters. Do not put private reports in a shared repository or attach them to
issues. One invocation accepts at most 16 MDD files and 512 MiB combined input.

MDX record sampling is deterministic: the inspector selects a center entry
from evenly spaced key blocks, capped at 24 records (12 by default), and
classifies at most the first 64 KiB of each sampled record in memory. All
feature counts are **sampled record hits**, not corpus-wide totals. A sampled
alias is resolved only in memory so its presence can be counted; its target key
and record are not written to the report. The MDD pass reads indexed resource
paths and sizes only; it does not inspect resource payload bytes. Aggregate
resource extensions use common type names plus an `other` bucket.

The report separates the rich MDX parser result from the overall compatibility
result. For example, MDX can parse successfully while the overall result is
`partially_supported` because sampled records reference relative resources
without a supplied companion MDD. The top-level result is `unsupported` only
when the required MDX parser route is unsupported. If MDX is supported but any
supplied MDD is partial or unsupported, the set is `partially_supported`; each
MDD keeps its own parser result in the per-file report. A top-level `supported`
result requires supported MDX and all supplied MDDs, with no missing-companion
signal. Results are evidence for the inspected artifact and current importer,
not a safety endorsement for dictionary markup.

## Stable capability vocabulary

Capability identifiers are stable machine-readable names in
[`scripts/mdict-compatibility-capabilities.mjs`](../scripts/mdict-compatibility-capabilities.mjs).
They describe what the inspector observes and the current importer boundary.
Sampled rich feature IDs are emitted in `featureSampling.observedCapabilities`;
that field means the feature was seen in the bounded sample and does not claim
the viewer supports or rejects it. Parser support and exact parser capability
reasons remain in `parser.supportedCapabilities` and
`parser.unsupportedCapabilities`.

| Area | Capability IDs |
| --- | --- |
| MDX format and encoding | `mdx.engine.v2`, `mdx.required-engine-version`, `mdx.encoding.utf8`, `mdx.encoding.utf16le`, `mdx.encoding.gbk`, `mdx.encoding.big5`, `mdx.encoding.gb18030`, `mdx.encoding.other` |
| MDX crypto and blocks | `mdx.encryption.key-info-v2`, `mdx.encryption.password-protected`, `mdx.encryption.record`, `mdx.key-info.compression-zlib`, `mdx.compression.none`, `mdx.compression.zlib`, `mdx.compression.lzo`, `mdx.compression.unknown` |
| MDX records | `mdx.record.html`, `mdx.record.text`, `mdx.record-format.other`, `mdx.style-sheet`, `mdx.compact-records`, `mdx.alias-link` |
| MDD format and resources | `mdd.engine.v2`, `mdd.required-engine-version`, `mdd.encoding.utf8`, `mdd.encoding.utf16le`, `mdd.encoding.gbk`, `mdd.encoding.big5`, `mdd.encoding.gb18030`, `mdd.encoding.other`, `mdd.encryption.key-info-v2`, `mdd.encryption.password-protected`, `mdd.encryption.record`, `mdd.compression.none`, `mdd.compression.zlib`, `mdd.compression.lzo`, `mdd.compression.unknown`, `mdd.resource.path-normalization`, `mdd.resource.format-other` |
| Sampled rich semantics | `rich.html-structure`, `rich.inline-style`, `rich.style-sheet-reference`, `rich.compact-style-marker`, `rich.image-reference`, `rich.audio-reference`, `rich.local-anchor`, `rich.entry-reference`, `rich.sound-reference`, `rich.relative-resource-path`, `rich.other-uri-scheme`, `rich.remote-url`, `rich.unusual-resource-extension` |

Parser result values are `supported`, `partially_supported`, or `unsupported`.
When headers pass but bounded index construction detects corrupt structure, the
report uses `failureClass: "invalid"`; unsafe-content rejections and safety
limits have separate failure classes. Missing/unreadable inputs and malformed
or too-short headers fail inspection with a sanitized CLI error instead of a
report. The matrix uses
`PASS`, `PASS_WITH_LIMITATIONS`, `BLOCKED_BY_CAPABILITY`,
`UNSUPPORTED_BY_POLICY`, and `NOT_TESTED`.

## Compatibility matrix

| Target / sanitized report | MDX engine | Encoding | Compression | MDD | Sampled rich semantics | Current status | Blocking capability | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ECDICT MDX 1.0.28 — [`ecdict-1.0.28.json`](../lexicon/build-evidence/mdict-compatibility/ecdict-1.0.28.json) | 2.0 / required 2.0 | UTF-8 | key-info zlib; key and record blocks zlib | no companion MDD in this corpus | Compact + StyleSheet metadata; bounded feature sample in report | `PASS_WITH_LIMITATIONS` | no parser/container gap observed in the pinned corpus | The exact MDX importer baseline passes. Product presentation remains subject to rich-content sanitization; this baseline contains no companion MDD, and bounded samples do not certify unseen records. Keep as a reviewed upstream compatibility baseline. Source version is 1.0.28; content date is 2017-06-03. The release publication date is 2017-09-20 and is not the content date. |
| Independent synthetic MDX/MDD — [`writemdict-synthetic-interop.json`](../lexicon/build-evidence/mdict-compatibility/writemdict-synthetic-interop.json) | 2.0 / required 2.0 | UTF-8; MDD paths UTF-16LE | zlib key-info, key and record blocks | one explicitly supplied companion; CSS, PNG and WAV resource types | HTML structure, image/audio, relative resource paths, and a remote URL are detected in the single synthetic record | `PASS_WITH_LIMITATIONS` | none for the exercised fixture | Independent MIT-licensed format fixture, not dictionary corpus evidence. Three leading root separators are canonicalized by the path reader (`resourcePathNormalizationChanges: 3`); there are zero unsafe/ambiguous path issues. Its hostile active/remote input remains subject to the existing sanitizer/viewer security tests. |
| Oxford learner dictionary (user-owned compatibility target) | — | — | — | — | — | `NOT_TESTED` | — | No lawful local copy was available in the inspection environment. |
| Longman learner dictionary (user-owned compatibility target) | — | — | — | — | — | `NOT_TESTED` | — | No lawful local copy was available in the inspection environment. |
| Collins COBUILD (user-owned compatibility target) | — | — | — | — | — | `NOT_TESTED` | — | No lawful local copy was available in the inspection environment. |
| Cambridge learner dictionary (user-owned compatibility target) | — | — | — | — | — | `NOT_TESTED` | — | No lawful local copy was available in the inspection environment. |
| Other commercial MDX/MDD dictionaries | — | — | — | — | — | `NOT_TESTED` | — | Compatibility targets only; no download or redistribution source is approved here. |

The ECDICT report was generated from a local MDX whose SHA-256 matches the
existing `ecdict-mdx-1.0.28-corpus-lock.json`. The corpus bytes are not part of
this repository. That upstream lock describes ECDICT source version 1.0.28 and
records `descriptionDate: 2017-06-03`; the 2017-09-20 GitHub publication date is
separate. The report contains bounded metadata and sampled feature counts, not
record content.

The synthetic report is checked against the existing pinned fixture from the
independent `zhansliu/writemdict` writer (MIT, commit
`f0240b30cabd2f0470d3ee1a0641fc7f8c38dcf5`). Fixture source and artifact
checksums remain in `tests/fixtures/mdd-interop/corpus-lock.json`.

## Evidence-based next capabilities

The public/synthetic engineering baseline provides evidence for the current
MDX v2 rich path and local MDD resource path. It does **not** show a repeated
real-world need for LZO, MDX 1.x, legacy text encodings, `entry://`,
`sound://`, or cross-entry navigation. The fixture demonstrates that those
feature families can be counted without publishing record content; a synthetic
observation alone does not promote implementation work.

| Observed gap class | Evidence and owner |
| --- | --- |
| Parser/container → #187 | No measured parser/container blocker appears in the pinned ECDICT report or independent interoperable fixture. LZO, MDX 1.x, and legacy encodings remain unmeasured on representative real dictionaries; no parser work is promoted. |
| Rich semantics → #201 | Relative local asset paths and one remote URL are present in the synthetic interop record and are counted. Existing fixture coverage exercises local image/audio/CSS resources; no real corpus evidence requires `entry://`, `sound://`, or local-anchor navigation, so no rich-semantics feature is promoted. |
| Product/UX → #203 | Companion files were passed explicitly to the local harness. Choosing files, presenting preflight, and explaining compatibility are product-flow work and are outside this evidence-only issue. |
| Explicit policy boundary | Remote references, executable markup, unknown resource types, and unsafe paths are not permission to fetch or execute content. Existing sanitizer/security tests own that policy behavior; private reports contain no source text or paths. |

Current minimum valuable next work from this corpus:

1. Keep the existing MDX v2, UTF-8/UTF-16, zlib/none, bounded MDD, and safe
   viewer behavior under regression coverage.
2. Collect sanitized reports only from lawfully owned, representative local
   dictionaries before considering parser or rich-semantic expansion.
3. Promote a capability only when a report shows a useful dictionary blocked
   by that exact capability and the gap can be addressed within the existing
   local-only, bounded, non-executing rich lane.

No parser or viewer feature is implemented by this evidence task. There is no
measured corpus gap here that justifies full MDict specification support.
