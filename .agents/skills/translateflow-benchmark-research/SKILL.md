---
name: translateflow-benchmark-research
description: Research a competing translation extension, dictionary product, or open-source project and turn evidence into actionable TranslateFlow product and architecture lessons. Use for benchmark/research Issues and cross-project synthesis.
---

# TranslateFlow benchmark research

## Goal

Learn what another product/project does better or differently, understand why it works, and translate only the useful lessons into evidence-backed TranslateFlow improvements.

Do not produce a superficial feature checklist.

## Research dimensions

Cover the dimensions that are actually relevant:

- target users and primary jobs;
- core product flows and information architecture;
- translation/reading/dictionary/video capabilities;
- caching, batching, deduplication, cancellation, and recovery;
- provider/model architecture;
- browser-extension architecture and permissions;
- storage/offline strategy;
- UX details that reduce user effort;
- privacy/security boundaries;
- build/release architecture;
- project maturity and maintenance signals.

For open-source projects, inspect current code and docs rather than inferring architecture from marketing text.

## Compare with current TranslateFlow

For each material finding, classify it as:

- already equivalent;
- stronger in TranslateFlow;
- weaker/missing in TranslateFlow;
- intentionally different due to product constraints;
- not worth adopting.

Explain the mechanism, not only the surface feature.

## Convert findings into action

A proposed improvement must include:

- observed evidence;
- user/product value;
- applicability to TranslateFlow;
- architectural fit;
- risks/tradeoffs;
- whether it maps to an existing Issue or warrants a new proposal;
- recommended priority only when supported by product impact/dependency evidence.

Do not copy implementation or UX blindly. Check licensing, security, browser constraints, and whether the competitor's assumptions match TranslateFlow.

## Output structure

Return:

1. concise project/product summary;
2. product-flow findings;
3. architecture/implementation findings;
4. what TranslateFlow should learn;
5. what TranslateFlow should not copy;
6. concrete follow-up opportunities tied to existing project areas;
7. sources/evidence and uncertainty.

When the task is a GitHub research Issue, record the complete result there rather than leaving only a chat summary.
