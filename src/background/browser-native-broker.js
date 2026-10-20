// Optional shared executor: a user-opened Options document, never a hidden tab.
import { NATIVE_PORT, NATIVE_PENDING_KEY, nativePair, nativeRequest, nativeErrorCode } from "../shared/browser-native-protocol.js";

export function createBrowserNativeBroker(api, { now = Date.now, timeoutMs = 35000, uuid = () => crypto.randomUUID() } = {}) {
  const clients = new Set(), hosts = new Set(), inflight = new Map();
  let persistence = Promise.resolve();
  const post = (port, value) => { try { port.postMessage(value); return true; } catch { return false; } };
  const fail = (port, id, code) => post(port, { id, ok: false, errorCode: code });
  const optionsSender = sender => { try { return new URL(sender.url).protocol === "chrome-extension:" && new URL(sender.url).hostname === api.runtime.id && new URL(sender.url).pathname === "/options.html"; } catch { return false; } };
  const contentSender = sender => Number.isInteger(sender.tab?.id) && /^https?:\/\//i.test(sender.url || "");
  function finish(id, value) {
    const task = inflight.get(id); if (!task) return;
    inflight.delete(id); clearTimeout(task.timer);
    post(task.client, { id: task.clientId, ...value });
  }
  function cancel(task, code = "CANCELLED") {
    post(task.host, { kind: "cancel", id: task.id }); finish(task.id, { ok: false, errorCode: code });
  }
  async function pendingState() {
    const data = await api.storage.session.get(NATIVE_PENDING_KEY), state = data?.[NATIVE_PENDING_KEY];
    if (!Array.isArray(state)) return [];
    return state.flatMap(item => {
      if (!item || !Number.isFinite(item.updatedAt) || item.updatedAt > now() || now() - item.updatedAt >= 86400000) return [];
      try { return [{ ...nativePair(item), updatedAt: item.updatedAt,
        ...(Number.isFinite(item.verifiedAt) && item.verifiedAt <= item.updatedAt ? { verifiedAt: item.verifiedAt } : {}) }]; }
      catch { return []; }
    }).slice(-32);
  }
  function updatePending(pair, verified) {
    const change = persistence.then(async () => {
      const state = (await pendingState()).filter(item => item.sourceLanguage !== pair.sourceLanguage || item.targetLanguage !== pair.targetLanguage);
      // Plain language codes/timestamps only. Never store source text or tokens.
      state.push({ ...pair, updatedAt: now(), ...(verified ? { verifiedAt: now() } : {}) });
      await api.storage.session.set({ [NATIVE_PENDING_KEY]: state.slice(-32) });
      return state;
    });
    persistence = change.catch(() => {}); return change;
  }
  function connect(port) {
    if (port.name !== NATIVE_PORT) return false;
    const sender = port.sender || {};
    if (sender.id !== api.runtime.id || (!optionsSender(sender) && !contentSender(sender))) { port.disconnect(); return true; }
    const isOptions = optionsSender(sender), cancelled = new Set(); let closed = false;
    clients.add(port);
    const disconnect = () => {
      if (closed) return; closed = true; clients.delete(port); hosts.delete(port);
      port.onMessage.removeListener(receive); port.onDisconnect.removeListener(disconnect);
      for (const task of [...inflight.values()]) {
        if (task.client === port) cancel(task);
        else if (task.host === port) cancel(task, "BROWSER_HOST_LOST");
      }
    };
    const receive = async message => {
      if (closed || !message || typeof message !== "object") return;
      const id = message.id;
      if (typeof id !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(id)) return;
      try {
        if (message.kind === "host-result") {
          const task = inflight.get(id);
          if (!isOptions || !hosts.has(port) || task?.host !== port) return;
          // UI consumers validate result shapes; never forward raw Error objects.
          finish(id, message.ok ? { ok: true, result: message.result } : { ok: false, errorCode: nativeErrorCode({ code: message.errorCode }) });
          return;
        }
        if (message.kind === "host-register") {
          if (!isOptions) return fail(port, id, "BROWSER_SCOPE");
          hosts.add(port); post(port, { id, ok: true, result: { registered: true } }); return;
        }
        if (message.kind === "cancel") {
          cancelled.add(id); if (cancelled.size > 256) cancelled.delete(cancelled.values().next().value);
          for (const task of inflight.values()) if (task.client === port && task.clientId === id) cancel(task);
          return;
        }
        if (message.kind === "pending-list") {
          if (!isOptions) return fail(port, id, "BROWSER_SCOPE");
          post(port, { id, ok: true, result: await pendingState() }); return;
        }
        if (message.kind === "pending-add" || message.kind === "pending-verified") {
          if (message.kind === "pending-verified" && !isOptions) return fail(port, id, "BROWSER_SCOPE");
          const pair = nativePair(message.pair);
          post(port, { id, ok: true, result: await updatePending(pair, message.kind === "pending-verified") }); return;
        }
        if (message.kind !== "call" || !contentSender(sender) || message.surface !== "selection-word") return fail(port, id, "BROWSER_SCOPE");
        const preferences = await api.storage.local.get(["browserTranslationEnabled", "translationPreferences"]);
        if (closed) return;
        if (cancelled.has(id)) return fail(port, id, "CANCELLED");
        if (!preferences.translationPreferences && preferences.browserTranslationEnabled === false) return fail(port, id, "BROWSER_DISABLED");
        const data = nativeRequest(message.action, message.data);
        const host = [...hosts].find(candidate => Boolean(candidate.sender?.tab?.incognito) === Boolean(sender.tab?.incognito));
        if (!host) return fail(port, id, "BROWSER_NO_HOST");
        if (inflight.size >= 64 || [...inflight.values()].filter(task => task.client === port).length >= 8) return fail(port, id, "BROWSER_BUSY");
        if ([...inflight.values()].some(task => task.client === port && task.clientId === id)) return fail(port, id, "BROWSER_PROTOCOL");
        const requestId = uuid(), task = { id: requestId, client: port, host, clientId: id, timer: null };
        task.timer = setTimeout(() => cancel(task, "BROWSER_TIMEOUT"), timeoutMs);
        inflight.set(requestId, task);
        if (!post(host, { kind: "host-call", id: requestId, action: message.action, data })) cancel(task, "BROWSER_HOST_LOST");
      } catch (cause) { fail(port, id, nativeErrorCode(cause)); }
    };
    port.onMessage.addListener(receive); port.onDisconnect.addListener(disconnect); return true;
  }
  return { connect, dispose() { for (const task of [...inflight.values()]) cancel(task); for (const port of [...clients]) { try { port.disconnect(); } catch {} } hosts.clear(); clients.clear(); }, status: () => ({ hosts: hosts.size, inflight: inflight.size }) };
}
