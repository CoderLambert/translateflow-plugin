# Selection v2 Design Freeze

Issue: #75  
Epic: #74  
Planning base: `3727f23795e64928645310e779cc46f38da8d2e0`

This is the Design Freeze evidence ledger. #76 production implementation may start only after the decisions below are reviewed against exact-head CI.

## 1. Frozen v1 product boundary

Offline lexical assistance v1 supports:

- English / English-dominant technical selections;
- Simplified Chinese output;
- ordinary lexical senses, technical concepts and named technical entities;
- local-first lookup with grounded AI only for ambiguity/insufficiency;
- sentence/unsupported-language selections falling back to the existing Translation Gateway.

It does not infer the user's profession, concatenate unknown phrase tokens as a fake translation, or call AI for every word.

## 2. Frozen source composition

### Required general semantic source: PWN3 + Chinese Open Wordnet

Locked Open Multilingual Wordnet source commit:

`406bf83b3c507a3d1f26e88252d5d66893fd36bf`

Locked blobs:

- English/PWN tab: `4ddc0bdeba3323afc6e264243a17bba7bbf0b07a`
- Chinese Open Wordnet tab: `66e1993d2580281e2e5b41a2a1e76173a9aa75e6`
- COW license: `wns/cow/LICENSE`

Phase-A source sampling:

| Group | Terms | PWN term hits | Terms with COW mapping | PWN senses | COW-mapped senses |
| --- | ---: | ---: | ---: | ---: | ---: |
| ordinary | 4 | 4 | 4 | 16 | 9 |
| polysemous | 6 | 6 | 6 | 58 | 27 |
| technical | 6 | 5 | 5 | 20 | 13 |
| named technical entities | 7 | 2 | 1 | 4 | 1 |

Material findings:

- `persistent` has useful general mappings but not complete sense coverage;
- `session` lacks the computing meaning needed by the target scenario;
- `container` maps the general shipping-container sense;
- `runtime` is absent;
- `cache` and `repository` emphasize non-computing senses;
- tmux, Kubernetes, Redis, PostgreSQL and OAuth are absent;
- Docker/React collide with ordinary English words;
- COW can contain morphology notation such as `持久+的`; raw source and display-normalized form must remain distinguishable.

**Decision:** PWN3+COW are the canonical general semantic layer, not a complete technical-reading dictionary.

### Required technical source: revision-locked Wikidata structured data

The Technical Concept & Entity layer is **required v1 scope**.

The POC locks representative QIDs to exact revisions for tmux, Docker, Kubernetes, React, Redis and OAuth. Release construction follows:

```text
live discovery may find QIDs
 -> exact QID + revision locked
 -> restricted structured-data extract
 -> checksum/version
 -> TFLex build input
```

Official builds never depend on live SPARQL. Wikipedia prose, Commons media, logos and arbitrary external content are excluded.

### Optional complementary source: FreeDict eng-zho

Exact official release metadata locked:

- edition: `2025.11.23`
- official source archive: `freedict-eng-zho-2025.11.23.src.tar.xz`
- source size: 1,600,448 bytes
- SHA-512: `25aed0f1d7de68919aa9da1ba92d67f566ae4ea81660f42071c81fc21e56d4b210d61df379315678648c45ca7e52c4a0ba2eec009fbaab7c72e7472489e1fc4c`

Independent reproducible-build evidence pins the same URL/checksum, extracts the archive `COPYING`, and records CC BY-SA 3.0. The exact TEI attribution/header still has to be archived before an official FreeDict pack ships.

Quality sampling from shards generated from that same pinned archive found:

- useful complementary technical candidates: `cache`, `dependency`, `commit`, `state`;
- weak/wrong examples: `portable -> 手机`, several `issue` mappings;
- general-only coverage for `container`, `repository`, `session`, `react`;
- missing target terms including `persistent`, `runtime`, `tmux`, Kubernetes, Redis, PostgreSQL and OAuth.

**Decision:** FreeDict remains an optional complementary candidate source. It is not Core and does not block #76. Exact TEI attribution/license compliance remains a hard gate for #83 if that optional pack ships.

### Excluded/deferred

- ECDICT: not officially bundled without a provenance audit.
- Wiktionary/Kaikki rich pack: deferred because it adds attribution/share-alike and data-volume complexity.
- CC-CEDICT: not used as the English Core because its native direction is Chinese -> English.

## 3. Frozen TFLex logical contract

The v1 contract is recorded in `docs/TFLEX_V1.md`.

Frozen properties include:

- immutable data-only packs;
- versioned manifest/reader/normalization contract;
- attributable candidate/sense/entity IDs;
- separate lookup and display normalization;
- User Glossary as the only explicit override source;
- all other sources contributing candidates rather than first-hit short-circuiting;
- unknown phrases never becoming naive token concatenations;
- deterministic pack fingerprints feeding generated-explanation cache identity.

No executable HTML/JS/CSS/WASM is permitted in a pack.

## 4. Frozen physical storage profiles

### Bundled Core/Technical packs: bounded shards

The POC tested an 8 MiB synthetic bundled asset, roughly the same order of magnitude as the locked raw PWN/COW inputs.

Current Chromium returned only the requested 23-byte range even though the extension URL response reported HTTP 200 and no `Content-Range`. This proves current feasibility but is not treated as a cross-version correctness contract.

**Decision:** bundled v1 does not depend on extension-URL byte-range semantics. It uses deterministic bounded shards with a target maximum read unit of **512 KiB**, subdividing oversized prefixes/ranges.

Reasons:

- ordinary file fetch semantics are simpler and more portable;
- one lookup cannot materialize the whole pack;
- worker restart loses only bounded LRU state;
- changing shard size later does not change the logical TFLex format.

### Optional packs: versioned OPFS files

Real Chromium/MV3 POC proved:

- `navigator.storage.getDirectory()` is available in the extension service worker;
- written data survives persistent browser-context close/relaunch;
- corrupt active data can be detected by hash;
- a previous healthy version can be selected as rollback;
- a subsequently missing active file is detected as a typed `needs-reinstall` condition.

Activation uses a `chrome.storage` active-version pointer. It does not assume an atomic filesystem rename.

Desktop OPFS was introduced in Chrome 102, matching the project's current minimum Chrome version. No minimum-version increase is currently required.

## 5. Performance / memory decision

POC with an 8 MiB synthetic bundled asset demonstrated the important materialization difference:

- ordinary full fetch materializes approximately 8 MiB;
- bounded range request materialized 23 bytes in the tested runtime;
- tiny shard request materialized only the shard;
- Chromium extension service-worker `performance.memory` was unavailable, so no fabricated JS-heap number is reported.

**Decision:** Design Freeze uses a **materialization budget**, not an unverifiable service-worker heap metric:

- bundled read unit target <= 512 KiB;
- directory/index and decoded-entry caches must be bounded;
- production peak-memory/LRU measurement belongs to #77 and final #84 where the real reader exists;
- whole-pack materialization is forbidden on lookup paths.

Timing from synthetic CI is informational only and is not a product SLA. Production cold/warm budgets are established with the real #77 reader.

## 6. Storage quota decision

The POC profile reported roughly 10.7 GB origin quota and `persisted() === false`; that one CI number is not treated as a user guarantee.

**Decision:**

- v1 does **not** add `unlimitedStorage` by default;
- optional-pack install preflights `navigator.storage.estimate()`;
- update requires space for incoming version + active rollback version + overhead/safety margin;
- insufficient quota fails before active state changes;
- eviction/missing-file recovery enters rollback or `needs-reinstall`.

If production evidence later demonstrates a need for `unlimitedStorage`, that permission requires a separate review.

## 7. Frozen trust model

Real service-worker WebCrypto POC proved ECDSA P-256 verification and tamper rejection.

v1 policy:

- extension ships accepted catalog public keys/key IDs plus a minimum accepted catalog-sequence baseline;
- remote data cannot introduce a new trust root;
- detached ECDSA P-256/SHA-256 verifies the exact downloaded UTF-8 catalog bytes **before parsing/reserialization**;
- signed catalog binds monotonic sequence, pack id/version, format/reader compatibility, normalized relative file paths, file sizes and SHA-256 values;
- highest accepted catalog sequence is persisted and lower sequences are rejected as replay/downgrade;
- after complete local-state loss, the extension-shipped sequence baseline still prevents rollback below the version known to that extension release;
- SHA-256 is checked only after catalog authenticity succeeds;
- key rotation/revocation is delivered by an extension update;
- a transition extension may trust old+new keys simultaneously.

This deliberately avoids remote trust-root delegation in v1. The local high-water mark is not treated as indestructible state; replay protection after a full local-data clear falls back to the baseline shipped with the installed extension version.

## 8. Frozen permission UX

Chrome's Permissions API permits requesting a specific origin that is a subset of a broad optional host declaration. The request must occur from a user gesture.

The POC initiates exactly:

`https://packs.translateflow.example/*`

from the Settings/options surface. Headless Chromium reaches the browser-level permission prompt and leaves its Promise pending because CI cannot click browser chrome. This is recorded as an automation limitation, not falsely marked as user acceptance.

**Decision:**

- Pack installation is initiated from Settings, not the toolbar popup;
- request only the exact trusted pack origin;
- no new broad **required** Host Permission;
- user denial leaves active pack state unchanged;
- headed/manual acceptance of the browser permission prompt remains a release check in #84.

## 9. Frozen privacy/cache policy

Browser POC proved visible context can cross split inline DOM nodes while excluding TranslateFlow-owned and hidden text.

For normal page reading:

- selected text + bounded visible context only;
- no full-page content;
- raw page URL never enters AI payload;
- page identity/URL may remain local for task/cache supersession.

For `input`, `textarea`, `contenteditable` and other sensitive editable contexts:

- surrounding editable text is never transmitted;
- only the explicitly selected text may be sent after the user's translate/explain action;
- generated explanation is memory-only/non-persistent by default.

Local deterministic lexical results never enter translation cache.

Generated AI explanation uses a separate cache namespace/fingerprint.

## 10. Disposable vertical slice evidence

The Design Freeze branch contains a POC-only Selection path proving:

- `persistent` -> local Core candidate with zero Provider requests;
- `tmux` -> local Technical candidate with zero Provider requests;
- ambiguous `session` -> bounded context + attributable candidates -> existing Background Provider boundary;
- a sentence -> existing Translation Gateway path;
- superseded selection -> stale request rejected.

The POC is deliberately not the production #77/#79 implementation.

## 11. Design Freeze decisions

| Decision | v1 |
| --- | --- |
| General semantic data | PWN3 + COW |
| Technical concepts/entities | required revision-locked Wikidata structured data |
| FreeDict | optional complementary pack; #83 license/attribution gate |
| ECDICT | not officially bundled |
| Bundled storage | deterministic <=512 KiB shards |
| Optional storage | versioned OPFS files + active pointer |
| IndexedDB | existing generated translation/explanation cache only; no static dictionary rows |
| TFLex | logical contract in `docs/TFLEX_V1.md` |
| Catalog trust | extension-pinned ECDSA keys + signed monotonic catalog + SHA-256 |
| Key rotation | extension update |
| Pack host access | exact trusted origin, optional/user-triggered, Settings surface |
| `unlimitedStorage` | no by default |
| Raw URL in AI payload | forbidden |
| Sensitive editable context | selected text only; generated result non-persistent |
| SQLite/WASM | deferred; no evidence of need |
| Minimum Chrome | remain 102 for desktop extension target |

## 12. Gate status

- [x] Real PWN3/COW feasibility sample completed.
- [x] Technical data gap demonstrated; #78 is mandatory v1 scope.
- [x] FreeDict exact release/checksum and archive-license corroboration recorded.
- [x] FreeDict quality sampled and role frozen as optional complement.
- [x] Exact FreeDict TEI attribution remains isolated to #83 and cannot contaminate Core release.
- [x] Reproducible revision-locked Wikidata extraction strategy demonstrated.
- [x] Real MV3/OPFS restart persistence demonstrated.
- [x] Corrupt/missing OPFS recovery behavior demonstrated.
- [x] 8 MiB bundled access/materialization POC completed.
- [x] Bundled physical profile frozen to bounded shards.
- [x] Optional physical profile frozen to versioned OPFS files.
- [x] TFLex logical/reader/normalization contract frozen.
- [x] Catalog signature/tamper POC completed.
- [x] Key rotation/replay policy frozen.
- [x] Narrow optional-origin request path reaches browser permission flow; headed acceptance is explicitly deferred to #84 manual evidence.
- [x] Bounded visible-context POC completed.
- [x] Editable privacy/persistence policy frozen.
- [x] Disposable Selection vertical slice completed.
- [x] Source composition frozen.
- [x] `unlimitedStorage` rejected by default.
- [x] SQLite/WASM remains deferred.
- [ ] Final exact-head quality PASS recorded.
- [ ] Final exact-head Chromium E2E PASS recorded.
- [ ] Independent audit has no Design Freeze blocker.

Once the final three rows are complete, #75 may be marked **DESIGN FROZEN v1** and #76 may start.
