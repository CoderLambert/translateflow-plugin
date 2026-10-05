export function createContentI18nStub({ locale = "zh_CN", messages = {} } = {}) {
  const render = (key, args = {}) => String(messages[key] || key).replace(/\{([a-z][a-zA-Z0-9]*)\}/g, (_, name) => String(args[name]));
  return {
    t: render,
    bindText(node, key, args = {}) { node.textContent = render(key, args); return () => {}; },
    bindAttribute(node, attribute, key, args = {}) { node.setAttribute(attribute, render(key, args)); return () => {}; },
    unbind() {},
    unbindTree() {},
    subscribe() { return () => {}; },
    start: async () => ({ locale, ready: true, error: false }),
    dispose() {},
    get: () => ({ locale, ready: true, error: false }),
    isReady: () => true
  };
}
