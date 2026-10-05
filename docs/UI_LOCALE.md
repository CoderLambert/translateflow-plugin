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

## Surface ownership

Popup, Options, Learning Center and the extension-owned Content controls consume
the same catalog. Each React document has one locale hook that owns its initial
`chrome.storage.local` read and its `storage.onChanged` listener. Options also
owns the explicit `uiLocale` write from its language control. Initial document
content is withheld until the stored value settles, so an explicit preference
does not briefly render in the browser-language fallback. React StrictMode
reuses one initial read, storage listeners are removed symmetrically, and an
already-open document rerenders safely when another document changes the value.

The pure catalog still performs no storage or browser access. Content's classic
renderers receive an already-resolved translator through their existing
surface owner; they do not create another storage owner. Popup, Options,
Glossary, the dictionary library and local import, Learning Center, Quick
Control, Selection and subtitle controls use catalog text for their
loading/empty/error/success/cancel/permission/confirmation paths. Dynamic site,
model, dictionary, word and user values remain text interpolation arguments.

Manifest localization remains browser-owned and independent. `uiLocale` still
does not change target language, dictionary languages, Prompt, Provider
credentials, cache identity or artifacts.

## Verification

Use scripts actually defined by the current package:

```bash
node --test tests/i18n.test.mjs
npm run check:i18n
npm run validate
npm run build:extension:wxt
TF_I18N_ARTIFACT=dist/extension npm run test:e2e -- e2e/ui-locale.spec.mjs
npm run test:e2e -- e2e/ui-locale.spec.mjs
```

The dedicated browser fixture defaults to the actual WXT package built by CI;
`TF_I18N_ARTIFACT=dist/extension` explicitly selects the built legacy comparison.
It consumes the chosen built package directly. It
copies the package to a temporary directory, adds no runtime source or
permissions, and uses a separate synthetic profile. It checks missing-settings
compatibility, language changes across two Options pages, preservation of all
other settings, reopening, storage failures and recovery. HTTP attempts and
uncaught page errors must remain zero. This does not test Chrome 102, browser
Manifest locale selection across operating systems or a real user's profile.

`npm run check` and therefore `validate` run the locale consistency command.
To update generated Manifest messages after editing the owned catalog, run
`node scripts/i18n-locales.mjs --generate`. Checks reject stale bytes, missing
keys, changed placeholders and uncontrolled Manifest references. The source
boundary checker treats `src/i18n/` as a pure domain, including transitive
browser/network/storage effects. Runtime declaration files stay outside both
installation artifacts.

Isolated Chromium 153 on this Linux host has exercised actual en-US and zh-CN
browser UI locales, without mocking `getUILanguage()`: Chinese browser/English
UI/Chinese translation target, English browser/Chinese UI/original dictionary
languages, dual-page synchronization, reopening and storage failure recovery.
Both the legacy and WXT artifacts passed all five browser cases with zero HTTP
requests and zero page errors. Earlier fixture failures were preserved:
fault injection was guarded against the initial non-extension page, and a cold
CI run exposed the implicit legacy-package prerequisite. The browser fixture
now defaults to WXT without building or repairing a missing artifact itself.
Manifest language selection on other operating systems remains unverified.
