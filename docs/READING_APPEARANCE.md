# Reading appearance

Issue #20 separates **how translated paragraphs look** from **how text is translated**.

Translation style presets (Technical / Academic / News / Natural) modify Provider instructions and therefore participate in cache identity. Reading appearance presets only change CSS presentation and never enter the Provider request or translation cache fingerprint.

## Presets

| Preset | Intent |
| --- | --- |
| Standard | Balanced default that preserves the existing TranslateFlow presentation. |
| Compact | Tighter spacing and smaller visual footprint for dense docs and lists. |
| Reading | Larger spacing, line height and separation for long-form reading. |
| Minimal | Low-chrome presentation with transparent background and no accent border. |

The source text remains the host page's original DOM in every preset. v0.8 does not hide or wrap arbitrary source DOM to create a translation-only mode.

## CSS contract

Translated paragraphs remain in page DOM and consume these variables:

```text
--tf-translation-font-scale
--tf-translation-line-height
--tf-translation-gap
--tf-translation-padding
--tf-translation-background
--tf-translation-border-width
--tf-translation-border-color
--tf-translation-opacity
--tf-translation-radius
```

`src/shared/appearance.js` is the preset/value source of truth. `src/content/appearance.js` asks Background for the effective context and applies only `--tf-translation-*` values to the document root. `content.css` provides Standard-compatible fallbacks for the short startup window.

No host-page layout container is rewritten, and structured translation rendering for links, code, emphasis and other supported inline nodes is unchanged.

## Default and per-site semantics

Global storage contains:

```text
appearance = standard | compact | reading | minimal
```

The default is `standard`.

A site profile may optionally contain its own `appearance`. When absent, the site inherits the global appearance. A site appearance changes presentation only; other site-profile fields continue to control translation behavior.

```text
site profile appearance
        |
        | present
        v
effective appearance

otherwise

global appearance
        |
        v
effective appearance
```

Options exposes the global default and an optional site override. The larger Settings information-architecture redesign remains #27.

## Cache and Provider boundary

Appearance is intentionally excluded from `resolveTranslationConfig()`, `getEffectiveConfig()` and the cache config hash.

Changing Standard → Compact → Reading → Minimal:

- does not change Provider/model/prompt/target language;
- does not create a new cache version;
- does not require an API request;
- does not remove or rebuild translated DOM;
- immediately restyles existing and future `.abt-translation` nodes.

Only translation-relevant site-profile fields (Provider, model, Prompt, target language or translation preset) cause auto-translation content to be invalidated. An appearance-only site-profile change only refreshes CSS variables.
