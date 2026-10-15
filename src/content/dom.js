(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || !app?.modules.structured || app.modules.dom) return;

  const { constants, state, cleanText } = app.modules.runtime;
  const structured = app.modules.structured;
  const {
    TRANSLATION_CLASS,
    TRANSLATED_ATTR,
    EXTENSION_UI_ATTR,
    CANDIDATE_SELECTOR,
    MIN_TEXT_LENGTH
  } = constants;

  function collectElements() {
    const root = document.querySelector("main, [role='main']") || document.body;
    if (!root) return [];
    return Array.from(root.querySelectorAll(CANDIDATE_SELECTOR)).filter(isCandidateElement);
  }

  function isCandidateElement(el) {
    if (!(el instanceof Element) || !isVisible(el)) return false;
    if (el.matches(`.${TRANSLATION_CLASS}`) || el.closest(`.${TRANSLATION_CLASS}`)) return false;
    if (el.closest(`[${EXTENSION_UI_ATTR}]`)) return false;
    if (el.closest("pre, code, script, style, textarea, input, select, option, button, nav, footer, header, [contenteditable='true']")) return false;
    if (el.tagName === "LI" && el.querySelector(":scope > ul, :scope > ol, p, blockquote")) return false;
    if (el.tagName === "BLOCKQUOTE" && el.querySelector("p, li")) return false;
    if (el.children.length > 18) return false;
    return true;
  }

  function isVisible(el) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function extractSourceText(el) {
    const parts = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest(`.${TRANSLATION_CLASS}, [${EXTENSION_UI_ATTR}], script, style, code, pre, textarea`)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let node;
    while ((node = walker.nextNode())) parts.push(node.nodeValue || "");
    return cleanText(parts.join(" "));
  }

  function extractSourceSegment(el) {
    const encoded = structured.encodeElement(el);
    if (!encoded.rich) return { text: extractSourceText(el), rich: false, descriptors: [] };
    return encoded;
  }

  function shouldTranslate(text) {
    if (!text || text.length < MIN_TEXT_LENGTH || text.length > 5000) return false;
    if (/^(https?:\/\/|www\.)/i.test(text)) return false;
    const letters = (text.match(/\p{L}/gu) || []).length;
    return letters >= 6;
  }

  function insertTranslation(el, translation, engine = "") {
    if (!translation || el.hasAttribute(TRANSLATED_ATTR)) return false;
    const node = document.createElement("span");
    node.className = TRANSLATION_CLASS;
    node.setAttribute("aria-hidden", "false");
    const source = structured.encodeElement(el);
    node.appendChild(structured.renderTranslation(translation, source));
    if (engine === "browser-translator") {
      const source = document.createElement("small"); source.className = "abt-translation-source";
      source.textContent = app.modules.contentI18n.t("content.basic.sourceBadge"); node.appendChild(source);
    }
    el.appendChild(node);
    el.setAttribute(TRANSLATED_ATTR, "1");
    return true;
  }

  function removeTranslationFromElement(el) {
    for (const child of [...el.children]) {
      if (child.classList?.contains(TRANSLATION_CLASS)) child.remove();
    }
    el.removeAttribute(TRANSLATED_ATTR);
  }

  function clearTranslations() {
    document.querySelectorAll(`.${TRANSLATION_CLASS}`).forEach((node) => node.remove());
    document.querySelectorAll(`[${TRANSLATED_ATTR}]`).forEach((el) => el.removeAttribute(TRANSLATED_ATTR));
    document.documentElement.classList.remove("abt-hide-translations");
    state.hidden = false;
  }

  function isTranslationNode(node) {
    const el = node instanceof Element ? node : node?.parentElement;
    if (!el) return false;
    return el.matches(`.${TRANSLATION_CLASS}, [${EXTENSION_UI_ATTR}]`)
      || Boolean(el.closest(`.${TRANSLATION_CLASS}, [${EXTENSION_UI_ATTR}]`));
  }

  app.modules.dom = {
    collectElements,
    isCandidateElement,
    extractSourceText,
    extractSourceSegment,
    shouldTranslate,
    insertTranslation,
    removeTranslationFromElement,
    clearTranslations,
    isTranslationNode
  };
})();
