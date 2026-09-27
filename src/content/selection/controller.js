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

    let resolved = null;
    try {
      tasks.transition(task, "translating");
      popover.setLoadingStatus("正在解析所选内容…");
      const selectionContext = captureSelectionContext(snapshot);
      resolved = await sendRuntimeMessage({
        type: messages.background.SELECTION_RESOLVE,
        text: snapshot.text,
        pageUrl: snapshot.pageUrl,
        context: selectionContext
      });
      assertCurrent(version, snapshot, expectedPage, task);
      if (!resolved?.ok) throw tasks.responseError(resolved, "划词解析失败");

      if (resolved.route === "local") {
        const card = buildLocalResult(resolved);
        if (!card?.primaryMeaning) throw new Error("本地词典没有可展示结果。");
        tasks.completeTask(task, { done: 1 });
        showResult(snapshot, card, copyTextForCard(card), "结果已复制");
        return;
      }

      if (resolved.route === "translation") {
        await translateSelection(snapshot, task, version, expectedPage);
        return;
      }

      if (resolved.route === "needs-explanation") {
        await explainSelection(snapshot, task, version, expectedPage, selectionContext, resolved.depth);
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
        cancelled ? "翻译已取消。" : failureMessage(error, resolved),
        () => translateSnapshot(snapshot)
      );
    }
  }

  async function explainSelection(snapshot, task, version, expectedPage, context, depth) {
    tasks.transition(task, "translating");
    popover.setLoadingStatus("正在结合上下文解释…");
    const explained = await sendRuntimeMessage({
      type: messages.background.SELECTION_EXPLAIN,
      requestId: task.id,
      text: snapshot.text,
      pageUrl: snapshot.pageUrl,
      context,
      depth
    });
    assertCurrent(version, snapshot, expectedPage, task);
    if (!explained?.ok) throw tasks.responseError(explained, "划词解释失败");

    if (explained.route === "local" && explained.resolved) {
      const card = buildLocalResult(explained.resolved);
      if (!card?.primaryMeaning) throw new Error("本地词典没有可展示结果。");
      tasks.completeTask(task, { done: 1 });
      showResult(snapshot, card, copyTextForCard(card), "结果已复制");
      return;
    }

    if (explained.route === "translation") {
      await translateSelection(snapshot, task, version, expectedPage);
      return;
    }

    if (explained.route !== "explained" || !explained.generated?.explanation) {
      throw new Error("模型没有返回可用的划词解释。");
    }

    const card = buildExplainedResult(explained);
    tasks.completeTask(task, {
      done: 1,
      cacheHits: explained.cacheHit ? 1 : 0,
      apiTranslated: explained.cacheHit ? 0 : 1
    });
    showResult(snapshot, card, copyTextForCard(card), "解释已复制");
  }

  async function translateSelection(snapshot, task, version, expectedPage) {
    tasks.transition(task, "cache_lookup");
    popover.setLoadingStatus("正在检查翻译缓存…");
    const lookup = await sendRuntimeMessage({
      type: messages.background.CACHE_LOOKUP,
      pageUrl: snapshot.pageUrl,
      segments: [{ id: "selection", text: snapshot.text }]
    });
    assertCurrent(version, snapshot, expectedPage, task);
    if (!lookup?.ok) throw tasks.responseError(lookup, "缓存查询失败");

    const cached = (lookup.hits || [])
      .find((item) => String(item.id) === "selection")?.text?.trim();
    if (cached) {
      tasks.completeTask(task, { done: 1, cacheHits: 1 });
      const card = buildTranslationResult(cached);
      showResult(snapshot, card, copyTextForCard(card), "译文已复制");
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
    const card = buildTranslationResult(translation);
    showResult(snapshot, card, copyTextForCard(card), "译文已复制");
  }

  function buildLocalResult(resolved) {
    const candidates = Array.isArray(resolved?.decision?.candidates)
      ? resolved.decision.candidates
      : (Array.isArray(resolved?.lookup?.candidates) ? resolved.lookup.candidates : []);
    if (!candidates.length) return null;

    const topId = resolved?.decision?.topCandidateId;
    const candidate = candidates.find((item) => item?.id === topId) || candidates[0];
    return cardFromCandidate(candidate, {
      kind: candidate?.kind === "technical-entity" ? "technical" : "local"
    });
  }

  function buildExplainedResult(explained) {
    const candidates = Array.isArray(explained?.local?.candidates) ? explained.local.candidates : [];
    const selectedIds = new Set(
      Array.isArray(explained?.generated?.selectedCandidateIds)
        ? explained.generated.selectedCandidateIds.map(String)
        : []
    );
    const candidate = candidates.find((item) => selectedIds.has(String(item?.id)))
      || candidates.find((item) => item?.id === explained?.local?.topCandidateId)
      || candidates[0]
      || null;
    const base = candidate
      ? cardFromCandidate(candidate, {
          kind: candidate?.kind === "technical-entity" ? "technical" : "local"
        })
      : {
          kind: "explained",
          headword: "",
          primaryMeaning: "",
          senses: [],
          domains: [],
          typeLabels: [],
          badges: []
        };

    const generatedTranslation = String(explained?.generated?.translation || "").trim();
    return {
      ...base,
      kind: "explained",
      primaryMeaning: generatedTranslation || base.primaryMeaning,
      explanation: String(explained?.generated?.explanation || "").trim(),
      badges: dedupeBadges([
        ...(Array.isArray(base.badges) ? base.badges : []),
        { label: "AI 辅助", kind: "ai" }
      ])
    };
  }

  function buildTranslationResult(text) {
    return {
      kind: "translation",
      primaryMeaning: String(text || "").trim(),
      badges: [{ label: "翻译", kind: "translation" }],
      senses: [],
      domains: [],
      typeLabels: []
    };
  }

  function cardFromCandidate(candidate, { kind } = {}) {
    const translations = uniqueText(candidate?.translations);
    const labels = uniqueText(candidate?.typeLabels);
    const headword = String(candidate?.headword || "").trim();
    const primaryMeaning = translations[0]
      || labels.slice(0, 2).join(" · ")
      || headword;

    return {
      kind: kind || "local",
      headword,
      pronunciation: String(candidate?.pronunciation || "").trim(),
      partOfSpeech: String(candidate?.partOfSpeech || "").trim(),
      primaryMeaning,
      senses: translations.slice(1),
      domains: uniqueText(candidate?.domains),
      typeLabels: labels,
      badges: [{ label: provenanceLabel(candidate), kind: "local" }]
    };
  }

  function provenanceLabel(candidate) {
    if (candidate?.kind === "technical-entity") return "技术词条";
    const packId = String(candidate?.provenance?.packId || "").trim();
    if (!packId || packId === "core" || packId.includes("core")) return "本地词典";
    if (packId.includes("technical") || packId.includes("wikidata")) return "技术词条";
    return `词典包 · ${packId}`;
  }

  function dedupeBadges(values) {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).filter((item) => {
      const label = String(item?.label || "").trim();
      if (!label || seen.has(label)) return false;
      seen.add(label);
      return true;
    });
  }

  function copyTextForCard(card) {
    return uniqueText([
      card?.primaryMeaning,
      ...(Array.isArray(card?.senses) ? card.senses : []),
      card?.explanation
    ]).join("\n");
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

  function failureMessage(error, resolved) {
    const detail = error?.message || String(error);
    if (resolved?.routeReason === "no-hit-needs-explanation") {
      return `本地词典未找到可靠结果，且 AI 辅助暂不可用：${detail}`;
    }
    if (resolved?.routeReason === "ambiguous-needs-explanation") {
      return `本地词典存在多个候选含义，且 AI 辅助暂不可用：${detail}`;
    }
    return detail;
  }

  function showResult(snapshot, card, copyText, copiedMessage) {
    popover.showResult(snapshot, card, async () => {
      try {
        await copyTextValue(copyText);
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

  async function copyTextValue(text) {
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
