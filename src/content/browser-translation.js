(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.browserTranslationContract || app.modules.browserTranslation) return;
  const { createBrowserNativeRuntime, withSharedNativeHost, BROWSER_TRANSLATION_ACTIONS: actions } = app.modules.browserTranslationContract;
  const local = createBrowserNativeRuntime(globalThis);
  const engine = typeof globalThis.chrome?.runtime?.connect === "function" ? withSharedNativeHost(local, chrome.runtime) : local;
  function dispatch(action, input = {}) {
    if (action === actions.CAPABILITY) return engine.capability(input);
    if (action === actions.PREPARE) return engine.prepare(input.pair, input);
    if (action === actions.EXECUTE) return engine.execute(input);
    if (action === actions.CANCEL) return engine.dispose();
    throw engine.error("BROWSER_UNAVAILABLE");
  }
  app.modules.browserTranslation = { ...engine, local, dispatch };
})();
