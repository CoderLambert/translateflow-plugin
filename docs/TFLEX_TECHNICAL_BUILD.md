# Building the TFLex Technical Concept & Entity Pack

Issue: #78  
Contract: [TFLEX_V1.md](./TFLEX_V1.md)

The Technical pack is built **offline from a checked-in, revision-locked Wikidata structured-data extract**. Release builds do not query SPARQL or fetch Wikidata at build time.

## Locked input

- source lock: `lexicon/source-locks/technical-wikidata.json`
- normalized extract: `lexicon/sources/wikidata-tech-entities.json`
- license: CC0 1.0 for Wikidata main-namespace structured data
- integrity: exact byte size + SHA-256 recorded in the source lock

Every entity preserves its QID, exact Wikidata revision and permanent revision URL. Discovery may use live Wikidata tooling, but a candidate is not part of an official pack until its structured fields are copied into the locked extract and the source lock checksum/version is updated.

The pack deliberately excludes Wikipedia article prose, Commons files, logos, remote media, HTML and arbitrary external descriptions.

## Current named-entity set

The initial locked revision set covers:

- tmux;
- Docker;
- Kubernetes;
- React;
- Redis;
- OAuth;
- PostgreSQL.

Product/tool labels are preserved as product names in `translations[]`; structured type labels provide the local technical meaning used by later ranking/explanation stages.

## Auditable inclusion policy

An entity ships only when at least one locked type is in `policy.allowedTypes`. Non-technical/noisy types are excluded deterministically.

Alias policy is also locked:

- generic aliases known to create false positives can be explicitly blocked;
- aliases that require exact product casing are explicitly listed as case-sensitive;
- an alias index maps a normalized alias to one or more canonical record keys;
- one-to-many aliases stay ambiguous and never choose a first winner;
- all alias-index bytes are covered by `directory.json` SHA-256 and the pack fingerprint.

For the current revision set, the broad generic alias `container orchestrator` is intentionally excluded while `K8s`, `React.js`, `Reactjs`, `Docker Engine` and `Postgres` remain eligible under their locked policies.

## Reproduce

Use an empty output directory:

```bash
node scripts/build-tflex-technical.mjs \
  --extract lexicon/sources/wikidata-tech-entities.json \
  --source-lock lexicon/source-locks/technical-wikidata.json \
  --out /tmp/translateflow-technical
```

The builder:

1. verifies extract byte size and SHA-256 before parsing;
2. validates CC0/source metadata and TFLex compatibility;
3. filters entities through the locked technical type allowlist;
4. rejects executable/renderable markup;
5. emits deterministic bounded shards and a sorted one-to-many alias index;
6. writes source/license notices from the same source lock;
7. creates the TFLex pack fingerprint;
8. reopens the emitted pack through the production TFLex reader and self-checks every canonical record and alias.

## Runtime/network boundary

The generated pack is immutable local data. Runtime lookup uses #77's bundled TFLex reader and requires no Provider/API/network request.

The release builder itself contains no `fetch()` and no live SPARQL dependency. Network acquisition/discovery is a separate source-maintenance operation whose output must be reviewed and re-locked before a release build can consume it.

## Deferred in this issue

The named-entity slice is the first production batch. Common technical concepts such as `container`, `runtime` and `session` are added only when their exact Wikidata structured entity/revision and target-language semantics are judged suitable; they must pass the same source-lock and false-positive rules rather than being synthesized from Wikipedia prose.
