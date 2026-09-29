# StarDict import POC boundary

Issue: #124

This POC validates the first untrusted-input boundary for user-owned StarDict dictionaries.

## Current supported subset

Only the simplest deterministic StarDict profile is accepted:

- `.ifo` version 2.4.2 or 3.0.0;
- 32-bit `.idx` offsets;
- uncompressed `.dict`;
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

It deliberately does **not** label arbitrary StarDict plain text as a translation, definition, sense or example. Semantic mapping into TFLex is a later #124 unit and must be justified by source metadata/user import configuration.

## Fail-closed security policy

The parser rejects:

- unsupported versions or rich field types;
- `.dict.dz` until a bounded streaming decompressor exists;
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
- DICT: 128 MiB;
- one entry: 512 KiB;
- entries: 1,000,000;
- synonyms: 1,000,000;
- headword/alias bytes: 1,024.

These are parser safety ceilings, not product quota promises.

## Runtime/package boundary

- no imported dictionary content enters the base extension;
- no fixture or POC output is copied by production packaging;
- no imported HTML/CSS/JS is rendered or executed;
- no network URL in imported data is fetched;
- no Provider/AI call is involved;
- user import does not imply TranslateFlow has redistribution rights.

## Next #124 units

1. add bounded `.dict.dz` decompression;
2. implement the MDict metadata/content POC with equivalent fail-closed limits;
3. connect converted local TFLex to the existing pack storage/lifecycle only after parser/security review;
4. measure import time, output bytes and lookup cost before production commitment.


## Explicit bilingual semantic mapping POC

The next POC stage may convert the safe plain-text projection into TFLex **only** when a separate import recipe explicitly declares the dictionary semantics.

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
  --dict dictionary.dict \
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

The POC reader is validation infrastructure only. Production activation of local/imported `opfs-indexed-v1` readers is still a separate dictionary-pack lifecycle unit; this stage does not silently register imported content into the running extension.
