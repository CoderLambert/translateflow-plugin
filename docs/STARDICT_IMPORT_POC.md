# StarDict import POC boundary

Issue: #124

This POC validates the first untrusted-input boundary for user-owned StarDict dictionaries.

## Current supported subset

Only the simplest deterministic StarDict profile is accepted:

- `.ifo` version 2.4.2 or 3.0.0;
- 32-bit `.idx` offsets;
- uncompressed `.dict`;
- `sametypesequence=m` UTF-8 plain text;
- no `.syn` aliases;
- no embedded resources;
- no renderable markup.

The POC outputs **build/test-only JSONL projection**, not a runtime TFLex pack.

Each projected row contains:

- normalized lookup key;
- exact/display headword;
- source plain text;
- source reference.

It deliberately does **not** label arbitrary StarDict plain text as a translation, definition, sense or example. Semantic mapping into TFLex is a later #124 unit and must be justified by source metadata/user import configuration.

## Fail-closed security policy

The parser rejects:

- unsupported versions or rich field types;
- `.dict.dz` until a bounded streaming decompressor exists;
- 64-bit offsets until explicitly implemented and tested;
- `.syn` until aliases have a bounded deterministic parser;
- malformed/truncated/unsorted index records;
- offset/length ranges outside the selected `.dict`;
- invalid UTF-8;
- oversized metadata/index/dictionary/entry/headword inputs;
- control characters;
- HTML-like/renderable markup.

Current default POC limits:

- IFO: 64 KiB;
- IDX: 64 MiB;
- DICT: 128 MiB;
- one entry: 512 KiB;
- entries: 1,000,000;
- headword bytes: 1,024.

These are parser safety ceilings, not product quota promises.

## Runtime/package boundary

- no imported dictionary content enters the base extension;
- no fixture or POC output is copied by production packaging;
- no imported HTML/CSS/JS is rendered or executed;
- no network URL in imported data is fetched;
- no Provider/AI call is involved;
- user import does not imply TranslateFlow has redistribution rights.

## Next #124 units

1. define explicit semantic mapping for approved bilingual StarDict profiles and emit local TFLex;
2. add bounded `.dict.dz` decompression and optional `.syn` parsing;
3. implement the MDict metadata/content POC with equivalent fail-closed limits;
4. connect converted local TFLex to the existing pack storage/lifecycle only after parser/security review;
5. measure import time, output bytes and lookup cost before production commitment.
