---
name: translateflow-product-design
description: Define or review TranslateFlow product features, UX flows, states, scope, and acceptance criteria before implementation. Use for new capabilities, UX changes, feature redesigns, or Issue shaping; do not use for trivial implementation-only edits.
---

# TranslateFlow product design

## Start from the product problem

Establish:

- who encounters the problem;
- the current behavior;
- concrete user cost or failure;
- evidence from the current product, Issue, user report, or benchmark;
- the smallest outcome that materially improves the experience.

Do not start by proposing abstractions, storage layers, APIs, or refactors.

## Inspect relevant current behavior

Read only what the feature needs:

- current Issue/Epic and dependencies;
- relevant UI/runtime implementation;
- existing tests/E2E;
- `README.md` for current product behavior;
- `docs/ARCHITECTURE.md` when feasibility or state ownership matters;
- domain Skill for dictionary-specific work.

## Design the interaction contract

Specify where relevant:

- entry point and primary user intent;
- information hierarchy;
- happy path;
- loading/progress;
- empty/no-hit;
- failure and actionable recovery;
- cancellation;
- stale/asynchronous result behavior;
- persistence and reload behavior;
- accessibility/keyboard/focus;
- narrow viewport and dark mode;
- privacy, permissions, and network expectations.

Prefer reusing an existing state model over creating a parallel setting or lifecycle.

## Control scope

Define:

- Goal;
- User value;
- In scope;
- Non-goals;
- Dependencies;
- Product/architecture constraints;
- Acceptance criteria;
- Required evidence/tests.

Separate "needed for the user outcome" from "technically attractive".

When uncertainty remains, prefer a bounded measurable experiment or research task over speculative implementation.

## Quality bar

A feature is not product-complete merely because the control exists. Verify that:

- the mental model is understandable without implementation jargon;
- failure does not trap the user;
- state is deterministic across reload/lifecycle operations;
- adjacent sources/features remain clearly distinguished;
- performance cost matches user value;
- product wording does not overclaim trust, compatibility, freshness, or endorsement.

## Output

Produce an Issue-ready product contract or a concrete review of an existing contract.

Do not write implementation code unless the task explicitly includes implementation.
