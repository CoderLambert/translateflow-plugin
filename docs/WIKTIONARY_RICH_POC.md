# Wikimedia Rich EN→ZH qualification — NO-GO

Decision date: 2026-09-30. Issues: [#176](https://github.com/CoderLambert/translateflow-plugin/issues/176), [#121](https://github.com/CoderLambert/translateflow-plugin/issues/121).

## Decision and scope

The exact `enwiktionary-20260901` source, pinned extractor pair, and existing `rich-en-zh-v1` projection are **NO-GO for an Official Rich pack**. Source qualification failed before a complete pack benchmark. This decision does not establish that Wiktionary's Chinese translations are generally poor, or reject every possible future extraction contract.

The source lock remains valid build evidence. It does not approve dictionary fields, licensing, distribution, or product quality. No Official catalog entry, downloadable pack, runtime vocabulary, or base-extension payload is introduced.

## Completed source ingest

[PR #177](https://github.com/CoderLambert/translateflow-plugin/pull/177) proved first-phase ingest with source verification before setup/parser execution:

- Dump: 1,632,298,458 bytes; SHA-256 `06acca8138eacb3e8ae9c1d6232f836e37c3bf9b6d582a86693731fe0d336c20`.
- Wiktextract: `1a05e46f9efbccda6a2b2f8e21b30a9c0c46513a`.
- Wikitextprocessor: `e3d6d4edb77618f4d6680edc66e3f774bea59820`.
- Parser DB: 5,352,067,072 bytes; Main 9,089,618; Template 54,144; Module 59,936 pages.

This proves dump ingest, not second-phase extraction completion or Rich dictionary quality.

## Source qualification blockers

### Additional inputs are not fully locked

The pinned processor initializes an interwiki map from live Wikimedia site information on a fresh DB. Wikidata lookup can fetch live SPARQL/EntityData on cache misses. These inputs are absent from the dump/source lock; Wikidata functions can contribute expanded lexical text. Exact source and Git revisions therefore do not establish a fully input-locked reproducible extraction.

Primary code evidence: [dump processing](https://github.com/tatuylonen/wikitextprocessor/blob/e3d6d4edb77618f4d6680edc66e3f774bea59820/src/wikitextprocessor/dumpparser.py#L118-L126), [interwiki initialization](https://github.com/tatuylonen/wikitextprocessor/blob/e3d6d4edb77618f4d6680edc66e3f774bea59820/src/wikitextprocessor/interwiki.py#L7-L46), [Wikidata fetch](https://github.com/tatuylonen/wikitextprocessor/blob/e3d6d4edb77618f4d6680edc66e3f774bea59820/src/wikitextprocessor/wikidata.py#L377-L423), [parser functions](https://github.com/tatuylonen/wikitextprocessor/blob/e3d6d4edb77618f4d6680edc66e3f774bea59820/src/wikitextprocessor/parserfns.py#L1530-L1553).

### Existing projection cannot establish definition-sense links

`scripts/project-kaikki-rich.mjs` deliberately accepts Chinese translations inside source senses and preserves those boundaries. The pinned English extractor's schema stores translations separately at word/POS level. A translation's optional textual `sense` label supplies no authoritative definition-sense ID or index. Joining labels to glosses would require an unsupported inference; assigning translation groups to definition senses would change the frozen projection contract.

Primary code evidence: [translation, sense and word schema](https://github.com/tatuylonen/wiktextract/blob/1a05e46f9efbccda6a2b2f8e21b30a9c0c46513a/src/wiktextract/extractor/en/type_utils.py#L130-L238), [translation parsing](https://github.com/tatuylonen/wiktextract/blob/1a05e46f9efbccda6a2b2f8e21b30a9c0c46513a/src/wiktextract/extractor/en/page.py#L3008-L3019), [textual label propagation](https://github.com/tatuylonen/wiktextract/blob/1a05e46f9efbccda6a2b2f8e21b30a9c0c46513a/src/wiktextract/extractor/en/translations.py#L554-L563).

The projection remains unchanged. Compatibility diagnostics are validation evidence, not a production dictionary or coverage benchmark.

### Brown corpus approval is unresolved

The pinned English extractor uses NLTK Brown data and otherwise downloads it dynamically. The experimental runner instead verifies a dated repository revision, archive size and SHA-256 before use. The upstream corpus metadata states non-commercial use; this dependency's use and retained-field implications have not received source-policy approval. Locking its bytes does not grant rights or resolve the issue.

See [extractor dependency](https://github.com/tatuylonen/wiktextract/blob/1a05e46f9efbccda6a2b2f8e21b30a9c0c46513a/src/wiktextract/extractor/en/english_words.py#L14-L18) and `scripts/wiktextract-nltk-data-lock.json`. Wikimedia attribution/share-alike and retained-field review also remain unapproved for production.

## Stopped experimental extraction

The corrected experimental second phase was stopped after 1,342.906855 seconds once the hard qualification gates were established. Its immutable local partial snapshot contains 2,274 complete JSON rows, 32,520,882 bytes, SHA-256 `69303bcd2ec164e46b932295259c37a5b69734077b086d292ef242f2ade47279`. It has no trailing partial row. These are **partial-run measurements**, not full-source totals or extraction throughput estimates.

At stop, the local log contained zero page-handler exception markers. This is not a complete-run failure count. Cache tables contained 781 interwiki rows and 354 Wikidata item rows; property, property-value and article caches contained zero rows. Cache presence alone does not establish which retained fields were affected.

The corrected run initialized the exact Scribunto child revision and verified a Lua smoke extraction. Earlier tooling attempts failed on a missing language argument and missing Scribunto files; those failures provide no evidence of dictionary quality.

Complete extraction hash/count/duration/error total, Rich TFLex size/index/install cost, baseline-versus-Rich benchmark, zh-CN quality rates, cold/warm lookup, memory and base-size delta are **not measured**. They are absent or null in bounded evidence. No GO claim can be derived from incomplete measurements.

An aggregate diagnostic of this same partial snapshot observed 2,268 English rows, 6,974 definition senses, 2,269 entry-level `zh/cmn` translation rows and zero nested `zh/cmn` translation rows. The existing projection processed 2,221 English rows, rejected 47 at its existing safety limits, and emitted zero entries because those processed rows lacked sense-level Chinese. These observations corroborate the schema incompatibility in this subset; they are not full-source coverage, false-hit, or translation-quality measurements. None of the 18 required benchmark headwords occurred in the observed subset, so their quality and availability remain unmeasured.

## Boundaries and outcome

Raw dump, parser DB, corpus, raw JSONL, partial rows and extractor logs remain local/ephemeral build inputs. Only bounded aggregate metadata is eligible for evidence artifacts. Production packaging continues to use its existing allowlist. Test terms remain validation assets.

The automated source-qualification gate verifies the NO-GO record and bounded observations. A passing gate means the rejection is faithfully recorded; it does not approve the source. Full extraction is an explicit experimental workflow-dispatch option only.

#116 freezes this exact Wiktionary Rich path as NO-GO. #122 is not executed because its GO/approved-source prerequisites are absent. Reopening this path would require separately reviewed input-locking, source semantics and licensing decisions, followed by complete product measurements.
