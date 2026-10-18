(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app || app.modules.selectionDictionaryFirst) return;
  async function run(snapshot, task, load, onExplain = null) {
    app.modules.selectionPopover.showEmpty(snapshot, { titleKey: "content.rich.title", messageKey: "content.rich.querying", onExplain });
    const summary = await new Promise((resolve, reject) => {
      Promise.resolve(load({ eager: true, allowVocabularyFallback: true, onSettled: resolve })).catch(reject);
    });
    app.modules.tasks.assertActive(task);
    if (summary.cancelled) throw Object.assign(new Error("Selection changed"), { code: "CANCELLED" });
    if (!summary.hasHit) return false;
    app.modules.tasks.completeTask(task, { done: 1 });
    return true;
  }
  app.modules.selectionDictionaryFirst = { run };
})();
