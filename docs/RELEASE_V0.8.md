# TranslateFlow v0.8 Release Gate

This checklist is the release-certification record for Issue #28. Automated evidence is produced by the repository quality/E2E workflows; live-site items are intentionally kept out of deterministic CI.

## Automated regression matrix

| Area | Evidence |
| --- | --- |
| Web reading | `e2e/translateflow.spec.mjs`: manual/auto/selection translation, appearance, Quick Control task retry/cancel, cache restore |
| Popup | `e2e/release-gate.spec.mjs`: active-page translate, show/hide, remove, cache-only restore |
| Commands | `e2e/commands.spec.mjs`: first-use injection, translate, visibility, Quick Control, protected pages |
| Settings | `e2e/settings-ia.spec.mjs`: section focus/navigation and save → reload |
| Subtitle source | `e2e/subtitles.spec.mjs`: YouTube DOM source, SPA switch, teardown |
| Subtitle cache/pipeline | `e2e/subtitle-pipeline.spec.mjs` |
| YouTube renderer | `e2e/youtube-subtitles.spec.mjs`: bilingual render, preset/size, cache reuse, failure fallback, stale-video rejection |
| Accessibility/UX | release-gate + existing Quick Control/selection tests: focus, Escape, click-outside, dark-mode readability, overlap suppression |
| Permissions | manifest + `tests/site-registration.test.mjs` + command tests: no broad required site host permission; persistent site registration requires explicit Origin permission |

## Required CI

Before merge/tag:

- `npm run validate` — must pass in the `quality` workflow.
- `npm run test:e2e` — must pass in the Chromium `e2e` workflow.
- Post-merge `main` quality + e2e — must also pass.

Exact run IDs/commit SHA are recorded in Issue #28 when the release-gate PR reaches its final head.

## Interactive Chrome / live YouTube smoke

The agent execution environment is headless and cannot honestly certify these live-site behaviors. They must be run in an interactive Chrome profile before the v0.8 tag/release.

| Check | Result |
| --- | --- |
| Load unpacked extension; Popup opens and Settings opens | PENDING manual |
| Normal http/https page: translate, hide/show, Quick Control, selection coexistence | PENDING manual |
| Persistent Quick Control: permission prompt occurs only after explicit Popup action | PENDING manual |
| Chrome internal page: actionable unsupported behavior, no injection | PENDING manual |
| YouTube watch page with human captions: bilingual/original/off | PENDING manual |
| YouTube auto-generated captions / language switch | PENDING manual |
| YouTube theater mode: subtitles/controls remain usable and avoid native controls | PENDING manual |
| YouTube fullscreen: subtitles/controls remain usable | PENDING manual |
| YouTube SPA switch: no prior-video translated text leaks | PENDING manual |
| Light and dark browser/OS appearance | PENDING manual |

Do not mark Issue #28 audited/release-ready while any required manual row remains unresolved. If live YouTube markup has drifted, fix only the YouTube source adapter unless the normalized SubtitleSource contract itself is proven insufficient.
