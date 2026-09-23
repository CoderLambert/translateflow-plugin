(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (
    !app?.modules.runtime
    || !app?.modules.tasks
    || !app?.modules.selection
    || !app?.modules.selectionPopover
    || app.modules.selectionController
  ) return;

  const { messages, getPageIdentity, sendRuntimeMessage, showToast } = app.modules.runtime;
  const tasks = app.modules.tasks;
  const { readSelection, isExtensionOwnedNode } = app.modules.selection;
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
      if (!activeSnapshot) popover.hide();
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
      tasks.transition(task, "cache_lookup");
      popover.setLoadingStatus("正在检查缓存…");
      const lookup = await sendRuntimeMessage({
        type: messages.background.CACHE_LOOKUP,
        pageUrl: snapshot.pageUrl,
        segments: [{ id: "selection", text: snapshot.text }]
      });
      assertCurrent(version, snapshot, expectedPage, task);
      if (!lookup?.ok) throw tasks.responseError(lookup, "缓存查询失败");

      const cached = (lookup.hits || []).find((item) => String(item.id) === "selection")?.text;
      if (cached) {
        tasks.completeTask(task, { done: 1, cacheHits: 1 });
        showResult(snapshot, cached);
        return;
      }

      tasks.transition(task, "translating");
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

      tasks.assertActive(task);
      tasks.transition(task, "storing");
      popover.setLoadingStatus("正在保存译文…");
      const stored = await sendRuntimeMessage({
        type: messages.background.CACHE_STORE,
        pageUrl: snapshot.pageUrl,
        pageTitle: document.title,
        items: [{ sourceText: snapshot.text, translation }]
      });
      assertCurrent(version, snapshot, expectedPage, task);
      if (!stored?.ok) throw tasks.responseError(stored, "译文缓存失败");

      tasks.completeTask(task, { done: 1, apiTranslated: 1 });
      showResult(snapshot, translation);
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

  function showResult(snapshot, translation) {
    popover.showResult(snapshot, translation, async () => {
      try {
        await copyText(translation);
        showToast("译文已复制", "success");
      } catch (error) {
        showToast(`复制失败：${error?.message || error}`, "error");
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
