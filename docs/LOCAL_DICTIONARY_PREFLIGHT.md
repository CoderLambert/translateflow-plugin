# Local dictionary preflight

`preflightLocalDictionaryFiles({ files, signal, semanticConfirmation, sourceLanguage, targetLanguage })`
classifies one user-selected local file set before import. It returns a versioned,
serializable result with a dictionary family, compatibility status, typed reason
codes, a closed importer id, associated resources, and bounded size/count estimates.
The public API is exported from `src/background/packs/local-dictionary-preflight.js`.

## Status and route

- `supported`: the selected file set matches a shipped import path.
- `partial`: an optional file is missing/unassociated, a user decision is needed,
  or full verification is deferred to the existing importer.
- `unsupported`: the format is recognized but needs a capability/profile that is
  not shipped, or exceeds an explicit preflight ceiling.
- `invalid`: a recognized format is malformed, corrupt, ambiguous, or has an
  invalid companion sequence.

Importer ids are closed to `rich-mdict`, `structured-mdict`, `stardict`, `tflex`,
and `none`. A plain-text MDX defaults to the Rich MDX lane. The structured lane
is selected only after explicit semantic confirmation for EN → zh-CN, and only
when its current strict profile applies (no MDD, compact/style transforms, or
encrypted records). The engine does not infer POS, senses, or translation fields.
StarDict also requires an explicit semantic recipe before it can become
structured lexical data.

## Bounded inspection

The engine accepts up to 32 files and a 640 MiB selected-set ceiling. MDX and MDD
use the current bounded range/index readers; preflight does not read MDX record
bodies or MDD resource bodies. It associates the same-basename `.mdd` and
consecutive `.1.mdd`… numbered files using the reviewed companion contract.
Unmatched files are returned as unassociated instead of being attached.

StarDict reads bounded `.ifo`, `.idx`, and optional `.syn` metadata. It checks
`.dict` size or reads only the bounded `.dict.dz` header; it does not read
definition bytes. TFLex reads only its bounded manifest and leaves hashes,
index integrity, and records to `validateLocalTflexImport` during import.

All reads are local `File.slice` ranges. The signal is checked before and after
each read and passed to MDX/MDD index construction. Cancellation throws an
`AbortError` so the caller can discard stale results. Result titles and filenames
are bounded and stripped of control/bidirectional override characters. Raw parser
messages, file bytes, and entry content are not returned.

Compatibility means parser/runtime eligibility for the chosen route. It does
not certify source licensing, editorial quality, dictionary freshness, or the
integrity of data that the importer deliberately verifies later.
