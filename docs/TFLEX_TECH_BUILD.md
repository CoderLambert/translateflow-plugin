# Building the Wikidata Technical TFLex Pack

Issue: #78  
Contract: [TFLEX_V1.md](./TFLEX_V1.md)

## Source boundary

The release builder consumes only the checked-in, revision-locked structured extract:

- `lexicon/sources/wikidata-tech-entities.json`
- lock: `lexicon/source-locks/technical-wikidata.json`

The lock binds the exact extract byte size/SHA-256, exact QID + Wikidata revision set, TFLex compatibility, curation kind/category, alias policy and CC0 license evidence.

The source also carries explicit revision-set snapshot provenance:

- snapshot kind: `qid-revision-set`
- snapshot version
- lock timestamp
- deterministic `extractRuleVersion`

These fields are copied into the TFLex manifest source metadata; snapshot version and extract-rule version participate in the pack fingerprint.

Live SPARQL and live Wikidata API calls are **not** release-build dependencies. They may be used only to discover or independently review a future source revision.

## Included structured data

The v1 release extract deliberately permits only:

- QID and exact revision;
- English label and aliases;
- bounded allowlisted type labels;
- permanent QID/revision URL.

The source lock separately assigns the curated `technical-entity` / `technical-concept` kind and narrow domain/category.

The builder rejects any unexpected field. In particular, the release extract does **not** carry:

- Wikipedia article prose or sitelink article bodies;
- zhwiki sitelink titles disguised as Wikidata Chinese labels;
- descriptions;
- Commons media or logos;
- remote resources;
- HTML or executable content.

If a future source revision adds a verified Wikidata Chinese label/alias path, that needs an explicit field-level provenance contract and test before it can enter this pack.

## Current revision set

The locked set covers named entities such as:

- tmux;
- Docker;
- Kubernetes;
- React;
- Redis;
- PostgreSQL;
- OAuth.

It also contains attributable technical concepts where the structured source is suitable:

- run-time system / runtime system;
- containerization;
- session.

The pack does **not** synthesize aliases that the locked source does not provide. Therefore standalone `runtime` and `container` remain safe no-hits in this pack; later ranking or AI logic must not pretend those aliases came from Wikidata.

## Alias policy

Generic aliases can be explicitly blocked. `container orchestrator` is not emitted as a Kubernetes alias because it is a generic concept and would create a false-positive entity match.

Case-sensitive aliases are explicit lock policy. `React.js` and `Reactjs` require declared casing; `K8s` remains case-insensitive while retaining exact-case match metadata.

The directory alias index supports one-to-many canonical targets. Ambiguous aliases remain multiple candidates and never choose a build-time winner.

## Translation semantics

A technical record is useful even when no verified Simplified-Chinese target string exists. In that case:

- `displayForm` remains the attributable source label;
- `typeLabels[]`, `domains[]`, QID/revision and provenance remain available;
- `translations[]` is empty.

The builder does **not** copy an English display label into `translations[]` merely to satisfy the target-language field, and does not reuse a Wikipedia sitelink title as a Wikidata Chinese label.

## Reproduce

Use an empty output directory:

```bash
node scripts/build-tflex-technical.mjs \
  --extract lexicon/sources/wikidata-tech-entities.json \
  --source-lock lexicon/source-locks/technical-wikidata.json \
  --out /tmp/translateflow-technical
```

The builder:

1. verifies exact extract size and SHA-256 before parsing;
2. validates CC0, snapshot metadata, QID/revision set and TFLex compatibility;
3. filters through the locked technical type allowlist;
4. rejects unapproved schema fields and executable/renderable markup;
5. emits deterministic bounded shards and the sorted one-to-many alias index;
6. writes CC0/source/snapshot notice metadata;
7. fingerprints the locked source identity, snapshot rule version and emitted files;
8. re-opens the emitted pack through the production TFLex reader and self-checks every canonical record and alias.

## Runtime/network boundary

The generated pack is immutable local data. Runtime lookup uses #77's bundled TFLex reader and requires no Provider/API/network request.

Any future source update must intentionally change the locked extract, exact revision set, checksum/snapshot metadata and pack version. A release reviewer should inspect the source diff, type/alias policy and license provenance before accepting a new fingerprint.
