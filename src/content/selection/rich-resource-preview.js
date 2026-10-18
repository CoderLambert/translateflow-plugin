(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
  if (app.modules.richResourcePreview) return;
  function create({ isCurrent, scheduleRead, fetchAsset, createTrackedUrl, revokeUrl, cancelResourceRequest, maxActiveBytes, maxImageBytes, maxImagePixels }) {
    const locale = app.modules.contentI18n;
    function live(session, preview) { return session && isCurrent(session) && session.preview === preview && !preview.closed; }
    function open(session, key, opener) {
      if (!session || !isCurrent(session) || typeof key !== "string") return false;
      const descriptor = session.resources.find((item) => item.kind === "image" && app.modules.richResourcePath.descriptorKey(item.kind, item.path, item.presentation) === key);
      if (!descriptor || !opener || !session.viewport.contains(opener)) return false;
      close(session, false);
      if (nodeCount(session) + 11 > 32767) { locale.bindText(opener, "content.rich.illustrationUnavailable"); return false; }
      const dialog = document.createElement("div"); dialog.className = "tf-rich-image-preview"; dialog.setAttribute("role", "dialog");
      locale.bindAttribute(dialog, "aria-label", "content.rich.illustrationAria");
      dialog.style.cssText = "display:block!important;position:relative;max-width:100%;padding:8px;margin:6px 0;border:1px solid var(--tf-border-soft,#d8ddd4);border-radius:8px;background:var(--tf-bg-subtle,#f7f5ef);color:var(--tf-text-main,#3c463d)";
      const dismiss = document.createElement("button"); dismiss.type = "button"; locale.bindText(dismiss, "content.rich.closeIllustration");
      const status = document.createElement("div"); status.setAttribute("role", "status");
      const body = document.createElement("div"); const retry = document.createElement("button"); retry.type = "button"; locale.bindText(retry, "content.rich.retry"); retry.hidden = true;
      dialog.append(dismiss, status, body, retry); session.viewport.prepend(dialog);
      const resource = { kind: "image", path: descriptor.path, inFlightRequests: new Set() };
      const preview = { dialog, body, retry, status, opener, resource, closed: false, read: null, url: "", svgSize: 0, svgPixels: 0, token: 0 };
      session.preview = preview;
      dismiss.addEventListener("click", () => close(session)); retry.addEventListener("click", () => { void load(session, preview); });
      dismiss.focus({ preventScroll: true }); void load(session, preview); return true;
    }
    async function load(session, preview) {
      if (!live(session, preview) || preview.read) return;
      const token = ++preview.token; preview.retry.hidden = true; locale.bindText(preview.status, "content.rich.loadingIllustration");
      preview.read = scheduleRead(session, () => live(session, preview) ? fetchAsset(session, preview.resource) : undefined);
      try {
        const asset = await preview.read;
        if (!asset || !live(session, preview) || token !== preview.token) return;
        const pixels = asset.width * asset.height;
        if (!Number.isSafeInteger(pixels) || pixels <= 0 || pixels > maxImagePixels) throw new Error("Image preview exceeds its pixel budget.");
        let element;
        if (asset.safeSvg) {
          const built = app.modules.richSvg.build(asset.safeSvg, session.container.ownerDocument);
          if (!built || nodeCount(session) + built.nodes > 32767 || session.objectBytes + asset.size > maxActiveBytes ||
              session.imageBytes + asset.size > maxImageBytes || session.imagePixels + pixels > maxImagePixels) throw new Error("Image preview exceeds its scene budget.");
          preview.svgSize = asset.size; preview.svgPixels = pixels;
          session.objectBytes += asset.size; session.imageBytes += asset.size; session.imagePixels += pixels; element = built.element;
        } else {
          const url = createTrackedUrl(session, asset, pixels, "image");
          if (!url) throw new Error("Image preview exceeds its resource budget.");
          preview.url = url; element = document.createElement("img"); element.src = url; element.width = asset.width; element.height = asset.height;
          element.addEventListener("error", () => { if (live(session, preview)) fail(session, preview); }, { once: true });
        }
        element.style.maxWidth = "100%"; element.style.maxHeight = "360px"; element.style.objectFit = "contain";
        if (element.tagName === "IMG") locale.bindAttribute(element, "alt", "content.rich.illustrationAria");
        preview.body.replaceChildren(element); preview.status.textContent = "";
      } catch { if (live(session, preview)) fail(session, preview); }
      finally { preview.read = null; }
    }
    function nodeCount(session) {
      const body = session.container.closest?.(".tf-selection-rich-card-body");
      const viewports = body ? [...body.querySelectorAll(".tf-selection-rich-text")].map((host) => host.shadowRoot?.querySelector(".tf-rich-viewer")).filter(Boolean) : [session.viewport];
      let total = 0; const visit = (node) => { for (const child of node.childNodes || []) { if (++total > 32768) return; visit(child); } };
      for (const viewport of viewports) visit(viewport); return total;
    }
    function release(session, preview) {
      if (preview.url) { revokeUrl(session, preview.url); preview.url = ""; }
      session.objectBytes = Math.max(0, session.objectBytes - preview.svgSize); session.imageBytes = Math.max(0, session.imageBytes - preview.svgSize);
      session.imagePixels = Math.max(0, session.imagePixels - preview.svgPixels); preview.svgSize = 0; preview.svgPixels = 0;
      preview.body.replaceChildren();
    }
    function fail(session, preview) { release(session, preview); locale.bindText(preview.status, "content.rich.illustrationUnavailable"); preview.retry.hidden = false; }
    function close(session, restoreFocus = true) {
      const preview = session?.preview; if (!preview) return false;
      session.preview = null; preview.closed = true; preview.token += 1; preview.read?.cancel?.();
      for (const requestId of [...preview.resource.inFlightRequests]) cancelResourceRequest(session, preview.resource, requestId);
      release(session, preview); preview.dialog.remove();
      if (restoreFocus && preview.opener.isConnected) preview.opener.focus({ preventScroll: true }); return true;
    }
    return Object.freeze({ open, close });
  }
  app.modules.richResourcePreview = Object.freeze({ create });
})();
