(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (
    !app?.modules.runtime
    || !app?.modules.selectionPopover
    || app.modules.selectionRichDetails
  ) return;

  const { messages, sendRuntimeMessage } = app.modules.runtime;
  const popover = app.modules.selectionPopover;

  async function load(snapshot, version, expectedPage, isCurrentSelection) {
    try {
      const response = await sendRuntimeMessage({
        type: messages.background.RICH_MDICT_VIEWER_LIST
      });
      if (!isCurrentSelection(version, snapshot, expectedPage) || !response?.ok) return;

      const dictionaries = Array.isArray(response.dictionaries) ? response.dictionaries : [];
      const lookupStates = new Map();
      popover.appendRichDictionaryCards(dictionaries, (dictionary, card) => {
        void lookupDictionary(dictionary, card, lookupStates);
      });
    } catch {
      // Detailed dictionary reads do not delay or replace the primary result.
    }

    async function lookupDictionary(dictionary, card, lookupStates) {
      const dictionaryId = String(dictionary?.id || "");
      if (!isCurrentSelection(version, snapshot, expectedPage) || !dictionaryId) return;

      if (dictionary?.status && dictionary.status !== "ready") {
        let state = lookupStates.get(dictionaryId);
        if (state?.settled) return;
        if (!state) {
          state = { inFlight: false, settled: true };
          lookupStates.set(dictionaryId, state);
        } else {
          state.settled = true;
        }
        const status = String(dictionary.status).slice(0, 48);
        const code = safeErrorCode(dictionary.errorCode);
        const detail = code || status;
        card.setError(`该词典当前不可读取${detail ? `（${detail}）` : ""}。`);
        return;
      }

      let state = lookupStates.get(dictionaryId);
      if (!state) {
        state = { inFlight: false, settled: false };
        lookupStates.set(dictionaryId, state);
      }
      const request = async (retry = false) => {
        if (!isCurrentSelection(version, snapshot, expectedPage)) return;
        if (state.inFlight || (state.settled && !retry)) return;
        state.inFlight = true;
        card.setLoading();
        try {
          const result = await sendRuntimeMessage({
            type: messages.background.RICH_MDICT_LOOKUP,
            text: snapshot.text,
            dictionaryId
          });
          if (!isCurrentSelection(version, snapshot, expectedPage)) return;

          const lookupError = Array.isArray(result?.errors) ? result.errors[0] : null;
          if (!result?.ok || lookupError) {
            state.settled = true;
            card.setError(
              `该词典暂时无法读取${safeErrorCode(result?.errorCode || lookupError?.code)
                ? `（${safeErrorCode(result?.errorCode || lookupError?.code)}）`
                : ""}。`,
              () => { void request(true); }
            );
            return;
          }

          const records = Array.isArray(result.dictionaries) ? result.dictionaries : [];
          const record = records.find((item) => String(item?.id || "") === dictionaryId);
          if (result.found && records.length && !record) {
            state.settled = true;
            card.setError("返回的词典结果与本卡片不匹配。");
            return;
          }
          if (!result.found || !record) {
            state.settled = true;
            card.setEmpty();
            return;
          }

          state.settled = true;
          card.setResult(record, dictionaryId);
        } catch {
          if (!isCurrentSelection(version, snapshot, expectedPage)) return;
          state.settled = true;
          card.setError("该词典暂时无法读取。", () => { void request(true); });
        } finally {
          state.inFlight = false;
        }
      };

      void request();
    }
  }

  function safeErrorCode(value) {
    return String(value || "")
      .replace(/[\u0000-\u001f\u007f]/gu, " ")
      .trim()
      .slice(0, 64);
  }

  app.modules.selectionRichDetails = Object.freeze({ load });
})();
