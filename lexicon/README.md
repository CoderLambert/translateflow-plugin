# Lexicon workspace

This directory contains **build/source/quality-control inputs**, not the Chrome extension runtime package.

See [../docs/LEXICAL_DATA_BOUNDARIES.md](../docs/LEXICAL_DATA_BOUNDARIES.md).

## Directory roles

- `source-candidates/**` — reviewed upstream snapshot metadata that is **not** an exact source lock yet.
- `source-locks/**` — reproducibility/provenance metadata for approved build inputs.
- `sources/**` — reviewed source extracts or project-authored transitional source material consumed by compilers.
- `quality-baselines/**` — benchmark baselines.
- `quality-decisions/**` — source/product quality decisions.

A moving upstream URL or advertised size is never a source lock. Candidate metadata may move to
`source-locks/**` only after the exact acquired artifact bytes have an independently recorded
cryptographic digest and byte size.

None of these directories should be copied directly into `dist/extension`.

Generated runtime packs belong under `assets/lexicon/**` and only approved bundled bootstrap packs may enter the base extension.

Large/high-coverage dictionaries should be downloadable/imported rather than bundled.

## Project-authored lexical data

Project-authored word/translation records are **not** the normal way to grow coverage.

The existing `sources/reviewed-tech-terms.json` was introduced as a transitional compatibility layer while fixing #115. Treat it as bounded exception/regression support:

- do not keep adding words simply because a benchmark or real page exposes a miss;
- prefer an attributable upstream/source pipeline;
- keep regression expectations in `tests/**`, even after runtime sourcing changes;
- remove/replace manual runtime rows when an approved source provides equivalent or better structured data.

TranslateFlow should maintain lexical engines, importers, integrity, ranking and provenance—not an ever-growing hand-authored dictionary.


## Kaikki Rich EN→ZH projection

`source-candidates/kaikki-enwiktionary-2026-09-25.json` remains **candidate-unlocked**. The real projection path must not consume the mutable Kaikki URL directly.

After the exact `raw-wiktextract-data.jsonl.gz` bytes have been acquired and a source lock has been generated/verified:

```bash
npm run project:kaikki -- \
  --source /path/to/raw-wiktextract-data.jsonl.gz \
  --source-lock /path/to/kaikki-source-lock.json \
  --out /tmp/kaikki-rich-projection.jsonl \
  --report /tmp/kaikki-rich-projection-report.json
```

The projector verifies the locked gzip SHA-256 and byte size **before parsing**. It streams the source rather than materializing the multi-GB input.

Projection v1 is intentionally conservative:

- only source entries with `lang_code=en` are considered;
- only **sense-level** Chinese/Mandarin translations (`lang_code/code = cmn|zh`) are retained;
- entry-level translations are counted but are not assigned to senses, because Wiktextract documents them as non-disambiguated;
- source sense boundaries, glosses, tags/topics, forms, IPA and translation romanization are preserved when supplied;
- audio URLs/files, examples, categories, raw glosses, etymology payloads, linkages and renderable/remote content are omitted;
- no zh-CN display normalization is applied in this stage, so source translation text remains unchanged;
- the projection JSONL/report are build/validation outputs only and are not production extension assets.

The projection step does **not** constitute a #121 GO decision and does not bypass the exact-source lock, licensing/field audit, TFLex compilation, zh-CN review or quality gates.
