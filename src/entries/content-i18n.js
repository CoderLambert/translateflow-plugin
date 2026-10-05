import { createI18n } from "../i18n/index.js";

(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
  if (app.modules.contentI18n && !app.modules.contentI18n.legacyFallback) return;

  const subscribers = new Set();
  const bindings = new Set();
  let translator = createI18n({ uiLocale: "auto", browserLocale: browserLocale() });
  let started = false;
  let ready = false;
  let readError = false;
  let generation = 0;
  let startPromise = null;
  let retryTimer = null;

  function browserLocale() {
    try {
      return chrome.i18n?.getUILanguage?.() || globalThis.navigator?.language || "en";
    } catch {
      return globalThis.navigator?.language || "en";
    }
  }

  function snapshot() {
    return Object.freeze({
      i18n: translator,
      locale: translator?.locale || null,
      ready,
      error: readError
    });
  }

  function notify() {
    const value = snapshot();
    refreshBindings();
    for (const subscriber of [...subscribers]) {
      try { subscriber(value); } catch { /* One surface must not block another. */ }
    }
    return value;
  }

  function apply(uiLocale, { error = false } = {}) {
    translator = createI18n({ uiLocale, browserLocale: browserLocale() });
    ready = true;
    readError = error;
    return notify();
  }

  function scheduleRecovery() {
    if (!started || retryTimer !== null) return;
    retryTimer = globalThis.setTimeout(() => {
      retryTimer = null;
      void readStoredLocale({ fallbackOnError: false });
    }, 1000);
  }

  async function readStoredLocale({ fallbackOnError }) {
    const readGeneration = generation;
    try {
      const stored = await chrome.storage.local.get(["uiLocale"]);
      if (!started || readGeneration !== generation) return snapshot();
      return apply(stored?.uiLocale);
    } catch {
      if (!started || readGeneration !== generation) return snapshot();
      if (fallbackOnError || !ready) apply("auto", { error: true });
      else {
        readError = true;
        notify();
      }
      scheduleRecovery();
      return snapshot();
    }
  }

  function handleStorageChange(changes, areaName) {
    if (!started || areaName !== "local" || !changes?.uiLocale) return;
    generation += 1;
    if (retryTimer !== null) {
      globalThis.clearTimeout(retryTimer);
      retryTimer = null;
    }
    apply(changes.uiLocale.newValue);
  }

  function start() {
    if (startPromise) return startPromise;
    started = true;
    chrome.storage.onChanged.addListener(handleStorageChange);
    startPromise = readStoredLocale({ fallbackOnError: true });
    return startPromise;
  }

  function dispose() {
    if (started) chrome.storage.onChanged.removeListener(handleStorageChange);
    started = false;
    startPromise = null;
    generation += 1;
    if (retryTimer !== null) globalThis.clearTimeout(retryTimer);
    retryTimer = null;
    subscribers.clear();
    bindings.clear();
  }

  function subscribe(subscriber, { immediate = true } = {}) {
    if (typeof subscriber !== "function") throw new TypeError("Content locale subscriber must be a function");
    subscribers.add(subscriber);
    if (immediate && ready) subscriber(snapshot());
    return () => subscribers.delete(subscriber);
  }

  function t(key, args = {}) {
    if (!translator) throw new Error("Content locale is not ready");
    return translator.t(key, args);
  }

  function bindText(node, key, args = {}) {
    return bind(node, "textContent", key, args);
  }

  function bindAttribute(node, attribute, key, args = {}) {
    if (!node || typeof node.setAttribute !== "function" || typeof attribute !== "string" || !attribute) {
      throw new TypeError("Invalid Content locale attribute binding");
    }
    return bind(node, `attribute:${attribute}`, key, args);
  }

  function bind(node, target, key, args) {
    if (!node || typeof key !== "string") throw new TypeError("Invalid Content locale binding");
    unbind(node, target);
    const binding = { ref: new WeakRef(node), target, key, args };
    bindings.add(binding);
    applyBinding(binding);
    return () => bindings.delete(binding);
  }

  function unbind(node, target = null) {
    for (const binding of [...bindings]) {
      if (binding.ref.deref() === node && (target === null || binding.target === target)) bindings.delete(binding);
    }
  }

  function unbindTree(root) {
    if (!root) return;
    for (const binding of [...bindings]) {
      const node = binding.ref.deref();
      const nodeRoot = node?.getRootNode?.();
      if (!node || node === root || nodeRoot === root || nodeRoot?.host === root || root.contains?.(node)) bindings.delete(binding);
    }
  }

  function applyBinding(binding) {
    const node = binding.ref.deref();
    if (!node) return false;
    const value = t(binding.key, binding.args);
    if (binding.target === "textContent") node.textContent = value;
    else node.setAttribute(binding.target.slice("attribute:".length), value);
    return true;
  }

  function refreshBindings() {
    for (const binding of [...bindings]) {
      const node = binding.ref.deref();
      if (!node?.isConnected) {
        bindings.delete(binding);
        continue;
      }
      try { applyBinding(binding); } catch { bindings.delete(binding); }
    }
  }

  app.modules.contentI18n = Object.freeze({
    start,
    dispose,
    subscribe,
    t,
    bindText,
    bindAttribute,
    unbind,
    unbindTree,
    get: snapshot,
    isReady: () => ready
  });
})();
