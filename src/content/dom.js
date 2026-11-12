(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || app.modules.dom) return;
  // An already registered pre-bundle script list cannot acquire new modules.
  // Preserve the refresh path without running a second extraction algorithm.
  if (!app.modules.pageDiscovery) {
    const unavailable = () => { throw Object.assign(new Error('扩展已更新，请刷新网页后重试。'), { code: 'EXTENSION_CONTEXT_INVALIDATED' }); };
    app.modules.dom = { collectUnitsAsync: async () => unavailable(), collectElements: () => [],
      isUnitCurrent: () => false, hasTranslation: () => false, getTranslationNode: () => null,
      extractSourceSegment: () => ({ text: '', rich: false }), shouldTranslate: () => false,
      insertTranslation: () => false, clearTranslations() {}, removeTranslationFromElement() {},
      isTranslationNode: () => false, setTranslationsHidden() {}, translationCount: () => 0 };
    return;
  }
  const discovery = app.modules.pageDiscovery, units = app.modules.pageUnits, policy = app.modules.pagePolicy;
  const source = target => target?.source || app.modules.structured.encodeElement(target);
  function shouldTranslate(text) {
    return policy.textDecision(text).status === 'eligible';
  }
  // Element helpers are kept for callers outside the page pipeline. Discovery,
  // batching and rendering use the same unit service in every translation mode.
  function collectElements(subtree) { return [...new Set(discovery.collectUnits({ subtree }).map(unit => unit.owner))]; }
  function asUnit(target) {
    if (target?.parts) return target;
    return discovery.collectUnits({ subtree: target }).find(unit => unit.owner === target);
  }
  const findCandidateElement = element => discovery.collectUnits().find(unit => unit.parts.some(part => policy.contains(element, part.node)))?.owner || null;
  app.modules.dom = {
    ...discovery,
    translationCount: units.translationCount,
    collectElements,
    isCandidateElement: element => collectElements().includes(element),
    findCandidateElement,
    extractSourceSegment: source,
    extractSourceText: target => app.modules.structured.stripMarkers(source(target).text),
    shouldTranslate,
    isUnitCurrent: units.isCurrent,
    hasTranslation: target => Boolean(units.getTranslationNode(target)),
    getTranslationNode: units.getTranslationNode,
    insertTranslation: (target, translation, engine) => units.insertTranslation(asUnit(target), translation, engine),
    removeTranslationFromElement: units.removeTranslationFromElement,
    clearTranslations: units.clearTranslations,
    setTranslationsHidden: units.setTranslationsHidden,
    isTranslationNode: policy.ownNode
  };
})();
