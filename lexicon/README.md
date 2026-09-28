# Lexicon workspace

This directory contains **build/source/quality-control inputs**, not the Chrome extension runtime package.

See [../docs/LEXICAL_DATA_BOUNDARIES.md](../docs/LEXICAL_DATA_BOUNDARIES.md).

## Directory roles

- `source-locks/**` — reproducibility/provenance metadata for approved build inputs.
- `sources/**` — reviewed source extracts or project-authored transitional source material consumed by compilers.
- `quality-baselines/**` — benchmark baselines.
- `quality-decisions/**` — source/product quality decisions.

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
