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
      "--tf-translation-gap": "0.85em",
      "--tf-translation-padding": "0.45em 0.7em",
      "--tf-translation-background": "rgba(127, 127, 127, 0.08)",
      "--tf-translation-border-width": "3px",
      "--tf-translation-border-color": "rgba(34, 113, 177, 0.55)",
      "--tf-translation-opacity": "0.92",
      "--tf-translation-radius": "3px"
    }
  ),
  preset(
    APPEARANCE_IDS.COMPACT,
    "Compact",
    "Reduced spacing for dense documentation and list-heavy pages.",
    {
      "--tf-translation-font-scale": "0.92em",
      "--tf-translation-line-height": "1.45",
      "--tf-translation-gap": "0.5em",
      "--tf-translation-padding": "0.28em 0.5em",
      "--tf-translation-background": "rgba(127, 127, 127, 0.05)",
      "--tf-translation-border-width": "2px",
      "--tf-translation-border-color": "rgba(34, 113, 177, 0.5)",
      "--tf-translation-opacity": "0.88",
      "--tf-translation-radius": "2px"
    }
  ),
  preset(
    APPEARANCE_IDS.READING,
    "Reading",
    "More breathing room and stronger separation for long-form reading.",
    {
      "--tf-translation-font-scale": "1em",
      "--tf-translation-line-height": "1.8",
      "--tf-translation-gap": "1.05em",
      "--tf-translation-padding": "0.65em 0.85em",
      "--tf-translation-background": "rgba(127, 127, 127, 0.1)",
      "--tf-translation-border-width": "3px",
      "--tf-translation-border-color": "rgba(34, 113, 177, 0.58)",
      "--tf-translation-opacity": "0.98",
      "--tf-translation-radius": "6px"
    }
  ),
  preset(
    APPEARANCE_IDS.MINIMAL,
    "Minimal",
    "Low-chrome presentation that stays close to the host page typography.",
    {
      "--tf-translation-font-scale": "0.96em",
      "--tf-translation-line-height": "1.6",
      "--tf-translation-gap": "0.55em",
      "--tf-translation-padding": "0.08em 0",
      "--tf-translation-background": "transparent",
      "--tf-translation-border-width": "0px",
      "--tf-translation-border-color": "transparent",
      "--tf-translation-opacity": "0.9",
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
