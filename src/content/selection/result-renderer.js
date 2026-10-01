(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app || app.modules.selectionResultRenderer) return;

  function render(container, input) {
    if (!container) throw new Error("Selection result container is required.");
    container.replaceChildren();
    const result = typeof input === "string"
      ? { kind: "translation", primaryMeaning: input }
      : (input || {});

    container.dataset.resultKind = String(result.kind || "translation");
    renderHeadword(container, result);

    const entries = Array.isArray(result.dictionaryEntries) ? result.dictionaryEntries : [];
    if (entries.length > 1) {
      renderDictionaryEntries(container, entries, result.moreEntryCount, result.headword);
    } else {
      renderCompactMeaning(container, result);
    }
    renderBadges(container, result.badges);

    const generatedMeaning = String(result.generatedMeaning || "").trim();
    const explanation = String(result.explanation || "").trim();
    if (!container.childElementCount && !generatedMeaning && !explanation) {
      const empty = document.createElement("div");
      empty.className = "tf-selection-primary";
      empty.textContent = "暂无可展示结果。";
      container.appendChild(empty);
    }

    return { generatedMeaning, explanation };
  }

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
        setResult(record, dictionaryId) {
          setCardState(details, status, "success", "查询完成");
          retryHandler = null;
          pendingResult = { record, dictionaryId };
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
        renderRichDictionaryRecord(body, pendingResult.record, pendingResult.dictionaryId);
        resultDisplayed = true;
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
  }

  function dictionaryMetadataText(dictionary) { return [String(dictionary?.title || "Rich MDict"), String(dictionary?.trustLabel || "").trim(), String(dictionary?.format || "").trim()].filter(Boolean).join(" · "); }

  function renderBadges(container, badges) {
    const meta = document.createElement("div");
    meta.className = "tf-selection-result-meta";
    for (const item of Array.isArray(badges) ? badges : []) {
      const label = String(item?.label || "").trim();
      if (!label) continue;
      const badge = document.createElement("span");
      badge.className = "tf-selection-result-badge";
      badge.dataset.kind = String(item?.kind || "local");
      badge.textContent = label;
      meta.appendChild(badge);
    }
    if (meta.childElementCount) container.appendChild(meta);
  }

  function renderHeadword(container, result) {
    const headword = String(result.headword || "").trim();
    const pronunciation = String(result.pronunciation || "").trim();
    const partOfSpeech = String(result.partOfSpeech || "").trim();
    if (!headword && !pronunciation && !partOfSpeech) return;

    const heading = document.createElement("div");
    heading.className = "tf-selection-headword-row";
    if (headword) {
      const strong = document.createElement("strong");
      strong.className = "tf-selection-headword";
      strong.textContent = headword;
      heading.appendChild(strong);
    }
    const details = [pronunciation, partOfSpeech].filter(Boolean);
    if (details.length) {
      const secondary = document.createElement("span");
      secondary.className = "tf-selection-headword-meta";
      secondary.textContent = details.join(" · ");
      heading.appendChild(secondary);
    }
    container.appendChild(heading);
  }

  function renderCompactMeaning(container, result) {
    const primary = String(result.primaryMeaning || "").trim();
    if (primary) {
      const node = document.createElement("div");
      node.className = "tf-selection-primary";
      node.textContent = primary;
      container.appendChild(node);
    }

    const senses = uniqueText(result.senses);
    if (senses.length) {
      const list = document.createElement("div");
      list.className = "tf-selection-senses";
      for (const sense of senses.slice(0, 5)) {
        const row = document.createElement("div");
        row.textContent = sense;
        list.appendChild(row);
      }
      container.appendChild(list);
    }
    renderFacts(container, [
      ...(Array.isArray(result.domains) ? result.domains : []),
      ...(Array.isArray(result.typeLabels) ? result.typeLabels : [])
    ]);
  }

  function renderDictionaryEntries(container, entries, moreEntryCount, primaryHeadword = "") {
    const list = document.createElement("div");
    list.className = "tf-selection-dictionary-entries";
    for (const [index, entry] of entries.entries()) {
      const item = document.createElement("section");
      item.className = "tf-selection-dictionary-entry";
      item.dataset.primary = entry?.primary ? "true" : "false";
      item.dataset.kind = String(entry?.kind || "lexical");

      const header = document.createElement("div");
      header.className = "tf-selection-entry-header";
      const number = document.createElement("span");
      number.className = "tf-selection-entry-number";
      number.textContent = String(index + 1);
      header.appendChild(number);

      const entryHeadword = String(entry?.headword || "").trim();
      const labels = uniqueText([
        entryHeadword && entryHeadword !== String(primaryHeadword || "").trim() ? entryHeadword : "",
        entry?.pronunciation,
        entry?.partOfSpeech
      ]);
      for (const label of labels) {
        const meta = document.createElement("span");
        meta.className = "tf-selection-entry-meta";
        meta.textContent = label;
        header.appendChild(meta);
      }
      item.appendChild(header);

      const translations = uniqueText(entry?.translations);
      for (const [translationIndex, translation] of translations.entries()) {
        const meaning = document.createElement("div");
        meaning.className = translationIndex === 0
          ? `tf-selection-entry-meaning${entry?.primary ? " tf-selection-primary" : ""}`
          : "tf-selection-entry-alternative";
        meaning.textContent = translation;
        item.appendChild(meaning);
      }

      renderFacts(item, [
        ...(Array.isArray(entry?.domains) ? entry.domains : []),
        ...(Array.isArray(entry?.typeLabels) ? entry.typeLabels : [])
      ], "tf-selection-entry-facts");

      const provenance = String(entry?.provenanceLabel || "").trim();
      if (provenance) {
        const source = document.createElement("div");
        source.className = "tf-selection-entry-provenance";
        source.textContent = provenance;
        item.appendChild(source);
      }
      list.appendChild(item);
    }

    if (Number(moreEntryCount || 0) > 0) {
      const more = document.createElement("div");
      more.className = "tf-selection-more-entries";
      more.textContent = `还有 ${Number(moreEntryCount)} 个候选未展开`;
      list.appendChild(more);
    }
    container.appendChild(list);
  }

  function renderFacts(container, values, className = "tf-selection-facts") {
    const facts = uniqueText(values);
    if (!facts.length) return;
    const row = document.createElement("div");
    row.className = className;
    for (const fact of facts.slice(0, 6)) {
      const item = document.createElement("span");
      item.textContent = fact;
      row.appendChild(item);
    }
    container.appendChild(row);
  }

  function uniqueText(values) {
    return [...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )];
  }

  app.modules.selectionResultRenderer = Object.freeze({
    render,
    appendRichDictionaryDetails,
    appendRichDictionaryCards
  });
})();
