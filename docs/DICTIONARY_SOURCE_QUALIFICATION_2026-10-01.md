# Dictionary source qualification — 2026-10-01

Parent: [#198](https://github.com/CoderLambert/translateflow-plugin/issues/198) · Research issue: [#205](https://github.com/CoderLambert/translateflow-plugin/issues/205)

## Decision

**No additional source qualifies for a curated Catalog v2 entry in this cycle.** The qualification result is useful: it protects the current English-to-Simplified-Chinese role from reverse-indexed or unmeasured data and does not create a speculative catalog entry.

| Candidate | Native role | Provenance / license result | Product quality and fit | Decision / trust class |
| --- | --- | --- | --- | --- |
| CC-CEDICT current MDBG export | Simplified/Traditional Chinese → English | The exact artifact header and current editor download page both state CC BY-SA 4.0. The project home, last modified 2025-05-31, still states 3.0. That older date makes a stale notice plausible, but no official supersession notice was found; record both and treat the history as unresolved. | A 20-term structural smoke sample found 20/20 exact Chinese headwords with pinyin; 12/20 had a distinct Traditional form. It is not a gold-labeled definition/sense-quality benchmark. TranslateFlow currently supports only English → zh-CN in structured lookup/import. | **NO-GO for this cycle**, `research-only`; not an EN→zh source. Revisit only with a zh→en product slice, quality benchmark, license-history clarification and bounded adapter. |
| Open English WordNet 2025 standard JSON | English semantic/monolingual supplement | Exact 2025 tag contains a license file that separates the underlying Princeton WordNet License from OEWN contributions licensed CC BY 4.0. Both notices must travel with any derivative. | The exact archive has 73 JSON members and structured POS/senses; a sample of 14 overloaded English lemmas confirms that shape. It provides no Chinese translations and overlaps the current Core semantic pack, already built from PWN 3.0 aligned to COW (61,340 of 147,306 locked PWN headwords mapped). No OEWN-vs-Core incremental benchmark or runtime result was measured. | **NO-GO for this cycle**, `research-only`; source quality cannot be treated as an incremental product improvement without a baseline comparison. |
| ECDICT upstream update check | English → Chinese, existing curated-upstream role | GitHub's latest release remains 1.0.28 (published 2017-09-20). The exact CSV revision dated 2025-03-28 is already pinned in the installed curated-upstream recipe. The MDX's content date remains 2017-06-03. | No new version or materially different exact upstream artifact was found. Preserve the existing direct-to-upstream/user-triggered boundary. | **No new candidate**; existing source state and its limits remain unchanged. |
| Maintained English → zh-CN source search | English → Simplified Chinese | The current official FreeDict listing still points to 2025.11.23; its exact licensed release already has a NO-SHIP quality decision. The exact Wiktionary Rich path remains NO-GO under #121. | No additional maintained exact artifact with clear content provenance and demonstrated zh-CN quality was qualified in this scoped search. This does not claim that no such source exists anywhere. | **No additional GO**; keep #206 inactive for a curated source. |

The exact source identities, retrieval metadata, hashes and machine-readable decisions are in [`cc-cedict-current-2026-10-01.json`](../lexicon/source-locks/cc-cedict-current-2026-10-01.json), [`open-english-wordnet-2025-json.json`](../lexicon/source-locks/open-english-wordnet-2025-json.json) and [`dictionary-ecosystem-v2-source-qualification-2026-10-01.json`](../lexicon/quality-decisions/dictionary-ecosystem-v2-source-qualification-2026-10-01.json). These locks identify research artifacts; they do not register production sources or approve Official redistribution.

## Candidate evidence

### CC-CEDICT

MDBG's [download page](https://www.mdbg.net/chinese/dictionary?page=cc-cedict) reports 125,149 entries and links to the exact gzip artifact pinned above. Its data contains Traditional and Simplified Chinese forms, pinyin and English glosses. On the retrieved 2026-09-30 content snapshot, a deterministic 20-headword common-Chinese smoke corpus found 20 hits, 20 entries with pinyin and 12 entries whose Traditional form differed from Simplified. Multiple records were present for the polyphonic fixtures `行`, `重`, `乐` and `长`. These checks verify direction and record shape only. They do not establish definition correctness, ranking, context handling or actual user benefit. The official [V2 format guide](https://cc-cedict.org/wiki/syntax_v2) notes that the V1 export converts V2 records back to V1, and the [V1 format page](https://cc-cedict.org/wiki/syntax) is marked historical while warning that the database contains infelicities, inaccuracies, omissions and errors. That upstream disclosure makes a product-quality benchmark necessary; the smoke corpus does not clear it.

License evidence is split explicitly. The exact MDBG export header and the current [CC-CEDICT editor download page](https://cc-cedict.org/editor/editor.php?handler=Download) both name CC BY-SA 4.0 and the current page says the recommended release is distributed through MDBG. The separate [CC-CEDICT project home](https://cc-cedict.org/wiki/) names CC BY-SA 3.0 and was last modified 2025-05-31. That older timestamp makes a stale notice plausible, but there is no explicit supersession statement in the inspected evidence. We keep legal/provenance status unresolved instead of silently choosing a version.

The 4.0 terms are explicit on the exact artifact and current editor download page; the older home page could be stale, but the source did not state that directly. Independently, the candidate is natively zh→en. The current TranslateFlow structured source and target contract is en→zh-CN, and there is no CC-CEDICT text importer or Chinese-selection lookup path. The direction cannot be inverted by searching English gloss text. No production catalog entry or Official designation is approved.

### Open English WordNet

The exact source is the standard (non-Plus) [OEWN 2025 release](https://github.com/globalwordnet/english-wordnet/releases/tag/2025-edition), published 2025-12-31. We downloaded the official JSON ZIP URL and recorded its 9,986,555-byte size and SHA-256. The official project reports the standard core as 135,969 words, 107,519 synsets and 355,064 relations. The existing structured baseline is already `core-semantic-en-zh`, built from PWN 3.0 + COW; the source lock maps 61,340 of 147,306 locked PWN headwords. That baseline does not prove OEWN offers no improvement, but it means a comparative measurement is required before claiming an incremental product benefit.

The exact revision's [LICENSE.md](https://github.com/globalwordnet/english-wordnet/blob/2025-edition/LICENSE.md) says the resource derives from Princeton WordNet under the WordNet License while OEWN's further development is CC BY 4.0. The [WNDB license notice](https://github.com/globalwordnet/english-wordnet/blob/2025-edition/WNDB_License.txt) therefore remains relevant; a repo-level CC-BY label alone is not a complete data-license record. Any future derivative would need to retain both attribution/license layers and the WordNet disclaimer. The [upstream repository README](https://github.com/globalwordnet/english-wordnet) also says quality and veracity may differ from Princeton WordNet, so this release must be benchmarked against TranslateFlow's current PWN3/COW Core before calling it an improvement. This evidence does not approve an Official pack or trust-root signing.

The artifact-shape sample found 14/14 overloaded English fixture lemmas and measured per-POS sense counts in the decision JSON. This only confirms OEWN's semantic structure. It does not measure improvement against the existing PWN 3.0/COW Core. OEWN contains no Chinese translation field, and the current product has no separate English-monolingual supplement flow, so no product-quality GO is justified.

## Maintained EN→zh-CN search and prior decisions

The current [FreeDict eng-zho upstream directory](https://download.freedict.org/dictionaries/eng-zho/) lists 2025.11.23 and 2024.10.10. The exact 2025.11.23 artifact and its license are already recorded in [`freedict-eng-zho.json`](../lexicon/source-locks/freedict-eng-zho.json); the separate quality decision is **NO-SHIP** because the evaluated release has misleading or non-zh-CN terms and misses technical senses. The newer directory's timestamp does not mean the data itself is newer or that its earlier benchmark was cleared.

The exact [Wiktionary Rich source/extractor/projection path evaluated in #121](WIKTIONARY_RICH_POC.md) remains **NO-GO**. Its complete quality/pack/performance evidence was not measured and no new evidence in this search changes that decision. Do not repackage or rename the same path as a new candidate.

Scoped primary-source searches covered maintained open English–Chinese data, current source releases, official CC-CEDICT/MDBG downloads, OEWN releases, FreeDict eng-zho and the existing Wiktionary/Kaikki path. They found no additional exact, maintained EN→zh-CN artifact with clear provenance and demonstrated product quality. That is a scoped result, not an exhaustive claim about every dataset on the internet.

## ECDICT update check

GitHub's [latest-release endpoint](https://api.github.com/repos/skywind3000/ECDICT/releases/latest) still reports 1.0.28, published 2017-09-20. The known MDX archive's exact lock is [`ecdict-mdx-1.0.28-corpus-lock.json`](../lexicon/build-evidence/ecdict-mdx-1.0.28-corpus-lock.json); its embedded content date is 2017-06-03. The ECDICT CSV at [commit `bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b`](https://github.com/skywind3000/ECDICT/commit/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b) (2025-03-28) is already the exact upstream revision used by the curated CSV recipe and carries the same 65,933,428-byte blob; the dictionary file itself was last changed on 2025-01-02. No new release or distinct current artifact was found. The repository/MDX content rights caveat in [`DICTIONARY_SOURCE_FREEZE.md`](DICTIONARY_SOURCE_FREEZE.md) remains authoritative: existing acquisition is explicit and direct to upstream, not approval to mirror or relicense content.

## Delivery and package boundary

- No production runtime code, catalog registration, dictionary payload or release artifact changed.
- No CC-CEDICT, OEWN, FreeDict, Wiktionary, or commercial dictionary bytes were added to Git.
- Research downloads and hashing were performed under `/tmp/translateflow-205` only.
- No source candidate passes all four distinct gates: provenance/legal, product quality, technical fit, and security/privacy.
- Recommend keeping optional delivery child #206 **NO-GO / not planned** for this source set. Keep Official Pack #122 blocked.

## Primary evidence links

- [CC-CEDICT current MDBG download page](https://www.mdbg.net/chinese/dictionary?page=cc-cedict)
- [CC-CEDICT current download/license page](https://cc-cedict.org/editor/editor.php?handler=Download)
- [CC-CEDICT project home and older license notice](https://cc-cedict.org/wiki/)
- [CC-CEDICT current V2 syntax and V1 export notes](https://cc-cedict.org/wiki/syntax_v2)
- [CC-CEDICT legacy V1 format and quality caveats](https://cc-cedict.org/wiki/syntax)
- [CC BY-SA 4.0 terms](https://creativecommons.org/licenses/by-sa/4.0/)
- [OEWN downloads and 2025 edition information](https://en-word.net/downloads)
- [OEWN 2025 exact tag/release](https://github.com/globalwordnet/english-wordnet/releases/tag/2025-edition)
- [OEWN 2025 exact license file](https://github.com/globalwordnet/english-wordnet/blob/2025-edition/LICENSE.md)
- [OEWN underlying WordNet license notice](https://github.com/globalwordnet/english-wordnet/blob/2025-edition/WNDB_License.txt)
- [ECDICT latest release](https://github.com/skywind3000/ECDICT/releases)
- [FreeDict eng-zho upstream release listing](https://download.freedict.org/dictionaries/eng-zho/)
