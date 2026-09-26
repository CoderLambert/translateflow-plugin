# Lexical Gateway

Issue: #77  
Contract: [TFLEX_V1.md](./TFLEX_V1.md)

The Lexical Gateway is a Background-only local lookup boundary. It is intentionally separate from the Translation Gateway and Provider stack.

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
  -> explicit irregular lemma/exception forms
  -> conservative morphology fallback
```

Except for an explicit User Glossary override, a generic Core hit does not short-circuit Technical or optional-pack candidates. Ranking and sufficiency are owned by #85.

## TFLex bundled reader

The bundled reader:

- loads only `manifest.json` + `directory.json` metadata initially;
- locates the bounded shard by sorted key range;
- verifies shard size/SHA-256 before decoding;
- rejects corrupt, overlapping or incompatible metadata with typed errors;
- caches decoded shards in a byte-accounted LRU.

The default runtime cache is at most **4 decoded shards / 2 MiB of raw shard bytes**, whichever limit is reached first. This is an explicit payload-accounting bound, not a claim about exact JavaScript heap size. Final real-reader heap evidence remains part of the release/performance gate.

## Package asset boundary

`src/background/lexical/package-assets.js` is the only non-Provider source module permitted to call `fetch()`, and it may only read `chrome.runtime.getURL(...)` extension-package assets. It is not an external network boundary and requires no host permission.

Official release packaging places the #76-generated Core pack under:

`assets/lexicon/core/`

Tests use a project-authored TFLex fixture and do not require live network data.

## Privacy/cache

Lexical lookup receives only the selected lexical text plus local page URL for resolving site glossary settings. It does not send the URL or lexical data to a Provider. Deterministic local results are not persisted to translation cache.
