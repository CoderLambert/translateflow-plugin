# Local dictionary import v2

The Settings local import surface starts from a user's selected files. It locally identifies MDX/MDD, StarDict, and native TFLex sets, reports the safe import route, then calls the existing importer for that route. Rich MDX stays in its isolated viewer path; only explicitly confirmed compatible plain-text MDX and StarDict imports become structured local packs.

## File association and compatibility

- MDX is selected on its own or with base-name MDD companions. Numbered companions must start at `.1.mdd` and remain consecutive. Unrelated, duplicate, ambiguous, corrupt, or unsupported companions are shown and block accidental attachment.
- A useful MDX can still be imported without optional resources. Associated MDD files are attached only after MDX installation through the existing atomic attachment flow.
- StarDict requires a complete, validated `.ifo` / `.idx` / `.dict` set (and `.syn` when declared). The user confirms English-to-Simplified-Chinese semantics before structured import.
- MDX `Text` defaults to the Rich viewer. A separate user confirmation reruns preflight; it becomes structured only when its format and language direction meet the existing strict requirements.
- Partial, unsupported, invalid, missing, and unassociated states have separate explanations. Unsupported feature messages use human-readable text and never expose implementation identifiers.

## Identity, replacement, and limitations

Local filename/title and sampled identity hints are not proof of file provenance or complete byte identity. A matching installed title is therefore presented as a possible duplicate. The user must explicitly keep a second copy; this creates an independent entry and never overwrites the installed dictionary.

An incoming TFLex pack that declares the same `packId` as an installed pack is not treated as a second independent entry. Its declared identity remains unverified until the full files pass validation, so the import surface requires a separate, explicit update confirmation. The existing local install transaction stages and validates the complete replacement before switching the active version; a bad hash or other failure leaves the old version and lookup available. Same-title MDX files without a verified identity remain possible duplicates: the user can explicitly keep the incoming dictionary as a separate entry, but the app does not infer that the contents match.

TFLex preflight reads its bounded manifest and labels its declared pack identity as unverified. Full file hashes, index structure, and records are checked by the normal local install transaction. The transaction either activates the complete validated pack or cleans up staged files; it does not activate a partial pack.

MDD can also be added later from the installed Rich dictionary row. The user selects files for the specific target dictionary, and the existing resource flow verifies association and commits atomically. A failed add or replacement leaves current resources available.

## Local data handling

Selected dictionary bytes remain local. Preflight uses bounded reads; importers stream large local files into temporary browser storage and reuse their existing validators. Rich content remains untrusted and continues through the existing sanitizer and scoped viewer. Import does not make Provider or AI calls and does not fetch URLs found in dictionary metadata or records.

The compatibility summary shows the selected file set, content format and encoding when known, entry count, source size as a rough local-storage estimate, trust/source status, limitations, and associated or missing resources. Duplicate prompts summarize bounded incoming filenames and aggregate bytes, and show installed source filename, size, and version where available. Rich dictionary rows keep the local source filename and source size separate from installed size and version. The final storage size can differ because the selected format may create local indexes.

## Verification matrix

The synthetic/open Chromium coverage exercises Rich MDX, base and numbered MDD attachment, unrelated and non-consecutive MDD rejection, LZO explanation, partial Rich fallback after an explicit structured request, structured MDX confirmation, StarDict semantic confirmation, duplicate keep-both, cancellable preflight, TFLex full validation and failure cleanup, bad-hash same-ID replacement preserving the active version and lookup, cancellation during initial MDD attachment preserving prior resource bytes, reload/delete, source details, dark/narrow/reduced-motion presentation, and zero Provider/external requests.

Same-title matches and bounded sample hints remain unverified identity evidence. The UI does not infer content equality, recommend a dictionary, or offer a silent replacement based on those hints.
