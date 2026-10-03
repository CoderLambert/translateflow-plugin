(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.uiPrimitives || app.modules.selectionEmptyState) return;

  const { button } = app.modules.uiPrimitives;

  function create({ container, onResize } = {}) {
    if (!container) throw new Error("Selection empty-state container is required.");
    let node = null;

    function reset() {
      node?.remove();
      node = null;
      delete container.dataset.resultKind;
    }

    function show({
      title = "本地词典暂未收录",
      message = "没有找到可靠的本地词典结果。",
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
      heading.textContent = title;

      const body = document.createElement("div");
      body.className = "tf-selection-empty-message";
      body.textContent = message;
      node.append(heading, body);

      const actions = document.createElement("div");
      actions.className = "tf-selection-empty-actions";
      if (typeof onExplain === "function") {
        const explain = button({ text: "AI 详解", label: "使用 AI 进一步解释这个词" });
        explain.addEventListener("click", (event) => onExplain(event));
        actions.appendChild(explain);
      }
      if (typeof onTranslate === "function") {
        const translate = button({ text: "普通翻译", label: "使用普通翻译处理这个词" });
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
