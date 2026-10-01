# TranslateFlow Agent Skills

## Purpose

TranslateFlow uses project Skills to encode repeatable specialist workflows without turning `AGENTS.md` or individual task prompts into large instruction dumps.

The separation is intentional:

```text
GitHub Issue
  = current task contract

AGENTS.md
  = repository-wide invariants

Skill
  = reusable specialist workflow

Canonical docs
  = architecture/data/provider contracts

Tests + code
  = executable/current behavior
```

## Repository layout

```text
.agents/
└── skills/
    ├── translateflow-product-design/
    │   └── SKILL.md
    ├── translateflow-benchmark-research/
    │   └── SKILL.md
    ├── translateflow-extension-engineering/
    │   └── SKILL.md
    ├── translateflow-dictionary-engineering/
    │   └── SKILL.md
    ├── translateflow-pr-audit/
    │   └── SKILL.md
    └── translateflow-release-certification/
        └── SKILL.md
```

Each Skill starts instruction-only. Add `references/`, `scripts/`, or `assets/` only when they reduce repeated work or make a deterministic step materially safer.

## Authoring standard

Every `SKILL.md` must:

1. start with YAML front matter containing a stable `name` and a precise `description`;
2. describe one recognizable workflow or user goal;
3. state when to use it and when not to use it;
4. refer to canonical repository docs instead of copying large sections from them;
5. define decision points, hard constraints, required evidence, and completion conditions;
6. remain valid for multiple Issues rather than encoding a single Issue number;
7. avoid secrets, machine-specific paths, personal environment assumptions, or proprietary data;
8. prefer instructions over scripts unless a step benefits from deterministic automation.

Descriptions matter because they are the routing signal used to decide whether a Skill should be loaded. Avoid vague descriptions such as "helps with TranslateFlow".

## Skill boundaries

### Product design

Owns problem definition, user value, interaction/state model, scope, non-goals, failure/recovery behavior, accessibility, and acceptance criteria.

It does not own implementation details unless architecture affects product feasibility.

### Benchmark research

Owns evidence-backed analysis of competing products/projects and converts findings into specific TranslateFlow opportunities.

It does not turn feature copying into a roadmap.

### Extension engineering

Owns normal MV3 runtime implementation: content/background boundaries, messaging, permissions, effective config, providers, cache/storage, task lifecycle, and package-safe code changes.

It does not override dictionary-specific data/security policy.

### Dictionary engineering

Owns lexical source policy, local dictionary lifecycle, parsing/indexing, MDict/MDD/StarDict/TFLex, OPFS, rich rendering security, catalog trust, provenance, offline guarantees, and lexical quality gates.

It is the authoritative specialist workflow for dictionary changes.

### PR audit

Owns independent exact-head review and evidence-based findings.

It should combine with the domain Skill when reviewing dictionary, provider, UX, or release work.

### Release certification

Owns scope freeze and release evidence. It verifies what shipped; it must not invent new product scope during the gate.

## Composition rules

Skills may be combined when responsibilities are orthogonal. Typical combinations:

```text
new dictionary UX
  -> product-design
  -> dictionary-engineering

dictionary PR review
  -> pr-audit
  -> dictionary-engineering

provider/cache PR review
  -> pr-audit
  -> extension-engineering

Dictionary Ecosystem release gate
  -> release-certification
  -> dictionary-engineering
```

Do not combine Skills merely to create a larger prompt.

## Adding a new Skill

Add a Skill only when all are true:

- the workflow repeats across multiple tasks;
- it has meaningful decisions or constraints not already captured by `AGENTS.md`;
- the trigger can be described precisely;
- it has a clear successful outcome;
- it will reduce repeated prompt text or recurring mistakes.

Before adding one, check whether an existing Skill should be extended instead.

## Maintenance

Review Skills when:

- a major architecture boundary changes;
- validation commands change;
- a repeated agent failure indicates missing workflow guidance;
- instructions become duplicated across Skills;
- a Skill triggers too broadly or too rarely.

Remove obsolete instructions instead of endlessly appending exceptions.

## Cloud/CLI usage

Project Skills live under `.agents/skills/<skill-name>/SKILL.md` so the same repository can carry its specialist workflows with the code. A task may explicitly request a Skill when deterministic routing is useful, for example:

```text
Implement the current GitHub Issue.
Follow AGENTS.md.
Use translateflow-dictionary-engineering.
Do not expand Issue scope.
Run the required validation and open a PR.
```

Keep the task prompt short; stable process belongs in the repository.
