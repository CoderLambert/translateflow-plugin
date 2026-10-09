(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.contentI18n || app.modules.selectionRichResultRenderer) return;
  const locale = app.modules.contentI18n;

  function appendRichDictionaryDetails(container, response) {
    if (!container || !response || typeof response !== "object") return false;
    const dictionaries = Array.isArray(response.dictionaries) ? response.dictionaries : [];
    const errors = Array.isArray(response.errors) ? response.errors : [];
    if (!dictionaries.length && !errors.length) return false;

    const section = document.createElement("section");
    section.className = "tf-selection-rich-details";
    locale.bindAttribute(section, "aria-label", "content.rich.aria");
    const heading = document.createElement("strong");
    heading.className = "tf-selection-rich-heading";
    locale.bindText(heading, "content.rich.title");
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
      const titleText = String(error?.title || locale.t("content.rich.title"));
      locale.bindText(failure, "content.rich.unavailable", { title: titleText });
      section.appendChild(failure);
    }
    container.appendChild(section);
    return true;
  }

  function appendRichDictionaryCards(container, dictionaries, onLookup) {
    if (!container || !Array.isArray(dictionaries) || dictionaries.length === 0) return [];

    const section = document.createElement("section");
    section.className = "tf-selection-rich-details";
    locale.bindAttribute(section, "aria-label", "content.rich.aria");
    const heading = document.createElement("strong");
    heading.className = "tf-selection-rich-heading";
    locale.bindText(heading, "content.rich.title");
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
      locale.bindAttribute(order, "aria-label", "content.rich.order", { index: index + 1 });

      const identity = document.createElement("span");
      identity.className = "tf-selection-rich-identity";
      const title = document.createElement("strong");
      title.className = "tf-selection-rich-title";
      if (dictionary?.title) title.textContent = String(dictionary.title);
      else locale.bindText(title, "content.rich.title");
      identity.appendChild(title);
      if (dictionary?.preferred) {
        const preferred = document.createElement("span");
        preferred.className = "tf-selection-rich-preference";
        locale.bindText(preferred, "content.rich.preferred");
        identity.appendChild(preferred);
      }

      const metadata = document.createElement("span");
      metadata.className = "tf-selection-rich-metadata";
      const trustLabel = String(dictionary?.trustLabel || "").trim();
      if (trustLabel) {
        const trust = document.createElement("span");
        trust.className = "tf-selection-rich-trust";
        locale.bindText(trust, "content.rich.trust", { trust: trustLabel });
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
      locale.bindText(status, details.open ? "content.rich.querying" : "content.rich.queryOnOpen");
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
          setCardState(details, status, "loading", "content.rich.querying");
          body.replaceChildren();
        },
        setError(message, onRetry = null) {
          setCardState(details, status, "error", "content.rich.queryFailed");
          body.replaceChildren();
          const failure = document.createElement("p");
          failure.className = "tf-selection-rich-error";
          bindMessage(failure, message, "content.rich.temporarilyUnavailable");
          body.appendChild(failure);
          retryHandler = typeof onRetry === "function" ? onRetry : null;
          if (retryHandler) {
            const retry = document.createElement("button");
            retry.type = "button";
            retry.className = "tf-selection-rich-retry";
            locale.bindText(retry, "content.rich.retry");
            retry.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              retryHandler?.();
            });
            body.appendChild(retry);
          }
        },
        setEmpty(message = "content.rich.noMatch") {
          setCardState(details, status, "empty", "content.rich.noMatchShort");
          body.replaceChildren();
          const empty = document.createElement("p");
          empty.className = "tf-selection-rich-empty";
          bindMessage(empty, message, "content.rich.noMatch");
          body.appendChild(empty);
          retryHandler = null;
        },
        setResult(record, dictionaryId, onDisplay = null) {
          setCardState(details, status, "success", "content.rich.complete");
          retryHandler = null;
          pendingResult = { record, dictionaryId, onDisplay };
          if (details.open) renderPendingResult();
          else {
            const note = document.createElement("p");
            note.className = "tf-selection-rich-deferred";
            locale.bindText(note, "content.rich.readyCollapsed");
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

  function setCardState(details, status, state, key) { details.dataset.state = state; locale.bindText(status, key); }

  function bindMessage(node, message, fallbackKey) {
    if (message && typeof message === "object" && typeof message.key === "string") {
      locale.bindText(node, message.key, message.args || {});
    } else if (typeof message === "string" && message.startsWith("content.")) {
      locale.bindText(node, message);
    } else if (message) {
      locale.unbind(node);
      node.textContent = String(message);
    } else locale.bindText(node, fallbackKey);
  }

  function renderRichDictionaryRecord(container, dictionary, dictionaryId) {
    const headword = String(dictionary?.headword || "").trim();
    const bodyText = String(dictionary?.text || "").trim();
    const body = document.createElement("div");
    body.className = "tf-selection-rich-text";
    const fallback = bodyText || locale.t("content.rich.emptyBody");
    const richRecord = dictionary?.richRecord;
    const sanitizer = app.modules.selectionRichSanitizer;
    const viewer = app.modules.selectionRichViewer;
    let displayed = false;
    let safeTree = null;
    if (richRecord && sanitizer?.sanitizeRichDictionaryRecord && viewer?.render) {
      try {
        safeTree = sanitizer.sanitizeRichDictionaryRecord(richRecord);
        if (safeTree) {
          displayed = viewer.render(body, safeTree, fallback, {
            preserveNewlines: String(richRecord.format || "").toLowerCase() === "text",
            dictionaryId: String(dictionaryId || ""),
            packageVersion: String(dictionary?.packageVersion || "")
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
    if (headword && !(displayed && semanticHeadwordMatches(safeTree, headword))) {
      const form = document.createElement("div");
      form.className = "tf-selection-rich-headword";
      form.textContent = headword;
      container.appendChild(form);
    }
    container.appendChild(body);
    const viewport = body.shadowRoot?.querySelector?.(".tf-rich-viewer");
    if (!bodyText && !displayed && viewport) locale.bindText(viewport, "content.rich.emptyBody");
    const visibleText = typeof viewport?.innerText === "string" ? viewport.innerText : viewport?.textContent;
    return { id: String(dictionaryId || ""), headword, packVersion: dictionary?.packVersion,
      text: String(visibleText ?? (!displayed ? bodyText : "")).replace(/\r\n?/gu, "\n") };
  }

  function semanticHeadwordMatches(tree, headword) {
    const rootNodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
    for (const line of rootNodes) {
      if (line.type !== "element" || line.tag !== "div" || !hasClass(line, "o-word-line")) continue;
      const main = findDescendant(line, (node) => node.tag === "span" && hasClass(node, "o-head-main"));
      const semantic = main && findDescendant(main, (node) => node.tag === "span" && hasClass(node, "o-h"));
      if (!semantic) continue;
      if (normalizeHeadword(collectText(semantic)) === normalizeHeadword(headword)) return true;
    }
    return false;
  }

  function hasClass(node, name) {
    return String(node?.attrs?.class || "").split(/\s+/u).includes(name);
  }

  function findDescendant(node, predicate) {
    for (const child of Array.isArray(node?.children) ? node.children : []) {
      if (child.type === "element" && predicate(child)) return child;
      const nested = child.type === "element" ? findDescendant(child, predicate) : null;
      if (nested) return nested;
    }
    return null;
  }

  function collectText(node) {
    let text = "";
    for (const child of Array.isArray(node?.children) ? node.children : []) {
      if (child.type === "text") text += child.text;
      else if (child.type === "element") text += collectText(child);
    }
    return text;
  }

  function normalizeHeadword(value) {
    return String(value || "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en");
  }

  function dictionaryMetadataText(dictionary) { return [String(dictionary?.title || "Rich MDict"), String(dictionary?.trustLabel || "").trim(), String(dictionary?.format || "").trim()].filter(Boolean).join(" · "); }

  app.modules.selectionRichResultRenderer = Object.freeze({ appendRichDictionaryDetails, appendRichDictionaryCards });
})();
