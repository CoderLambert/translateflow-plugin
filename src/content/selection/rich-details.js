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
        type: messages.background.RICH_MDICT_LOOKUP,
        text: snapshot.text
      });
      if (!isCurrentSelection(version, snapshot, expectedPage) || !response?.ok) return;
      popover.appendRichDictionaryDetails(response);
    } catch {
      // Detailed dictionary reads do not delay or replace the primary result.
    }
  }

  app.modules.selectionRichDetails = Object.freeze({ load });
})();
