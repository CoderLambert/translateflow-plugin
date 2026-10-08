(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.contentI18n || !app?.modules.uiPrimitives || app.modules.selectionVocabularyActions) return;

  const locale = app.modules.contentI18n;
  const { button } = app.modules.uiPrimitives;

  function create({ onResize = () => {} } = {}) {
    let actions, addButton, openButton, statusNode;
    let saveHandler, openHandler, isCurrent;

    function ensure() {
      if (actions) return actions;
      actions = document.createElement("div");
      actions.className = "tf-selection-vocabulary-actions";
      actions.hidden = true;
      addButton = button({ text: locale.t("content.vocabulary.add"), className: "tf-selection-action-primary tf-selection-vocabulary-add" });
      locale.bindText(addButton, "content.vocabulary.add");
      addButton.addEventListener("click", save);
      openButton = button({ text: locale.t("content.vocabulary.open"), className: "tf-selection-action-quiet tf-selection-vocabulary-open" });
      locale.bindText(openButton, "content.vocabulary.open");
      openButton.hidden = true;
      openButton.addEventListener("click", open);
      statusNode = document.createElement("div");
      statusNode.className = "tf-selection-vocabulary-status";
      statusNode.setAttribute("role", "status");
      statusNode.setAttribute("aria-live", "polite");
      statusNode.hidden = true;
      actions.append(addButton, openButton, statusNode);
      return actions;
    }

    function show({ onSave, onOpen, current } = {}) {
      ensure();
      saveHandler = typeof onSave === "function" ? onSave : null;
      openHandler = typeof onOpen === "function" ? onOpen : null;
      isCurrent = typeof current === "function" ? current : () => true;
      actions.hidden = !saveHandler;
      addButton.hidden = !saveHandler;
      addButton.disabled = false;
      openButton.hidden = true;
      openButton.disabled = false;
      setStatus("");
    }

    async function save(event) {
      const handler = saveHandler, active = isCurrent;
      if (!event?.isTrusted || !handler || !addButton) return;
      addButton.disabled = true;
      setStatus("content.vocabulary.saving");
      try {
        const result = await handler(event);
        if (active !== isCurrent || !active() || !actions?.isConnected || result?.ignored) return;
        addButton.hidden = true;
        openButton.hidden = false;
        setStatus(result?.added ? "content.vocabulary.saved" : result?.updated ? "content.vocabulary.updatedSaved" : "content.vocabulary.alreadySaved");
      } catch (error) {
        if (active !== isCurrent || !active() || !actions?.isConnected) return;
        addButton.disabled = false;
        const key = error?.code === "VOCABULARY_CAPACITY" ? "content.vocabulary.full"
          : error?.code === "VOCABULARY_STORAGE" ? "content.vocabulary.storageError"
            : "content.vocabulary.saveError";
        setStatus(key);
      }
      onResize();
    }

    async function open(event) {
      const handler = openHandler, active = isCurrent;
      if (!event?.isTrusted || !handler || !openButton) return;
      openButton.disabled = true;
      try {
        await handler(event);
        if (active === isCurrent && active() && actions?.isConnected) setStatus("content.vocabulary.opened");
      } catch {
        if (active === isCurrent && active() && actions?.isConnected) setStatus("content.vocabulary.openError");
      } finally {
        if (active === isCurrent && active() && openButton?.isConnected) openButton.disabled = false;
      }
    }

    function setStatus(key) {
      if (!statusNode) return;
      locale.unbind(statusNode);
      statusNode.textContent = "";
      statusNode.hidden = !key;
      if (key) locale.bindText(statusNode, key);
    }

    function hide() { if (actions) actions.hidden = true; }
    function reset() { saveHandler = openHandler = isCurrent = null; hide(); }
    function dispose() {
      if (actions) { locale.unbindTree(actions); actions.remove(); }
      reset(); actions = addButton = openButton = statusNode = null;
    }

    return Object.freeze({ ensure, show, hide, reset, dispose });
  }

  app.modules.selectionVocabularyActions = Object.freeze({ create });
})();
