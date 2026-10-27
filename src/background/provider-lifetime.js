const INTERVAL_MS = 20_000;
let activeRequests = 0;
let timer = null;

// An open Port or pending fetch alone does not keep an MV3 worker alive.
// Hold only while a Provider operation is running; its existing abort and
// timeout budgets still own termination. Never persist or log platform data.
export async function withProviderLifetime(work) {
  const runtime = globalThis.chrome?.runtime;
  if (typeof runtime?.getPlatformInfo !== 'function') return work();
  if (activeRequests++ === 0) {
    const ping = () => {
      try { Promise.resolve(runtime.getPlatformInfo()).catch(() => {}); } catch {}
    };
    ping();
    timer = setInterval(ping, INTERVAL_MS);
  }
  try { return await work(); }
  finally {
    if (--activeRequests === 0) { clearInterval(timer); timer = null; }
  }
}
