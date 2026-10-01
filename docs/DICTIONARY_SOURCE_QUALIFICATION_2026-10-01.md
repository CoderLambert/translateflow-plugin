# Dictionary source qualification — 2026-10-01

Parent: [#198](https://github.com/CoderLambert/translateflow-plugin/issues/198) · Research issue: [#205](https://github.com/CoderLambert/translateflow-plugin/issues/205)

## Decision

**No additional source qualifies for a curated Catalog v2 entry in this cycle.** No source passed all applicable provenance, product-quality, technical-fit, and acquisition/privacy gates. Keep optional delivery child #206 **NO-GO / not planned** for this source set. No candidate is approved for Official Pack #122.

| Candidate | Native role | Evidence and gate result | Decision |
| --- | --- | --- | --- |
| CC-CEDICT current MDBG export | Simplified/Traditional Chinese → English | The observed artifact header and editor download page state CC BY-SA 4.0; the project home, last modified 2025-05-31, states 3.0. The conflict is unresolved. MDBG's official [privacy policy](https://www.mdbg.net/chinese/dictionary?page=privacy) states automated or scripted access is prohibited. A scripted retrieval happened before this restriction was discovered; the retrieval and its structural smoke test are withdrawn. The downloaded temporary files were deleted after preserving artifact hashes. | **NO-GO**: do not use app-side/scripted acquisition absent explicit authorization. No qualifying product-quality evidence or zh→en runtime path. `research-only` historical fingerprint. |
| Open English WordNet 2025 standard JSON | English semantic / monolingual supplement | OEWN 2025 is based on Princeton WordNet **3.1**; the current `core-semantic-en-zh` baseline uses PWN **3.0** aligned to Chinese Open Wordnet (61,340 of 147,306 locked PWN headwords mapped). This difference may be meaningful, but no incremental coverage, alignment, or user-visible quality comparison was measured. OEWN has no Chinese translations. Both OEWN CC BY 4.0 and underlying WordNet 3.1 notices apply. | **NO-GO**: possible version delta is not evidence of user benefit; no current monolingual product role or relative benchmark. `research-only`. |
| ECDICT upstream update check | English → Chinese, existing curated-upstream role | Latest upstream release remains 1.0.28 (published 2017-09-20). Its MDX content date remains 2017-06-03. The exact 2025 CSV snapshot already integrated into the curated recipe was not a new release. | **No new candidate**; keep existing source/content-date and acquisition boundaries. |
| Maintained English → zh-CN search | English → Simplified Chinese | The exact FreeDict eng-zho release has an existing NO-SHIP quality decision. The Wiktionary Rich path remains NO-GO under #121. No additional exact maintained source with clear provenance and demonstrated zh-CN quality was qualified in this scoped search. | **No additional GO**; #206 remains inactive. |

The machine-readable records are [`cc-cedict-current-2026-10-01.json`](../lexicon/source-locks/cc-cedict-current-2026-10-01.json), [`open-english-wordnet-2025-json.json`](../lexicon/source-locks/open-english-wordnet-2025-json.json), and [`dictionary-ecosystem-v2-source-qualification-2026-10-01.json`](../lexicon/quality-decisions/dictionary-ecosystem-v2-source-qualification-2026-10-01.json). They record research evidence only; they do not register production sources or approve Official redistribution.

## CC-CEDICT: withdrawn, non-qualifying observation

The historical MDBG URL observed was `https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz`. Before discovering the access restriction, a scripted request retrieved an artifact with a 3,977,421-byte gzip fingerprint (`58c442d8f100a8a56852832fdd4555a233b6d802b0bf01a5bdddf01561c0a326`) and 9,855,907 decoded bytes (`4585efcc6cb11b57b216554efbb5c66f88e15ab5cc9136f6b0579910d30e89cb`). These are retained only to identify the withdrawn temporary copy. The auxiliary editor download fingerprint was 3,977,745 bytes, SHA-256 `33a8f0f78cdda5600bd6eac5be79c85e5b9af8927b42c0df0e8b335e9684e504`. All downloaded MDBG files and the page capture were deleted from `/tmp`; no source payload, extracted text, or Chinese fixture remains in the repository or research area. This research lane made no further artifact requests; the coordinator separately verified the policy wording through one read-only page observation.

After the initial request, the official [MDBG privacy policy](https://www.mdbg.net/chinese/dictionary?page=privacy) was observed to state: “Automated or scripted access is prohibited.” The previous structural inspection is therefore withdrawn, not a compatibility or quality result. A fetch initiated by a user click is still an app-side scripted request and is not qualified by that action. Do not call MDBG from the app or a script unless MDBG explicitly authorizes that method or a separately authorized acquisition route is established. No further artifact retrieval was performed by this research lane after discovery; the coordinator separately verified the policy wording through one read-only page observation.

License observations are kept separate from the access gate. The exact artifact header and current [editor download page](https://cc-cedict.org/editor/editor.php?handler=Download) state CC BY-SA 4.0; the [project home](https://cc-cedict.org/wiki/), last modified 2025-05-31, states CC BY-SA 3.0. No explicit supersession statement was located, so license history remains unresolved. Independently, CC-CEDICT's native direction is zh→en, while the current structured import/lookup contract is en→zh-CN. It must not be reverse-indexed and presented as authoritative EN→zh data. Its official [V2 format guide](https://cc-cedict.org/wiki/syntax_v2) and [historical V1 format page](https://cc-cedict.org/wiki/syntax) remain documentation references, not evidence from an accepted payload sample.

## Open English WordNet 2025

The exact candidate is the standard, non-Plus [OEWN 2025 release](https://github.com/globalwordnet/english-wordnet/releases/tag/2025-edition), dated 2025-12-31, at commit [`dc343f2683279ecbb13fab4e2fd778d7b162d287`](https://github.com/globalwordnet/english-wordnet/commit/dc343f2683279ecbb13fab4e2fd778d7b162d287). The official JSON ZIP fingerprint is 9,986,555 bytes, SHA-256 `7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51`; it contains 73 JSON data members. The project reports 135,969 words, 107,519 synsets, and 355,064 relations.

The exact [2025 LICENSE.md](https://github.com/globalwordnet/english-wordnet/blob/2025-edition/LICENSE.md) states OEWN further development is CC BY 4.0 and the underlying WordNet terms apply. The exact [WNDB license notice](https://github.com/globalwordnet/english-wordnet/blob/2025-edition/WNDB_License.txt) identifies the underlying database as Princeton WordNet **3.1** and carries its license notice and disclaimer. Any future derivative must retain both attribution/license layers and the WordNet notice/disclaimer. This does not establish #122 Official trust-root approval.

The existing [Core semantic source lock](../lexicon/source-locks/core-semantic-pwn3-cow.json) records PWN 3.0 aligned to Chinese Open Wordnet, with 61,340 of 147,306 locked PWN headwords mapped. OEWN 2025's PWN 3.1 basis could include meaningful changes relative to that baseline. We did not measure version-to-version sense alignment, incremental coverage, Chinese mapping impact, or user-visible quality. The observed JSON sense/POS counts confirm artifact shape only; they do not establish an improvement. OEWN has no Chinese translation field and no current separate monolingual supplement flow, so the candidate remains NO-GO for this cycle.

## Maintained EN→zh-CN sources and prior decisions

The current [FreeDict eng-zho release directory](https://download.freedict.org/dictionaries/eng-zho/) lists 2025.11.23 and 2024.10.10. The exact release and its source terms are already recorded in [`freedict-eng-zho.json`](../lexicon/source-locks/freedict-eng-zho.json); its separate quality decision is **NO-SHIP** because evaluated results include misleading/non-zh-CN terms and miss technical senses. A newer listing date does not clear that quality result.

The exact [Wiktionary Rich source/extractor/projection path evaluated under #121](WIKTIONARY_RICH_POC.md) remains **NO-GO**. No materially new source, license, schema, or quality evidence changes that decision; do not repackage or rename the same path as a new candidate.

Scoped primary-source searches covered maintained open English–Chinese sources, exact releases for ECDICT, CC-CEDICT, OEWN and FreeDict, and the existing Wiktionary/Kaikki path. No additional exact, maintained EN→zh-CN artifact with clear provenance and demonstrated product quality was qualified. This is a scoped result, not an exhaustive claim that no such dataset exists.

## ECDICT update check

GitHub's [latest-release endpoint](https://api.github.com/repos/skywind3000/ECDICT/releases/latest) reports 1.0.28, published 2017-09-20. The MDX lock is [`ecdict-mdx-1.0.28-corpus-lock.json`](../lexicon/build-evidence/ecdict-mdx-1.0.28-corpus-lock.json), with embedded content date 2017-06-03. The exact CSV snapshot at [commit `bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b`](https://github.com/skywind3000/ECDICT/commit/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b), dated 2025-03-28, is already used by the curated CSV recipe; the dictionary file itself was last changed 2025-01-02. No new ECDICT release or distinct artifact was found. Keep source version, content date and user acquisition separate; do not call the 2017 MDX content current.

## Delivery and package boundary

- No production runtime code, catalog registration, dictionary payload, or release artifact changed.
- No CC-CEDICT or OEWN bytes were committed. No commercial dictionary bytes were obtained or considered for curated redistribution.
- OEWN research bytes remained under `/tmp/translateflow-205`; all temporary MDBG downloads and page capture were deleted after preserving artifact fingerprints.
- MDBG app-side/scripted acquisition is not qualified under the observed policy. No further artifact retrieval was performed by this research lane; the coordinator separately verified the policy wording through one read-only page observation.
- Keep #206 NO-GO for this source set and #122 blocked.

## Primary evidence links

- [MDBG privacy policy and automated-access restriction](https://www.mdbg.net/chinese/dictionary?page=privacy)
- [CC-CEDICT current MDBG download information](https://www.mdbg.net/chinese/dictionary?page=cc-cedict)
- [CC-CEDICT current editor download/license page](https://cc-cedict.org/editor/editor.php?handler=Download)
- [CC-CEDICT project home and older license notice](https://cc-cedict.org/wiki/)
- [CC-CEDICT syntax V2 guide](https://cc-cedict.org/wiki/syntax_v2)
- [CC-CEDICT historical syntax V1 page](https://cc-cedict.org/wiki/syntax)
- [OEWN downloads](https://en-word.net/downloads)
- [OEWN 2025 exact tag/release](https://github.com/globalwordnet/english-wordnet/releases/tag/2025-edition)
- [OEWN 2025 exact license file](https://github.com/globalwordnet/english-wordnet/blob/2025-edition/LICENSE.md)
- [OEWN underlying WordNet license notice](https://github.com/globalwordnet/english-wordnet/blob/2025-edition/WNDB_License.txt)
- [ECDICT latest releases](https://github.com/skywind3000/ECDICT/releases)
- [FreeDict eng-zho release directory](https://download.freedict.org/dictionaries/eng-zho/)
