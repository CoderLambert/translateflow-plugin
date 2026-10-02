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
    if (element.assignedSlot || element.shadowRoot || element.tagName === "SLOT" || element.tagName.includes("-")) return { unsupported: true, sensitive: true, reason: "unsupported-host" };
    // shadowRoot alone cannot prove that a native host has no closed root.
    // Inspect only the presence of a root, never its private contents.
    try {
      const dom = globalThis.chrome?.dom;
      if (typeof dom?.openOrClosedShadowRoot !== "function") return { unsupported: true, sensitive: true, reason: "shadow-proof-unavailable" };
      const root = dom.openOrClosedShadowRoot(element);
      if (root === undefined) return { unsupported: true, sensitive: true, reason: "shadow-proof-unavailable" };
      if (root !== null) return { unsupported: true, sensitive: true, reason: "unsupported-host" };
    } catch { return { unsupported: true, sensitive: true, reason: "shadow-proof-unavailable" }; }
    if (excludedTags.has(element.tagName) || element.isContentEditable || element.hasAttribute("data-tf-sensitive")) return { excluded: true, sensitive: true };
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return { excluded: true };
    const style = getComputedStyle(element);
    if (style.display === "none" || ["hidden", "collapse"].includes(style.visibility) || style.contentVisibility === "hidden" || Number(style.opacity) === 0) return { excluded: true };
    if (!["normal", "nowrap"].includes(style.whiteSpace)) return { unsupported: true, reason: "white-space" };
    return { block: style.display !== "contents" && !style.display.startsWith("inline"), excluded: false };
  }
  function createSliceBudget(clock = () => performance.now()) {
    const started = clock();
    return { clock, started, deadline: started + limits.sliceMs, nodes: 0, chars: 0 };
  }
  const timeExpired = (budget) => budget.clock() >= budget.deadline;
  function rangePolicy(range, selectedText = "", { budget = createSliceBudget() } = {}) {
    if (budget.nodes >= limits.sliceNodes || timeExpired(budget)) return { supported: false, sensitive: true, reason: "range-budget" };
    if (!range || !range.startContainer?.isConnected || !range.endContainer?.isConnected) return { supported: false, sensitive: true, reason: "detached" };
    try {
      if (window.top !== window || [range.startContainer, range.endContainer].some((node) => node.getRootNode() !== document)) {
        return { supported: false, sensitive: true, reason: "unsupported-root" };
      }
    } catch { return { supported: false, sensitive: true, reason: "unsupported-root" }; }
    let supported = true, sensitive = false, reason = "";
    const exhausted = () => budget.nodes >= limits.sliceNodes || timeExpired(budget);
    const deny = (decision) => { supported = false; sensitive ||= Boolean(decision.sensitive); reason ||= decision.reason || "excluded"; };
    for (const node of [range.startContainer, range.endContainer, range.commonAncestorContainer]) {
      if (node.assignedSlot) deny({ sensitive: true, reason: "unsupported-slot" });
      let element = node.nodeType === 1 ? node : node.parentElement;
      while (element) {
        if (exhausted()) return { supported: false, sensitive: true, reason: "range-budget" };
        budget.nodes++;
        const decision = inspect(element);
        if (timeExpired(budget)) return { supported: false, sensitive: true, reason: "range-budget" };
        if (decision.excluded || decision.unsupported) deny(decision);
        element = element.parentElement;
      }
    }
    const active = document.activeElement;
    if (active?.matches?.("input,textarea") && Number(active.selectionEnd) > Number(active.selectionStart) &&
      app.modules.runtime.cleanText(active.value.slice(active.selectionStart, active.selectionEnd)) === app.modules.runtime.cleanText(selectedText)) {
      deny({ sensitive: true, reason: "editable" });
    }
    if (supported) {
      const interior = rangeInterior(range, budget);
      if (!interior.supported) deny(interior);
    }
    return { supported, sensitive, reason };
  }
  function rangeInterior(range, budget) {
    const root = range.commonAncestorContainer;
    if (root.nodeType === 3) return { supported: true };
    const stack = [{ node: root, entered: false }];
    while (stack.length) {
      if (budget.nodes >= limits.sliceNodes || timeExpired(budget)) return { supported: false, sensitive: true, reason: "range-budget" };
      const frame = stack.at(-1), node = frame.node;
      if (!frame.entered) {
        budget.nodes++; frame.entered = true;
        let intersects;
        try { intersects = range.intersectsNode(node); } catch { return { supported: false, sensitive: true, reason: "unknown-range" }; }
        if (intersects) {
          if (node.assignedSlot) return { supported: false, sensitive: true, reason: "unsupported-slot" };
          if (node.nodeType === 1) {
            const decision = inspect(node);
            if (timeExpired(budget)) return { supported: false, sensitive: true, reason: "range-budget" };
            if (decision.unsupported || decision.excluded) return { supported: false, sensitive: true, reason: decision.reason || "excluded-interior" };
          }
          frame.child = node.firstChild;
        }
      }
      if (frame.child) { const child = frame.child; frame.child = child.nextSibling; stack.push({ node: child, entered: false }); }
      else stack.pop();
    }
    return { supported: true };
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
  app.modules.textProjectionPolicy = { inspect, owned, rangePolicy, sourceMutation, createSliceBudget, timeExpired, limits, projectionVersion: "tf-source-utf16-v1" };
})();
