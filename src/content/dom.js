(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || app.modules.dom) return;

  const { constants, state, cleanText } = app.modules.runtime;
  const { TRANSLATION_CLASS, TRANSLATED_ATTR, CANDIDATE_SELECTOR, MIN_TEXT_LENGTH } = constants;

  function collectElements() {
    const root = document.querySelector("main, [role='main']") || document.body;
    if (!root) return [];
    return Array.from(root.querySelectorAll(CANDIDATE_SELECTOR)).filter(isCandidateElement);
  }

  function isCandidateElement(el) {
    if (!(el instanceof Element) || !isVisible(el)) return false;
    if (el.matches(`.${TRANSLATION_CLASS}`) || el.closest(`.${TRANSLATION_CLASS}`)) return false;
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
        if (parent.closest(`.${TRANSLATION_CLASS}, script, style, code, pre, textarea`)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let node;
    while ((node = walker.nextNode())) parts.push(node.nodeValue || "");
    return cleanText(parts.join(" "));
  }

  function shouldTranslate(text) {
    if (!text || text.length < MIN_TEXT_LENGTH || text.length > 5000) return false;
    if (/^(https?:\/\/|www\.)/i.test(text)) return false;
    const latin = (text.match(/[A-Za-z]/g) || []).length;
    const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
    const letters = latin + cjk;
    if (letters < 6) return false;
    return latin / letters >= 0.58;
  }

  function insertTranslation(el, translation) {
    if (!translation || el.hasAttribute(TRANSLATED_ATTR)) return false;
    const node = document.createElement("span");
    node.className = TRANSLATION_CLASS;
    node.setAttribute("aria-hidden", "false");
    node.textContent = translation;
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
    if (!(node instanceof Element)) return false;
    return node.matches(`.${TRANSLATION_CLASS}`) || Boolean(node.closest(`.${TRANSLATION_CLASS}`));
  }

  app.modules.dom = {
    collectElements,
    isCandidateElement,
    extractSourceText,
    shouldTranslate,
    insertTranslation,
    removeTranslationFromElement,
    clearTranslations,
    isTranslationNode
  };
})();
