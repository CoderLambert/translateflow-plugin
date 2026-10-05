(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.contentI18n || app.modules.selectionClipboard) return;

  async function writeText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = String(text || "");
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.setAttribute("data-tf-extension-ui", "selection-copy");
    document.documentElement.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw Object.assign(new Error(app.modules.contentI18n.t("content.selection.copyDenied")), { i18nKey: "content.selection.copyDenied" });
  }

  app.modules.selectionClipboard = Object.freeze({ writeText });
})();
