(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.contentI18n || app.modules.selectionMethodControls) return;
  const locale = app.modules.contentI18n;
  const button = options => app.modules.uiPrimitives.button(options);
  const text = (tag, className, value) => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = value;
    return node;
  };

  function render(panel, snapshot, routingHandler, chip) {
    if (!panel) return;
    const current = snapshot.temporaryMethod || snapshot.resolvedMethod || "";
    const key = `${snapshot.selectionGeneration}:${snapshot.selectionKind}:${current}:${locale.get?.().locale || ""}`;
    if (panel.dataset.methodControls === key) return;
    panel.dataset.methodControls = key;
    const word = snapshot.selectionKind === "word";
    locale.bindText(chip, word ? "mt.wordAction" : "mt.textAction");
    locale.bindAttribute(chip, "aria-label", word ? "mt.wordAction" : "mt.textAction");
    let controls = panel.querySelector(".tf-selection-routing");
    const restoreFocus = controls?.contains(panel.getRootNode().activeElement);
    if (!controls) {
      controls = document.createElement("details");
      controls.className = "tf-selection-routing";
      panel.insertBefore(controls, panel.children[1]);
    }
    controls.open = false;
    controls.replaceChildren();
    const summary = document.createElement("summary");
    summary.className = "tf-selection-method-summary";
    const methodName = locale.t(current ? `mt.method.${current}` : "mt.savedChoice");
    summary.setAttribute("aria-label", locale.t("mt.switchMethodLabel", { method: methodName }));
    summary.append(text("span", "tf-selection-method-context", locale.t(word ? "mt.wordAction" : "mt.textAction")),
      text("span", "tf-selection-method-current", methodName), text("span", "tf-selection-method-switch", locale.t("mt.switchMethod")));
    const body = document.createElement("div");
    body.className = "tf-selection-method-body";
    const hint = text("p", "tf-selection-method-hint", "");
    const choices = document.createElement("div");
    choices.className = "tf-selection-method-choices";
    const footer = document.createElement("div");
    footer.className = "tf-selection-method-footer";
    const kind = button({ className: "tf-selection-method-link" });
    const settings = button({ text: locale.t("mt.changeDefault"), className: "tf-selection-method-link" });
    let draftKind = snapshot.selectionKind || "text";
    function updateChoices() {
      const isWord = draftKind === "word";
      hint.textContent = locale.t(isWord ? "mt.switchWordHelp" : "mt.switchTextHelp");
      kind.textContent = locale.t(isWord ? "mt.treatAsText" : "mt.treatAsWord");
      choices.replaceChildren();
      for (const method of isWord ? ["free-online", "dictionary", "browser-local", "ai"] : ["ai", "browser-local", "free-online"]) {
        const choice = button({ label: locale.t(`mt.use.${method}`, { action: locale.t(isWord ? "mt.lookupAction" : "mt.translateAction") }), className: "tf-selection-method-choice" });
        choice.setAttribute("aria-pressed", String(method === current && draftKind === snapshot.selectionKind));
        choice.append(text("span", "tf-selection-method-name", locale.t(`mt.method.${method}`)),
          text("span", "tf-selection-method-description", locale.t(`mt.describe.${method}`)));
        choice.onclick = event => {
          if (!event.isTrusted) return;
          controls.open = false;
          summary.focus({ preventScroll: true });
          routingHandler?.(snapshot, { selectionKind: draftKind, temporaryMethod: method }, event);
        };
        choices.append(choice);
      }
    }
    kind.onclick = () => { draftKind = draftKind === "word" ? "text" : "word"; updateChoices(); };
    settings.onclick = () => app.modules.runtime.sendRuntimeMessage({ type: app.modules.runtime.messages.background.OPEN_OPTIONS, hash: "#general" });
    footer.append(kind, settings);
    body.append(hint, choices, footer);
    controls.append(summary, body);
    updateChoices();
    if (restoreFocus) summary.focus({ preventScroll: true });
  }

  function consumeEscape(event, panel) {
    const controls = panel?.querySelector(".tf-selection-routing[open]");
    if (!controls) return false;
    event.preventDefault(); event.stopPropagation();
    controls.open = false;
    controls.querySelector("summary").focus({ preventScroll: true });
    return true;
  }
  app.modules.selectionMethodControls = { render, consumeEscape };
})();
