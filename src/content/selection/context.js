(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.selectionSourceSnapshot || !app?.modules.selection || app.modules.selectionContext) return;
  function captureSelectionContext(snapshot, options) {
    if (!snapshot?.range || !snapshot.text) return { text: "", sensitive: false, source: "none", truncated: false };
    return snapshot.sourceCapture?.context || app.modules.selectionSourceSnapshot.capture(snapshot, options).context;
  }
  function isSensitiveRange(range, selectedText) { return app.modules.textProjectionPolicy.rangePolicy(range, selectedText).sensitive; }
  app.modules.selectionContext = { captureSelectionContext, isSensitiveRange };
})();
