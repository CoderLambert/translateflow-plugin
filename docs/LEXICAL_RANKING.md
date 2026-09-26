# Lexical Ranking & Sufficiency Policy v1

Issue: #85  
Inputs: #77 Lexical Gateway candidates + #78 Technical candidates

This policy is a deterministic, local-only layer between candidate collection and Selection v2 intent/UI work. It does not call a Provider, does not generate prose, and never hides candidates.

## Outcomes

The decision layer returns:

- `sufficient` — local evidence is strong enough for the next Selection stage to use the top candidate directly;
- `ambiguous` — local candidates exist, but the score/gap is not decisive;
- `no-hit` — no final local candidate exists;
- `unsupported` / `error` — pass-through routing states from the Lexical Gateway.

All candidates remain in the result, including candidates below the top rank.

## Explicit override

User Glossary is the only explicit override source. A valid User Glossary hit is immediately `sufficient`.

Core, Technical and optional packs are never first-hit overrides. They contribute attributable candidates to the same ranking set.

## Ranking signals

Policy version: **1**

Base match scores:

| Match | Points |
|---|---:|
| User Glossary | 1000 |
| exact | 72 |
| alias | 64 |
| lemma | 56 |
| morphology | 50 |
| token evidence | 20 |

Additional deterministic signals:

| Signal | Points |
|---|---:|
| exact-case match | +5 |
| verified target translation exists | +3 |
| technical candidate in technical context | +14 |
| candidate domain/type/alias token overlaps context | +5 each, capped at +15 |

There is deliberately **no pack-ID/source-name boost**. A Core or optional candidate is not preferred just because of source identity, and a Technical candidate gets no blanket preference outside technical context.

## Context handling

The selected query tokens are removed from context before context evidence is scored. This prevents a candidate from receiving a context boost merely because the selected word appears in its own surrounding sentence.

Technical-context detection uses a small frozen v1 marker set oriented around software/documentation terms such as API, browser, code, component, container, database, Docker, Git, JavaScript, Kubernetes, package, protocol, repository, runtime, server, terminal and tmux.

Candidate-specific evidence is limited to attributable structured fields already present on the candidate:

- `domains[]`
- `typeLabels[]`
- `aliases[]`

No LLM-derived feature is used.

## Sufficiency thresholds

- Single candidate: score **>= 55** and not token-evidence-only => `sufficient`.
- Multiple candidates: top score **>= 80** and top-vs-second gap **>= 18** => `sufficient`.
- Otherwise => `ambiguous`.

This intentionally keeps cases such as a tmux-context `session` ambiguous when the technical candidate ranks first but the evidence gap is still modest. Stronger structured context (for example protocol/statefulness evidence) may cross the decisive threshold.

## Phase B corpus

`tests/fixtures/lexical-ranking-v1.json` is project-authored and redistributable. It covers:

- ordinary exact words;
- polysemy;
- technical-vs-general context;
- named technical entities;
- phrase exact matches;
- irregular lemma and morphology;
- case/alias ambiguity;
- deliberate entity false-positive pressure;
- same-translation cross-source conflicts;
- untranslated technical candidates;
- no-hit, code-like no-hit and unsupported-language routing;
- User Glossary override.

Run:

```bash
npm run evaluate:lexical
```

The evaluator reports outcome accuracy, top-candidate accuracy, coverage and entity false-positive-top rate separately. It exits non-zero on any expected outcome/top-candidate regression.

## Change control

Material ranking changes require:

1. explicit policy/version review;
2. corpus diff or a documented reason the existing corpus remains sufficient;
3. before/after evaluation metrics;
4. no Provider/network calls during evaluation.

#79 and #80 should consume this decision contract rather than duplicate scoring logic.
