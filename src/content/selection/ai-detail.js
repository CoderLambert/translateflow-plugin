(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.uiPrimitives || !app?.modules.contentI18n || app.modules.selectionAiDetail) return;

  const { button } = app.modules.uiPrimitives;
  const locale = app.modules.contentI18n;
  const markdown = app.modules.selectionMarkdownRenderer || Object.freeze({
    render(target, text, { onRendered } = {}) { target.textContent = String(text || ""); onRendered?.(); },
    clear() {}
  });

  const ACTION_LABEL_KEYS = Object.freeze({
    understand: "content.ai.understandLabel",
    analyze: "content.ai.analyzeLabel",
    usage: "content.ai.usageLabel"
  });

  function create({ container, onResize, action = "" } = {}) {
    if (!container) throw new Error("Selection AI detail container is required.");
    let node = null, markdownBody = null;
    const persistenceView = app.modules.selectionAiPersistenceView?.create({ onResize }) || Object.freeze({
      reset() {}, update() {}, render() {}
    });

    function reset() {
      markdown.clear(markdownBody);
      locale.unbindTree(node);
      persistenceView.reset(node);
      node?.remove();
      node = markdownBody = null;
    }

    function loading(onCancel) {
      render({
        state: "loading",
        messageKey: "content.ai.loading",
        onCancel
      });
    }

    function choices(onAction) {
      render({ state: "actions", messageKey: "content.ai.choose", onAction });
    }

    function streaming(answer, onCancel, stopping = false) {
      render({ state: stopping ? "stopping" : "streaming", messageKey: stopping ? "content.ai.stopping" : "content.ai.answering",
        answer: String(answer || ""), onCancel: stopping ? null : onCancel });
    }

    function interrupted(answer, messageKey, onRetry) {
      render({ state: "interrupted", messageKey: messageKey || "content.ai.interrupted", answer: String(answer || ""), onRetry });
    }

    function success(result = {}) {
      persistenceView.reset(node);
      render({
        state: "success",
        generatedMeaning: String(result.generatedMeaning || "").trim(),
        explanation: String(result.explanation || "").trim()
      });
    }

    function persistence(next = {}) {
      persistenceView.update(ensureNode(), next);
    }

    function error(messageKey, onRetry) {
      render({
        state: "error",
        messageKey: messageKey || "content.ai.unavailable",
        onRetry
      });
    }

    function cancelled(onRetry) {
      render({
        state: "cancelled",
        messageKey: "content.ai.cancelled",
        onRetry
      });
    }

    function ensureNode() {
      if (node?.isConnected) return node;
      node = document.createElement("section");
      node.className = "tf-selection-generated tf-selection-ai-detail";
      node.hidden = true;
      container.appendChild(node);
      return node;
    }

    function render({
      state = "idle",
      messageKey = "",
      generatedMeaning = "",
      explanation = "",
      answer = "",
      onRetry = null,
      onCancel = null,
      onAction = null
    } = {}) {
      const target = ensureNode();
      const markdownText = state === "success" ? explanation : answer;
      if (!markdownText) markdown.clear(markdownBody);
      target.replaceChildren();
      target.hidden = state === "idle";
      target.dataset.state = state;
      target.setAttribute("aria-busy", ["loading", "streaming", "stopping"].includes(state) ? "true" : "false");
      target.setAttribute("aria-live", "polite");
      if (target.hidden) {
        onResize?.();
        return;
      }

      const header = document.createElement("div");
      header.className = "tf-selection-ai-header";
      const label = document.createElement("div");
      label.className = "tf-selection-generated-label";
      locale.bindText(label, ACTION_LABEL_KEYS[action] || "content.ai.label");
      header.appendChild(label);

      if (state === "success" && !action) {
        const badge = document.createElement("span");
        badge.className = "tf-selection-result-badge";
        badge.dataset.kind = "ai";
        locale.bindText(badge, "content.ai.badge");
        header.appendChild(badge);
      }
      target.appendChild(header);

      if (state === "success") {
        if (generatedMeaning) {
          const meaning = document.createElement("div");
          meaning.className = "tf-selection-generated-meaning";
          meaning.textContent = generatedMeaning;
          target.appendChild(meaning);
        }
        if (explanation) {
          appendMarkdown(target, explanation, false);
        }
        persistenceView.render(target);
        onResize?.();
        return;
      }

      if (answer) {
        appendMarkdown(target, answer, state === "streaming" || state === "stopping");
      }

      const statusNode = document.createElement("div");
      statusNode.className = "tf-selection-ai-status";
      statusNode.dataset.kind = state;
      if (messageKey) locale.bindText(statusNode, messageKey);
      target.appendChild(statusNode);

      if (typeof onAction === "function" || typeof onRetry === "function" || typeof onCancel === "function") {
        const actions = document.createElement("div");
        actions.className = "tf-selection-ai-actions";
        if (typeof onAction === "function") {
          for (const [action, textKey, labelKey] of [["understand", "content.ai.understand", "content.ai.understandAria"], ["analyze", "content.ai.analyze", "content.ai.analyzeAria"], ["usage", "content.ai.usage", "content.ai.usageAria"]]) {
            const actionButton = button({ text: locale.t(textKey), label: locale.t(labelKey) });
            locale.bindText(actionButton, textKey);
            locale.bindAttribute(actionButton, "aria-label", labelKey);
            actionButton.dataset.action = action;
            actionButton.addEventListener("click", event => onAction(event, action));
            actions.appendChild(actionButton);
          }
        }
        if (typeof onRetry === "function") {
          const retry = button({ text: locale.t("content.common.retry"), label: locale.t("content.ai.retryAria") });
          locale.bindText(retry, "content.common.retry");
          locale.bindAttribute(retry, "aria-label", "content.ai.retryAria");
          retry.addEventListener("click", (event) => onRetry(event));
          actions.appendChild(retry);
        }
        if (typeof onCancel === "function") {
          const cancel = button({ text: locale.t(state === "streaming" ? "content.common.stop" : "content.common.cancel"), label: locale.t(state === "streaming" ? "content.ai.stopAria" : "content.ai.cancelAria") });
          locale.bindText(cancel, state === "streaming" ? "content.common.stop" : "content.common.cancel");
          locale.bindAttribute(cancel, "aria-label", state === "streaming" ? "content.ai.stopAria" : "content.ai.cancelAria");
          cancel.addEventListener("click", () => onCancel());
          actions.appendChild(cancel);
        }
        target.appendChild(actions);
      }
      onResize?.();
    }

    function appendMarkdown(target, text, streaming) {
      if (!markdownBody) {
        markdownBody = document.createElement("div");
        markdownBody.className = "tf-selection-generated-body tf-selection-markdown";
      }
      target.appendChild(markdownBody);
      markdown.render(markdownBody, text, { streaming, onRendered: onResize });
    }

    return Object.freeze({
      reset,
      ensure: ensureNode,
      choices,
      loading,
      streaming,
      interrupted,
      success,
      persistence,
      error,
      cancelled
    });
  }

  app.modules.selectionAiDetail = Object.freeze({ create });
})();
(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.uiPrimitives || !app?.modules.contentI18n || !app?.modules.selectionAiDetail || app.modules.selectionViewTabs) return;
  const { button } = app.modules.uiPrimitives;
  const locale = app.modules.contentI18n;
  const AI_ACTIONS = Object.freeze(["understand", "analyze", "usage"]);
  const BUSY = new Set(["starting", "loading", "streaming", "stopping"]);

  function create({ tabList, workspace, dictionaryPane, onDictionaryLeave, onChange, onRequest, onResize } = {}) {
    if (!tabList || !workspace || !dictionaryPane) throw new Error("Selection view containers are required.");
    const tabs = new Map(), panes = new Map([["dictionary", dictionaryPane]]), details = new Map(), states = new Map();
    let active = "dictionary", requestHandler = null, browserDefinition = false;
    createTab("dictionary", "content.selection.dictionaryTab", "content.selection.dictionaryTabAria");
    for (const action of AI_ACTIONS) {
      const panel = document.createElement("div");
      panel.className = "tf-selection-view-panel tf-selection-ai-panel";
      panel.id = `tf-selection-panel-${action}`;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", `tf-selection-tab-${action}`);
      panel.hidden = true;
      workspace.appendChild(panel);
      panes.set(action, panel);
      details.set(action, app.modules.selectionAiDetail.create({ container: panel, action, onResize }));
      states.set(action, "idle");
      createTab(action, `content.ai.${action}Label`, `content.ai.${action}TabAria`);
    }
    select("dictionary");

    function createTab(view, textKey, labelKey) {
      const tab = button({ text: locale.t(textKey), label: locale.t(labelKey), className: "tf-selection-view-tab" });
      tab.id = `tf-selection-tab-${view}`;
      tab.dataset.view = view;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", `tf-selection-panel-${view}`);
      tab.setAttribute("aria-selected", "false");
      tab.tabIndex = -1;
      locale.bindText(tab, textKey);
      locale.bindAttribute(tab, "aria-label", labelKey);
      tab.addEventListener("click", event => select(view, { event, focus: true, request: true }));
      tab.addEventListener("keydown", onKeyDown);
      tabs.set(view, tab);
      tabList.appendChild(tab);
    }

    function onKeyDown(event) {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const enabled = [...tabs.values()].filter(tab => !tab.disabled && !tab.hidden);
      if (!enabled.length) return;
      const current = enabled.indexOf(event.currentTarget);
      let next = current < 0 ? 0 : current;
      if (event.key === "Home") next = 0;
      else if (event.key === "End") next = enabled.length - 1;
      else next = (next + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length;
      event.preventDefault();
      enabled[next].focus({ preventScroll: true });
    }

    function setPrimaryKind(kind, result = {}) {
      const translation = kind === "translation", tab = tabs.get("dictionary");
      browserDefinition = translation && Boolean(result?.browserDefinition || result?.browserPair);
      locale.bindText(tab, browserDefinition ? "content.basic.definitionTab" : translation ? "content.basic.translationTab" : "content.selection.dictionaryTab");
      locale.bindAttribute(tab, "aria-label", browserDefinition ? "content.basic.definitionTab" : translation ? "content.basic.translationTab" : "content.selection.dictionaryTabAria");
      const understand = tabs.get("understand");
      locale.bindText(understand, browserDefinition ? "content.selection.aiDetail" : "content.ai.understandLabel");
      locale.bindAttribute(understand, "aria-label", browserDefinition ? "content.selection.aiDetailAria" : "content.ai.understandTabAria");
      for (const action of ["analyze", "usage"]) tabs.get(action).hidden = browserDefinition;
      if (browserDefinition && ["analyze", "usage"].includes(active)) select("dictionary");
      sync();
    }

    function configure(handler, visible) {
      requestHandler = typeof handler === "function" ? handler : null;
      tabList.hidden = !visible;
      sync();
    }

    function select(view, { event = null, focus = false, request = false } = {}) {
      if (!panes.has(view) || tabs.get(view)?.disabled) return false;
      const previous = active;
      active = view;
      for (const [name, pane] of panes) pane.hidden = name !== view;
      for (const [name, tab] of tabs) {
        const selected = name === view;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
      }
      if (previous === "dictionary" && view !== "dictionary") onDictionaryLeave?.();
      if (focus) tabs.get(view)?.focus({ preventScroll: true });
      if (request && view !== "dictionary" && states.get(view) === "idle" && requestHandler && event?.isTrusted) {
        states.set(view, "starting");
        details.get(view)?.loading(null);
        sync();
        void onRequest?.(event, view, requestHandler);
      }
      onChange?.(view);
      return true;
    }

    function sync() {
      const busy = AI_ACTIONS.find(action => BUSY.has(states.get(action)));
      for (const action of AI_ACTIONS) {
        const tab = tabs.get(action);
        const available = Boolean(requestHandler) || states.get(action) !== "idle";
        tab.disabled = !available || Boolean(busy && busy !== action);
        tab.dataset.state = String(states.get(action) || "idle");
        tab.setAttribute("aria-busy", BUSY.has(states.get(action)) ? "true" : "false");
      }
    }

    function reset() {
      setPrimaryKind("local", {});
      for (const action of AI_ACTIONS) {
        details.get(action)?.reset();
        states.set(action, "idle");
      }
      sync();
    }

    function render(action, state, method, args = []) {
      if (!details.has(action)) return false;
      states.set(action, state);
      details.get(action)[method](...args);
      sync();
      onChange?.(active);
      return true;
    }

    function retry(action, handler) {
      if (typeof handler !== "function") return null;
      return event => {
        if (BUSY.has(states.get(action))) return;
        states.set(action, "starting");
        sync();
        handler(event);
      };
    }

    return Object.freeze({
      configure,
      setPrimaryKind,
      reset,
      selectDictionary: () => select("dictionary"),
      active: () => active,
      loading: (action, cancel) => render(action, "loading", "loading", [cancel]),
      streaming: (action, answer, stop) => render(action, "streaming", "streaming", [answer, stop]),
      stopping: (action, answer) => render(action, "stopping", "streaming", [answer, null, true]),
      interrupted: (action, answer, message, handler) => render(action, "interrupted", "interrupted", [answer, message, retry(action, handler)]),
      success: (action, result) => render(action, "success", "success", [result]),
      persistence: (action, state) => details.get(action)?.persistence(state) ?? false,
      error: (action, message, handler) => render(action, "error", "error", [message, retry(action, handler)]),
      cancelled: (action, handler) => render(action, "cancelled", "cancelled", [retry(action, handler)]),
      dispose() {
        for (const detail of details.values()) detail.reset();
        locale.unbindTree(tabList);
        tabs.clear(); panes.clear(); details.clear(); states.clear();
      }
    });
  }

  app.modules.selectionViewTabs = Object.freeze({ create, AI_ACTIONS });
})();
