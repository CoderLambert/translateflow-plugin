(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || app.modules.appearance) return;

  const { messages, sendRuntimeMessage } = app.modules.runtime;
  const appliedVariables = new Set();
  let current = null;
  let refreshVersion = 0;

  async function refresh() {
    const version = ++refreshVersion;
    const response = await sendRuntimeMessage({
      type: messages.background.EFFECTIVE_CONTEXT,
      pageUrl: location.href
    });
    if (version !== refreshVersion) return current;
    if (!response?.ok) throw new Error(response?.error || "读取阅读外观失败。");

    applyContext(response.context || {});
    return current;
  }

  function applyContext(context) {
    const variables = context?.appearanceVariables && typeof context.appearanceVariables === "object"
      ? context.appearanceVariables
      : {};

    for (const name of [...appliedVariables]) {
      if (!(name in variables)) {
        document.documentElement.style.removeProperty(name);
        appliedVariables.delete(name);
      }
    }

    for (const [name, value] of Object.entries(variables)) {
      if (!/^--tf-translation-[a-z-]+$/.test(name)) continue;
      document.documentElement.style.setProperty(name, String(value), "important");
      appliedVariables.add(name);
    }

    current = {
      id: String(context.appearanceId || "standard"),
      label: String(context.appearanceLabel || "Standard"),
      source: String(context.appearanceSource || "default")
    };
  }

  function start() {
    refresh().catch(() => {
      // CSS fallbacks keep Standard readable if background context is temporarily unavailable.
    });
  }

  function getState() {
    return current ? { ...current } : null;
  }

  app.modules.appearance = { start, refresh, getState, applyContext };
})();
