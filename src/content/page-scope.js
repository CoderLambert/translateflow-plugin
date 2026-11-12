(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.dom || app.modules.pageScope) return;
  const { state, messages, sendRuntimeMessage } = app.modules.runtime;
  let ready = null, revision = 0;
  function apply(value) {
    revision++;
    const next = value === 'all' ? 'all' : 'content';
    if (next === (state.pageScope || 'content')) return;
    state.pageScope = next;
    app.modules.dom.clearTranslations();
    app.modules.pageObserver?.reset();
    const task = app.modules.tasks?.getLatestTask();
    if (task && ["page", "auto"].includes(task.surface) && !app.modules.tasks.isTerminal(task)) app.modules.tasks.cancelTask(task.id).catch(() => {});
  }
  function load() {
    if (!ready) {
      const expected = revision;
      ready = sendRuntimeMessage({ type: messages.background.PUBLIC_SETTINGS_GET })
        .then(response => { if (expected === revision) apply(response?.settings?.pageTranslationScope); })
        .catch(error => { ready = null; throw error; });
    }
    return ready;
  }
  app.modules.pageScope = { load, apply };
})();
