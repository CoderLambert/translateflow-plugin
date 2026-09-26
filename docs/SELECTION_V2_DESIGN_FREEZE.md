# Selection v2 Design Freeze

Issue: #75  
Epic: #74  
Planning base: `3727f23795e64928645310e779cc46f38da8d2e0`

This document is the evidence ledger for the Design Freeze Gate. Production issues #76–#84 stay blocked until every required row is either PASS or has an explicit design change resolving the failure.

## 1. Decisions already supported by evidence

### PWN3 / Chinese Open Wordnet cannot be the only technical-reading source

A real-source audit was run against the Open Multilingual Wordnet repository at commit:

`406bf83b3c507a3d1f26e88252d5d66893fd36bf`

Relevant locked blobs at that commit:

- Princeton WordNet tab: `wns/eng/wn-data-eng.tab` — blob `4ddc0bdeba3323afc6e264243a17bba7bbf0b07a`
- Chinese Open Wordnet tab: `wns/cow/wn-data-cmn.tab` — blob `66e1993d2580281e2e5b41a2a1e76173a9aa75e6`
- COW license: `wns/cow/LICENSE`

The first Phase-A sample produced:

| Group | Terms | WordNet term hits | Terms with >=1 COW mapping | PWN synsets | COW-mapped synsets |
| --- | ---: | ---: | ---: | ---: | ---: |
| ordinary | 4 | 4 | 4 | 16 | 9 |
| polysemous | 6 | 6 | 6 | 58 | 27 |
| technical | 6 | 5 | 5 | 20 | 13 |
| named technical entities | 7 | 2 | 1 | 4 | 1 |

Material observations:

- `persistent` has four PWN senses but only two are mapped by COW.
- `session` maps only two of four PWN senses and does not provide the computing-session meaning needed by the target scenario.
- `container` maps to `集装箱`; that is valid general English but not the Docker/computing concept.
- `runtime` is absent from PWN in this sample path.
- `cache` maps traditional stash/store senses, not a computing cache.
- `repository` maps `贮藏室`, not a Git/software repository.
- `tmux`, Kubernetes, Redis, PostgreSQL and OAuth are absent.
- WordNet contains `docker`, but not the Docker software entity.
- WordNet contains verb `react`; COW maps a general reaction sense, not the React framework.
- COW lexical forms can contain source morphology notation such as `持久+的`; the production builder needs a documented normalization/display policy rather than rendering source notation directly.

**Current decision:** PWN3 + COW remain useful semantic/general-language inputs, but a Technical Concept & Entity layer is required in v1. This is no longer optional scope.

### Licensing facts already verified

- Princeton WordNet 3.0 permits use/copy/modify/distribution, including commercial use, subject to preservation of the license/copyright/disclaimer and its Princeton naming/publicity restriction.
- The COW license in the locked OMW source permits use/copy/modify/distribution for any purpose without fee/royalty, subject to preserving its copyright/disclaimer.
- Wikidata structured data in the main/Property/Lexeme/EntitySchema namespaces is CC0. Wikipedia prose, Commons media and other externally licensed content are outside the planned pack.
- FreeDict is not treated as one global license. The exact `eng-zho` TEI header must be archived and approved before its role is frozen.

## 2. Reproducible source-audit tooling

The repository includes:

- `tests/fixtures/selection-v2-quality.json` — project-authored Phase-A corpus.
- `scripts/audit-lexicon-sources.mjs` — offline parser/auditor for locked OMW English/Chinese tab files.
- `tests/lexicon-source-audit.test.mjs` — deterministic parser/coverage tests.

Example after obtaining exact locked source files:

```bash
node scripts/audit-lexicon-sources.mjs \
  --eng /path/to/wn-data-eng.tab \
  --cmn /path/to/wn-data-cmn.tab \
  --corpus tests/fixtures/selection-v2-quality.json
```

Official CI does not fetch live dictionary sources. Release data inputs must be source-locked and checksum-verified.

## 3. Browser/MV3 POC

Status: **in progress**.

The POC must prove in the real extension runtime:

- OPFS write/read from an MV3 service worker;
- data survives browser/service-worker restart using the same extension profile/origin;
- bundled monolithic-vs-sharded asset behavior;
- WebCrypto signature verification compatibility for a pinned catalog trust root;
- no requirement for broad required host permissions;
- bounded visible-context extraction and sensitive editable behavior.

Browser evidence belongs in `e2e/design-freeze-poc.spec.mjs` and its CI run.

## 4. Privacy/cache contract to freeze

Provisional policy pending browser POC:

- local lexical facts never leave the browser;
- local lexical facts are not persisted as generated translation cache entries;
- AI explain payload excludes raw page URL and full-page text;
- context is bounded visible text around the selection;
- surrounding values/text from form/editable surfaces are not silently transmitted;
- generated explanation from a sensitive editable selection defaults to non-persistent/memory-only behavior.

## 5. Trust/permission contract to freeze

Provisional policy pending browser POC:

- SHA-256 verifies bytes but is not catalog authenticity;
- catalog authenticity is rooted in a verification key/trust root shipped with the extension;
- signed metadata binds pack id/version/format/reader compatibility/size/hash;
- optional pack origin permission is user-triggered and narrowed to the trusted origin;
- automatic downgrade/replay is rejected;
- `unlimitedStorage` is not added unless quota/eviction evidence proves it necessary.

## 6. Open Design Freeze rows

- [x] Real PWN3/COW feasibility sample shows a mandatory technical-data gap.
- [ ] Exact FreeDict eng-zho TEI license archived and quality sampled.
- [ ] Reproducible locked Wikidata technical extract demonstrated.
- [ ] Bundled monolithic-vs-sharded asset POC measured.
- [ ] OPFS restart/recovery POC passed.
- [ ] Package-size / cold-warm latency / peak-memory budgets recorded.
- [ ] Catalog signature/trust-root POC passed.
- [ ] Narrow optional-origin permission flow proven.
- [ ] Context extraction + editable privacy POC passed.
- [ ] Disposable Selection vertical slice passed.
- [ ] Final source composition frozen.
- [ ] Final TFLex logical schema/reader version contract frozen.
- [ ] Final physical storage profiles frozen.
- [ ] Final privacy/cache/trust/permission ADR frozen.

Until those rows close, #76 is intentionally blocked.
