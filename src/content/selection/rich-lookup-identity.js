(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
  if (app.modules.richLookupIdentity) return;
  const REQUEST_ID_PREFIX = "selection-rich-lookup-";
  let fallbackRequestCounter = 0;
  function createLookupRequestId() {
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      // Extension contexts provide WebCrypto; this fallback is only for test/old browser harnesses.
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
      fallbackRequestCounter += 1;
      bytes[0] ^= fallbackRequestCounter & 0xff;
    }
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    return REQUEST_ID_PREFIX + hex;
  }

  function createContentDocumentOwnerToken() {
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      // Supported browsers provide WebCrypto; retain isolation in test harnesses
      // that execute the content module without a browser crypto global.
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  app.modules.richLookupIdentity = Object.freeze({ createLookupRequestId, createContentDocumentOwnerToken });
})();
