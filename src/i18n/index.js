import { catalogs } from "./catalog.js";
import { normalizeUiLocale, resolveLocale } from "./locale.js";

export { normalizeUiLocale, resolveLocale };

export function messageParameters(template) {
  if (typeof template !== "string" || !template) throw new TypeError("Empty i18n message");
  const names = [...template.matchAll(/\{([a-z][a-zA-Z0-9]*)\}/g)].map((match) => match[1]);
  if (/[{}]/.test(template.replace(/\{([a-z][a-zA-Z0-9]*)\}/g, ""))) {
    throw new TypeError("Invalid i18n placeholder");
  }
  return [...new Set(names)].sort();
}

/** Pure catalog validation, also used by build/validate. Throws on drift. */
export function validateCatalogs(candidate = catalogs) {
  if (!candidate || !candidate.en || !candidate.zh_CN) throw new TypeError("Missing i18n locale");
  const keys = Object.keys(candidate.en).sort();
  if (!keys.length) throw new TypeError("Empty i18n catalog");
  for (const locale of ["en", "zh_CN"]) {
    if (JSON.stringify(Object.keys(candidate[locale]).sort()) !== JSON.stringify(keys)) {
      throw new TypeError(`i18n keys differ: ${locale}`);
    }
    for (const key of keys) {
      const actual = messageParameters(candidate[locale][key]);
      const expected = messageParameters(candidate.en[key]);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new TypeError(`i18n placeholders differ: ${locale}/${key}`);
      }
    }
  }
  return keys.length;
}

/** The only output is text. Consumers must use textContent/React text nodes. */
export function createI18n({ uiLocale = "auto", browserLocale = "en", onDiagnostic = defaultDiagnostic } = {}) {
  const locale = resolveLocale(uiLocale, browserLocale);
  const intlLocale = locale === "zh_CN" ? "zh-CN" : "en";
  return Object.freeze({
    locale,
    t(key, args = {}) {
      if (typeof key !== "string" || !Object.hasOwn(catalogs.en, key)) {
        onDiagnostic({ code: "missing-key", key: typeof key === "string" ? key : "<invalid>" });
        return `[${typeof key === "string" ? key : "invalid-key"}]`;
      }
      let template = catalogs[locale][key];
      if (typeof template !== "string" || !template) {
        onDiagnostic({ code: "english-fallback", key });
        template = catalogs.en[key];
      }
      const parameters = messageParameters(template);
      if (!args || typeof args !== "object" || Array.isArray(args)
        || JSON.stringify(Object.keys(args).sort()) !== JSON.stringify(parameters)
        || parameters.some((name) => !["string", "number"].includes(typeof args[name])
          || (typeof args[name] === "number" && !Number.isFinite(args[name])))) {
        onDiagnostic({ code: "invalid-arguments", key });
        throw new TypeError(`Invalid i18n arguments: ${key}`);
      }
      return template.replace(/\{([a-z][a-zA-Z0-9]*)\}/g, (_, name) => String(args[name]));
    },
    formatNumber(value, options) {
      return new Intl.NumberFormat(intlLocale, options).format(value);
    },
    formatDateTime(value, options) {
      return new Intl.DateTimeFormat(intlLocale, options).format(value);
    }
  });
}

function defaultDiagnostic({ code, key }) {
  // Do not log interpolated text, saved records or configuration.
  console.warn(`[TranslateFlow i18n] ${code}: ${key}`);
}

const manifestKeys = Object.freeze({
  extensionName: "manifest.name",
  extensionDescription: "manifest.description",
  actionTitle: "manifest.actionTitle",
  translatePage: "manifest.translatePage",
  toggleTranslations: "manifest.toggleTranslations",
  toggleQuickControl: "manifest.toggleQuickControl"
});

/** Build-time projection; never maintained as a second handwritten catalog. */
export function getManifestMessages(locale) {
  if (!Object.hasOwn(catalogs, locale)) throw new TypeError("Unsupported manifest locale");
  validateCatalogs();
  return Object.fromEntries(Object.entries(manifestKeys).map(([key, source]) => {
    const message = catalogs[locale][source];
    if (messageParameters(message).length || message.includes("$")) {
      throw new TypeError(`Invalid manifest message: ${source}`);
    }
    return [key, { message }];
  }));
}
