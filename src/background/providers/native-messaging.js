export const CHATGPT_PLAN_NATIVE_HOST = "com.coderlambert.translateflow";

const NATIVE_PERMISSION = "nativeMessaging";
const PROTOCOL_VERSION = 1;
const REQUIRED_CAPABILITIES = Object.freeze([
  "auth.status", "auth.start", "auth.select", "auth.logout", "models.list", "infer.start", "cancel"
]);
const HANDSHAKE_TIMEOUT_MS = 5000;
let requestCounter = 0;

export class NativeHostError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "NativeHostError";
    this.code = code;
  }
}

export function createNativeMessagingClient({
  getBrowser = () => globalThis.chrome,
  hostName = CHATGPT_PLAN_NATIVE_HOST
} = {}) {
  let port = null;
  let portReady = false;
  let connecting = null;
  let activeInferenceId = "";
  const pending = new Map();

  async function ensureConnected() {
    const browser = getBrowser();
    const runtime = browser?.runtime;
    await assertPermission(browser, runtime);
    if (port && portReady) return;
    if (connecting) return connecting;

    connecting = (async () => {
      let candidate;
      try {
        candidate = runtime.connectNative(hostName);
      } catch {
        throw hostUnavailable();
      }
      if (!candidate?.onMessage?.addListener || !candidate?.onDisconnect?.addListener || typeof candidate.postMessage !== "function") {
        try { candidate?.disconnect?.(); } catch {}
        throw protocolError();
      }
      port = candidate;
      portReady = false;
      candidate.onMessage.addListener(value => receive(candidate, value));
      candidate.onDisconnect.addListener(() => {
        // Chrome exposes lastError only while this listener is running. Its text
        // is intentionally not forwarded to callers or logs.
        const unavailable = Boolean(runtime.lastError);
        close(candidate, unavailable ? hostUnavailable() : disconnected());
      });

      try {
        const hello = await sendOn(candidate, "hello", {}, { timeoutMs: HANDSHAKE_TIMEOUT_MS });
        if (hello?.protocolVersion !== PROTOCOL_VERSION || !Array.isArray(hello.capabilities) ||
          REQUIRED_CAPABILITIES.some(capability => !hello.capabilities.includes(capability))) {
          throw protocolError();
        }
        if (port !== candidate) throw disconnected();
        portReady = true;
      } catch (error) {
        close(candidate, normalizeClientError(error));
        throw normalizeClientError(error);
      }
    })();

    try {
      await connecting;
    } finally {
      connecting = null;
    }
  }

  async function request(method, payload = {}, options = {}) {
    await ensureConnected();
    if (options.signal?.aborted) throw cancelled();
    if (method === "infer.start" && activeInferenceId) throw hostBusy();
    const current = port;
    if (!current || !portReady) throw disconnected();
    return sendOn(current, method, payload, options);
  }

  async function authStatus() { return request("auth.status"); }
  async function startAuth({ addAccount = false } = {}) { return request("auth.start", { addAccount: Boolean(addAccount) }); }
  async function selectAccount(accountId) { return request("auth.select", { accountId: String(accountId || "") }); }
  async function logout() { return request("auth.logout"); }
  async function listModels() { return request("models.list"); }
  async function infer(input, { signal, onDelta } = {}) {
    return request("infer.start", input, { signal, onEvent: event => {
      if (event.name === "infer.delta" && typeof event.payload?.text === "string") onDelta?.(event.payload.text);
    } });
  }

  function sendOn(target, method, payload, { signal, onEvent, timeoutMs = 0 } = {}) {
    if (signal?.aborted) return Promise.reject(cancelled());
    if (method === "infer.start" && activeInferenceId) return Promise.reject(hostBusy());
    const requestId = nextRequestId();
    return new Promise((resolve, reject) => {
      const entry = { requestId, method, sequence: 0, resolve, reject, signal, onEvent, timeout: null, abort: null, cancelSent: false };
      pending.set(requestId, entry);
      if (method === "infer.start") activeInferenceId = requestId;
      if (timeoutMs > 0) {
        entry.timeout = setTimeout(() => {
          close(target, new NativeHostError("NATIVE_HOST_TIMEOUT", "The native host did not respond in time."));
        }, timeoutMs);
      }
      if (signal) {
        entry.abort = () => {
          if (entry.method !== "infer.start" || entry.cancelSent || !pending.has(requestId)) return;
          entry.cancelSent = true;
          void sendOn(target, "cancel", { requestId }).catch(() => {});
        };
        signal.addEventListener("abort", entry.abort, { once: true });
      }
      try {
        target.postMessage({ type: "request", requestId, method, payload });
      } catch {
        settle(entry, false, disconnected());
        close(target, disconnected());
      }
    });
  }

  function receive(source, value) {
    if (source !== port || !isObject(value) || typeof value.requestId !== "string" ||
      !Number.isSafeInteger(value.sequence) || value.sequence < 0) {
      close(source, protocolError());
      return;
    }
    const entry = pending.get(value.requestId);
    if (!entry) {
      close(source, protocolError());
      return;
    }
    if (value.sequence !== entry.sequence) {
      close(source, protocolError());
      return;
    }
    entry.sequence += 1;

    if (value.type === "event") {
      if (typeof value.event !== "string") {
        close(source, protocolError());
        return;
      }
      if (entry.method === "infer.start" && value.event !== "infer.delta" ||
        entry.method === "auth.start" && value.event !== "auth.waiting" ||
        !["infer.start", "auth.start"].includes(entry.method)) {
        close(source, protocolError());
        return;
      }
      if (value.event === "infer.delta" && (!isObject(value.payload) || typeof value.payload.text !== "string" || value.payload.text.length > 128 * 1024)) {
        close(source, protocolError());
        return;
      }
      try { entry.onEvent?.({ name: value.event, payload: value.payload }); } catch {}
      return;
    }

    if (value.type !== "terminal" || typeof value.ok !== "boolean") {
      close(source, protocolError());
      return;
    }
    if (entry.signal?.aborted && entry.method === "infer.start") {
      settle(entry, false, cancelled());
    } else if (!value.ok) {
      const code = typeof value.error?.code === "string" ? normalizeErrorCode(value.error.code) : "NATIVE_HOST_ERROR";
      settle(entry, false, errorFor(code));
    } else if (!isObject(value.payload)) {
      settle(entry, false, protocolError());
    } else {
      settle(entry, true, value.payload);
    }
  }

  function close(source, error) {
    if (source !== port) return;
    port = null;
    portReady = false;
    try { source.disconnect?.(); } catch {}
    for (const entry of pending.values()) settle(entry, false, error);
  }

  function settle(entry, succeeded, value) {
    if (!pending.has(entry.requestId)) return;
    pending.delete(entry.requestId);
    if (entry.timeout) clearTimeout(entry.timeout);
    if (entry.abort) entry.signal?.removeEventListener("abort", entry.abort);
    if (activeInferenceId === entry.requestId) activeInferenceId = "";
    if (succeeded) entry.resolve(value); else entry.reject(normalizeClientError(value));
  }

  return Object.freeze({ ensureConnected, authStatus, startAuth, selectAccount, logout, listModels, infer });
}

export const nativeMessagingClient = createNativeMessagingClient();

async function assertPermission(browser, runtime) {
  if (typeof runtime?.connectNative !== "function" || typeof runtime?.getManifest !== "function") {
    throw new NativeHostError("NATIVE_MESSAGING_UNAVAILABLE", "Native messaging is unavailable in this browser context.");
  }
  const manifest = runtime.getManifest();
  const required = Array.isArray(manifest?.permissions) && manifest.permissions.includes(NATIVE_PERMISSION);
  const optional = Array.isArray(manifest?.optional_permissions) && manifest.optional_permissions.includes(NATIVE_PERMISSION);
  let granted = required;
  if (optional && typeof browser?.permissions?.contains === "function") {
    try { granted = await browser.permissions.contains({ permissions: [NATIVE_PERMISSION] }); } catch { granted = false; }
  }
  if (!required && !optional || !granted) {
    throw new NativeHostError("NATIVE_MESSAGING_PERMISSION", "The extension does not have native messaging permission. Install the host component and authorize native messaging first.");
  }
}

function normalizeErrorCode(code) {
  if (code === "HOST_BUSY" || code === "busy") return "HOST_BUSY";
  if (["token_expired", "token_refresh_failed", "token_unavailable", "session_changed", "not_signed_in"].includes(code)) return "RECONNECT_REQUIRED";
  if (code === "missing_scope") return "MISSING_SCOPE";
  if (code === "cancelled") return "CANCELLED";
  if (["inference_incomplete", "stream_incomplete"].includes(code)) return "INFERENCE_INCOMPLETE";
  if (["inference_failed", "stream_failed", "inference_unavailable"].includes(code)) return "INFERENCE_FAILED";
  if (code === "models_unavailable" || code === "models_response_invalid") return "MODELS_UNAVAILABLE";
  if (code === "account_not_found") return "ACCOUNT_NOT_FOUND";
  if (code === "invalid_account") return "CHATGPT_ACCOUNT_INVALID";
  return code;
}

function errorFor(code) {
  const messages = {
    HOST_BUSY: "Another ChatGPT subscription operation is still running. Wait for it to finish and retry.",
    RECONNECT_REQUIRED: "The ChatGPT session needs to be reconnected in Settings.",
    MISSING_SCOPE: "This ChatGPT account does not have the required plan access.",
    CANCELLED: "The ChatGPT request was cancelled.",
    INFERENCE_INCOMPLETE: "ChatGPT returned an incomplete response. No partial answer was saved.",
    INFERENCE_FAILED: "ChatGPT could not complete the response. No partial answer was saved.",
    MODELS_UNAVAILABLE: "ChatGPT models could not be loaded.",
    ACCOUNT_NOT_FOUND: "The selected ChatGPT account is no longer available.",
    CHATGPT_ACCOUNT_INVALID: "Select a valid saved ChatGPT account.",
    NATIVE_HOST_UNAVAILABLE: "TranslateFlow native host is not installed or registered for this user.",
    NATIVE_HOST_DISCONNECTED: "TranslateFlow native host disconnected before completing the request.",
    NATIVE_HOST_PROTOCOL: "TranslateFlow native host returned an unsupported protocol response.",
    NATIVE_HOST_TIMEOUT: "TranslateFlow native host did not respond in time.",
    NATIVE_HOST_ERROR: "The ChatGPT native host request failed."
  };
  return new NativeHostError(code, messages[code] || "The ChatGPT native host request failed.");
}

function normalizeClientError(error) {
  if (error instanceof NativeHostError) return error;
  return disconnected();
}

function hostUnavailable() { return errorFor("NATIVE_HOST_UNAVAILABLE"); }
function disconnected() { return errorFor("NATIVE_HOST_DISCONNECTED"); }
function protocolError() { return errorFor("NATIVE_HOST_PROTOCOL"); }
function hostBusy() { return errorFor("HOST_BUSY"); }
function cancelled() { return errorFor("CANCELLED"); }
function isObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function nextRequestId() {
  const random = globalThis.crypto?.randomUUID?.();
  return `tf-${random || `${Date.now().toString(36)}-${(++requestCounter).toString(36)}`}`;
}
