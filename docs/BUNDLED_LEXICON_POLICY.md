# Bundled lexical bootstrap policy

TranslateFlow keeps a bounded bundled lexical bootstrap so Selection is useful immediately after installation, while broad/high-coverage dictionaries remain downloadable or imported.

Architecture remains:

> **Source-driven data → Rule-driven retrieval → Context-driven ranking → User-driven AI**

## Current decision

The current locked PWN 3.0 + Chinese Open WordNet Core remains bundled for this release line.

This is a deliberate bootstrap decision, not permission to grow the base extension into a complete dictionary. The current Core is reproducible from locked attributable sources and preserves the existing first-run experience without requiring a dictionary download before local lookup works.

The tested alternative based only on WordNet `index.sense` `tagCount` is rejected as a production bootstrap rule. The least aggressive tested threshold reduced Core bytes substantially but also caused material benchmark and contrastive-quality regression. A smaller replacement remains acceptable only if a future deterministic source-derived policy preserves substantially more useful coverage.

## Enforced size ceilings

The production package gate enforces both of these bundled lexical ceilings:

- raw bundled lexical assets: **37,000,000 bytes maximum**;
- deterministic ZIP/DEFLATE proxy: **4,000,000 bytes maximum**.

These are freeze ceilings around the currently justified bootstrap, not targets for adding vocabulary until the limit is reached.

An intentional increase requires all of:

1. an explicit policy change in review;
2. source/provenance justification;
3. measured benchmark plus common-word/ordinary-browsing evidence;
4. production package-size evidence;
5. exact-head quality/E2E/lexicon-release gates.

High-coverage Rich dictionaries must not consume this budget. They belong in the trusted downloadable/imported lifecycle.

## Independent coverage evidence

`scripts/evaluate-core-bootstrap.mjs` evaluates bootstrap candidates against three separate evidence classes:

- the established lexical quality benchmark;
- a deterministic common-word sample derived from the locked WordNet 3.0 `index.sense` source by aggregating positive `tagCount` and selecting the highest-frequency single-token alphabetic lemmas;
- a project-authored ordinary-browsing prose fixture used only for validation.

Neither the benchmark nor either validation sample determines dictionary membership.

## Install and runtime interpretation

The production package is dominated by bundled Core bytes, so install/update footprint is the reason to keep the bootstrap bounded.

The TFLex reader remains sharded and cache-bounded. Real-pack certification shows that a cold lookup reads only the required metadata/shards rather than materializing the complete Core, and a warm repeat can remain cache-local. Therefore bundled-size policy and query-time memory/I/O policy are reviewed separately.

## First-run behavior

Because the current Core remains bundled:

- first-run local lookup remains available without a download step;
- no new automatic AI fallback is introduced;
- no no-dictionary onboarding state is required by this decision;
- Rich/high-coverage dictionary installation remains explicit user action.

If a future release moves to a much smaller or empty bootstrap, that change must separately define and certify the first-run/no-dictionary UX before production.

## Revisit conditions

Re-open the bootstrap decision when any of these occurs:

- #121/#122 delivers a production-ready Rich downloadable dictionary;
- a new source-derived bootstrap policy materially improves the tested size/coverage trade-off;
- Chrome Web Store packaging evidence shows the current base-install cost is unacceptable;
- Core source/version changes would exceed either enforced size ceiling.

#125 remains responsible for final integrated production-artifact and installed-dictionary certification.
