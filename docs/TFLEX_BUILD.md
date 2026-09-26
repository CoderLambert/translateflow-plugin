# Building the TFLex Core Semantic Pack

Issue: #76  
Contract: [TFLEX_V1.md](./TFLEX_V1.md)

The Core pack build is intentionally **offline and source-locked**. The compiler never downloads source data. A release engineer obtains the exact locked artifacts, verifies them through the compiler, and produces deterministic TFLex output.

## Locked official inputs

Source lock:

`lexicon/source-locks/core-semantic-pwn3-cow.json`

The lock pins Open Multilingual Wordnet repository commit:

`406bf83b3c507a3d1f26e88252d5d66893fd36bf`

with these raw data SHA-256 values:

| Source | Locked path | SHA-256 |
| --- | --- | --- |
| Princeton WordNet 3.0 English tab | `wns/eng/wn-data-eng.tab` | `d1409d88addcdb890b1606dd280b558cca4258b1f33bd580d54ed949daad1ede` |
| Chinese Open Wordnet tab | `wns/cow/wn-data-cmn.tab` | `379fd2e41d3e1395f9f27cf23a39c6181849ffb4020c14a07ed2a4d4dd651122` |

The same lock contains the exact source-license notices used to generate `THIRD_PARTY_NOTICES.txt`.

## Reproduce an official build

Download the two raw files from the exact URLs in the source lock into a local source cache. Do not substitute the repository default branch.

The output directory must be new or empty. The compiler deliberately refuses to recursively delete a non-empty directory; cleanup is an explicit caller/release-engineer action.

Then run:

```bash
node scripts/build-tflex-core.mjs \
  --eng /path/to/wn-data-eng.tab \
  --cmn /path/to/wn-data-cmn.tab \
  --source-lock lexicon/source-locks/core-semantic-pwn3-cow.json \
  --out /tmp/translateflow-core
```

The source lock also pins `formatVersion`, `readerMinVersion`, and `normalizationVersion`. The compiler rejects incompatible locks and verifies both SHA-256 digests **before parsing**. Source drift fails closed. The emitted manifest records `compilerVersion`.

A successful output contains:

```text
manifest.json
directory.json
THIRD_PARTY_NOTICES.txt
shards/0000.jsonl
shards/0001.jsonl
...
```

The bundled profile guarantees each lexical shard stays within the Design Freeze read-unit budget of 512 KiB. An oversized individual record is rejected. The manifest records the effective `profileOptions.maxShardBytes`, and that value participates in the pack fingerprint.

## Determinism

For identical locked bytes, source-lock metadata, compiler version and shard-size profile:

- record ordering is deterministic;
- JSON object keys are serialized deterministically;
- shard boundaries are deterministic;
- file hashes and manifest fingerprint are deterministic.

The manifest fingerprint covers lookup-visible format/source identity plus the ordered output file descriptors. It intentionally excludes the fingerprint field itself.

## CI fixture

`tests/fixtures/tflex-core/` is project-authored and small enough for CI. It is not an upstream dictionary subset and carries no upstream dictionary text.

Run:

```bash
npm run validate
```

The tests compile the fixture twice and require byte-identical outputs, preserved polysemy, raw/display normalization, bounded shards, source-drift rejection, license-metadata validation and data-only rejection.

## Scope boundary

#76 builds the immutable Core artifact only. Runtime reading/ranking belongs to #77/#85. Technical Wikidata records belong to #78. Optional FreeDict packaging remains #83.
