(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
  if (app.modules.richSvg) return;
  const namespace = "http://www.w3.org/2000/svg";
  function build(scene, ownerDocument = document) {
    const checked = app.modules.safeSvg?.validateSafeSvgScene(scene);
    if (!checked) return null;
    function node(item) {
      const element = ownerDocument.createElementNS(namespace, item.tag);
      for (const [key, value] of Object.entries(item.attrs)) element.setAttribute(key, value);
      for (const child of item.children) element.appendChild(node(child));
      return element;
    }
    const element = node(checked.scene.root);
    element.setAttribute("width", String(checked.width));
    element.setAttribute("height", String(checked.height));
    element.setAttribute("role", "img");
    element.setAttribute("focusable", "false");
    element.style.maxWidth = "100%";
    element.style.maxHeight = "360px";
    element.style.overflow = "hidden";
    return { element, ...checked };
  }
  function asset(response) {
    const checked = app.modules.safeSvg?.validateSafeSvgScene(response.safeSvg);
    if (!checked || response.kind !== "image" || response.mime !== "image/svg+xml" ||
        !Number.isSafeInteger(response.size) || response.size <= 0 || response.size > 65536 ||
        response.base64 !== undefined || checked.width !== response.width || checked.height !== response.height) {
      throw new Error("Static SVG resource failed scene verification.");
    }
    return { ...checked, safeSvg: checked.scene, size: response.size, mime: response.mime, width: checked.width, height: checked.height };
  }
  function create({ isCurrent, scheduleRead, fetchAsset, maxActiveBytes, maxImageBytes, maxImagePixels, makePlaceholder }) {
    async function load(session, resource) {
      try {
        const image = await scheduleRead(session, () => fetchAsset(session, resource));
        if (!image || !isCurrent(session)) return;
        const checked = asset({ ...image, kind: "image", safeSvg: image.safeSvg });
        const instances = resource.instances.filter((item) => item.element?.parentNode);
        const count = checked.nodes * instances.length;
        const pixels = checked.width * checked.height * instances.length;
        if (!instances.length || viewerNodes(session) + count - instances.length > 32767 ||
            session.objectBytes + image.size > maxActiveBytes || session.imageBytes + image.size > maxImageBytes ||
            session.imagePixels + pixels > maxImagePixels) return;
        const prepared = instances.map((item) => ({ item, built: build(checked.scene, session.container.ownerDocument) }));
        if (!isCurrent(session) || prepared.some((item) => !item.built)) return;
        session.svgBytes = (session.svgBytes || 0) + image.size;
        session.svgPixels = (session.svgPixels || 0) + pixels;
        session.objectBytes += image.size; session.imageBytes += image.size; session.imagePixels += pixels;
        for (const { item, built } of prepared) {
          built.element.setAttribute("class", "tf-rich-resource-image");
          if (resource.label) built.element.setAttribute("aria-label", resource.label);
          item.element.replaceWith(built.element); item.element = built.element;
        }
      } catch { /* The existing local image placeholder remains readable. */ }
    }
    function viewerNodes(session) {
      const body = session.container.closest?.(".tf-selection-rich-card-body");
      const viewports = body ? [...body.querySelectorAll(".tf-selection-rich-text")].map((host) => host.shadowRoot?.querySelector(".tf-rich-viewer")).filter(Boolean) : [session.viewport];
      let total = 0;
      const walk = (node) => { for (const child of node.childNodes || []) { total += 1; if (total > 32768) return; walk(child); } };
      for (const viewport of viewports) walk(viewport);
      return total;
    }
    function close(session, restore = false) {
      if (restore) for (const resource of session.resources) for (const item of resource.instances) {
        if (item.element?.namespaceURI !== namespace) continue;
        const placeholder = makePlaceholder("image", resource.label, resource.presentation);
        item.element.replaceWith(placeholder); item.element = placeholder;
      }
      session.objectBytes = Math.max(0, session.objectBytes - (session.svgBytes || 0));
      session.imageBytes = Math.max(0, session.imageBytes - (session.svgBytes || 0));
      session.imagePixels = Math.max(0, session.imagePixels - (session.svgPixels || 0));
      session.svgBytes = 0; session.svgPixels = 0;
    }
    return Object.freeze({ load, close });
  }
  app.modules.richSvg = Object.freeze({ build, asset, create });
})();
