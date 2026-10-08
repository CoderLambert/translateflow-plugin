(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
  if (!app.modules.contentI18n || app.modules.richResourceMedia) return;
  const locale = app.modules.contentI18n;

  function create({ isCurrent, scheduleRead, fetchAsset, createTrackedUrl, revokeUrl, makePlaceholder, cancelResourceRequest,
    maxAssetBytes, maxViewImageBytes, maxViewImagePixels }) {
    function installLazyImages(session, resource) {
      if (!resource.instances.length) return;
      if (typeof IntersectionObserver !== "function") {
        for (const instance of resource.instances) {
          instance.visible = true;
          void loadImage(session, resource);
        }
        return;
      }
      session.imageObserver ||= new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const targetInfo = session.observedImages.get(entry.target);
          if (!targetInfo || !isCurrent(session)) continue;
          const { resource: observedResource, instance } = targetInfo;
          instance.visible = Boolean(entry.isIntersecting);
          if (instance.visible) {
            if (observedResource.objectUrl) showImageInstance(session, observedResource, instance);
            else void loadImage(session, observedResource);
          } else {
            hideImageInstance(session, observedResource, instance);
            releaseImageWhenOffscreen(session, observedResource);
          }
        }
      }, { root: session.viewport, rootMargin: "0px" });
      for (const instance of resource.instances) observeImageInstance(session, resource, instance);
    }

    function observeImageInstance(session, resource, instance) {
      if (!session.imageObserver || !instance.element || !isCurrent(session)) return;
      session.observedImages.set(instance.element, { resource, instance });
      session.imageObserver.observe(instance.element);
    }

    function replaceImageInstance(session, resource, instance, next) {
      const previous = instance.element;
      if (previous) {
        session.imageObserver?.unobserve(previous);
        session.observedImages.delete(previous);
        if (previous.isConnected || previous.parentNode) previous.replaceWith(next);
      }
      instance.element = next;
      observeImageInstance(session, resource, instance);
    }

    function showImageInstance(session, resource, instance) {
      const url = resource.objectUrl;
      if (!url || !instance.visible || !isCurrent(session)) return;
      if (instance.element?.tagName === "IMG" && instance.element.src === url) return;
      const image = document.createElement("img");
      image.className = "tf-rich-resource-image";
      const presentation = oxfordInlinePresentation(resource);
      if (presentation) {
        image.className += " tf-rich-resource-image-oxford-inline";
        const descriptionKey = presentation === "oxford-opposition"
          ? "content.rich.oxfordOppositionDescription" : "content.rich.oxfordKeyDescription";
        locale.bindAttribute(image, "alt", descriptionKey);
        locale.bindAttribute(image, "aria-label", descriptionKey);
        locale.bindAttribute(image, "title", descriptionKey);
      } else if (resource.label) image.alt = resource.label;
      else locale.bindAttribute(image, "alt", "content.rich.dictionaryImage");
      image.width = resource.imageWidth;
      image.height = resource.imageHeight;
      image.addEventListener("error", () => failImageResource(session, resource, url), { once: true });
      image.addEventListener("load", () => {
        if (!isCurrent(session)) revokeUrl(session, url);
      }, { once: true });
      image.src = url;
      replaceImageInstance(session, resource, instance, image);
    }

    function hideImageInstance(session, resource, instance) {
      const image = instance.element;
      if (image?.tagName !== "IMG") return;
      // Keep the image element's width/height box in layout while dropping its
      // Blob URL. Replacing a tall image with a text placeholder collapses the
      // viewer's scroll range and moves content the reader was following.
      image.removeAttribute("src");
      image.style.visibility = "hidden";
    }

    async function loadImage(session, resource) {
      if (!isCurrent(session) || resource.imageLoadFailed || resource.objectUrl || resource.loadingPromise ||
          !resource.instances.some((instance) => instance.visible)) return;
      resource.loadingPromise = (async () => {
        try {
          const asset = await scheduleRead(session, () => fetchAsset(session, resource));
          if (!asset || !isCurrent(session) || !resource.instances.some((instance) => instance.visible)) return;
          const width = asset.width;
          const height = asset.height;
          if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
              !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > maxAssetBytes) {
            resource.imageLoadFailed = true;
            return;
          }
          const pixels = width * height;
          if (!Number.isSafeInteger(pixels) || pixels <= 0 || pixels > maxViewImagePixels) {
            resource.imageLoadFailed = true;
            return;
          }
          if (session.imagePixels + pixels > maxViewImagePixels ||
              session.imageBytes + asset.size > maxViewImageBytes) return;
          const url = createTrackedUrl(session, asset, pixels, "image");
          if (!url || !isCurrent(session) || !resource.instances.some((instance) => instance.visible)) {
            if (url) revokeUrl(session, url);
            return;
          }
          resource.objectUrl = url;
          resource.imageWidth = width;
          resource.imageHeight = height;
          for (const instance of resource.instances) showImageInstance(session, resource, instance);
        } catch {
          // A failed or over-budget read leaves its observed placeholder in place.
          // Capacity changes call retryVisibleImages() so it can be tried again.
        }
      })().finally(() => {
        resource.loadingPromise = null;
      });
      await resource.loadingPromise;
    }

    function releaseImageWhenOffscreen(session, resource) {
      if (resource.instances.some((instance) => instance.visible) || !resource.objectUrl) return;
      const url = resource.objectUrl;
      resource.objectUrl = "";
      resource.imageWidth = 0;
      resource.imageHeight = 0;
      revokeUrl(session, url);
    }

    function failImageResource(session, resource, url) {
      if (resource.objectUrl !== url) return;
      resource.imageLoadFailed = true;
      resource.objectUrl = "";
      resource.imageWidth = 0;
      resource.imageHeight = 0;
      for (const instance of resource.instances) {
        if (instance.element?.tagName === "IMG" && instance.element.src === url) {
          const placeholder = makePlaceholder("image", resource.label);
          decorateOxfordPlaceholder(placeholder, oxfordInlinePresentation(resource));
          replaceImageInstance(session, resource, instance, placeholder);
        }
      }
      revokeUrl(session, url);
    }

    function retryVisibleImages(session) {
      if (!isCurrent(session)) return;
      for (const resource of session.resources) {
        if (resource.kind === "image" && !resource.objectUrl && !resource.imageLoadFailed &&
            !resource.loadingPromise && resource.instances.some((instance) => instance.visible)) {
          void loadImage(session, resource);
        }
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
        const url = createTrackedUrl(session, asset, 0, "audio");
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
        audio.addEventListener("error", () => {
          if (session.activeAudio === activeAudio) releaseActiveAudio(session, activeAudio, true);
        }, { once: true });
        if (button.parentNode) button.replaceWith(audio);
      } catch {
        if (session.activeAudio !== activeAudio || !isCurrent(session)) return;
        session.activeAudio = null;
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
      if (session.activeAudio === activeAudio) session.activeAudio = null;
      if (restoreButton && isCurrent(session)) bindAudioButton(session, activeAudio.resource, activeAudio.instance);
    }

    function restorePlaceholders(session) {
      for (const resource of session.resources) {
        for (const instance of resource.instances) {
          const element = instance.element;
          if (!element || !/^(?:AUDIO|IMG)$/u.test(element.tagName)) continue;
          const placeholder = makePlaceholder(resource.kind === "audio" ? "audio" : "image", resource.label);
          decorateOxfordPlaceholder(placeholder, oxfordInlinePresentation(resource));
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

    function oxfordInlinePresentation(resource) {
      if (resource?.presentation === "oxford-opposition" && resource.path === "img/OPP.png") return resource.presentation;
      if (resource?.presentation === "oxford-key" &&
          (resource.path === "img/Ox3000_key_L.png" || resource.path === "img/Ox3000_key_S.png")) return resource.presentation;
      return "";
    }

    function decorateOxfordPlaceholder(element, presentation) {
      if (!element || !presentation) return;
      const opposition = presentation === "oxford-opposition";
      const fallbackKey = opposition ? "content.rich.oxfordOppositionFallback" : "content.rich.oxfordKeyFallback";
      const descriptionKey = opposition ? "content.rich.oxfordOppositionDescription" : "content.rich.oxfordKeyDescription";
      element.className += " tf-rich-inline-symbol-placeholder";
      locale.bindText(element, fallbackKey);
      element.setAttribute("role", "img");
      locale.bindAttribute(element, "aria-label", descriptionKey);
      locale.bindAttribute(element, "title", descriptionKey);
    }

    return Object.freeze({ installLazyImages, installAudioLoader, releaseActiveAudio, restorePlaceholders, retryVisibleImages });
  }

  app.modules.richResourceMedia = Object.freeze({ create });
})();
