(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || app.modules.textProjectionPolicy) return;
  const { EXTENSION_UI_ATTR, TRANSLATION_CLASS } = app.modules.runtime.constants;
  const limits = Object.freeze({ sliceChars: 16000, sliceNodes: 500, sliceMs: 8, totalChars: 1000000, totalNodes: 25000, totalMs: 250 });
  const excludedTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "INPUT", "TEXTAREA", "SELECT", "OPTION"]);
  function owned(node) {
    let element = node?.nodeType === 1 ? node : node?.parentElement;
    for (let count = 0; element && count < limits.sliceNodes; count++, element = element.parentElement) {
      if (element.hasAttribute(EXTENSION_UI_ATTR) || element.classList.contains(TRANSLATION_CLASS)) return true;
    }
    return false;
  }
  function inspect(element) {
    if (element.hasAttribute(EXTENSION_UI_ATTR) || element.classList.contains(TRANSLATION_CLASS)) return { excluded: true };
    if (excludedTags.has(element.tagName) || element.isContentEditable || element.hasAttribute("data-tf-sensitive")) return { excluded: true, sensitive: true };
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return { excluded: true };
    const style = getComputedStyle(element);
    if (style.display === "none" || ["hidden", "collapse"].includes(style.visibility) || style.contentVisibility === "hidden" || Number(style.opacity) === 0) return { excluded: true };
    if (!["normal", "nowrap"].includes(style.whiteSpace)) return { unsupported: true, reason: "white-space" };
    return { block: style.display !== "contents" && !style.display.startsWith("inline"), excluded: false };
  }
  function rangePolicy(range, selectedText = "") {
    if (!range || !range.startContainer?.isConnected || !range.endContainer?.isConnected) return { supported: false, sensitive: true, reason: "detached" };
    try {
      if (window.top !== window || [range.startContainer, range.endContainer].some((node) => node.getRootNode() !== document)) {
        return { supported: false, sensitive: true, reason: "unsupported-root" };
      }
    } catch { return { supported: false, sensitive: true, reason: "unsupported-root" }; }
    for (const node of [range.startContainer, range.endContainer, range.commonAncestorContainer]) {
      if (node.assignedSlot) return { supported: false, sensitive: true, reason: "unsupported-slot" };
      let element = node.nodeType === 1 ? node : node.parentElement;
      let count = 0;
      while (element && count++ < limits.sliceNodes) {
        if (element.assignedSlot || element.tagName.includes("-")) return { supported: false, sensitive: true, reason: "unsupported-host" };
        const decision = inspect(element);
        if (decision.excluded || decision.unsupported) return { supported: false, sensitive: Boolean(decision.sensitive), reason: decision.reason || "excluded" };
        element = element.parentElement;
      }
      if (element) return { supported: false, sensitive: true, reason: "ancestor-budget" };
    }
    const active = document.activeElement;
    if (active?.matches?.("input,textarea") && Number(active.selectionEnd) > Number(active.selectionStart) &&
      app.modules.runtime.cleanText(active.value.slice(active.selectionStart, active.selectionEnd)) === app.modules.runtime.cleanText(selectedText)) {
      return { supported: false, sensitive: true, reason: "editable" };
    }
    return { supported: true, sensitive: false, reason: "" };
  }
  function sourceMutation(record) {
    if (owned(record.target)) return false;
    if (record.type === "characterData") return true;
    if (record.type === "childList") { for (const nodes of [record.addedNodes, record.removedNodes]) for (const node of nodes) if (!owned(node)) return true; return false; }
    if (record.attributeName === "class") {
      const normalize = (value) => String(value || "").split(/\s+/u).filter((part) => part && part !== "abt-hide-translations").sort().join(" ");
      return normalize(record.oldValue) !== normalize(record.target.getAttribute("class"));
    }
    return true;
  }
  app.modules.textProjectionPolicy = { inspect, owned, rangePolicy, sourceMutation, limits, projectionVersion: "tf-source-utf16-v1" };
})();
