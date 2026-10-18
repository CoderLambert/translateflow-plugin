(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.uiPrimitives || !app?.modules.contentI18n || app.modules.selectionAiPersistenceView) return;
  const { button } = app.modules.uiPrimitives;
  const locale = app.modules.contentI18n;

  function create({ onResize } = {}) {
    let state = null;
    function reset(target) {
      const existing = target?.querySelector?.(":scope > .tf-selection-ai-persistence");
      if (existing) { locale.unbindTree(existing); existing.remove(); }
      state = null;
    }
    function update(target, next = {}) {
      state = { ...(state || {}), ...next,
        reading: next.reading === undefined ? state?.reading : next.reading,
        vocabulary: next.vocabulary === undefined ? state?.vocabulary : next.vocabulary };
      render(target);
    }
    function render(target) {
      const existing = target?.querySelector?.(":scope > .tf-selection-ai-persistence");
      if (existing) { locale.unbindTree(existing); existing.remove(); }
      if (!target || target.dataset.state !== "success" || !state) return;
      const section = document.createElement("section");
      section.className = "tf-selection-ai-persistence";
      const reading = state.reading;
      if (reading?.messageKey) {
        const status = document.createElement("div");
        status.className = "tf-selection-ai-save-status";
        status.dataset.state = String(reading.state || "idle");
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        locale.bindText(status, reading.messageKey, reading.messageArgs || {});
        section.appendChild(status);
      }
      const actions = document.createElement("div");
      actions.className = "tf-selection-ai-save-actions";
      if (reading?.state === "manual" && typeof state.onSaveReading === "function") {
        actions.appendChild(actionButton("content.reading.saveToLearningCenter", state.onSaveReading, "tf-selection-ai-save-reading"));
      } else if ((reading?.state === "invite" || reading?.state === "disabled") && reading.openAvailable &&
          typeof state.onOpenReading === "function") {
        actions.appendChild(actionButton("content.reading.saveToLearningCenter", state.onOpenReading, "tf-selection-ai-save-reading"));
      }
      if (reading?.retryAvailable && typeof state.onRetryReading === "function") {
        actions.appendChild(actionButton("content.reading.retrySave", state.onRetryReading, "tf-selection-ai-retry-reading"));
      }
      if (reading?.state === "saved" && typeof state.onOpenReading === "function") {
        actions.appendChild(actionButton("content.reading.openLearningCenter", state.onOpenReading, "tf-selection-ai-open-reading"));
      }
      const vocabulary = state.vocabulary;
      if (vocabulary?.available && vocabulary.state !== "saved" && typeof state.onSaveVocabulary === "function") {
        const vocabularyActionKey = vocabulary.state === "failed" ? "content.reading.retrySave" : "content.vocabulary.addAiNote";
        const saveVocabulary = actionButton(vocabularyActionKey, async (event) => {
          const handler = state.onSaveVocabulary, request = {};
          state = { ...state, vocabularyRequest: request,
            vocabulary: { ...vocabulary, state: "saving", messageKey: "content.vocabulary.savingAiNote" } };
          render(target);
          try {
            const result = await handler(event);
            if (state?.vocabularyRequest !== request) return;
            if (result?.ignored) return;
            state = { ...state, vocabulary: { ...vocabulary, state: "saved",
              messageKey: result?.updated ? "content.vocabulary.updatedAiNote" : "content.vocabulary.savedAiNote" } };
          } catch (error) {
            if (state?.vocabularyRequest !== request) return;
            const messageKey = error?.code === "VOCABULARY_CAPACITY" ? "content.vocabulary.full"
              : error?.code === "VOCABULARY_STORAGE" ? "content.vocabulary.storageError"
                : "content.vocabulary.saveAiNoteError";
            state = { ...state, vocabulary: { ...vocabulary, state: "failed", messageKey } };
          }
          render(target);
        }, "tf-selection-ai-save-vocabulary");
        saveVocabulary.disabled = vocabulary.state === "saving";
        actions.appendChild(saveVocabulary);
      } else if (vocabulary?.state === "saved" && typeof state.onOpenVocabulary === "function") {
        actions.appendChild(actionButton("content.vocabulary.open", state.onOpenVocabulary, "tf-selection-ai-open-vocabulary"));
      }
      if (actions.childElementCount) section.appendChild(actions);
      if (vocabulary?.messageKey) {
        const status = document.createElement("div");
        status.className = "tf-selection-ai-save-status";
        status.dataset.state = vocabulary.state || "idle";
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        locale.bindText(status, vocabulary.messageKey);
        section.appendChild(status);
      }
      target.appendChild(section);
      onResize?.();
    }
    return Object.freeze({ reset, update, render });
  }

  function actionButton(key, handler, className) {
    const control = button({ text: locale.t(key), className: `tf-selection-action-quiet ${className}` });
    locale.bindText(control, key);
    control.addEventListener("click", (event) => handler?.(event));
    return control;
  }

  app.modules.selectionAiPersistenceView = Object.freeze({ create });
})();
