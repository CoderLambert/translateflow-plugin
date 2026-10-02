# Interface language

`uiLocale` is an independent local setting with the values `auto`, `en`, and
`zh_CN`. Missing or invalid values normalize to `auto`; `zh-CN` normalizes to the
stored value `zh_CN`. Changing it does not change translation target language,
dictionary languages, Prompt, Provider credentials or cache identity.

Automatic selection uses the browser UI language as a signal. `zh-Hans` uses
simplified Chinese, while `zh-Hant` falls back to English. Chinese tags without
a script use simplified Chinese only for regions CN and SG. Bare `zh`, TW, HK,
MO and unsupported languages fall back to English. An explicit interface
language takes precedence. These rules do not claim traditional Chinese support.

## Ownership and use

`src/i18n/catalog.js` is the single TranslateFlow-owned English and simplified
Chinese catalog. `createI18n({ uiLocale, browserLocale })` returns the resolved
locale, `t(key, args)`, `formatNumber(value, options)` and
`formatDateTime(value, options)`. It does not read browser APIs or storage.
Consumers pass settings through their existing storage boundary and use text
nodes or React text children for all translated output. Interpolation preserves
untrusted text; it does not sanitize text for use as HTML.

The declaration next to this native JavaScript API derives accepted keys and
required interpolation names from the same literal catalog. There is no second
handwritten key or placeholder table. Runtime validation rejects missing,
extra, invalid and nonfinite interpolation values. Development diagnostics
contain a code and message key, without interpolation arguments. A missing key
produces a visible `[key]` diagnostic; a missing localized message falls back to
English. `validateCatalogs()` rejects catalog drift during project checks.

`getManifestMessages(locale)` projects only six controlled catalog messages into
Chrome's messages format. Build integration generates `_locales/en/messages.json`
and `_locales/zh_CN/messages.json`, with Manifest `default_locale` set to `en`.
These generated files are not a second source of translations. Chrome chooses
Manifest text based on its own locale rules. Changing `uiLocale` does not
immediately change the extension name, browser action title or command labels.
See the official [Chrome internationalization reference](https://developer.chrome.com/docs/extensions/reference/api/i18n).

## Current migration scope

This slice localizes the new interface-language control, Manifest text and the
first learning-center catalog namespace. The learning-center UI is delivered
by its own task. Existing Options sections, Popup, Content controls, subtitles
and dictionary displays retain their existing strings; this is not a claim
that the entire extension is bilingual.

The Options adapter reads and writes only `uiLocale`. It displays the new
control after the initial read, listens for local storage changes to update
open pages, and reports read/write failures with a retry action. It does not
save or test Provider configuration. A failed write keeps the last committed
selection. A read failure disables the control until recovery.

## Verification

Use scripts actually defined by the current package:

```bash
node --test tests/i18n.test.mjs
npm run validate
npm run build:extension:wxt
TF_I18N_ARTIFACT=dist/extension npm run test:e2e -- e2e/ui-locale.spec.mjs
TF_I18N_ARTIFACT=.output/chrome-mv3 npm run test:e2e -- e2e/ui-locale.spec.mjs
```

The dedicated browser fixture consumes the chosen built package directly. It
copies the package to a temporary directory, adds no runtime source or
permissions, and uses a separate synthetic profile. It checks missing-settings
compatibility, language changes across two Options pages, preservation of all
other settings, reopening, storage failures and recovery. HTTP attempts and
uncaught page errors must remain zero. This does not test Chrome 102, browser
Manifest locale selection across operating systems or a real user's profile.
