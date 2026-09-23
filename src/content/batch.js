(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || !app?.modules.dom || app.modules.batch) return;

  const { constants, normalizeSourceText } = app.modules.runtime;
  const { extractSourceText, shouldTranslate } = app.modules.dom;
  const { TRANSLATED_ATTR, BATCH_MAX_ITEMS, BATCH_MAX_CHARS } = constants;

  function buildEntries(elements) {
    const entries = [];
    let nextId = 1;
    for (const el of elements) {
      if (!document.contains(el) || el.hasAttribute(TRANSLATED_ATTR)) continue;
      const text = extractSourceText(el);
      if (!shouldTranslate(text)) continue;
      entries.push({ id: String(nextId++), el, text, normalizedText: normalizeSourceText(text) });
    }
    return entries;
  }

  function groupEntriesByText(entries) {
    const byText = new Map();
    for (const entry of entries) {
      let group = byText.get(entry.normalizedText);
      if (!group) {
        group = {
          id: String(byText.size + 1),
          text: entry.text,
          normalizedText: entry.normalizedText,
          elements: []
        };
        byText.set(entry.normalizedText, group);
      }
      group.elements.push(entry.el);
    }
    return [...byText.values()];
  }

  function makeBatches(groups) {
    const batches = [];
    let current = [];
    let chars = 0;
    for (const group of groups) {
      const nextChars = chars + group.text.length;
      if (current.length && (current.length >= BATCH_MAX_ITEMS || nextChars > BATCH_MAX_CHARS)) {
        batches.push(current);
        current = [];
        chars = 0;
      }
      current.push(group);
      chars += group.text.length;
    }
    if (current.length) batches.push(current);
    return batches;
  }

  app.modules.batch = { buildEntries, groupEntriesByText, makeBatches };
})();
