import { NATIVE_PORT, nativeRequest, nativeErrorCode } from "../shared/browser-native-protocol.js";
const makeError = code => Object.assign(new Error(code), { code, i18nKey: `content.basic.${code}` });

export function createNativePortClient(runtime, timeoutMs = 35000) {
  let port = null, generation = 0;
  const pending = new Map();
  const post = value => { try { port?.postMessage(value); } catch { disconnect(); } };
  function disconnect() {
    const old = port; port = null; generation++;
    for (const item of [...pending.values()]) item.finish(false, makeError("BROWSER_HOST_LOST"));
    try { old?.disconnect(); } catch {}
  }
  function ensure() {
    if (port) return;
    port = runtime.connect({ name: NATIVE_PORT });
    const current = port;
    current.onDisconnect.addListener(() => { if (port === current) disconnect(); });
    current.onMessage.addListener(message => {
      if (port !== current) return;
      const request = pending.get(message?.id);
      if (request) request.finish(message.ok === true, message.ok ? message.result : makeError(nativeErrorCode({ code: message.errorCode })));
    });
  }
  function request(message, { signal } = {}) {
    if (signal?.aborted) return Promise.reject(makeError("CANCELLED"));
    try { ensure(); } catch { return Promise.reject(makeError("BROWSER_NO_HOST")); }
    const id = crypto.randomUUID(), expected = generation;
    return new Promise((resolve, reject) => {
      let timer;
      const abort = () => { post({ kind: "cancel", id }); finish(false, makeError("CANCELLED")); };
      const finish = (ok, value) => {
        if (!pending.delete(id)) return;
        clearTimeout(timer); signal?.removeEventListener("abort", abort);
        ok ? resolve(value) : reject(value);
      };
      pending.set(id, { finish });
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => { post({ kind: "cancel", id }); finish(false, makeError("BROWSER_TIMEOUT")); }, timeoutMs);
      if (signal?.aborted || expected !== generation) abort();
      else post({ ...message, id });
    });
  }
  return { request, call: (action, data, options) => request({ kind: "call", surface: "selection-word", action, data: nativeRequest(action, data) }, options), dispose: disconnect };
}

export function attachNativeModelHost(runtime, engine) {
  let port, stopped = false, retry, reconnects = 0;
  const tasks = new Map();
  const cancel = () => { for (const controller of tasks.values()) controller.abort(); tasks.clear(); };
  function connect() {
    if (stopped) return;
    try { port = runtime.connect({ name: NATIVE_PORT }); } catch { if (reconnects < 3) retry = setTimeout(connect, 1000 * 2 ** reconnects++); return; }
    const current = port;
    current.onDisconnect.addListener(() => { if (port !== current || stopped) return; cancel(); port = null; if (reconnects < 3) retry = setTimeout(connect, 1000 * 2 ** reconnects++); });
    current.onMessage.addListener(async message => {
      if (stopped || port !== current) return;
      if (message?.kind === "cancel") { tasks.get(message.id)?.abort(); return; }
      if (message?.kind !== "host-call" || typeof message.id !== "string" || tasks.has(message.id)) return;
      const controller = new AbortController(); tasks.set(message.id, controller);
      const reply = value => { if (!stopped && port === current) { try { current.postMessage({ kind: "host-result", id: message.id, ...value }); } catch {} } };
      try {
        const data = nativeRequest(message.action, message.data), signal = controller.signal;
        let result;
        if (message.action === "capability") result = await engine.capability(data.pair);
        else if (message.action === "detectDecision") result = await engine.detectDecision(data.text, { signal, cacheOnly: data.cacheOnly });
        else if (message.action === "detectSelection") result = await engine.detectSelection(data.text, data.context, { signal, cacheOnly: data.cacheOnly });
        else if (message.action === "prepare") {
          // Remote page messages never authorize downloads in the Options origin.
          if (!engine.ready(data.pair) && await engine.capability(data.pair) !== "available") throw makeError("BROWSER_PREPARE");
          result = await engine.prepare(data.pair, { signal, verifyText: data.verifyText });
        } else result = await engine.execute({ ...data, signal });
        if (signal.aborted) throw makeError("CANCELLED");
        reply({ ok: true, result });
      } catch (cause) { reply({ ok: false, errorCode: nativeErrorCode(cause) }); }
      finally { tasks.delete(message.id); }
    });
    current.postMessage({ kind: "host-register", id: crypto.randomUUID() });
  }
  connect();
  return () => { stopped = true; clearTimeout(retry); cancel(); try { port?.disconnect(); } catch {} port = null; };
}

export function withSharedNativeHost(local, runtime) {
  const transport = createNativePortClient(runtime);
  const unavailable = error => ["BROWSER_NO_HOST", "BROWSER_HOST_LOST", "BROWSER_SCOPE"].includes(error?.code);
  async function route(action, data, options, fallback) {
    try { return await transport.call(action, data, options); }
    catch (cause) { if (!unavailable(cause)) throw cause; return fallback(); }
  }
  return { ...local,
    async capability(pair) {
      if (local.ready(pair)) return "available";
      const remote = await route("capability", { pair }, {}, () => local.capability(pair));
      if (remote === "available") return remote;
      const page = await local.capability(pair);
      return page === "available" ? page : remote;
    },
    prepare(pair, options = {}) {
      if (options.userGesture || local.ready(pair)) return local.prepare(pair, options);
      const availableLocal = async () => {
        if (await local.capability(pair) !== "available") throw makeError("BROWSER_PREPARE");
        return local.prepare(pair, options);
      };
      return transport.call("prepare", { pair, verifyText: String(options.verifyText || "").slice(0, 160) }, options)
        .catch(cause => {
          if (!unavailable(cause) && cause?.code !== "BROWSER_PREPARE") throw cause;
          // Losing the shared host never grants a page permission to download.
          return availableLocal();
        });
    },
    async detectDecision(text, options = {}) {
      if (local.status().detectors) return local.detectDecision(text, options);
      const result = await route("detectDecision", { text, cacheOnly: options.cacheOnly }, options, () => local.detectDecision(text, options));
      return result.language || result.source === "empty" ? result : local.detectDecision(text, options);
    },
    async detectSelection(text, context, options = {}) {
      if (local.status().detectors) return local.detectSelection(text, context, options);
      const result = await route("detectSelection", { text, context, cacheOnly: options.cacheOnly }, options, () => local.detectSelection(text, context, options));
      return result.language || result.source === "empty" ? result : local.detectSelection(text, context, options);
    },
    execute(input) {
      if (local.ready(input.pair)) return local.execute(input);
      return route("execute", { pair: input.pair, segments: input.segments }, input, () => local.execute(input));
    },
    ready: pair => local.ready(pair), // The remote host can close: re-check every request.
    requestPreparation: (pair, options) => transport.request({ kind: "pending-add", pair }, options),
    dispose() { transport.dispose(); local.dispose(); }
  };
}
