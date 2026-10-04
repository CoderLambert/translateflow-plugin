# 251 — Reading history routing, commit integrity, page privacy and long-page recovery

## Goal

Complete the locally authorized A–E Reading repair against the current main source. Build from the repository's locked Node/npm versions. Keep all work on the task branch and make a local commit; do not push, create a PR, merge, or publish.

## Scope

- **A — Trusted history routing:** derive site/page identity from the backend-validated stored record; route history through the existing site config/profile/preset/glossary resolver with no return-URL fallback. Fingerprint the exact effective config while preserving cache identity, endpoint separation, empty-glossary behavior, and port normalization.
- **B — Stop and storage transaction:** pass an in-memory abort signal through stream/runtime/service/repository/IDB, check request/generation at async boundaries, abort real transactions before one synchronous commit point, and report committed or failed terminal outcomes truthfully.
- **C — Page isolation:** keep stored quote/context/answer text in the learning center. The page may show generic state/count/actions and text verified against a current mapped Range. Clear stale locations and UI on mutation, navigation, close, or revocation.
- **D — Long-page location:** use the existing projection rules in resumable 8ms/500-node/16,000-UTF-16-character slices under the existing 1,000,000-character/25,000-node/250ms total budget. Share scan and digest caches, avoid false unique/missing results on incomplete coverage, and cap summaries at two requests/200 records.
- **E — Upgrade and data exit:** preserve static injection and exact legacy dynamic-registration cleanup, avoid permission/schema/cache changes, and verify real visible controls, native host permission changes, ordinary-page injection, toolbar Popup behavior, and old-package same-ID update/reload with temporary browser profiles.

## Acceptance and constraints

Use synthetic page text, mock Providers, and isolated temporary profiles. Preserve existing user data and unrelated task branches. Do not download private dictionaries or use account credentials. Record unavailable browser permission prompts or unsupported browser states as NOT_RUN; never claim a Boolean mock as a native grant. Regenerate Reading classic files from their authored sources. Do not change database schema, source IDs, cache fingerprint meaning, or extension permissions.

Run the task-scoped validation commands in state.json, record the actual Node/npm/Chromium versions and built WXT package fingerprint, and self-review the exact candidate diff. Keep the old package at the immutable 19e89b65fd3600073410407392da82ffa666ffc8 baseline and the updated package in .output/chrome-mv3. No sync or merge action is authorized.
