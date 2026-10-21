(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.subtitleSource || app.modules.youtubeCaptionDom) return;
  const { cleanCueText } = app.modules.subtitleSource;
  const CAPTION_CONTAINER_SELECTORS = Object.freeze(["#ytp-caption-window-container", ".ytp-caption-window-container"]);
  const CAPTION_SEGMENT_SELECTORS = Object.freeze([".ytp-caption-segment", ".caption-visual-line", ".captions-text span"]);

  // DOM fallback and native-caption visibility share one owner, without listeners.
  function createCaptionDom(doc) {
    const hidden = new Map();
    function readCues() {
      for (const selector of CAPTION_CONTAINER_SELECTORS) {
        const container = doc.querySelector?.(selector);
        if (!container) continue;
        for (const segmentSelector of CAPTION_SEGMENT_SELECTORS) {
          const nodes = Array.from(container.querySelectorAll?.(segmentSelector) || []);
          const text = cleanCueText(nodes.map(node => node?.textContent).filter(Boolean).join(" "));
          // Selectors are alternatives: parents and children duplicate words.
          if (text) return [{ id: "yt:dom:0", startTime: null, endTime: null, text }];
        }
        const text = cleanCueText(container.textContent || "");
        if (text) return [{ id: "yt:dom:0", startTime: null, endTime: null, text }];
      }
      return [];
    }
    function restoreNode(node, visibility) {
      if (node.style) node.style.visibility = visibility || "";
      node.removeAttribute?.("data-tf-native-caption-hidden");
      hidden.delete(node);
    }
    function suppress(playerRoot) {
      // Do not retain replaced caption containers throughout a viewing session.
      for (const [node, visibility] of hidden) {
        if (node.isConnected === false) restoreNode(node, visibility);
      }
      for (const root of [playerRoot, doc]) {
        for (const selector of CAPTION_CONTAINER_SELECTORS) {
          const node = root?.querySelector?.(selector);
          if (!node || hidden.has(node)) continue;
          if (node.style) { hidden.set(node, node.style.visibility); node.style.visibility = "hidden"; }
          node.setAttribute?.("data-tf-native-caption-hidden", "true");
        }
      }
    }
    function restore() { for (const [node, visibility] of hidden) restoreNode(node, visibility); }
    return { readCues, suppress, restore };
  }
  app.modules.youtubeCaptionDom = { CAPTION_CONTAINER_SELECTORS, CAPTION_SEGMENT_SELECTORS, createCaptionDom };
})();
