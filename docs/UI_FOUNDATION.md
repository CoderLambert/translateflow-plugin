# TranslateFlow UI foundation

TranslateFlow separates translated page content from extension-owned controls.

## DOM boundary

- `.abt-translation` remains in the real page DOM so translations follow the host page's content width and typography.
- Interactive TranslateFlow controls live under the single `#translateflow-ui-root` host and its open Shadow DOM.
- `src/content/ui/host.js` owns that root and exposes named layers so selection, toast, Quick Control, and future YouTube controls can share one isolated surface.

Do not move translated paragraphs into the Shadow DOM and do not create additional top-level Shadow roots for new controls unless the shared host cannot satisfy a documented requirement.

## Tokens

`src/content/ui/tokens.js` is the content-surface source of truth for typography, spacing, radii, elevation, semantic colors, and control states. It also supplies dark values through `prefers-color-scheme`.

New content controls should consume the `--tf-*` variables rather than hard-code duplicate colors and spacing. Popup and Options work should use the same token names/semantics when those surfaces are migrated; the content script does not inject Shadow CSS into extension pages.

## Primitives

`src/content/ui/primitives.js` provides framework-free DOM helpers for surfaces, buttons/icon-buttons, select controls, menu shells, live status regions, status badges, and progress indicators. These primitives own structure/accessibility defaults only; product behavior stays in the feature modules that consume them.

## Toasts

Runtime `showToast()` delegates to `uiToast` once the UI foundation is loaded. A legacy page-DOM fallback remains only for bootstrap safety. Normal toasts render in the Shadow host.

## Host-page isolation

The host itself resets inherited styling with `all: initial`; internal styles are scoped by Shadow DOM. Page CSS in `content.css` is therefore reserved primarily for translated content that intentionally lives in page DOM.

## Loading order

The injection order is:

1. content runtime;
2. UI tokens / host / primitives / toast;
3. task and translation modules;
4. selection modules;
5. `content.js` bootstrap.

Tests in `tests/constants.test.mjs` enforce this dependency order.
