(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || app.modules.selectionVocabularyBook) return;
  const { messages, sendRuntimeMessage } = app.modules.runtime;

  async function request(type, fields = {}) {
    let response;
    try { response = await sendRuntimeMessage({ type, ...fields }); }
    catch { throw Object.assign(new Error("VOCABULARY_DISCONNECTED"), { code: "VOCABULARY_DISCONNECTED" }); }
    if (!response?.ok) {
      const code = String(response?.errorCode || "VOCABULARY_UNAVAILABLE");
      throw Object.assign(new Error(code), { code });
    }
    return response;
  }

  function create() {
    return Object.freeze({
      async add(entry, event) {
        if (!event?.isTrusted || !entry) return { ignored: true };
        const response = await request(messages.background.VOCABULARY_BOOK_ADD, { entry });
        return { added: response.added === true, updated: response.updated === true };
      },
      async open(event) {
        if (!event?.isTrusted) return { ignored: true };
        await request(messages.background.VOCABULARY_BOOK_OPEN);
        return { opened: true };
      }
    });
  }

  app.modules.selectionVocabularyBook = Object.freeze({ create });
})();
