(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app || app.modules.selectionRichResultRenderer) return;

  function appendRichDictionaryDetails(container, response) {
    if (!container || !response || typeof response !== "object") return false;
    const dictionaries = Array.isArray(response.dictionaries) ? response.dictionaries : [];
    const errors = Array.isArray(response.errors) ? response.errors : [];
    if (!dictionaries.length && !errors.length) return false;

    const section = document.createElement("section");
    section.className = "tf-selection-rich-details";
    section.setAttribute("aria-label", "详细词典释义");
    const heading = document.createElement("strong");
    heading.className = "tf-selection-rich-heading";
    heading.textContent = "详细词典";
    section.appendChild(heading);

    for (const dictionary of dictionaries.slice(0, 5)) {
      const record = document.createElement("article");
      record.className = "tf-selection-rich-record";
      const title = document.createElement("div");
      title.className = "tf-selection-rich-title";
      title.textContent = dictionaryMetadataText(dictionary);
      record.appendChild(title);
      renderRichDictionaryRecord(record, dictionary, dictionary?.id);
      section.appendChild(record);
    }

    for (const error of errors.slice(0, 3)) {
      const failure = document.createElement("div");
      failure.className = "tf-selection-rich-error";
      failure.textContent = `${String(error?.title || "详细词典")}：暂时无法读取（${String(error?.message || "索引或文件损坏")}）`;
      section.appendChild(failure);
    }
    container.appendChild(section);
    return true;
  }

  function appendRichDictionaryCards(container, dictionaries, onLookup) {
    if (!container || !Array.isArray(dictionaries) || dictionaries.length === 0) return [];

    const section = document.createElement("section");
    section.className = "tf-selection-rich-details";
    section.setAttribute("aria-label", "详细词典释义");
    const heading = document.createElement("strong");
    heading.className = "tf-selection-rich-heading";
    heading.textContent = "详细词典";
    section.appendChild(heading);

    const ordered = dictionaries
      .map((dictionary, sourceIndex) => ({ dictionary, sourceIndex }))
      .sort((left, right) => {
        const leftOrder = Number(left.dictionary?.order);
        const rightOrder = Number(right.dictionary?.order);
        const leftHasOrder = Number.isFinite(leftOrder);
        const rightHasOrder = Number.isFinite(rightOrder);
        if (leftHasOrder && rightHasOrder && leftOrder !== rightOrder) return leftOrder - rightOrder;
        if (leftHasOrder !== rightHasOrder) return leftHasOrder ? -1 : 1;
        return left.sourceIndex - right.sourceIndex;
      });
    const cards = [];

    for (const [index, { dictionary }] of ordered.entries()) {
      const details = document.createElement("details");
      details.className = "tf-selection-rich-record";
      details.dataset.dictionaryId = String(dictionary?.id || "");
      details.dataset.state = "idle";
      details.open = Boolean(dictionary?.preferred || dictionary?.expandedByDefault);

      const summary = document.createElement("summary");
      summary.className = "tf-selection-rich-summary";
      const order = document.createElement("span");
      order.className = "tf-selection-rich-order";
      order.textContent = String(index + 1);
      order.setAttribute("aria-label", `词典顺序 ${order.textContent}`);

      const identity = document.createElement("span");
      identity.className = "tf-selection-rich-identity";
      const title = document.createElement("strong");
      title.className = "tf-selection-rich-title";
      title.textContent = String(dictionary?.title || "详细词典");
      identity.appendChild(title);
      if (dictionary?.preferred) identity.appendChild(Object.assign(document.createElement("span"), {
        className: "tf-selection-rich-preference", textContent: "你的首选 · 个人偏好"
      }));

      const metadata = document.createElement("span");
      metadata.className = "tf-selection-rich-metadata";
      const trustLabel = String(dictionary?.trustLabel || "").trim();
      if (trustLabel) {
        const trust = document.createElement("span");
        trust.className = "tf-selection-rich-trust";
        trust.textContent = `来源 / 信任：${trustLabel}`;
        metadata.appendChild(trust);
      }
      const format = String(dictionary?.format || "").trim();
      if (format) {
        const formatLabel = document.createElement("span");
        formatLabel.className = "tf-selection-rich-format";
        formatLabel.textContent = format;
        metadata.appendChild(formatLabel);
      }
      if (metadata.childElementCount) identity.appendChild(metadata);

      const status = document.createElement("span");
      status.className = "tf-selection-rich-card-status";
      status.setAttribute("aria-live", "polite");
      status.textContent = details.open ? "正在查询…" : "展开后查询";
      summary.append(order, identity, status);

      const body = document.createElement("div");
      body.className = "tf-selection-rich-card-body";
      details.append(summary, body);
      section.appendChild(details);

      let pendingResult = null;
      let resultDisplayed = false;
      let retryHandler = null;
      const card = {
        dictionary,
        isOpen: () => details.open,
        setLoading() {
          setCardState(details, status, "loading", "正在查询…");
          body.replaceChildren();
        },
        setError(message, onRetry = null) {
          setCardState(details, status, "error", "查询失败");
          body.replaceChildren();
          const failure = document.createElement("p");
          failure.className = "tf-selection-rich-error";
          failure.textContent = String(message || "暂时无法读取。");
          body.appendChild(failure);
          retryHandler = typeof onRetry === "function" ? onRetry : null;
          if (retryHandler) {
            const retry = document.createElement("button");
            retry.type = "button";
            retry.className = "tf-selection-rich-retry";
            retry.textContent = "重试查询";
            retry.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              retryHandler?.();
            });
            body.appendChild(retry);
          }
        },
        setEmpty(message = "这本词典没有匹配条目。") {
          setCardState(details, status, "empty", "无匹配");
          body.replaceChildren();
          const empty = document.createElement("p");
          empty.className = "tf-selection-rich-empty";
          empty.textContent = String(message);
          body.appendChild(empty);
          retryHandler = null;
        },
        setResult(record, dictionaryId, onDisplay = null) {
          setCardState(details, status, "success", "查询完成");
          retryHandler = null;
          pendingResult = { record, dictionaryId, onDisplay };
          if (details.open) renderPendingResult();
          else {
            const note = document.createElement("p");
            note.className = "tf-selection-rich-deferred";
            note.textContent = "释义已就绪，展开后显示。";
            body.replaceChildren(note);
          }
        }
      };

      function renderPendingResult() {
        if (!pendingResult || resultDisplayed) return;
        body.replaceChildren();
        const displayed = renderRichDictionaryRecord(body, pendingResult.record, pendingResult.dictionaryId);
        resultDisplayed = true;
        pendingResult.onDisplay?.(displayed);
      }

      details.addEventListener("toggle", () => {
        if (!details.open) return;
        renderPendingResult();
        if (typeof onLookup === "function") onLookup(dictionary, card);
      });
      cards.push(card);
    }

    container.appendChild(section);
    for (const card of cards) {
      if (card.isOpen() && typeof onLookup === "function") onLookup(card.dictionary, card);
    }
    return cards;
  }

  function setCardState(details, status, state, text) { details.dataset.state = state; status.textContent = text; }

  function renderRichDictionaryRecord(container, dictionary, dictionaryId) {
    const headword = String(dictionary?.headword || "").trim();
    if (headword) {
      const form = document.createElement("div");
      form.className = "tf-selection-rich-headword";
      form.textContent = headword;
      container.appendChild(form);
    }

    const bodyText = String(dictionary?.text || "").trim();
    const body = document.createElement("div");
    body.className = "tf-selection-rich-text";
    const fallback = bodyText || "词典中有匹配记录，但没有可展示的纯文本内容。";
    const richRecord = dictionary?.richRecord;
    const sanitizer = app.modules.selectionRichSanitizer;
    const viewer = app.modules.selectionRichViewer;
    let displayed = false;
    if (richRecord && sanitizer?.sanitizeRichDictionaryRecord && viewer?.render) {
      try {
        const safeTree = sanitizer.sanitizeRichDictionaryRecord(richRecord);
        if (safeTree && !safeTree.truncated) {
          displayed = viewer.render(body, safeTree, fallback, {
            preserveNewlines: String(richRecord.format || "").toLowerCase() === "text",
            dictionaryId: String(dictionaryId || "")
          });
        }
      } catch {
        displayed = false;
      }
    }
    if (!displayed) {
      if (viewer?.renderPlainText) viewer.renderPlainText(body, fallback);
      else body.textContent = fallback;
    }
    container.appendChild(body);
    const viewport = body.shadowRoot?.querySelector?.(".tf-rich-viewer");
    return { id: String(dictionaryId || ""), headword, packVersion: dictionary?.packVersion,
      text: String(viewport?.textContent ?? (!displayed ? bodyText : "")) };
  }

  function dictionaryMetadataText(dictionary) { return [String(dictionary?.title || "Rich MDict"), String(dictionary?.trustLabel || "").trim(), String(dictionary?.format || "").trim()].filter(Boolean).join(" · "); }

  app.modules.selectionRichResultRenderer = Object.freeze({ appendRichDictionaryDetails, appendRichDictionaryCards });
})();
