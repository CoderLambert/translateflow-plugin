# Personal MDX Dictionary Builder

This tooling builds a **personal-use rich English → Simplified Chinese MDX/MDD dictionary** without changing TranslateFlow's production dictionary catalog.

## Data composition

- full upstream ECDICT CSV;
- ECDICT phonetic / English definition / Chinese translation / POS / Collins / Oxford / BNC / contemporary frequency / exchange metadata;
- selected English ↔ Mandarin Tatoeba examples for high-value headwords;
- local CSS packaged in a companion MDD.

The result is intentionally more information-dense than the current curated ECDICT Rich MDX. It is a personal dictionary artifact, not a TranslateFlow official dictionary.

## Output

- \`TranslateFlow-Personal-English-Chinese-v1.mdx\`
- \`TranslateFlow-Personal-English-Chinese-v1.mdd\`
- \`build-report.json\`

The MDD contains presentation CSS only. No executable JavaScript or remote dictionary resources are embedded.

## Lookup experience

Entries can contain:

- headword + phonetic;
- Chinese senses;
- English definitions;
- POS distribution;
- Collins / Oxford / exam tags;
- BNC and contemporary frequency ranks;
- inflection / lemma links from ECDICT exchange metadata;
- up to two bilingual Tatoeba examples for selected high-frequency headwords.

The build remains source-driven. It does not copy proprietary Oxford / Longman / Collins definition text.
