(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app || app.modules.selectionAssistantPersistence) return;

  function create({ records, vocabularyBook, popover, isLive } = {}) {
    function attach(result, { targetLanguage, sourceLanguage, provenance, turn } = {}) {
      render(result, records && result.operation
        ? { state: "checking", messageKey: "content.reading.checkingAiSave", retryAvailable: false }
        : { state: "not-saved", messageKey: "content.reading.recordsUnavailable", retryAvailable: false });
      const accepted = records?.accept(result.queryRecord, { kind: "assistant", targetLanguage, provenance, payload: turn }, {
        key: result.operation?.operationId,
        operation: result.operation,
        sourceLanguage,
        onStatus: (view) => { if (isLive(result)) render(result, readingView(view)); },
        onSaved: (receipt) => saved(result, receipt)
      });
      if (!accepted && records && result.operation && isLive(result)) {
        render(result, { state: "not-saved", messageKey: "content.reading.unsupported", retryAvailable: false });
      }
      return accepted;
    }

    function readingView(view) {
      const messageKey = view?.state === "saving" ? "content.reading.savingAiAnswer"
        : view?.state === "saved" ? "content.reading.savedAiAnswer"
          : view?.state === "manual" ? "content.reading.aiReadyToSave"
            : view?.messageKey || "content.reading.unsupported";
      return { ...view, messageKey };
    }

    function render(result, reading) {
      if (!isLive(result)) return;
      const key = result.operation?.operationId;
      const state = {
        reading,
        onSaveReading: key ? (event) => records?.save(event, key) : null,
        onRetryReading: key ? (event) => records?.retry(event, key) : null,
        onOpenReading: (event) => records?.open(event),
        onSaveVocabulary: (event) => saveVocabulary(result, event),
        onOpenVocabulary: (event) => vocabularyBook.open(event)
      };
      if (!result.persistenceInitialized) {
        state.vocabulary = { available: isVocabularyNoteSelection(result.note.headword) };
        result.persistenceInitialized = true;
      }
      popover.showAiPersistence?.(state, result.action);
    }

    async function saveVocabulary(result, event) {
      if (!event?.isTrusted || !isLive(result)) return { ignored: true };
      const savedRef = result.readingRef;
      const response = await vocabularyBook.addAiNote({ ...result.note, readingRef: savedRef }, event);
      if (!isLive(result) || response?.ignored) return { ignored: true };
      result.wordbookSaved = true;
      if (result.readingRef && !sameReference(result.readingRef, savedRef)) {
        void vocabularyBook.syncAiNote({ ...result.note, readingRef: result.readingRef }).catch(() => {});
      }
      return response;
    }

    function saved(result, receipt) {
      if (!isLive(result)) return;
      result.readingRef = { recordId: receipt.recordId, artifactId: receipt.artifactId };
      if (result.wordbookSaved) {
        void vocabularyBook.syncAiNote({ ...result.note, readingRef: result.readingRef }).catch(() => {});
      }
    }

    return Object.freeze({ attach });
  }

  function isVocabularyNoteSelection(text) {
    const value = String(text || "").normalize("NFKC").trim();
    const tokens = value.match(/[\p{L}\p{N}+#.'’-]+/gu) || [];
    return Boolean(value && value.length <= 180 && tokens.length > 0 && tokens.length <= 6 &&
      !/[\n\r。！？!?](?:["')\]}”’]*)$/u.test(value));
  }

  function sameReference(left, right) {
    return left?.recordId === right?.recordId && left?.artifactId === right?.artifactId;
  }

  app.modules.selectionAssistantPersistence = Object.freeze({ create, isVocabularyNoteSelection });
})();
