export const PRESET_IDS = Object.freeze({
  TECHNICAL: "technical",
  ACADEMIC: "academic",
  NEWS: "news",
  NATURAL: "natural"
});

export const TRANSLATION_PRESETS = Object.freeze([
  Object.freeze({
    id: PRESET_IDS.TECHNICAL,
    label: "Technical",
    description: "技术文档 / API / 工程内容",
    instructions: Object.freeze([
      "Use precise technical terminology and keep established domain terms consistent.",
      "Preserve product names, API names, identifiers, commands, file paths and code-like tokens exactly when they should not be translated.",
      "Prefer clarity and semantic fidelity over stylistic rewriting."
    ])
  }),
  Object.freeze({
    id: PRESET_IDS.ACADEMIC,
    label: "Academic",
    description: "论文 / 研究 / 学术内容",
    instructions: Object.freeze([
      "Use a formal academic register while preserving the author's degree of certainty and hedging.",
      "Preserve citations, symbols, terminology, definitions and logical relationships precisely.",
      "Do not simplify technical claims or add conclusions that are not present in the source."
    ])
  }),
  Object.freeze({
    id: PRESET_IDS.NEWS,
    label: "News",
    description: "新闻 / 报道 / 时事文章",
    instructions: Object.freeze([
      "Use clear, neutral journalistic language.",
      "Preserve names, dates, numbers, quotations and attribution accurately.",
      "Avoid embellishment, sensational wording or interpretation beyond the source."
    ])
  }),
  Object.freeze({
    id: PRESET_IDS.NATURAL,
    label: "Natural",
    description: "日常阅读 / 流畅自然表达",
    instructions: Object.freeze([
      "Produce fluent and idiomatic target-language prose while preserving the original meaning and tone.",
      "Avoid awkward word-for-word phrasing when a natural equivalent is available.",
      "Do not omit factual details or add explanations."
    ])
  })
]);

const PRESET_MAP = new Map(TRANSLATION_PRESETS.map((preset) => [preset.id, preset]));

export function normalizePresetId(value) {
  const id = String(value || "").trim().toLowerCase();
  return PRESET_MAP.has(id) ? id : "";
}

export function isPresetId(value) {
  return Boolean(normalizePresetId(value));
}

export function getPreset(value) {
  return PRESET_MAP.get(normalizePresetId(value)) || null;
}

export function getPresetLabel(value) {
  return getPreset(value)?.label || "";
}

export function composePresetPrompt(prompt, presetId) {
  const preset = getPreset(presetId);
  if (!preset) return String(prompt || "");

  return [
    String(prompt || "").trim(),
    `Translation style preset: ${preset.label}.`,
    ...preset.instructions.map((instruction) => `- ${instruction}`)
  ].filter(Boolean).join("\n");
}
