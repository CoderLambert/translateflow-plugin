(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.uiPrimitives || !app?.modules.contentI18n || app.modules.selectionAiDetail) return;

  const { button } = app.modules.uiPrimitives;
  const locale = app.modules.contentI18n;

  function create({ container, onResize } = {}) {
    if (!container) throw new Error("Selection AI detail container is required.");
    let node = null;

    function reset() {
      locale.unbindTree(node);
      node?.remove();
      node = null;
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
      render({
        state: "success",
        generatedMeaning: String(result.generatedMeaning || "").trim(),
        explanation: String(result.explanation || "").trim()
      });
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
      locale.bindText(label, "content.ai.label");
      header.appendChild(label);

      if (state === "success") {
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
          const body = document.createElement("div");
          body.className = "tf-selection-generated-body";
          body.textContent = explanation;
          target.appendChild(body);
        }
        onResize?.();
        return;
      }

      if (answer) {
        const body = document.createElement("div");
        body.className = "tf-selection-generated-body";
        body.textContent = answer;
        target.appendChild(body);
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

    return Object.freeze({
      reset,
      ensure: ensureNode,
      choices,
      loading,
      streaming,
      interrupted,
      success,
      error,
      cancelled
    });
  }

  app.modules.selectionAiDetail = Object.freeze({ create });
})();
