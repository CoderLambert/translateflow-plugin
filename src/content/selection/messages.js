(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app || app.modules.selectionMessages) return;

  function unresolvedMessage(resolved) {
    if (resolved?.routeReason === "ambiguous-local-unresolved") {
      return "本地词典无法确定可靠候选；如需进一步判断，可点击“AI 详解”。";
    }
    if (resolved?.routeReason === "local-error") {
      const code = resolved?.decision?.error?.code || "";
      if (code === "LEXICON_STORAGE") {
        return "内置本地词典资源缺失或不可读。请在 TranslateFlow 设置 > 本地词典检查状态。";
      }
      if (code === "LEXICON_CORRUPT") {
        return "内置本地词典校验失败。请在 TranslateFlow 设置 > 本地词典检查状态。";
      }
      if (code === "LEXICON_INCOMPATIBLE") {
        return "内置本地词典与当前扩展版本不兼容。请在 TranslateFlow 设置 > 本地词典检查状态，并更新扩展或重新安装词典资源。";
      }
      return "本地词典暂时不可用，请重试。";
    }
    return "暂时无法确定该选段的含义。";
  }

  app.modules.selectionMessages = Object.freeze({ unresolvedMessage });
})();
