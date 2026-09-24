# TranslateFlow UI foundation

TranslateFlow separates translated page content from extension-owned controls.

## DOM boundary

- `.abt-translation` remains in the real page DOM so translations follow the host page's content width and typography.
- Interactive TranslateFlow controls live under the single `#translateflow-ui-root` host and its open Shadow DOM.
- `src/content/ui/host.js` owns that root and exposes named layers so selection, toast, Quick Control, and future YouTube controls can share one isolated surface.

Do not move translated paragraphs into the Shadow DOM and do not create additional top-level Shadow roots for new controls unless the shared host cannot satisfy a documented requirement.

## Tokens

TranslateFlow uses one semantic token vocabulary across extension pages and content-owned controls.

- `src/ui/styles/tokens.css` is the extension-page source of truth used by Popup, Options and future extension-owned pages.
- `src/content/ui/tokens.js` mirrors the same semantic names inside the shared Shadow DOM host.
- `src/ui/styles/components.css` contains framework-free extension-page primitives for buttons, fields/selects, cards, badges, switches, accordions and toast surfaces.

The approved visual direction is calm and low-distraction: sage/forest greens, warm beige/cream surfaces, restrained elevation and low-motion interactions. New controls should consume `--tf-*` variables rather than hard-code duplicate colors and spacing.

Compatibility aliases such as `--tf-color-accent` remain temporarily available while existing surfaces migrate, but new work should prefer semantic tokens such as `--tf-green-700`, `--tf-bg-card`, `--tf-text-main`, `--tf-border-main` and `--tf-focus-ring`.

### Motion and focus

All interactive primitives must provide a visible `:focus-visible` state. Nonessential transitions are disabled under `prefers-reduced-motion: reduce`.

### Surface migration

Popup, Quick Control, Options and reading presentation are migrated independently. The shared token/primitives layer must not change Provider, cache, permission or translation behavior.

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
