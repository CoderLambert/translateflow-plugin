(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app || app.modules.selectionMessages) return;

  function unresolvedMessage(resolved) {
    if (resolved?.routeReason === "ambiguous-local-unresolved") {
      return "content.selection.unreliable";
    }
    if (resolved?.routeReason === "local-error") {
      const code = resolved?.decision?.error?.code || "";
      if (code === "LEXICON_STORAGE") {
        return "content.selection.lexiconMissing";
      }
      if (code === "LEXICON_CORRUPT") {
        return "content.selection.lexiconInvalid";
      }
      if (code === "LEXICON_INCOMPATIBLE") {
        return "content.selection.lexiconIncompatible";
      }
      return "content.selection.lexiconUnavailable";
    }
    return "content.selection.unresolved";
  }

  app.modules.selectionMessages = Object.freeze({ unresolvedMessage });
})();
