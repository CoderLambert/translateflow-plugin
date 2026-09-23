import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

class TextNode {
  constructor(value) { this.nodeType = 3; this.nodeValue = value; this.parentElement = null; }
  get textContent() { return this.nodeValue; }
}
class ElementNode {
  constructor(tag, attrs = {}, children = []) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.childNodes = children;
    for (const child of children) child.parentElement = this;
  }
  matches() { return false; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  appendChild(node) { this.childNodes.push(node); node.parentElement = this; return node; }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }
}
class FragmentNode extends ElementNode { constructor() { super("#fragment"); } }

function loadStructured() {
  const document = {
    createTextNode: (text) => new TextNode(String(text)),
    createElement: (tag) => new ElementNode(tag),
    createDocumentFragment: () => new FragmentNode()
  };
  const context = vm.createContext({
    console, document, Node: { TEXT_NODE: 3 }, Element: ElementNode,
    __TRANSLATE_FLOW_CONTENT__: {
      modules: {
        runtime: {
          constants: { TRANSLATION_CLASS: "tf-translation", EXTENSION_UI_ATTR: "data-tf-ui" },
          cleanText: (value) => String(value).replace(/\s+/g, " ").trim()
        }
      }
    }
  });
  vm.runInContext(readFileSync(new URL("../src/content/structured.js", import.meta.url), "utf8"), context);
  return { structured: context.__TRANSLATE_FLOW_CONTENT__.modules.structured, document };
}

test("plain segment keeps current text identity while rich segment gets deterministic markers", () => {
  const { structured } = loadStructured();
  const plain = new ElementNode("p", {}, [new TextNode("Read the API docs.")]);
  const rich = new ElementNode("p", {}, [
    new TextNode("Read the "),
    new ElementNode("strong", {}, [new TextNode("API docs")]),
    new TextNode(".")
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(structured.encodeElement(plain))), {
    text: "Read the API docs.", rich: false, descriptors: []
  });
  assert.equal(structured.encodeElement(rich).text, "Read the ⟦TF:0:S⟧API docs⟦TF:0:E⟧.");
});

test("renderer restores whitelisted structure and original safe link attributes", () => {
  const { structured } = loadStructured();
  const source = new ElementNode("p", {}, [
    new ElementNode("a", { href: "https://example.com/docs", title: "Docs" }, [new TextNode("documentation")]),
    new TextNode(" and "),
    new ElementNode("code", {}, [new TextNode("fetch()")])
  ]);
  const encoded = structured.encodeElement(source);
  const rendered = structured.renderTranslation(
    "阅读⟦TF:0:S⟧文档⟦TF:0:E⟧并调用⟦TF:1:S⟧fetch()⟦TF:1:E⟧",
    encoded
  );
  assert.equal(rendered.childNodes[1].tagName, "A");
  assert.equal(rendered.childNodes[1].getAttribute("href"), "https://example.com/docs");
  assert.equal(rendered.childNodes[3].tagName, "CODE");
  assert.equal(rendered.childNodes[3].textContent, "fetch()");
});

test("unsafe link attributes are dropped and malformed markers degrade to plain text", () => {
  const { structured } = loadStructured();
  const source = new ElementNode("p", {}, [
    new ElementNode("a", { href: "javascript:alert(1)", onclick: "evil()" }, [new TextNode("link")])
  ]);
  const encoded = structured.encodeElement(source);
  assert.equal(encoded.descriptors[0].href, undefined);
  assert.equal(encoded.descriptors[0].onclick, undefined);
  const rendered = structured.renderTranslation("坏⟦TF:0:S⟧标记", encoded);
  assert.equal(rendered.textContent, "坏标记");
  assert.equal(rendered.childNodes.some((node) => node.tagName === "A"), false);
});
