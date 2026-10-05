(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
  if (!app.modules.runtime || !app.modules.contentI18n || !app.modules.richResourcePath || !app.modules.richResourceMedia || app.modules.richResourceResolver) return;

  const MAX_RESOURCE_COUNT = 1024;
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
  const locale = app.modules.contentI18n;
  const media = app.modules.richResourceMedia.create({
    isCurrent,
    scheduleRead,
    fetchAsset,
    createTrackedUrl,
    revokeUrl,
    makePlaceholder,
    cancelResourceRequest,
    maxViewImagePixels: MAX_VIEW_IMAGE_PIXELS
  });

  function attach(container, shadowRoot, viewport, resources, dictionaryId, packageVersion = "") {
    close(container);
    const session = {
      container,
      shadowRoot,
      viewport,
      dictionaryId: String(dictionaryId || ""),
      packageVersion: String(packageVersion || ""),
      closed: false,
      resources: [],
      urls: new Map(),
      inFlightRequests: new Set(),
      activeAudio: null,
      imageObserver: null,
      observedImages: new WeakMap(),
      objectBytes: 0,
      imagePixels: 0
    };
    sessionsByContainer.set(container, session);
    activeSessions.add(session);
    for (const item of Array.isArray(resources) ? resources.slice(0, MAX_RESOURCE_COUNT) : []) {
      const path = app.modules.richResourcePath.normalize(item?.path);
      if (!path || path !== item.path || !["image", "audio", "stylesheet"].includes(item.kind)) continue;
      const elements = Array.isArray(item?.elements)
        ? item.elements.filter(Boolean)
        : item?.element ? [item.element] : [];
      const key = `${item.kind}\u0000${path}`;
      if (session.resources.some((existing) => `${existing.kind}\u0000${existing.path}` === key)) continue;
      session.resources.push({
        kind: item.kind,
        path,
        label: String(item.label || "").slice(0, 160),
        instances: elements.map((element) => ({ element, loaded: false, loading: false, objectUrl: "" })),
        inFlightRequests: new Set(),
        styleNode: null
      });
    }
    for (const resource of session.resources) {
      if (resource.kind === "audio") media.installAudioLoader(session, resource);
      else if (resource.kind === "image") media.installLazyImages(session, resource);
      else void scheduleRead(session, () => loadStylesheet(session, resource));
    }
    return session;
  }

  async function loadStylesheet(session, resource) {
    if (!isCurrent(session)) return;
    try {
      const asset = await fetchAsset(session, resource);
      if (!isCurrent(session)) return;
      if (resource.kind === "stylesheet") {
        let css = typeof asset.safeCss === "string"
          ? asset.safeCss
          : app.modules.richResourceStylesheet?.compileLocalStylesheet(asset.bytes) || "";
        for (const slot of asset.assetSlots) {
          if (!isCurrent(session)) return;
          try {
            const image = await fetchAsset(session, { kind: "image", path: slot.path, label: "" });
            if (!isCurrent(session)) return;
            const pixels = image.width * image.height;
            if (!Number.isSafeInteger(pixels) || pixels <= 0 || pixels > MAX_VIEW_IMAGE_PIXELS) {
              css = css.replaceAll(slot.token, "none");
              continue;
            }
            const url = createTrackedUrl(session, image, pixels);
            if (!url) {
              css = css.replaceAll(slot.token, "none");
              continue;
            }
            css = css.replaceAll(slot.token, `url("${url}")`);
          } catch (error) {
            if (!isCurrent(session)) return;
            if (error?.code !== "RICH_MDD_RESOURCE_MISSING") throw error;
            css = css.replaceAll(slot.token, "none");
          }
        }
        if (!css || !isCurrent(session)) return;
        const style = document.createElement("style");
        style.textContent = css;
        session.shadowRoot.appendChild(style);
        resource.styleNode = style;
        return;
      }
    } catch {
      if (!isCurrent(session)) return;
      for (const instance of resource.instances) {
        if (instance.element?.isConnected || instance.element?.parentNode) {
          instance.element.replaceWith(makePlaceholder(resource.kind, resource.label));
        }
      }
    }
  }

  async function fetchAsset(session, resource) {
    if (!isCurrent(session)) throw new Error("Rich viewer is closed.");
    const requestId = createResourceRequestId();
    session.inFlightRequests.add(requestId);
    resource.inFlightRequests?.add(requestId);
    let response;
    try {
      response = await sendRuntimeMessage({
        type: messages.background.RICH_MDD_RESOURCE,
        requestId,
        ownerToken: CONTENT_DOCUMENT_OWNER_TOKEN,
        dictionaryId: session.dictionaryId,
        path: resource.path,
        ...(session.packageVersion ? { packageVersion: session.packageVersion } : {})
      });
    } finally {
      session.inFlightRequests.delete(requestId);
      resource.inFlightRequests?.delete(requestId);
    }
    if (!isCurrent(session) || !response?.ok) throw new Error("MDD resource is unavailable.");
    if (response.stale || (session.packageVersion && response.packageVersion !== session.packageVersion)) {
      const error = new Error("MDD package version changed while this entry was being rendered.");
      error.code = "RICH_MDD_RESOURCE_STALE";
      throw error;
    }
    if (!response.found) {
      const error = new Error("MDD resource is unavailable.");
      error.code = "RICH_MDD_RESOURCE_MISSING";
      throw error;
    }
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
    const safeCss = typeof response.safeCss === "string" && response.safeCss.length <= MAX_STYLESHEET_BYTES
      ? response.safeCss
      : "";
    const assetSlots = normalizeStylesheetAssetSlots(response.assetSlots);
    return { bytes, mime, size, width, height, safeCss, assetSlots };
  }

  function normalizeStylesheetAssetSlots(input) {
    if (!Array.isArray(input) || input.length > MAX_RESOURCE_COUNT) return [];
    const slots = [];
    const names = new Set();
    for (const item of input) {
      const token = String(item?.token || "");
      const path = app.modules.richResourcePath.normalize(item?.path || "");
      if (!/^tfasset[0-7]$/u.test(token) || !path || path !== item.path || names.has(token) || item.kind !== "image") continue;
      names.add(token);
      slots.push({ token, path });
    }
    return slots;
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
    session.imageObserver?.disconnect();
    if (session.activeAudio) media.releaseActiveAudio(session, session.activeAudio, false);
    cancelQueuedReads(session);
    cancelRunningReads(session);
    for (const url of [...session.urls.keys()]) revokeUrl(session, url);
    for (const resource of session.resources) {
      resource.styleNode?.remove();
    }
    if (restorePlaceholders) media.restorePlaceholders(session);
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
    for (const requestId of requestIds) cancelResourceRequest(session, null, requestId);
  }

  function cancelResourceRequest(session, resource, requestId) {
    session.inFlightRequests.delete(requestId);
    resource?.inFlightRequests?.delete(requestId);
    void sendRuntimeMessage({
      type: messages.background.RICH_MDD_RESOURCE_READ_CANCEL,
      requestId,
      ownerToken: CONTENT_DOCUMENT_OWNER_TOKEN
    }).catch(() => {});
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
    compileLocalStylesheet: app.modules.richResourceStylesheet?.compileLocalStylesheet,
    get activeObjectUrlCount() { return activeObjectUrlCount; },
    get pendingReadCount() { return readQueue.length; },
    get runningReadCount() { return runningReads; }
  });
})();
