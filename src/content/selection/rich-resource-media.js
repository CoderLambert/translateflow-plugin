(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
  if (!app.modules.contentI18n || app.modules.richResourceMedia) return;
  const locale = app.modules.contentI18n;

  function create({ isCurrent, scheduleRead, fetchAsset, createTrackedUrl, revokeUrl, makePlaceholder, cancelResourceRequest,
    maxAssetBytes, maxViewImagePixels }) {
    function installLazyImages(session, resource) {
      if (!resource.instances.length) return;
      if (typeof IntersectionObserver !== "function") {
        for (const instance of resource.instances) void loadImage(session, resource, instance);
        return;
      }
      session.imageObserver ||= new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const target = entry.target;
          const targetInfo = session.observedImages.get(target);
          session.imageObserver?.unobserve(target);
          session.observedImages.delete(target);
          if (targetInfo) void loadImage(session, targetInfo.resource, targetInfo.instance);
        }
      }, { root: session.viewport, rootMargin: "0px" });
      for (const instance of resource.instances) {
        if (!instance.element) continue;
        session.observedImages.set(instance.element, { resource, instance });
        session.imageObserver.observe(instance.element);
      }
    }

    async function loadImage(session, resource, instance) {
      if (!isCurrent(session) || instance.loading || instance.loaded) return;
      instance.loading = true;
      try {
        const asset = await scheduleRead(session, () => fetchAsset(session, resource));
        if (!asset || !isCurrent(session)) return;
        const width = asset.width;
        const height = asset.height;
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) return;
        const pixels = width * height;
        if (!Number.isSafeInteger(pixels) || pixels > maxViewImagePixels || session.imagePixels + pixels > maxViewImagePixels) return;
        const url = createTrackedUrl(session, asset, pixels);
        if (!url || !isCurrent(session)) return;
        const image = document.createElement("img");
        image.className = "tf-rich-resource-image";
        if (resource.label) image.alt = resource.label;
        else locale.bindAttribute(image, "alt", "content.rich.dictionaryImage");
        image.width = width;
        image.height = height;
        image.addEventListener("error", () => {
          revokeUrl(session, url);
          instance.objectUrl = "";
          if (!isCurrent(session)) return;
          const placeholder = makePlaceholder("image", resource.label);
          image.replaceWith(placeholder);
          instance.element = placeholder;
          instance.loaded = false;
        }, { once: true });
        image.addEventListener("load", () => {
          if (!isCurrent(session)) revokeUrl(session, url);
        }, { once: true });
        image.src = url;
        if (instance.element?.isConnected || instance.element?.parentNode) instance.element.replaceWith(image);
        instance.element = image;
        instance.objectUrl = url;
        instance.loaded = true;
      } catch {
        if (!isCurrent(session)) return;
        if (instance.element?.isConnected || instance.element?.parentNode) {
          const placeholder = makePlaceholder("image", resource.label);
          instance.element.replaceWith(placeholder);
          instance.element = placeholder;
        }
      } finally {
        instance.loading = false;
      }
    }

    function installAudioLoader(session, resource) {
      for (const instance of resource.instances) bindAudioButton(session, resource, instance);
    }

    function bindAudioButton(session, resource, instance) {
      const button = makePlaceholder("audio", resource.label);
      button.className = "tf-rich-placeholder tf-rich-audio-load";
      button.type = "button";
      button.dataset.action = "load-mdd-audio";
      locale.bindText(button, resource.label ? "content.rich.loadAudio" : "content.rich.loadAudioGeneric", resource.label ? { label: resource.label } : {});
      locale.bindAttribute(button, "aria-label", resource.label ? "content.rich.loadAudio" : "content.rich.loadAudioGeneric", resource.label ? { label: resource.label } : {});
      button.addEventListener("click", () => { void loadAudio(session, resource, instance, button); });
      if (instance.element?.isConnected || instance.element?.parentNode) instance.element.replaceWith(button);
      instance.element = button;
    }

    async function loadAudio(session, resource, instance, button) {
      if (!isCurrent(session) || button.disabled) return;
      if (session.activeAudio) releaseActiveAudio(session, session.activeAudio, true);
      const activeAudio = { resource, instance, button, audio: null, objectUrl: "" };
      session.activeAudio = activeAudio;
      button.disabled = true;
      locale.bindText(button, "content.rich.loadingAudio");
      try {
        const asset = await scheduleRead(session, () => session.activeAudio === activeAudio ? fetchAsset(session, resource) : undefined);
        if (!asset || !isCurrent(session) || session.activeAudio !== activeAudio) return;
        const url = createTrackedUrl(session, asset, 0);
        if (!url) throw new Error("Audio resource budget was exceeded.");
        const audio = document.createElement("audio");
        audio.className = "tf-rich-resource-audio";
        audio.controls = true;
        audio.preload = "none";
        audio.autoplay = false;
        audio.setAttribute("controls", "");
        audio.setAttribute("preload", "none");
        audio.src = url;
        activeAudio.audio = audio;
        activeAudio.objectUrl = url;
        instance.element = audio;
        instance.objectUrl = url;
        instance.loaded = true;
        audio.addEventListener("error", () => {
          if (session.activeAudio === activeAudio) releaseActiveAudio(session, activeAudio, true);
        }, { once: true });
        if (button.parentNode) button.replaceWith(audio);
      } catch {
        if (session.activeAudio !== activeAudio || !isCurrent(session)) return;
        session.activeAudio = null;
        instance.loaded = false;
        bindAudioButton(session, resource, instance);
        locale.bindText(instance.element, resource.label ? "content.rich.audioUnreadable" : "content.rich.audioMissing", resource.label ? { label: resource.label } : {});
      }
    }

    function releaseActiveAudio(session, activeAudio, restoreButton) {
      if (!activeAudio) return;
      if (activeAudio.audio) {
        try {
          activeAudio.audio.pause();
          activeAudio.audio.removeAttribute("src");
          activeAudio.audio.load();
        } catch {}
      }
      for (const requestId of activeAudio.resource.inFlightRequests) cancelResourceRequest(session, activeAudio.resource, requestId);
      if (activeAudio.objectUrl) revokeUrl(session, activeAudio.objectUrl);
      activeAudio.instance.objectUrl = "";
      activeAudio.instance.loaded = false;
      if (session.activeAudio === activeAudio) session.activeAudio = null;
      if (restoreButton && isCurrent(session)) bindAudioButton(session, activeAudio.resource, activeAudio.instance);
    }

    function restorePlaceholders(session) {
      for (const resource of session.resources) {
        for (const instance of resource.instances) {
          const element = instance.element;
          if (!element || !/^(?:AUDIO|IMG)$/u.test(element.tagName)) continue;
          const placeholder = makePlaceholder(resource.kind === "audio" ? "audio" : "image", resource.label);
          if (resource.kind === "audio") {
            placeholder.className = "tf-rich-placeholder tf-rich-audio-load";
            placeholder.type = "button";
            placeholder.dataset.action = "load-mdd-audio";
            locale.bindText(placeholder, resource.label ? "content.rich.loadAudio" : "content.rich.loadAudioGeneric", resource.label ? { label: resource.label } : {});
            locale.bindAttribute(placeholder, "aria-label", resource.label ? "content.rich.loadAudio" : "content.rich.loadAudioGeneric", resource.label ? { label: resource.label } : {});
          }
          element.replaceWith(placeholder);
          instance.element = placeholder;
        }
      }
    }

    return Object.freeze({ installLazyImages, installAudioLoader, releaseActiveAudio, restorePlaceholders });
  }

  app.modules.richResourceMedia = Object.freeze({ create });
})();
