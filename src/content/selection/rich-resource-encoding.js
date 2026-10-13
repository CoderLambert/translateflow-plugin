(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
  if (app.modules.richResourceEncoding) return;
  const MAX_ASSET_BYTES = 8 * 1024 * 1024;
  function decodeBase64(base64, expectedSize) {
    if (!isStrictBase64(base64)) throw new Error("MDD resource encoding is invalid.");
    const binary = atob(base64);
    if (binary.length !== expectedSize || binary.length > MAX_ASSET_BYTES) throw new Error("MDD resource byte length is inconsistent.");
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function isStrictBase64(value) {
    if (!value || value.length % 4 !== 0) return false;
    const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
    const payloadEnd = value.length - padding;
    if ((padding === 2 && payloadEnd % 4 !== 2) || (padding === 1 && payloadEnd % 4 !== 3)) return false;
    for (let index = 0; index < payloadEnd; index += 1) {
      const code = value.charCodeAt(index);
      if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
          (code >= 48 && code <= 57) || code === 43 || code === 47)) return false;
    }
    for (let index = payloadEnd; index < value.length; index += 1) {
      if (value.charCodeAt(index) !== 61) return false;
    }
    return true;
  }

  app.modules.richResourceEncoding = Object.freeze({ decodeBase64, isStrictBase64 });
})();
