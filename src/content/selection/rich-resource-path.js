(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
  if (app.modules.richResourcePath) return;

  const ENCODED_SEPARATOR_OR_CONTROL = /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/iu;
  const CONTROL = /[\u0000-\u001f\u007f]/u;

  function normalize(value) {
    if (typeof value !== "string" || !value || value.length > 4096 || ENCODED_SEPARATOR_OR_CONTROL.test(value)) return "";
    let path;
    try { path = decodeURIComponent(value); } catch { return ""; }
    if (
      CONTROL.test(path) || path.includes("%") || path.includes(":") || path.includes("?") || path.includes("#") ||
      /^[a-z][a-z\d+.-]*:/iu.test(path) || /^[a-z]:/iu.test(path) || /^[\\/]{2}/u.test(path) ||
      path.startsWith("\\/") || path.startsWith("/\\")
    ) return "";
    if (path.startsWith("/") || path.startsWith("\\")) path = path.slice(1);
    path = path.replaceAll("\\", "/");
    const segments = path.split("/");
    if (!path || segments.some((segment) => !segment || segment === "." || segment === "..")) return "";
    return path;
  }

  app.modules.richResourcePath = Object.freeze({ normalize });
})();
