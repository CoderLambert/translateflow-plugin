(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (
    !app?.modules.runtime
    || !app?.modules.selection
    || !app?.modules.selectionPopover
    || app.modules.selectionController
  ) return;

  const { messages, getPageIdentity, sendRuntimeMessage, showToast } = app.modules.runtime;
  const { readSelection, isExtensionOwnedNode } = app.modules.selection;
  const popover = app.modules.selectionPopover;

  let started = false;
  let activeSnapshot = null;
  let requestVersion = 0;
  let selectionTimer = null;

  function start() {
    if (started) return;
    started = true;

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

    requestVersion += 1;
    activeSnapshot = snapshot;
    popover.showChip(snapshot, () => translateSnapshot(snapshot));
  }

  async function translateSnapshot(snapshot) {
    if (!snapshot || snapshot !== activeSnapshot) return;

    const version = ++requestVersion;
    const expectedPage = getPageIdentity(snapshot.pageUrl);
    popover.showLoading(snapshot);

    try {
      const lookup = await sendRuntimeMessage({
        type: messages.background.CACHE_LOOKUP,
        pageUrl: snapshot.pageUrl,
        segments: [{ id: "selection", text: snapshot.text }]
      });
      assertCurrent(version, snapshot, expectedPage);
      if (!lookup?.ok) throw new Error(lookup?.error || "缓存查询失败");

      const cached = (lookup.hits || []).find((item) => String(item.id) === "selection")?.text;
      if (cached) {
        showResult(snapshot, cached);
        return;
      }

      const translated = await sendRuntimeMessage({
        type: messages.background.TRANSLATE_BATCH,
        pageUrl: snapshot.pageUrl,
        segments: [{ id: "selection", text: snapshot.text }]
      });
      assertCurrent(version, snapshot, expectedPage);
      if (!translated?.ok) throw new Error(translated?.error || "翻译失败");

      const translation = (translated.translations || [])
        .find((item) => String(item.id) === "selection")?.text?.trim();
      if (!translation) throw new Error("模型没有返回可用译文。");

      const stored = await sendRuntimeMessage({
        type: messages.background.CACHE_STORE,
        pageUrl: snapshot.pageUrl,
        pageTitle: document.title,
        items: [{ sourceText: snapshot.text, translation }]
      });
      assertCurrent(version, snapshot, expectedPage);
      if (!stored?.ok) throw new Error(stored?.error || "译文缓存失败");

      showResult(snapshot, translation);
    } catch (error) {
      if (error?.name === "SelectionSupersededError") return;
      if (snapshot !== activeSnapshot) return;
      const message = error?.message || String(error);
      popover.showError(snapshot, message, () => translateSnapshot(snapshot));
    }
  }

  function showResult(snapshot, translation) {
    popover.showResult(snapshot, translation);
    popover.onCopy(async () => {
      try {
        await copyText(translation);
        showToast("译文已复制", "success");
      } catch (error) {
        showToast(`复制失败：${error?.message || error}`, "error");
      } finally {
        if (snapshot === activeSnapshot) {
          popover.onCopy(async () => {
            try {
              await copyText(translation);
              showToast("译文已复制", "success");
            } catch (error) {
              showToast(`复制失败：${error?.message || error}`, "error");
            }
          });
        }
      }
    });
  }

  function assertCurrent(version, snapshot, expectedPage) {
    if (
      version !== requestVersion
      || snapshot !== activeSnapshot
      || getPageIdentity(location.href) !== expectedPage
    ) {
      const error = new Error("selection superseded");
      error.name = "SelectionSupersededError";
      throw error;
    }
  }

  function handleOutsidePointerDown(event) {
    if (popover.contains(event.target)) return;
    if (!activeSnapshot) return;
    activeSnapshot = null;
    requestVersion += 1;
    popover.hide();
  }

  function handleKeyDown(event) {
    if (event.key !== "Escape") return;
    activeSnapshot = null;
    requestVersion += 1;
    popover.hide();
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
