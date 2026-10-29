(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || !app?.modules.dom || app.modules.batch) return;
  const { constants, normalizeSourceText } = app.modules.runtime;
  const { extractSourceSegment, shouldTranslate } = app.modules.dom;
  const { TRANSLATED_ATTR, BATCH_MAX_ITEMS, BATCH_MAX_CHARS } = constants;

  function buildEntries(elements) {
    const entries = [];
    let nextId = 1;
    for (const el of elements) {
      if (!document.contains(el) || el.hasAttribute(TRANSLATED_ATTR)) continue;
      const source = extractSourceSegment(el), text = source.text;
      const visibleText = source.rich ? text.replace(/⟦TF:[^⟧]*⟧/g, "") : text;
      if (!shouldTranslate(visibleText)) continue;
      entries.push({ id: String(nextId++), el, text, rich: source.rich,
        normalizedText: normalizeSourceText(text),
        // Capture protection with the same source snapshot, not a later live DOM read.
        protectedIds: (source.descriptors || []).flatMap((item, index) => item.protectedText != null ? [index] : []) });
    }
    return entries;
  }

  function groupEntriesByText(entries) {
    const byText = new Map();
    for (const entry of entries) {
      // Execution equivalence is exact source + format + protected content policy.
      // Cosmetic normalization is only retained for the existing stale-DOM check.
      const groupKey = JSON.stringify([entry.text, entry.rich === true, entry.protectedIds || []]);
      let group = byText.get(groupKey);
      if (!group) {
        group = { id: String(byText.size + 1), text: entry.text, normalizedText: entry.normalizedText,
          rich: entry.rich, protectedIds: entry.protectedIds || [], elements: [] };
        byText.set(groupKey, group);
      }
      group.elements.push(entry.el);
    }
    return [...byText.values()];
  }

  function makeBatches(groups, limits = {}) {
    const batches = [];
    let current = [], chars = 0;
    for (const group of groups) {
      const nextChars = chars + group.text.length;
      if (current.length && (current.length >= (limits.maxItems || BATCH_MAX_ITEMS) || nextChars > (limits.maxChars || BATCH_MAX_CHARS))) {
        batches.push(current); current = []; chars = 0;
      }
      current.push(group); chars += group.text.length;
    }
    if (current.length) batches.push(current);
    return batches;
  }

  // The first batch is deliberately small: it is one provider round trip, and it
  // is what the reader sees first. Everything after it uses the normal limits.
  function makeBatchesHeadFirst(groups, headItems = 8) {
    if (!Array.isArray(groups) || groups.length <= headItems) return makeBatches(groups);
    const head = makeBatches(groups.slice(0, headItems), { maxItems: headItems });
    return [...head, ...makeBatches(groups.slice(headItems))];
  }

  // Readers look at one screen first. Order the work by what is on (or near) that
  // screen so the first batches cover visible text instead of paragraph 1..18 of a
  // long article. Everything else keeps its document order.
  function prioritizeVisibleGroups(groups, { viewportHeight = 0, measure = null } = {}) {
    if (!Array.isArray(groups) || groups.length < 2) return Array.isArray(groups) ? groups : [];
    const limit = Math.max(0, Number(viewportHeight) || 0) * 1.5;
    if (!limit) return groups;
    const read = measure || (element => { try { return element.getBoundingClientRect(); } catch { return null; } });
    const near = [], rest = [];
    for (const group of groups) {
      let distance = Infinity;
      for (const element of group.elements || []) {
        const rect = read(element);
        if (!rect) continue;
        if (rect.bottom < -limit || rect.top > limit) continue;
        distance = Math.min(distance, Math.abs(rect.top));
      }
      if (distance === Infinity) rest.push(group);
      else near.push({ group, distance });
    }
    near.sort((a, b) => a.distance - b.distance);
    return [...near.map(item => item.group), ...rest];
  }
  app.modules.batch = { buildEntries, groupEntriesByText, makeBatches, makeBatchesHeadFirst, prioritizeVisibleGroups };
})();
