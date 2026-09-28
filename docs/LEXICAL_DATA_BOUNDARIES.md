# Lexical data and production package boundaries

TranslateFlow is a **selection lookup/orchestration engine**, not a project-authored dictionary.

The long-term architecture is:

> **Source-driven data → Rule-driven retrieval → Context-driven ranking → User-driven AI**

This document is normative for lexical work, dictionary packs, validation fixtures and extension packaging.

## 1. Product responsibility

TranslateFlow owns:

- selection capture and lookup orchestration;
- safe normalization and morphology;
- phrase discovery;
- candidate aggregation;
- deterministic ranking from source-provided metadata and bounded context;
- provenance, integrity and dictionary lifecycle;
- structured presentation;
- explicit user-triggered AI detail.

TranslateFlow does **not** own the ongoing authorship of English/Chinese dictionary content.

Headword meanings, translations, definitions, pronunciation, examples, entity facts and domain metadata should come from attributable dictionary/entity sources. If a local dictionary has no trustworthy result, the product should report a local no-hit or let the user explicitly request ordinary translation / AI detail. A model-generated explanation must never silently become authoritative dictionary data.

## 2. Five data classes

### A. Runtime extension assets

Only files required by the installed extension:

- runtime code and UI;
- required static assets;
- explicitly approved **small bootstrap** lexical packs.

These files may enter the Chrome Web Store artifact.

### B. Build/source inputs

Examples:

- `lexicon/sources/**`;
- `lexicon/source-locks/**`;
- locked upstream snapshots;
- dictionary compilers;
- source qualification reports.

They exist to reproduce runtime packs. They are **not runtime assets** and must not be copied into the production extension.

### C. Validation assets

Examples:

- `tests/**`;
- `e2e/**`;
- benchmark cases;
- regression words and expected senses;
- malformed/malicious import fixtures;
- large local test dictionaries.

Validation assets express requirements such as:

```text
Git branch context -> technical branch sense
tree branch context -> ordinary branch sense
descendant combinator -> CSS phrase
```

They must never be promoted into runtime dictionary records merely so a test passes.

### D. Downloadable/imported dictionaries

Large dictionaries belong outside the base extension:

- approved official TFLex packs;
- curated upstream dictionaries converted locally;
- user-imported MDict / StarDict / TFLex packs.

They are installed after explicit user action and stored through the dictionary lifecycle (for example OPFS). Their size does not count toward the base extension package.

### E. AI-generated detail

AI output is an explicit enhancement:

- only after a user action;
- not a substitute for a local dictionary source;
- not persisted as authoritative lexical facts;
- not used to silently populate bundled dictionaries.

## 3. Manual lexical data policy

Manual lexical content is an exception, not a coverage strategy.

Do not increase coverage by continuously adding project-authored:

- headword → translation rows;
- brand/entity dictionaries;
- technical terminology lists;
- query-specific sense tables.

Do not hide the same behavior inside code such as:

```text
if query == "branch" and context contains "git" -> force technical sense
```

Generic retrieval/ranking rules are valid when they operate on source metadata such as phrase matches, POS, domains, entity types, aliases, provenance and weak frequency priors.

### Temporary override budget

A small project-authored override layer may exist only when all of the following hold:

1. the user-visible error is high-value and reproducible;
2. upstream structured data is currently missing or demonstrably wrong;
3. the fact has review evidence;
4. the record is attributable and auditable;
5. a removal/replacement path exists.

The override set must remain small and must not become a dictionary project.

The former `reviewed-tech-terms` dataset is retained only as **validation/audit history**. It is not compiled into the production Technical pack. New coverage should come from #116/#121/#124/#126 source pipelines; any future temporary override must be separately approved against the exception criteria above.

Regression words remain in validation fixtures even after their runtime data source changes.

## 4. Bundled data budget

Bundled lexical data exists only to provide a useful offline bootstrap experience.

The bundled Core/Technical footprint should stay bounded. Do not attempt to make the bundled extension a complete English-Chinese dictionary by adding more and more hand-curated records.

High-coverage resources should be downloadable.

## 5. Production package boundary

Development may keep tests, compilers and source material in the same repository. Production packaging must use an **allowlist**, not "copy the repository and exclude a few directories".

The production extension may include:

```text
manifest.json
background.js
content.js
content.css
popup.*
options.*
src/**
assets/lexicon/**        # only generated/approved bundled runtime packs
```

The production artifact must not include:

```text
tests/**
e2e/**
scripts/**
docs/**
.github/**
lexicon/sources/**
lexicon/source-locks/**
.release-sources/**
node_modules/**
playwright-report/**
test-results/**
benchmark reports
raw Kaikki / MDict / StarDict fixtures
```

`npm run build:extension` produces `dist/extension` from this allowlist.

## 6. Release review questions

Every lexical PR should answer:

1. Is this change an algorithm/rule or dictionary content?
2. If dictionary content, why is it not coming from a source pipeline?
3. Does any validation fixture enter the runtime artifact?
4. Does the change increase the bundled lexical footprint?
5. Could the same behavior be represented with source metadata instead of a query-specific rule?
6. Is AI still explicit and non-authoritative?

A confidently wrong dictionary answer remains worse than an honest no-hit.
