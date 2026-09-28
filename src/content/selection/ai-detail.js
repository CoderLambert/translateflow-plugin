(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.uiPrimitives || app.modules.selectionAiDetail) return;

  const { button } = app.modules.uiPrimitives;

  function create({ container, onResize } = {}) {
    if (!container) throw new Error("Selection AI detail container is required.");
    let node = null;

    function reset() {
      node?.remove();
      node = null;
    }

    function loading(onCancel) {
      render({
        state: "loading",
        message: "正在结合上下文解释…",
        onCancel
      });
    }

    function success(result = {}) {
      render({
        state: "success",
        generatedMeaning: String(result.generatedMeaning || "").trim(),
        explanation: String(result.explanation || "").trim()
      });
    }

    function error(message, onRetry) {
      render({
        state: "error",
        message: message || "AI 详解暂不可用。",
        onRetry
      });
    }

    function cancelled(onRetry) {
      render({
        state: "cancelled",
        message: "AI 详解已取消。",
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
      message = "",
      generatedMeaning = "",
      explanation = "",
      onRetry = null,
      onCancel = null
    } = {}) {
      const target = ensureNode();
      target.replaceChildren();
      target.hidden = state === "idle";
      target.dataset.state = state;
      target.setAttribute("aria-busy", state === "loading" ? "true" : "false");
      if (target.hidden) {
        onResize?.();
        return;
      }

      const header = document.createElement("div");
      header.className = "tf-selection-ai-header";
      const label = document.createElement("div");
      label.className = "tf-selection-generated-label";
      label.textContent = "AI 详解";
      header.appendChild(label);

      if (state === "success") {
        const badge = document.createElement("span");
        badge.className = "tf-selection-result-badge";
        badge.dataset.kind = "ai";
        badge.textContent = "AI 辅助";
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

      const statusNode = document.createElement("div");
      statusNode.className = "tf-selection-ai-status";
      statusNode.dataset.kind = state;
      statusNode.textContent = message;
      target.appendChild(statusNode);

      if (typeof onRetry === "function" || typeof onCancel === "function") {
        const actions = document.createElement("div");
        actions.className = "tf-selection-ai-actions";
        if (typeof onRetry === "function") {
          const retry = button({ text: "重试", label: "重新请求 AI 详解" });
          retry.addEventListener("click", () => onRetry());
          actions.appendChild(retry);
        }
        if (typeof onCancel === "function") {
          const cancel = button({ text: "取消", label: "取消 AI 详解" });
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
      loading,
      success,
      error,
      cancelled
    });
  }

  app.modules.selectionAiDetail = Object.freeze({ create });
})();
