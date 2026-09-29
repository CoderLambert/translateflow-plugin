# StarDict import POC boundary

Issue: #124

This POC validates the first untrusted-input boundary for user-owned StarDict dictionaries.

## Current supported subset

Only the simplest deterministic StarDict profile is accepted:

- `.ifo` version 2.4.2 or 3.0.0;
- 32-bit `.idx` offsets;
- uncompressed `.dict` or dictzip-compressed `.dict.dz`;
- `sametypesequence=m` UTF-8 plain text;
- optional bounded `.syn` aliases using 32-bit source-entry indexes;
- no embedded resources;
- no renderable markup.

The POC outputs **build/test-only JSONL projection**, not a runtime TFLex pack.

Each projected row contains:

- normalized lookup key;
- exact/display headword;
- source plain text;
- optional source-provided aliases;
- source reference.

It deliberately does **not** label arbitrary StarDict plain text as a translation, definition, sense or example. The projection remains semantic-neutral; conversion into TFLex is a separate explicit-recipe stage described below and requires source metadata/user import configuration.

## Fail-closed security policy

The parser rejects:

- unsupported versions or rich field types;
- malformed/non-DEFLATE `.dict.dz` gzip headers;
- `.dict.dz` files without a structurally valid dictzip `RA` extra subfield;
- dictzip `RA` versions other than v1;
- inconsistent/duplicate dictzip chunk metadata;
- compressed `.dict.dz` files above the input ceiling or decompressed output above the DICT ceiling;
- 64-bit offsets until explicitly implemented and tested;
- malformed/truncated/unsorted index or synonym records;
- `.syn` targets outside the declared `.idx` word list;
- `.syn` count/metadata mismatches;
- offset/length ranges outside the selected `.dict`;
- invalid UTF-8;
- oversized metadata/index/dictionary/entry/headword inputs;
- control characters;
- HTML-like/renderable markup.

Current default POC limits:

- IFO: 64 KiB;
- IDX: 64 MiB;
- SYN: 32 MiB;
- DICT.DZ compressed input: 128 MiB;
- DICT decompressed bytes: 128 MiB;
- one entry: 512 KiB;
- entries: 1,000,000;
- synonyms: 1,000,000;
- headword/alias bytes: 1,024.

These are parser safety ceilings, not product quota promises.

For `.dict.dz`, TranslateFlow validates the dictzip gzip/RA header first and then performs bounded streaming decompression. The POC intentionally inflates the body once during import rather than implementing random-access chunk reads in the runtime; the decompressed buffer is still capped before lexical parsing, so a small compressed input cannot expand past the configured DICT ceiling.

## Runtime/package boundary

- no imported dictionary content enters the base extension;
- no fixture or POC output is copied by production packaging;
- no imported HTML/CSS/JS is rendered or executed;
- no network URL in imported data is fetched;
- no Provider/AI call is involved;
- user import does not imply TranslateFlow has redistribution rights.

## Next #124 units

1. implement the MDict metadata/content POC with equivalent fail-closed limits;
2. connect converted local TFLex to the existing pack storage/lifecycle only after parser/security review;
3. add explicit import cancellation / failure cleanup and isolation;
4. measure import time, output bytes and lookup cost before production commitment.


## Explicit bilingual semantic mapping POC

The semantic-mapping POC converts the safe plain-text projection into TFLex **only** when a separate import recipe explicitly declares the dictionary semantics.

Required recipe shape:

```json
{
  "schemaVersion": 1,
  "semanticProfile": "en-zh-plain-text-translation-v1",
  "packId": "local-my-dictionary",
  "packVersion": "local-v1",
  "sourceLanguage": "en",
  "targetLanguage": "zh-CN",
  "dictionary": {
    "bookname": "Exact StarDict bookname",
    "sourceId": "local-source-id",
    "sourceVersion": "local-v1"
  },
  "assertions": {
    "plainTextRepresentsTargetTranslation": true,
    "localUseOnly": true
  }
}
```

The recipe is intentionally external to the StarDict bytes. StarDict `sametypesequence=m` only says that the payload is plain text; it does **not** prove that the text is a Chinese translation. TranslateFlow therefore refuses to infer the language direction or semantic role.

The compiler also binds the recipe to the exact `.ifo` `bookname`. Reusing a recipe for a different dictionary fails closed.

Run:

```bash
npm run build:tflex:stardict-import -- \
  --ifo dictionary.ifo \
  --idx dictionary.idx \
  --dict dictionary.dict.dz \
  --syn dictionary.syn \
  --recipe import-recipe.json \
  --out /tmp/local-stardict-tflex \
  --report /tmp/local-stardict-report.json
```

The output is:

```text
manifest.json
index.dat
entries.dat
```

Properties:

- TFLex v1;
- physical profile `opfs-indexed-v1`;
- distribution status `user-import-only`;
- English → zh-CN only for this semantic profile;
- one source StarDict row becomes one attributable TFLex sense;
- source-provided `.syn` aliases become TFLex aliases without creating fabricated senses;
- duplicate StarDict headwords are grouped under one lexical record without discarding their source-row boundaries;
- no POS/domain/example metadata is invented;
- source license is recorded as `USER-PROVIDED-UNVERIFIED`: local import does not assert redistribution rights;
- output satisfies the existing optional-pack manifest health contract;
- a POC indexed reader verifies the output can participate in the existing Lexical Gateway candidate/provenance model.

The build-side POC reader remains validation infrastructure only. The emitted three-file TFLex pack is now compatible with the production local-import transaction and dynamic active-pack reader. The remaining StarDict product gap is the browser-side parser/converter adapter that feeds those validated bytes into the transaction; imported content is never activated before that transaction succeeds.
