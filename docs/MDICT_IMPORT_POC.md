# MDict import POC boundary

Issue: #124

This POC establishes a strict untrusted-input boundary for user-owned MDict `.mdx` dictionaries. It extracts approved lexical text only; it does not render MDict presentation content.

## Supported subset

The initial parser deliberately accepts only a narrow MDict v2 profile:

- `.mdx` files generated as MDict engine version 2.0;
- unencrypted dictionaries only;
- UTF-8 and UTF-16 text encodings;
- the v2 key-block-info section using its required zlib block;
- uncompressed or zlib-compressed key-data and record blocks;
- v2 keyword index, keyword blocks, record index and record blocks;
- Adler32 validation for the header and every decoded block;
- plain-text record payloads only.

The projection output is build/test-only JSONL. It is semantic-neutral: arbitrary MDict record text is not guessed to be a translation, definition, sense or example.

## Explicitly unsupported

The POC fails closed on:

- MDX 1.x or 3.x;
- encrypted MDX;
- LZO-compressed blocks;
- GBK / Big5 encodings;
- Compact / Compat / StyleSheet presentation transforms;
- HTML-like/renderable record markup;
- `@@@LINK=` redirects;
- `.mdd` resources;
- unknown compression types;
- malformed/truncated indexes, blocks or record offsets.

Unsupported features are reported/rejected; TranslateFlow does not silently render or approximate them.

## Resource and corruption limits

Current parser ceilings:

- MDX file: 128 MiB;
- UTF-16LE XML header: 256 KiB;
- decoded keyword index: 16 MiB;
- one compressed block: 32 MiB;
- one decoded block: 32 MiB;
- total decoded record bytes: 128 MiB;
- one record: 512 KiB;
- entries: 1,000,000;
- key/record blocks: 65,536;
- one headword: 1,024 bytes.

Zlib blocks are decompressed through a bounded stream. Output exceeding the declared or configured ceiling is aborted before lexical parsing continues.

These values are POC safety ceilings, not final product quotas.

## Data-only security model

Imported MDict content is treated as untrusted data:

- no imported HTML/CSS/JS is executed;
- no record markup is rendered;
- no remote URL from imported content is fetched;
- `.mdd` resources are not mounted or loaded;
- no Provider/AI call is made by the importer;
- local import does not imply redistribution rights;
- raw fixtures and parser corpora remain outside the production extension package.

## Projection shape

Each accepted entry projects only:

- normalized lookup key;
- exact/display headword;
- sanitized source plain text;
- source reference.

Source-provided presentation semantics are not synthesized into richer lexical structure.

Run:

```bash
npm run project:mdict -- \
  --mdx dictionary.mdx \
  --out /tmp/mdict-projection.jsonl \
  --report /tmp/mdict-report.json \
  --source-id local-mdict \
  --source-version local-v1
```



## Explicit bilingual semantic mapping POC

The semantic projection remains neutral until a separate local import recipe explicitly declares that the selected dictionary is an English -> Simplified Chinese plain-text translation source.

Required recipe shape:

```json
{
  "schemaVersion": 1,
  "semanticProfile": "en-zh-plain-text-translation-v1",
  "packId": "local-my-mdict",
  "packVersion": "local-v1",
  "sourceLanguage": "en",
  "targetLanguage": "zh-CN",
  "dictionary": {
    "title": "Exact MDict title",
    "generatedByEngineVersion": "2.0",
    "encoding": "UTF-8",
    "format": "Text",
    "sourceId": "local-source-id",
    "sourceVersion": "local-v1",
    "mdxSha256": "<exact lowercase sha256 of the selected .mdx>"
  },
  "assertions": {
    "plainTextRepresentsTargetTranslation": true,
    "localUseOnly": true
  }
}
```

The recipe is bound to both the parser-visible dictionary metadata and the exact selected MDX bytes. A same-title dictionary with a different SHA-256 fails closed.

Run:

```bash
npm run build:tflex:mdict-import -- \
  --mdx dictionary.mdx \
  --recipe import-recipe.json \
  --out /tmp/local-mdict-tflex \
  --report /tmp/local-mdict-report.json
```

The output contains:

```text
manifest.json
index.dat
entries.dat
```

Properties:

- TFLex v1 physical profile `opfs-indexed-v1`;
- distribution status `user-import-only`;
- English -> zh-CN only for this semantic profile;
- one accepted MDict source row becomes one attributable TFLex sense;
- duplicate headwords preserve separate source-row provenance;
- no aliases are synthesized because `@@@LINK=` redirects remain rejected;
- no POS/domain/example metadata is invented;
- the exact MDX SHA-256 is retained in source provenance and the manifest;
- source license remains `USER-PROVIDED-UNVERIFIED`;
- output satisfies the existing optional-pack manifest health contract;
- the POC reader participates in the existing Lexical Gateway candidate/provenance model.

This compiler does not activate the imported pack in the production extension. Runtime registration and storage lifecycle remain separate #124 work.

## Next #124 units

1. validate the MDict parser against representative real user-owned dictionaries before widening format support;
2. decide a safe `.mdd` resource policy; do not render arbitrary resource-backed presentation content;
3. connect converted local TFLex to the production OPFS reader/storage lifecycle;
4. add cancellation, failure cleanup and isolation;
5. measure import time, output bytes and lookup cost before production commitment.
