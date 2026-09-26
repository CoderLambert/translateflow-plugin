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

Exact-head evidence at `33ef962f8e6777c82c07940d450e0fb73a27197a`:

- quality #159 — PASS
- Chromium E2E #128 — PASS
- MV3 service worker: `navigator.storage.getDirectory()` available.
- OPFS fixture survived full persistent-browser-context close/relaunch with the same extension profile.
- WebCrypto ECDSA P-256 signature verification succeeded; a one-byte-equivalent catalog mutation was rejected.
- storage estimate in CI: quota 10,737,520,784 bytes; test usage 102,544 bytes; `navigator.storage.persisted()` returned `false`.
- bundled asset ordinary fetch: 524,312 bytes.
- byte-range read from the same `chrome-extension://` asset: 23 bytes, exactly the requested marker, despite status 200/no `Content-Range` header.
- tiny prefix shard fixture: 45 bytes.
- CI timing on this synthetic fixture was low-single-digit milliseconds and is **not** treated as a production performance budget.

This proves that byte-range access to a monolithic bundled asset is technically viable in the tested Chromium runtime. It does **not** prove that monolithic storage is always preferable; #75 still needs realistic pack-size/index measurements.

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

## 6. Wikidata locked-extract strategy

The repository now contains a CC0 structured-data sample lock for:

- tmux — Q1935361 @ revision 2532735398
- Docker software — Q15206305 @ revision 2547641252
- Kubernetes — Q22661306 @ revision 2537061327
- React — Q19399674 @ revision 2531086275
- Redis software — Q2136322 @ revision 2535677803
- OAuth — Q743238 @ revision 2474831081

The design intentionally separates **discovery** from **release inputs**:

1. SPARQL or other live discovery may identify candidate QIDs during source refresh.
2. The refresh job records exact QID + Wikidata revision and emits a restricted structured-data extract.
3. The extract is versioned/checksummed.
4. Official TFLex builds consume only that frozen extract, never live SPARQL results.

`scripts/audit-wikidata-tech-lock.mjs` rejects missing revisions, unbound permanent URLs and disallowed fields such as logos/media/HTML/JS/WASM. This demonstrates a practical reproducibility model without making every release build process the complete Wikidata dump.

## 7. FreeDict early audit

Official FreeDict metadata for `eng-zho` edition `2025.11.23` is locked in `tests/fixtures/freedict-eng-zho-source-lock.json`:

- 26,660 headwords;
- source archive size: 1,600,448 bytes;
- exact official source URL;
- exact SHA-512: `25aed0f1d7de68919aa9da1ba92d67f566ae4ea81660f42071c81fc21e56d4b210d61df379315678648c45ca7e52c4a0ba2eec009fbaab7c72e7472489e1fc4c`.

WikDict generator evidence at commit `f30228da482e74b06956ef55dcf23ae2757f9812`, which predates this release, emits a TEI header declaring CC BY-SA 3.0 and identifies Wiktionary via DBnary as its base data.

**This is not enough to approve the pack.** The exact 2025.11.23 TEI header/source archive must still be archived/inspected before approval. The test suite explicitly keeps `approvedForOfficialPack=false` until that happens.

## 8. Open Design Freeze rows

- [x] Real PWN3/COW feasibility sample shows a mandatory technical-data gap.
- [ ] Exact FreeDict eng-zho TEI license archived and quality sampled.
- [x] Reproducible revision-locked Wikidata technical extract strategy demonstrated on six representative entities.
- [x] Bundled full-vs-byte-range-vs-tiny-shard transfer behavior measured on a synthetic asset; realistic pack-size benchmark still required before final physical-profile freeze.
- [x] OPFS write/read survives browser/service-worker restart; missing/corrupt active-file recovery policy POC still pending.
- [ ] Package-size / cold-warm latency / peak-memory budgets recorded.
- [x] WebCrypto ECDSA P-256 pinned-key verification/tamper-rejection POC passed; key-rotation/revocation policy still pending.
- [ ] Narrow optional-origin permission flow proven.
- [ ] Context extraction + editable privacy POC passed.
- [ ] Disposable Selection vertical slice passed.
- [ ] Final source composition frozen.
- [ ] Final TFLex logical schema/reader version contract frozen.
- [ ] Final physical storage profiles frozen.
- [ ] Final privacy/cache/trust/permission ADR frozen.

Until those rows close, #76 is intentionally blocked.
