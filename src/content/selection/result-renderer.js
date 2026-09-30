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
      title.textContent = `${String(dictionary?.title || "Rich MDict")} · 本地导入 · 用户提供 / 未验证 · MDX`;
      record.appendChild(title);

      const headword = String(dictionary?.headword || "").trim();
      if (headword) {
        const form = document.createElement("div");
        form.className = "tf-selection-rich-headword";
        form.textContent = headword;
        record.appendChild(form);
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
              preserveNewlines: String(richRecord.format || "").toLowerCase() === "text"
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
      record.appendChild(body);
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

  app.modules.selectionResultRenderer = Object.freeze({ render, appendRichDictionaryDetails });
})();
