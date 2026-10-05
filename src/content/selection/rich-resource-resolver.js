(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
  if (!app.modules.runtime || !app.modules.contentI18n || !app.modules.richResourcePath || app.modules.richResourceResolver) return;
  const locale = app.modules.contentI18n;

  const MAX_RESOURCE_COUNT = 8;
  const MAX_ASSET_BYTES = 8 * 1024 * 1024;
  const MAX_VIEW_BLOB_BYTES = 32 * 1024 * 1024;
  const MAX_VIEW_IMAGE_PIXELS = 16 * 1024 * 1024;
  const MAX_STYLESHEET_BYTES = 64 * 1024;
  const MAX_BASE64_CHARS = Math.ceil(MAX_ASSET_BYTES / 3) * 4;
  const MAX_CONCURRENT_READS = 2;
  const REQUEST_ID_PREFIX = "selection-mdd-resource-";
  let fallbackRequestCounter = 0;
  const CONTENT_DOCUMENT_OWNER_TOKEN = createContentDocumentOwnerToken();
  const sessionsByContainer = new WeakMap();
  const activeSessions = new Set();
  const readQueue = [];
  let runningReads = 0;
  let activeObjectUrlCount = 0;

  const { messages, sendRuntimeMessage } = app.modules.runtime;

  function attach(container, shadowRoot, viewport, resources, dictionaryId) {
    close(container);
    const session = {
      container,
      shadowRoot,
      viewport,
      dictionaryId: String(dictionaryId || ""),
      closed: false,
      resources: [],
      urls: new Map(),
      inFlightRequests: new Set(),
      objectBytes: 0,
      imagePixels: 0
    };
    sessionsByContainer.set(container, session);
    activeSessions.add(session);
    for (const item of Array.isArray(resources) ? resources.slice(0, MAX_RESOURCE_COUNT) : []) {
      const path = app.modules.richResourcePath.normalize(item?.path);
      if (!path || path !== item.path || !["image", "audio", "stylesheet"].includes(item.kind)) continue;
      session.resources.push({
        kind: item.kind,
        path,
        label: String(item.label || "").slice(0, 160),
        element: item.element || null
      });
    }
    for (const resource of session.resources) {
      if (resource.kind === "audio") installAudioLoader(session, resource);
      else void scheduleRead(session, () => loadResource(session, resource));
    }
    return session;
  }

  async function loadResource(session, resource) {
    if (!isCurrent(session)) return;
    try {
      const asset = await fetchAsset(session, resource);
      if (!isCurrent(session)) return;
      if (resource.kind === "stylesheet") {
        const css = compileLocalStylesheet(asset.bytes);
        if (!css || !isCurrent(session)) return;
        const style = document.createElement("style");
        style.textContent = css;
        session.shadowRoot.appendChild(style);
        resource.styleNode = style;
        return;
      }
      if (resource.kind !== "image") return;
      const width = asset.width;
      const height = asset.height;
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) return;
      const pixels = width * height;
      if (!Number.isSafeInteger(pixels) || pixels > MAX_VIEW_IMAGE_PIXELS || session.imagePixels + pixels > MAX_VIEW_IMAGE_PIXELS) return;
      const url = createTrackedUrl(session, asset, pixels);
      if (!url || !isCurrent(session)) return;
      resource.objectUrl = url;
      const image = document.createElement("img");
      image.className = "tf-rich-resource-image";
      if (resource.label) image.alt = resource.label;
      else locale.bindAttribute(image, "alt", "content.rich.dictionaryImage");
      image.width = width;
      image.height = height;
      image.addEventListener("error", () => {
        revokeUrl(session, url);
        resource.objectUrl = "";
        if (!isCurrent(session)) return;
        resource.element?.replaceWith(makePlaceholder("image", resource.label));
      }, { once: true });
      image.addEventListener("load", () => {
        if (!isCurrent(session)) revokeUrl(session, url);
      }, { once: true });
      image.src = url;
      if (resource.element?.isConnected) resource.element.replaceWith(image);
      else if (resource.element?.parentNode) resource.element.replaceWith(image);
      resource.element = image;
      resource.onClose = () => image.replaceWith(makePlaceholder("image", resource.label));
    } catch {
      if (resource.objectUrl) revokeUrl(session, resource.objectUrl);
      resource.objectUrl = "";
      if (!isCurrent(session)) return;
      resource.element?.replaceWith(makePlaceholder(resource.kind, resource.label));
    }
  }

  function installAudioLoader(session, resource) {
    const previous = resource.element;
    const button = makePlaceholder("audio", resource.label);
    button.className = "tf-rich-placeholder tf-rich-audio-load";
    button.type = "button";
    button.dataset.action = "load-mdd-audio";
    locale.bindText(button, resource.label ? "content.rich.loadAudio" : "content.rich.loadAudioGeneric", resource.label ? { label: resource.label } : {});
    locale.bindAttribute(button, "aria-label", resource.label ? "content.rich.loadAudio" : "content.rich.loadAudioGeneric", resource.label ? { label: resource.label } : {});
    resource.element = button;
    resource.onClose = () => {
      const placeholder = makePlaceholder("audio", resource.label);
      button.replaceWith(placeholder);
    };
    button.addEventListener("click", async () => {
      if (!isCurrent(session) || button.disabled) return;
      button.disabled = true;
      locale.bindText(button, "content.rich.loadingAudio");
      try {
        const asset = await scheduleRead(session, () => fetchAsset(session, resource));
        if (!isCurrent(session)) return;
        const url = createTrackedUrl(session, asset, 0);
        if (!url) throw new Error("Audio resource budget was exceeded.");
        resource.objectUrl = url;
        const audio = document.createElement("audio");
        audio.className = "tf-rich-resource-audio";
        audio.controls = true;
        audio.preload = "none";
        audio.autoplay = false;
        audio.setAttribute("controls", "");
        audio.setAttribute("preload", "none");
        audio.src = url;
        audio.addEventListener("error", () => {
          revokeUrl(session, url);
          resource.objectUrl = "";
          if (!isCurrent(session)) return;
          audio.replaceWith(makePlaceholder("audio", resource.label));
        }, { once: true });
        if (button.parentNode) button.replaceWith(audio);
        resource.element = audio;
        resource.onClose = () => audio.replaceWith(makePlaceholder("audio", resource.label));
      } catch {
        if (resource.objectUrl) revokeUrl(session, resource.objectUrl);
        resource.objectUrl = "";
        if (!isCurrent(session)) return;
        button.disabled = true;
        locale.bindText(button, resource.label ? "content.rich.audioUnreadable" : "content.rich.audioMissing", resource.label ? { label: resource.label } : {});
      }
    });
    previous?.replaceWith(button);
  }

  async function fetchAsset(session, resource) {
    if (!isCurrent(session)) throw new Error("Rich viewer is closed.");
    const requestId = createResourceRequestId();
    session.inFlightRequests.add(requestId);
    let response;
    try {
      response = await sendRuntimeMessage({
        type: messages.background.RICH_MDD_RESOURCE,
        requestId,
        ownerToken: CONTENT_DOCUMENT_OWNER_TOKEN,
        dictionaryId: session.dictionaryId,
        path: resource.path
      });
    } finally {
      session.inFlightRequests.delete(requestId);
    }
    if (!isCurrent(session) || !response?.ok || !response.found) throw new Error("MDD resource is unavailable.");
    const size = Number(response.size);
    const mime = String(response.mime || "");
    const expectedMime = {
      image: /^image\/(?:png|jpeg|gif|webp)$/u,
      audio: /^audio\/(?:wav|mpeg|ogg|mp4|aac|flac)$/u,
      stylesheet: /^text\/css$/u
    }[resource.kind];
    const base64 = String(response.base64 || "");
    if (!expectedMime?.test(mime) || !Number.isSafeInteger(size) || size <= 0 || size > MAX_ASSET_BYTES || base64.length > MAX_BASE64_CHARS) {
      throw new Error("MDD resource failed the viewer bounds.");
    }
    const bytes = decodeBase64(base64, size);
    if (resource.kind === "stylesheet" && bytes.byteLength > MAX_STYLESHEET_BYTES) throw new Error("MDD stylesheet is too large.");
    const width = Number(response.width);
    const height = Number(response.height);
    if (resource.kind === "image" && (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0)) {
      throw new Error("MDD image dimensions are missing.");
    }
    return { bytes, mime, size, width, height };
  }

  function createTrackedUrl(session, asset, pixels) {
    if (!isCurrent(session) || session.objectBytes + asset.size > MAX_VIEW_BLOB_BYTES) return "";
    let url = "";
    try { url = URL.createObjectURL(new Blob([asset.bytes], { type: asset.mime })); } catch { return ""; }
    session.urls.set(url, { size: asset.size, pixels });
    session.objectBytes += asset.size;
    session.imagePixels += pixels;
    activeObjectUrlCount += 1;
    return url;
  }

  function revokeUrl(session, url) {
    const item = session.urls.get(url);
    if (!item) return;
    session.urls.delete(url);
    session.objectBytes = Math.max(0, session.objectBytes - item.size);
    session.imagePixels = Math.max(0, session.imagePixels - item.pixels);
    activeObjectUrlCount = Math.max(0, activeObjectUrlCount - 1);
    try { URL.revokeObjectURL(url); } catch {}
  }

  function close(container) {
    const session = sessionsByContainer.get(container);
    if (!session) return;
    closeSession(session, false);
  }

  function closeAll() {
    for (const session of [...activeSessions]) closeSession(session, false);
  }

  function closeDictionary(dictionaryId) {
    const id = String(dictionaryId || "");
    for (const session of [...activeSessions]) {
      if (session.dictionaryId === id) closeSession(session, true);
    }
  }

  function closeSession(session, restorePlaceholders) {
    if (session.closed) return;
    session.closed = true;
    if (sessionsByContainer.get(session.container) === session) sessionsByContainer.delete(session.container);
    activeSessions.delete(session);
    cancelQueuedReads(session);
    cancelRunningReads(session);
    for (const url of [...session.urls.keys()]) revokeUrl(session, url);
    for (const resource of session.resources) {
      resource.styleNode?.remove();
      if (restorePlaceholders) {
        try { resource.onClose?.(); } catch {}
      }
    }
  }

  function isCurrent(session) {
    return !session.closed && sessionsByContainer.get(session.container) === session;
  }

  function scheduleRead(session, action) {
    return new Promise((resolve, reject) => {
      if (!isCurrent(session)) {
        resolve(undefined);
        return;
      }
      readQueue.push({ session, action, resolve, reject });
      drainReads();
    });
  }

  function cancelQueuedReads(session) {
    for (let index = readQueue.length - 1; index >= 0; index -= 1) {
      if (readQueue[index].session !== session) continue;
      const [job] = readQueue.splice(index, 1);
      job.resolve(undefined);
    }
  }

  function cancelRunningReads(session) {
    const requestIds = [...session.inFlightRequests];
    session.inFlightRequests.clear();
    for (const requestId of requestIds) {
      void sendRuntimeMessage({
        type: messages.background.RICH_MDD_RESOURCE_READ_CANCEL,
        requestId,
        ownerToken: CONTENT_DOCUMENT_OWNER_TOKEN
      }).catch(() => {});
    }
  }

  function drainReads() {
    while (runningReads < MAX_CONCURRENT_READS && readQueue.length) {
      const job = readQueue.shift();
      if (!isCurrent(job.session)) {
        job.resolve(undefined);
        continue;
      }
      runningReads += 1;
      Promise.resolve()
        .then(() => isCurrent(job.session) ? job.action() : undefined)
        .then(job.resolve, job.reject)
        .finally(() => {
          runningReads -= 1;
          drainReads();
        });
    }
  }

  function compileLocalStylesheet(bytes) {
    let source;
    try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return ""; }
    if (!source || bytes.byteLength > MAX_STYLESHEET_BYTES || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(source)) return "";
    if (/@|\/\*|\*\/|\\|url\s*\(|expression\s*\(|javascript\s*:|vbscript\s*:/iu.test(source)) return "";
    const styleApi = app.modules.richDictionarySanitizerStyle;
    if (!styleApi?.safeStyleValue) return "";
    const rules = [];
    let offset = 0;
    const pattern = /([^{}]+)\{([^{}]*)\}/g;
    for (const match of source.matchAll(pattern)) {
      if (match.index !== offset && source.slice(offset, match.index).trim()) return "";
      offset = match.index + match[0].length;
      const selectors = match[1].split(",").map((item) => item.trim()).filter(Boolean);
      if (!selectors.length || selectors.length > 3) return "";
      const safeSelectors = selectors.map(normalizeLocalSelector);
      if (safeSelectors.some((selector) => !selector)) return "";
      const declarations = [];
      for (const declaration of match[2].split(";")) {
        if (!declaration.trim()) continue;
        const separator = declaration.indexOf(":");
        if (separator <= 0 || declarations.length >= 12) return "";
        const property = declaration.slice(0, separator).trim().toLowerCase();
        const rawValue = declaration.slice(separator + 1).trim();
        const value = styleApi.safeStyleValue(property, rawValue);
        if (!value || !ALLOWED_STYLESHEET_PROPERTIES.has(property)) continue;
        declarations.push(`${property}:${property === "font-size" ? `clamp(8px, ${value}, 48px)` : value}`);
      }
      if (!declarations.length) continue;
      rules.push(`${safeSelectors.map((selector) => `.tf-rich-viewer ${selector}`).join(",")}{${declarations.join(";")}}`);
      if (rules.length > 64) return "";
    }
    if (source.slice(offset).trim()) return "";
    return rules.join("\n");
  }

  const ALLOWED_STYLESHEET_TAGS = new Set(["div", "span", "p", "br", "b", "strong", "i", "em", "u", "ul", "ol", "li", "table", "tr", "td", "th", "ruby", "rt", "rp"]);
  const ALLOWED_STYLESHEET_PROPERTIES = new Set([
    "color", "background-color", "font-size", "font-weight", "font-style", "text-decoration", "text-align",
    "vertical-align", "white-space", "line-height", "margin", "margin-top", "margin-right", "margin-bottom",
    "margin-left", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "border",
    "border-top", "border-right", "border-bottom", "border-left", "border-color", "border-width", "border-style",
    "border-collapse", "border-spacing"
  ]);

  function normalizeLocalSelector(value) {
    const selector = String(value || "").trim();
    const match = /^(?:(div|span|p|br|b|strong|i|em|u|ul|ol|li|table|tr|td|th|ruby|rt|rp))?(?:\.([-_a-z][-_a-z0-9]{0,47}))?$/iu.exec(selector);
    if (!match || (!match[1] && !match[2])) return "";
    if (match[1] && !ALLOWED_STYLESHEET_TAGS.has(match[1].toLowerCase())) return "";
    return `${match[1] ? match[1].toLowerCase() : ""}${match[2] ? `.${match[2]}` : ""}`;
  }

  function createResourceRequestId() {
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
      fallbackRequestCounter += 1;
      bytes[0] ^= fallbackRequestCounter & 0xff;
    }
    return REQUEST_ID_PREFIX + Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function createContentDocumentOwnerToken() {
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function decodeBase64(base64, expectedSize) {
    if (!base64 || !/^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/iu.test(base64)) throw new Error("MDD resource encoding is invalid.");
    const binary = atob(base64);
    if (binary.length !== expectedSize || binary.length > MAX_ASSET_BYTES) throw new Error("MDD resource byte length is inconsistent.");
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function makePlaceholder(kind, label = "") {
    const node = kind === "audio" ? document.createElement("button") : document.createElement("span");
    node.className = "tf-rich-placeholder";
    locale.bindAttribute(node, "aria-label", kind === "image" ? "content.rich.imageMissing" : "content.rich.audioMissing");
    locale.bindText(node,
      label ? (kind === "image" ? "content.rich.imageLabel" : "content.rich.audioLabel")
        : (kind === "image" ? "content.rich.imageMissing" : "content.rich.audioMissing"),
      label ? { label } : {});
    return node;
  }

  app.modules.richResourceResolver = Object.freeze({
    attach,
    close,
    closeAll,
    closeDictionary,
    compileLocalStylesheet,
    get activeObjectUrlCount() { return activeObjectUrlCount; },
    get pendingReadCount() { return readQueue.length; },
    get runningReadCount() { return runningReads; }
  });
})();
