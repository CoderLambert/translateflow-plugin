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

Except for an explicit User Glossary override, a user-dictionary hit does not short-circuit candidates from other enabled dictionaries. Ranking and sufficiency are owned by #85.

The runtime does not carry a project-authored irregular word→lemma table. Irregular forms such as `went`, `children`, `better` or `written` remain measurable source gaps unless an attributable dictionary/morphology source supplies the relation. Generic suffix rules remain valid runtime algorithms because they do not encode per-word lexical facts.

## Generic TFLex reader

The reusable sharded-format reader:

- loads only `manifest.json` + `directory.json` metadata initially;
- locates the bounded shard by sorted key range;
- resolves optional directory aliases to one-or-more canonical keys before shard reads; ambiguous aliases remain multiple candidates rather than a first-hit winner;
- verifies shard size/SHA-256 before decoding;
- rejects corrupt, overlapping or incompatible metadata with typed errors;
- caches decoded shards in a byte-accounted LRU.

The default runtime cache is at most **4 decoded shards / 2 MiB of raw shard bytes**, whichever limit is reached first. This is an explicit payload-accounting bound, not a claim about exact JavaScript heap size. Final real-reader heap evidence remains part of the release/performance gate.

## User-installed dictionary boundary

Production registers only the existing active OPFS reader and effective User Glossary resolver. It discovers enabled user dictionaries from persisted state; there are no fixed package paths, bundled Readers, health checks or status messages. No installed dictionary is a normal local `no-hit`, not resource damage. A damaged user pack remains a scoped diagnostic and cannot suppress healthy packs or Glossary.

Users install through curated downloads or local TFLex / StarDict / MDX / MDD import. Installation, rollback, resource recovery, ordering and preferences retain their existing owners and storage formats. The gateway neither mutates installation state nor downloads data. The settings library exposes curated dictionaries, installed dictionaries and local import.

All extension builds exclude dictionary content. Tests explicitly prepare synthetic user-installed dictionaries in isolated profiles; fixtures never enter the production package.

## Dictionary facts vs runtime rules

Valid runtime rules are generic operations such as Unicode normalization, conservative morphology, phrase matching, source/POS/domain evidence and deterministic ranking.

The following are not acceptable long-term coverage mechanisms:

- adding more project-authored headword → translation rows;
- adding brand/entity names one by one;
- query-specific ranking branches that encode a hidden sense table;
- using benchmark fixtures as runtime data.

A small evidenced compatibility override may exist temporarily, but it must remain bounded and have a source-driven replacement path. The retired built-in dictionaries and their source-specific builders are no longer maintained. New dictionary coverage must come from attributable user-installed sources.

## Ranking and sufficiency

Candidate collection does not choose a semantic winner. #85 owns deterministic ranking/sufficiency in [LEXICAL_RANKING.md](./LEXICAL_RANKING.md). User Glossary is the only explicit override; all other local sources remain attributable candidates.

## Privacy/cache

Lexical lookup receives only the selected lexical text plus local page URL for resolving site glossary settings. It does not send the URL or lexical data to a Provider. Deterministic local results are not persisted to translation cache.
