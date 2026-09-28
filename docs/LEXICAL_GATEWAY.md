# Lexical Gateway

Issue: #77  
Contract: [TFLEX_V1.md](./TFLEX_V1.md)

The Lexical Gateway is a Background-only local lookup boundary. It is intentionally separate from the Translation Gateway and Provider stack.

Its content model is source-driven: TranslateFlow should not grow lexical coverage by continuously authoring its own word/translation database. The runtime owns lookup/ranking behavior; dictionary facts come from attributable packs or the User Glossary. See [LEXICAL_DATA_BOUNDARIES.md](./LEXICAL_DATA_BOUNDARIES.md).

## Request/result contract

`LEXICAL_LOOKUP` accepts selected text plus local language metadata and returns one of:

- `unsupported` — v1 local language pair is not supported;
- `no-hit` — local packs and glossary produced no final candidate;
- `candidates` — one or more attributable local candidates;
- `error` — typed storage/corruption/compatibility failure.

A local hit never invokes a translation Provider and is never written to translation cache.

## Lookup order

```text
User Glossary exact override
  -> exact phrase/headword across every active local pack
  -> for phrase miss: token evidence only (never concatenated as a translation)
  -> conservative rule-based morphology fallback
```

Except for an explicit User Glossary override, a generic Core hit does not short-circuit Technical or optional-pack candidates. Ranking and sufficiency are owned by #85.

The runtime does not carry a project-authored irregular word→lemma table. Irregular forms such as `went`, `children`, `better` or `written` remain measurable source gaps unless an attributable dictionary/morphology source supplies the relation. Generic suffix rules remain valid runtime algorithms because they do not encode per-word lexical facts.

## TFLex bundled reader

The bundled reader:

- loads only `manifest.json` + `directory.json` metadata initially;
- locates the bounded shard by sorted key range;
- resolves optional directory aliases to one-or-more canonical keys before shard reads; ambiguous aliases remain multiple candidates rather than a first-hit winner;
- verifies shard size/SHA-256 before decoding;
- rejects corrupt, overlapping or incompatible metadata with typed errors;
- caches decoded shards in a byte-accounted LRU.

The default runtime cache is at most **4 decoded shards / 2 MiB of raw shard bytes**, whichever limit is reached first. This is an explicit payload-accounting bound, not a claim about exact JavaScript heap size. Final real-reader heap evidence remains part of the release/performance gate.

## Package asset boundary

`src/background/lexical/package-assets.js` is the only non-Provider source module permitted to call `fetch()`, and it may only read `chrome.runtime.getURL(...)` extension-package assets. It is not an external network boundary and requires no host permission.

Official release packaging places the #76-generated Core pack under:

`assets/lexicon/core/`

Tests use project-authored fixtures and do not require live network data. Those fixtures are validation assets only and must not be copied into the production extension. Production packaging is allowlist-based and may include generated `assets/lexicon/**` only when the pack itself is an approved runtime asset.

## Dictionary facts vs runtime rules

Valid runtime rules are generic operations such as Unicode normalization, conservative morphology, phrase matching, source/POS/domain evidence and deterministic ranking.

The following are not acceptable long-term coverage mechanisms:

- adding more project-authored headword → translation rows;
- adding brand/entity names one by one;
- query-specific ranking branches that encode a hidden sense table;
- using benchmark fixtures as runtime data.

A small evidenced compatibility override may exist temporarily, but it must remain bounded and have a source-driven replacement path. The former `reviewed-tech-terms` dataset is retained only as validation/audit history; the production Technical builder does not import it. New technical coverage must come from attributable source pipelines such as #116/#121/#126.

## Ranking and sufficiency

Candidate collection does not choose a semantic winner. #85 owns deterministic ranking/sufficiency in [LEXICAL_RANKING.md](./LEXICAL_RANKING.md). User Glossary is the only explicit override; all other local sources remain attributable candidates.

## Privacy/cache

Lexical lookup receives only the selected lexical text plus local page URL for resolving site glossary settings. It does not send the URL or lexical data to a Provider. Deterministic local results are not persisted to translation cache.
