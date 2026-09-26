# Building the Wikidata Technical TFLex Pack

Issue: #78  
Contract: [TFLEX_V1.md](./TFLEX_V1.md)

## Source boundary

The release builder consumes only the checked-in, revision-locked structured extract:

- `lexicon/sources/wikidata-tech-entities.json`
- lock: `lexicon/source-locks/technical-wikidata.json`

The lock binds the extract byte size/SHA-256, the exact QID + Wikidata revision set, TFLex compatibility, curation kind/category, alias policy and CC0 license evidence.

Live SPARQL and live Wikidata API calls are **not** release-build dependencies. They may be used only to discover or review a future source revision; updating the pack requires intentionally replacing the locked extract, revision metadata, hash and pack version.

## Included structured data

The v1 technical extract is deliberately narrow. It may contain:

- QID and exact revision;
- English label/aliases;
- optional Chinese structured label/aliases;
- bounded Wikidata description;
- bounded allowlisted type labels;
- permanent Wikidata QID/revision URL for provenance.

The builder rejects unexpected entity fields. It does not import Wikipedia article prose, sitelink article bodies, Commons media, logos, arbitrary external descriptions, HTML or executable content.

## Curation policy

The source lock distinguishes `technical-entity` from `technical-concept` and assigns a narrow domain/category. Current regression coverage includes tmux, Docker, Kubernetes/K8s, React/React.js, Redis, PostgreSQL/Postgres, OAuth, run-time system/runtime system, containerization and session.

Generic aliases can be explicitly blocked. For example, `container orchestrator` is not emitted as a Kubernetes alias because it is a generic concept and would create false-positive entity matches.

Case-sensitive aliases are explicit lock policy. `React.js` and `Reactjs` require declared casing, while `K8s` remains case-insensitive but retains exact-case match metadata for ranking.

## Reproduce

```bash
node scripts/build-tflex-technical.mjs \
  --extract lexicon/sources/wikidata-tech-entities.json \
  --source-lock lexicon/source-locks/technical-wikidata.json \
  --out /tmp/translateflow-technical
```

The output directory must be empty. The compiler verifies the locked source bytes before parsing, emits deterministic bounded TFLex shards plus the directory alias index, writes CC0 provenance into `THIRD_PARTY_NOTICES.txt`, and re-opens the emitted pack through the production TFLex reader as a self-check.

## Translation behavior

For named software/products without a structured Chinese label, the technical record preserves the product label as its translation/display value. When the locked structured extract has a Chinese label, that label is emitted as the target translation. Technical type labels, bounded description, category/domain, QID and revision remain separate attributable facts; no Wikipedia prose is synthesized into the pack.

## Audit/update rule

Any source update must change the locked extract hash and exact revision set. A release reviewer should inspect the source diff, type/alias allowlist, blocked aliases and licensing metadata before accepting a new pack fingerprint.
