(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (
    !app?.modules.runtime
    || !app?.modules.tasks
    || !app?.modules.selection
    || !app?.modules.selectionContext
    || !app?.modules.selectionPopover
    || app.modules.selectionController
  ) return;

  const { messages, getPageIdentity, sendRuntimeMessage, showToast } = app.modules.runtime;
  const tasks = app.modules.tasks;
  const { readSelection, isExtensionOwnedNode } = app.modules.selection;
  const { captureSelectionContext } = app.modules.selectionContext;
  const popover = app.modules.selectionPopover;

  let started = false;
  let activeSnapshot = null;
  let activeTask = null;
  let requestVersion = 0;
  let selectionTimer = null;

  function start() {
    if (started) return;
    started = true;
    popover.setCloseHandler(dismiss);

    document.addEventListener("mouseup", handlePotentialSelection, true);
    document.addEventListener("keyup", handlePotentialSelection, true);
    document.addEventListener("selectionchange", scheduleSelectionRefresh, true);
    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("scroll", () => popover.reposition(), true);
    window.addEventListener("resize", () => popover.reposition(), true);
  }

  function handlePotentialSelection(event) {
    if (isExtensionOwnedNode(event.target)) return;
    scheduleSelectionRefresh();
  }

  function scheduleSelectionRefresh() {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(refreshSelectionUi, 90);
  }

  function refreshSelectionUi() {
    const snapshot = readSelection();
    if (!snapshot) {
      if (!activeSnapshot) {
        popover.hide();
        setQuickControlSelectionActive(false);
      }
      return;
    }

    if (
      activeSnapshot
      && activeSnapshot.text === snapshot.text
      && getPageIdentity(activeSnapshot.pageUrl) === getPageIdentity(snapshot.pageUrl)
    ) {
      activeSnapshot.range = snapshot.range;
      activeSnapshot.rect = snapshot.rect;
      popover.reposition();
      return;
    }

    cancelActiveTask({ showCancelled: false });
    requestVersion += 1;
    activeSnapshot = snapshot;
    setQuickControlSelectionActive(true);
    popover.showChip(snapshot, () => translateSnapshot(snapshot));
  }

  async function translateSnapshot(snapshot) {
    if (!snapshot || snapshot !== activeSnapshot) return;

    if (activeTask && !tasks.isTerminal(activeTask)) {
      await tasks.cancelTask(activeTask);
    }

    const task = tasks.createTask({
      surface: "selection",
      pageUrl: snapshot.pageUrl,
      total: 1
    });
    activeTask = task;

    const version = ++requestVersion;
    const expectedPage = getPageIdentity(snapshot.pageUrl);
    popover.showLoading(snapshot, () => cancelActiveTask({ showCancelled: true }));

    try {
      tasks.transition(task, "translating");
      popover.setLoadingStatus("正在解析所选内容…");
      const resolved = await sendRuntimeMessage({
        type: messages.background.SELECTION_RESOLVE,
        text: snapshot.text,
        pageUrl: snapshot.pageUrl,
        context: captureSelectionContext(snapshot)
      });
      assertCurrent(version, snapshot, expectedPage, task);
      if (!resolved?.ok) throw tasks.responseError(resolved, "划词解析失败");

      if (resolved.route === "local") {
        const localText = formatLocalResult(resolved);
        if (!localText) throw new Error("本地词典没有可展示结果。");
        tasks.completeTask(task, { done: 1 });
        showResult(snapshot, localText, "结果已复制");
        return;
      }

      if (resolved.route === "translation") {
        await translateSelection(snapshot, task, version, expectedPage);
        return;
      }

      if (resolved.route === "needs-explanation") {
        tasks.completeTask(task, { done: 1 });
        popover.showError(
          snapshot,
          "本地词典存在多个可能含义，需要结合上下文进一步解释。",
          () => translateSnapshot(snapshot)
        );
        return;
      }

      tasks.completeTask(task, { done: 1 });
      popover.showError(
        snapshot,
        unresolvedMessage(resolved),
        () => translateSnapshot(snapshot)
      );
    } catch (error) {
      if (error?.name === "SelectionSupersededError") return;
      tasks.failTask(task, error);
      if (snapshot !== activeSnapshot) return;

      const cancelled = tasks.isCancelledError(error) || task.state === "cancelled";
      popover.showError(
        snapshot,
        cancelled ? "翻译已取消。" : (error?.message || String(error)),
        () => translateSnapshot(snapshot)
      );
    }
  }

  async function translateSelection(snapshot, task, version, expectedPage) {
    popover.setLoadingStatus("正在翻译…");
    const translated = await sendRuntimeMessage({
      type: messages.background.TRANSLATE_BATCH,
      requestId: task.id,
      pageUrl: snapshot.pageUrl,
      segments: [{ id: "selection", text: snapshot.text }]
    });
    assertCurrent(version, snapshot, expectedPage, task);
    if (!translated?.ok) throw tasks.responseError(translated, "翻译失败");

    const translation = (translated.translations || [])
      .find((item) => String(item.id) === "selection")?.text?.trim();
    if (!translation) throw new Error("模型没有返回可用译文。");

    tasks.completeTask(task, { done: 1, apiTranslated: 1 });
    showResult(snapshot, translation, "译文已复制");
  }

  function formatLocalResult(resolved) {
    const candidates = Array.isArray(resolved?.decision?.candidates)
      ? resolved.decision.candidates
      : (Array.isArray(resolved?.lookup?.candidates) ? resolved.lookup.candidates : []);
    if (!candidates.length) return "";

    const topId = resolved?.decision?.topCandidateId;
    const candidate = candidates.find((item) => item?.id === topId) || candidates[0];
    const translations = uniqueText(candidate?.translations);
    if (translations.length) return translations.slice(0, 3).join("；");

    const labels = uniqueText(candidate?.typeLabels);
    const headword = String(candidate?.headword || "").trim();
    if (headword && labels.length) return headword + " · " + labels.slice(0, 2).join(" / ");
    return headword || labels.slice(0, 2).join(" / ");
  }

  function uniqueText(values) {
    return [...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )];
  }

  function unresolvedMessage(resolved) {
    if (resolved?.routeReason === "ambiguous-concise") {
      return "本地词典存在多个可能含义；精简模式不会调用 AI。";
    }
    if (resolved?.routeReason === "no-hit-concise") {
      return "本地词典未找到可靠结果；精简模式不会调用 AI。";
    }
    if (resolved?.routeReason === "local-error") {
      return "本地词典暂时不可用，请重试。";
    }
    return "暂时无法确定该选段的含义。";
  }

  function showResult(snapshot, text, copiedMessage) {
    popover.showResult(snapshot, text, async () => {
      try {
        await copyText(text);
        showToast(copiedMessage, "success");
      } catch (error) {
        showToast("复制失败：" + (error?.message || error), "error");
      }
    });
  }

  function assertCurrent(version, snapshot, expectedPage, task) {
    tasks.assertActive(task);
    if (
      version !== requestVersion
      || snapshot !== activeSnapshot
      || getPageIdentity(location.href) !== expectedPage
    ) {
      const error = new Error("selection superseded");
      error.name = "SelectionSupersededError";
      error.code = "CANCELLED";
      throw error;
    }
  }

  function handleOutsidePointerDown(event) {
    if (popover.contains(event.target)) return;
    if (!activeSnapshot) return;
    dismiss();
  }

  function handleKeyDown(event) {
    if (event.key !== "Escape") return;
    dismiss();
  }

  function dismiss() {
    cancelActiveTask({ showCancelled: false });
    activeSnapshot = null;
    requestVersion += 1;
    popover.hide();
    setQuickControlSelectionActive(false);
  }

  function cancelActiveTask({ showCancelled }) {
    const task = activeTask;
    if (!task || tasks.isTerminal(task)) return;
    tasks.cancelTask(task).catch(() => {});
    if (showCancelled && activeSnapshot) {
      const snapshot = activeSnapshot;
      popover.showError(snapshot, "翻译已取消。", () => translateSnapshot(snapshot));
    }
  }

  function setQuickControlSelectionActive(active) {
    app.modules.quickControl?.setSelectionActive(Boolean(active));
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.setAttribute("data-tf-extension-ui", "selection-copy");
    document.documentElement.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("浏览器拒绝复制操作");
  }

  app.modules.selectionController = { start };
})();
