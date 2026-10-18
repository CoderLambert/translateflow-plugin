# Building and validating generic TFLex packs

TFLex is a content-independent format. TranslateFlow no longer generates built-in source packs or includes dictionary content in any extension package. Users explicitly download or import dictionaries through the library. The file/storage contract remains [TFLEX_V1.md](TFLEX_V1.md).

## Shared writer and validation

`scripts/tflex-writer.mjs` owns reusable tooling, without source-specific lexical records:

- `writeTflexPack({ records, sources, packId, packVersion, sourceLanguage, targetLanguage, outDir, maxShardBytes })` writes deterministic bounded shards, directory, notices and fingerprinted manifest; returns `{ manifest, directory, records }`.
- `validateTflexRecords(records)` validates the logical data-only record model.
- `validateTflexOutput({ outDir, readerVersion })` validates the emitted manifest, descriptors, hashes, shard ranges, record counts and fingerprint.
- Shared normalization, deterministic JSON serialization and format constants are reused by existing third-party conversion tools.

Each source provides its attributable `id`, `version`, `provenance`, locked data URL/SHA-256 and license identity/source/notice. The caller supplies real source-derived records. A successful writer result is format evidence, not permission to redistribute a source or a declaration of source quality.

The output directory must be new or empty. The writer refuses destructive replacement of a nonempty directory. Each shard stays within `maxShardBytes` (default 512 KiB); a single oversized record is rejected. The persisted profile identifier `bundled-sharded-v1` remains unchanged for existing files and generic tooling. It does not enable dictionary packaging.

## Retained converters

The existing FreeDict research, MDX, StarDict and Kaikki/Wiktextract tools retain their independent provenance and format restrictions. See their scripts and source contracts before invoking them. Browser imports continue to use the existing local importer/OPFS installation transaction; no storage migration, changed pack ID or user-data cleanup is required.

Production runtime lookup uses enabled user-installed OPFS dictionaries and effective User Glossary. The reusable sharded Reader remains bounded and integrity-checked. Test records remain under `tests/` or `e2e/` and never enter installation packages.

## Validation

```bash
node --test tests/tflex-builder.test.mjs
```

Use the retained converter-specific tests for each affected input format. A normal extension build requires no dictionary sources, downloads or generated dictionary files. Historical source-specific build instructions were retired; their original content is preserved in Git history at `349321a079544a51834de1b3173f1fc653220e6d`.
