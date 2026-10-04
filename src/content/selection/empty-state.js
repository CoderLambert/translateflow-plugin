(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.uiPrimitives || !app?.modules.contentI18n || app.modules.selectionEmptyState) return;

  const { button } = app.modules.uiPrimitives;
  const locale = app.modules.contentI18n;

  function create({ container, onResize } = {}) {
    if (!container) throw new Error("Selection empty-state container is required.");
    let node = null;

    function reset() {
      locale.unbindTree(node);
      node?.remove();
      node = null;
      delete container.dataset.resultKind;
    }

    function show({
      titleKey = "content.selection.localEmptyTitle",
      messageKey = "content.selection.localEmpty",
      onExplain = null,
      onTranslate = null
    } = {}) {
      reset();
      container.dataset.resultKind = "empty";
      node = document.createElement("section");
      node.className = "tf-selection-empty";
      node.dataset.state = "empty";

      const heading = document.createElement("strong");
      heading.className = "tf-selection-empty-title";
      locale.bindText(heading, titleKey);

      const body = document.createElement("div");
      body.className = "tf-selection-empty-message";
      locale.bindText(body, messageKey);
      node.append(heading, body);

      const actions = document.createElement("div");
      actions.className = "tf-selection-empty-actions";
      if (typeof onExplain === "function") {
        const explain = button({ text: locale.t("content.selection.aiDetail"), label: locale.t("content.selection.aiFurtherAria") });
        locale.bindText(explain, "content.selection.aiDetail");
        locale.bindAttribute(explain, "aria-label", "content.selection.aiFurtherAria");
        explain.addEventListener("click", (event) => onExplain(event));
        actions.appendChild(explain);
      }
      if (typeof onTranslate === "function") {
        const translate = button({ text: locale.t("content.selection.regularTranslation"), label: locale.t("content.selection.regularTranslationAria") });
        locale.bindText(translate, "content.selection.regularTranslation");
        locale.bindAttribute(translate, "aria-label", "content.selection.regularTranslationAria");
        translate.addEventListener("click", (event) => onTranslate(event));
        actions.appendChild(translate);
      }
      if (actions.childElementCount) node.appendChild(actions);

      container.appendChild(node);
      onResize?.();
    }

    return Object.freeze({ reset, show });
  }

  app.modules.selectionEmptyState = Object.freeze({ create });
})();
