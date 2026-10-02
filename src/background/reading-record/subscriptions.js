import { READING_ERROR as E, READING_INVALIDATION_PORT, READING_METHOD as M, READING_PROTOCOL_VERSION as V } from "../../shared/reading/constants.js";
import { validateReadingInvalidation } from "../../shared/reading/invalidations.js";
import { fail } from "../../shared/reading/validation.js";

// Read-only Reading revision invalidations. No generic message forwarding or future assistant stream.
export function createReadingSubscriptions({ accessControl, repository } = {}) {
  const entries = new Map();
  async function connect(port) {
    let connected = true;
    const close = () => { connected = false; entries.delete(port); };
    port.onDisconnect.addListener(close);
    port.onMessage.addListener(() => { close(); port.disconnect(); }); // No caller scope/subscription payload accepted.
    try {
      if (port.name !== READING_INVALIDATION_PORT) fail(E.FORBIDDEN, "port.name");
      if (entries.size >= 128) fail(E.CAPACITY, "subscriptions");
      const entry = { close, access: null, assertCurrent: null };
      entries.set(port, entry); // Pending native/repository work consumes capacity before the first await.
      const access = await accessControl.authorize(port.sender, M.GET_RECORDING_STATE, {});
      if (!["content", "extension"].includes(access.scope)) fail(E.FORBIDDEN, "port.scope");
      if (typeof repository?.readInvalidationState !== "function") fail(E.NOT_READY, "repository");
      const assertCurrent = () => { if (!connected || entries.get(port) !== entry || !accessControl.isCurrent(access)) fail(E.STALE_OPERATION, "port.current"); };
      assertCurrent();
      const state = await repository.readInvalidationState({ access, assertCurrent });
      assertCurrent();
      const message = validateReadingInvalidation(state, access.scope);
      Object.assign(entry, { access, assertCurrent });
      port.postMessage(message);
    } catch (error) {
      const notify = connected;
      close(); // Release even if a raced native disconnect makes postMessage/disconnect throw.
      if (notify) {
        try { port.postMessage({ protocolVersion: V, ok: false, error: { code: Object.values(E).includes(error.code) ? error.code : E.STORAGE } }); } catch {}
        try { port.disconnect(); } catch {}
      }
    }
  }
  async function publish() {
    // Called only after repository commit; each short read verifies current policy/revision again.
    await Promise.all([...entries].filter(([, entry]) => entry.access).map(async ([port, entry]) => {
      try {
        const state = await repository.readInvalidationState(entry);
        entry.assertCurrent();
        port.postMessage(validateReadingInvalidation(state, entry.access.scope));
      } catch { entry.close(); try { port.disconnect(); } catch {} }
    }));
  }
  return { connect, publish, close() { for (const [port, entry] of [...entries]) { entry.close(); try { port.disconnect(); } catch {} } }, get size() { return entries.size; } };
}
