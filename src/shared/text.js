export function normalizeSourceText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}
