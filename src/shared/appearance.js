export const APPEARANCE_IDS = Object.freeze({
  STANDARD: "standard",
  COMPACT: "compact",
  READING: "reading",
  MINIMAL: "minimal"
});

export const DEFAULT_APPEARANCE_ID = APPEARANCE_IDS.STANDARD;

const VARIABLE_NAMES = Object.freeze([
  "--tf-translation-font-scale",
  "--tf-translation-line-height",
  "--tf-translation-gap",
  "--tf-translation-padding",
  "--tf-translation-background",
  "--tf-translation-border-width",
  "--tf-translation-border-color",
  "--tf-translation-opacity",
  "--tf-translation-radius"
]);

function preset(id, label, description, variables) {
  return Object.freeze({
    id,
    label,
    description,
    variables: Object.freeze({ ...variables })
  });
}

export const TRANSLATION_APPEARANCES = Object.freeze([
  preset(
    APPEARANCE_IDS.STANDARD,
    "Standard",
    "Balanced spacing and contrast for general bilingual reading.",
    {
      "--tf-translation-font-scale": "0.96em",
      "--tf-translation-line-height": "1.65",
      "--tf-translation-gap": "0.78em",
      "--tf-translation-padding": "0.24em 0 0.24em 0.72em",
      "--tf-translation-background": "rgba(237, 243, 232, 0.32)",
      "--tf-translation-border-width": "2px",
      "--tf-translation-border-color": "rgba(111, 150, 104, 0.34)",
      "--tf-translation-opacity": "0.94",
      "--tf-translation-radius": "1px"
    }
  ),
  preset(
    APPEARANCE_IDS.COMPACT,
    "Compact",
    "Reduced spacing for dense documentation and list-heavy pages.",
    {
      "--tf-translation-font-scale": "0.92em",
      "--tf-translation-line-height": "1.45",
      "--tf-translation-gap": "0.46em",
      "--tf-translation-padding": "0.12em 0 0.12em 0.58em",
      "--tf-translation-background": "rgba(237, 243, 232, 0.16)",
      "--tf-translation-border-width": "1px",
      "--tf-translation-border-color": "rgba(111, 150, 104, 0.28)",
      "--tf-translation-opacity": "0.90",
      "--tf-translation-radius": "0px"
    }
  ),
  preset(
    APPEARANCE_IDS.READING,
    "Reading",
    "More breathing room and stronger separation for long-form reading.",
    {
      "--tf-translation-font-scale": "1em",
      "--tf-translation-line-height": "1.8",
      "--tf-translation-gap": "1em",
      "--tf-translation-padding": "0.38em 0 0.38em 0.88em",
      "--tf-translation-background": "rgba(246, 241, 232, 0.46)",
      "--tf-translation-border-width": "2px",
      "--tf-translation-border-color": "rgba(111, 150, 104, 0.40)",
      "--tf-translation-opacity": "0.97",
      "--tf-translation-radius": "2px"
    }
  ),
  preset(
    APPEARANCE_IDS.MINIMAL,
    "Minimal",
    "Low-chrome presentation that stays close to the host page typography.",
    {
      "--tf-translation-font-scale": "0.96em",
      "--tf-translation-line-height": "1.6",
      "--tf-translation-gap": "0.52em",
      "--tf-translation-padding": "0.08em 0",
      "--tf-translation-background": "transparent",
      "--tf-translation-border-width": "0px",
      "--tf-translation-border-color": "transparent",
      "--tf-translation-opacity": "0.90",
      "--tf-translation-radius": "0px"
    }
  )
]);

const APPEARANCE_MAP = new Map(
  TRANSLATION_APPEARANCES.map((appearance) => [appearance.id, appearance])
);

export const APPEARANCE_VARIABLE_NAMES = VARIABLE_NAMES;

export function normalizeAppearanceId(value) {
  const id = String(value || "").trim().toLowerCase();
  return APPEARANCE_MAP.has(id) ? id : "";
}

export function getAppearance(value) {
  return APPEARANCE_MAP.get(normalizeAppearanceId(value) || DEFAULT_APPEARANCE_ID);
}

export function getAppearanceLabel(value) {
  return getAppearance(value).label;
}

export function resolveAppearance(defaultValue, siteValue = "") {
  const defaultId = normalizeAppearanceId(defaultValue) || DEFAULT_APPEARANCE_ID;
  const siteId = normalizeAppearanceId(siteValue);
  const appearance = getAppearance(siteId || defaultId);
  return {
    id: appearance.id,
    label: appearance.label,
    description: appearance.description,
    source: siteId ? "site" : "default",
    variables: { ...appearance.variables }
  };
}
