import MarkdownIt from "markdown-it";

const app = globalThis.__TRANSLATE_FLOW_CONTENT__;

if (app && !app.modules.selectionMarkdownRenderer) {
  const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });
  const pending = new WeakMap();
  const blocks = Object.freeze({
    paragraph_open: "p",
    blockquote_open: "blockquote",
    bullet_list_open: "ul",
    ordered_list_open: "ol",
    list_item_open: "li",
    table_open: "table",
    thead_open: "thead",
    tbody_open: "tbody",
    tr_open: "tr",
    th_open: "th",
    td_open: "td"
  });
  const inline = Object.freeze({ strong_open: "strong", em_open: "em", s_open: "s" });

  function safeLink(value) {
    try {
      const url = new URL(String(value || ""), location.href);
      return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  function renderTokens(tokens, root) {
    const stack = [root];
    const current = () => stack.at(-1);
    const open = (tag, className = "") => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      current().appendChild(node);
      stack.push(node);
      return node;
    };
    const close = () => { if (stack.length > 1) stack.pop(); };

    for (const token of tokens || []) {
      if (blocks[token.type]) {
        const node = open(blocks[token.type]);
        if (token.type === "ordered_list_open") {
          const start = Number(token.attrGet?.("start"));
          if (Number.isInteger(start) && start > 1) node.start = start;
        }
        continue;
      }
      if (token.type === "heading_open") {
        const level = Number.parseInt(String(token.tag || "h3").slice(1), 10);
        open(`h${Math.min(6, Math.max(1, Number.isFinite(level) ? level : 3))}`);
        continue;
      }
      if (token.type.endsWith("_close") || token.type === "heading_close") {
        close();
        continue;
      }
      if (token.type === "inline") {
        renderTokens(token.children || [{ type: "text", content: token.content }], current());
        continue;
      }
      if (inline[token.type]) {
        open(inline[token.type]);
        continue;
      }
      if (token.type === "link_open") {
        const href = safeLink(token.attrGet?.("href"));
        const link = open(href ? "a" : "span", href ? "" : "tf-selection-markdown-invalid-link");
        if (href) {
          link.href = href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        }
        continue;
      }
      if (token.type === "image") {
        const alt = document.createElement("span");
        alt.className = "tf-selection-markdown-image-alt";
        alt.textContent = token.content ? `[${token.content}]` : "";
        current().appendChild(alt);
        continue;
      }
      if (token.type === "softbreak") {
        current().appendChild(document.createTextNode(" "));
        continue;
      }
      if (token.type === "hardbreak") {
        current().appendChild(document.createElement("br"));
        continue;
      }
      if (token.type === "hr") {
        current().appendChild(document.createElement("hr"));
        continue;
      }
      if (token.type === "code_inline") {
        const code = document.createElement("code");
        code.textContent = token.content || "";
        current().appendChild(code);
        continue;
      }
      if (token.type === "fence" || token.type === "code_block") {
        const pre = document.createElement("pre"), code = document.createElement("code");
        code.textContent = token.content || "";
        pre.appendChild(code);
        current().appendChild(pre);
        continue;
      }
      if (token.type === "text" || token.type === "html_inline" || token.type === "html_block") {
        current().appendChild(document.createTextNode(token.content || ""));
      }
    }
  }

  function commit(container, text, onRendered) {
    if (!container?.isConnected) return;
    const scroller = container.closest?.(".tf-selection-ai-panel");
    const follow = scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 32 : false;
    const fragment = document.createDocumentFragment();
    try {
      renderTokens(markdown.parse(String(text || ""), {}), fragment);
    } catch {
      fragment.appendChild(document.createTextNode(String(text || "")));
    }
    container.replaceChildren(fragment);
    if (follow && scroller) scroller.scrollTop = scroller.scrollHeight;
    onRendered?.();
  }

  function clear(container) {
    if (!container) return;
    const state = pending.get(container);
    if (state && state.frame !== null) cancelAnimationFrame(state.frame);
    pending.delete(container);
  }

  function render(container, text, { streaming = false, onRendered = null } = {}) {
    if (!container) return;
    if (!streaming) {
      clear(container);
      commit(container, text, onRendered);
      return;
    }
    const state = pending.get(container) || { frame: null, text: "", onRendered: null };
    state.text = String(text || "");
    state.onRendered = onRendered;
    if (state.frame === null) {
      state.frame = requestAnimationFrame(() => {
        state.frame = null;
        if (pending.get(container) !== state) return;
        commit(container, state.text, state.onRendered);
      });
    }
    pending.set(container, state);
  }

  app.modules.selectionMarkdownRenderer = Object.freeze({ render, clear });
}
