import test from "node:test";
import assert from "node:assert/strict";

test("Content locale waits for storage, refreshes bound text, and removes its listener", async () => {
  const previousApp = globalThis.__TRANSLATE_FLOW_CONTENT__;
  const previousChrome = globalThis.chrome;
  const listeners = new Set();
  let resolveRead;
  const read = new Promise((resolve) => { resolveRead = resolve; });
  globalThis.__TRANSLATE_FLOW_CONTENT__ = { modules: {} };
  globalThis.chrome = {
    i18n: { getUILanguage: () => "en-US" },
    storage: {
      local: { get: async () => read },
      onChanged: {
        addListener(listener) { listeners.add(listener); },
        removeListener(listener) { listeners.delete(listener); }
      }
    }
  };

  try {
    await import(`../src/entries/content-i18n.js?test=${Date.now()}`);
    const owner = globalThis.__TRANSLATE_FLOW_CONTENT__.modules.contentI18n;
    const observed = [];
    owner.subscribe((value) => observed.push({ locale: value.locale, error: value.error }));
    const starting = owner.start();
    assert.equal(owner.isReady(), false);
    assert.equal(observed.length, 0, "no surface may render an assumed locale before storage resolves");
    assert.equal(listeners.size, 1);

    resolveRead({ uiLocale: "zh_CN" });
    await starting;
    assert.deepEqual(observed, [{ locale: "zh_CN", error: false }]);
    const node = { isConnected: true, textContent: "", attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
    owner.bindText(node, "learning.title");
    assert.equal(node.textContent, "学习中心");

    for (const listener of listeners) listener({ uiLocale: { oldValue: "zh_CN", newValue: "en" } }, "local");
    assert.equal(node.textContent, "Learning center");
    assert.equal(owner.get().locale, "en");

    owner.dispose();
    assert.equal(listeners.size, 0);
  } finally {
    globalThis.__TRANSLATE_FLOW_CONTENT__ = previousApp;
    globalThis.chrome = previousChrome;
  }
});
