---
name: translateflow-dictionary-engineering
description: Implement or review TranslateFlow dictionary and lexical work, including lookup/ranking, TFLex, MDict/MDD, StarDict, OPFS, dictionary catalog/import/lifecycle, rich rendering, provenance, and offline quality/security. Use for all dictionary-specific engineering.
---

# TranslateFlow dictionary engineering

## Required contracts

Read the task-relevant parts of:

- current dictionary Issue/Epic;
- `AGENTS.md`;
- `docs/LEXICAL_DATA_BOUNDARIES.md` — normative;
- `docs/ARCHITECTURE.md`;
- existing dictionary tests, E2E, benchmark and certification scripts.

## Core product/data rule

Preserve:

> **Source-driven data → Rule-driven retrieval → Context-driven ranking → User-driven AI**

TranslateFlow owns the lookup/orchestration engine, not ongoing dictionary authorship.

Do not improve coverage by:

- adding project-authored translation rows;
- adding query-specific sense hacks;
- promoting benchmark/test words into runtime data;
- turning AI output into authoritative local entries.

Prefer attributable source data plus generic normalization, morphology, phrase discovery, metadata-based ranking, and provenance.

## Local/offline boundary

User-owned dictionary inspection, indexing, lookup, rich resources, and navigation must remain local-only unless the Issue explicitly changes that contract.

Do not send dictionary contents to Providers/AI automatically.

Large dictionaries should be downloadable/imported and lifecycle-managed outside the base extension package.

## Parser/index/viewer safety

For MDict/MDD/StarDict/TFLex work consider:

- bounded file/header/index parsing;
- malformed/truncated input;
- compression/decompression bounds;
- encoding/encryption policy;
- alias/redirect loop bounds;
- cancellation and stale work;
- bounded concurrency;
- range/block access instead of whole-file runtime materialization;
- local resource confinement;
- sanitizer fail-closed behavior;
- no raw untrusted `innerHTML`;
- no dictionary-driven remote script/CSS/image/audio/network load;
- object/blob URL cleanup.

One corrupt dictionary must not break other dictionary results.

## Catalog and lifecycle

Keep trust concepts distinct:

- source identity/provenance;
- source version;
- content freshness;
- TranslateFlow review date;
- installed version/date;
- curated upstream vs user imported;
- user preference vs product endorsement.

Install/update/reimport/delete must have deterministic identity and failure behavior. Failed update/import must not silently destroy the last healthy state.

## Packaging and licensing

Never commit or upload proprietary/user-owned dictionary bytes, extracted commercial definitions/examples, or private compatibility reports.

Source/build/validation corpora must remain outside the production allowlist.

Every curated source needs attributable provenance, license/distribution review, integrity/identity checks, and reproducible source locking where applicable.

## Validation

Always run:

```bash
npm run validate
```

Then run the Issue-specific dictionary checks. Available project commands include lexical benchmarks/certifiers, MDict/StarDict projection and compatibility checks, rich-dictionary security tests, and Chromium rich-dictionary E2E.

Do not run every dictionary command mechanically. Select checks that prove the changed contract, and record the exact evidence.
