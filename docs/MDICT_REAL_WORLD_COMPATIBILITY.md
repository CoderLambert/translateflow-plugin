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
acceptance. Its state remains `paused`; this documentation update does not
implement a parser fix, approve a download, or certify a new dictionary.

The source review at `8c3ad6d8bfc528a12b4b28d3c90ab97e0e403a32` identified
that `parseKeyBlock()` compares normalized actual first/last keys with the
stored descriptors. Raw descriptors can therefore disagree at block boundaries.
The task requires a binary reproducer and preserves strict paired checks,
checksums, limits and existing lookup semantics; research experiments are not
production acceptance. The matrix and capability decisions below retain their
original corpus scope: "no measured gap in this corpus" does not assert that
no parser defect exists elsewhere. No existing PASS is rebound by this plan.

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
