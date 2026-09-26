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

### Dark mode

TranslateFlow follows the browser/OS color scheme through `prefers-color-scheme`. There is no persisted Light/Dark preference: extension pages and the content Shadow UI consume the same semantic `--tf-*` token contract and switch automatically.

Dark mode must override both surface/text semantics and control semantics. In particular, do not pair the light-theme dark-green `--tf-green-900/800` foregrounds with dark sage surfaces, and do not hard-code white text on the light-sage primary gradient. Use `--tf-primary-foreground`, `--tf-control-track`, `--tf-control-thumb`, `--tf-control-thumb-shadow`, `--tf-primary-hover-start` and `--tf-accent-shadow`.

Host-page content is not recolored or forced into dark mode. Translated text remains in the real page DOM and inherits host-page typography/color as before; only TranslateFlow-owned extension and Shadow-DOM controls follow this UI token path.

The Chromium release gate emulates `colorScheme: "dark"` and checks representative computed foreground/background pairs for WCAG AA ordinary-text contrast (>= 4.5:1).

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
2. UI tokens and feature style modules;
3. shared Shadow host / primitives / toast;
4. task and translation modules;
5. selection modules;
6. `content.js` bootstrap.

Tests in `tests/constants.test.mjs` enforce this dependency order.
