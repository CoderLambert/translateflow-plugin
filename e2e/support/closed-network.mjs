import assert from "node:assert/strict";
import { createServer, request } from "node:http";

// Bounded proxy for the migration tests only. No connection is opened except
// to the exact pinned mock origin. Start before Chromium, not via page routing.
export async function startClosedNetwork(allowedOrigin, { port = 0 } = {}) {
  const allowed = new URL(allowedOrigin);
  assert.equal(allowed.protocol, "http:");
  assert.equal(allowed.hostname, "127.0.0.1");
  assert.equal(allowed.href, allowed.origin + "/");
  assert(allowed.port, "An explicit mock server port is required");
  const attempts = [];
  let overflow = false;
  let mockForwarded = 0;
  const sockets = new Set();
  function record(kind, origin, blocked) {
    if (attempts.length < 1024) attempts.push({ kind, origin, blocked });
    else overflow = true;
  }
  function deny(response) {
    response.writeHead(403, { "Access-Control-Allow-Origin": "*", "Content-Type": "text/plain", "Connection": "close" });
    response.end("Blocked by isolated migration test proxy");
  }
  const server = createServer((incoming, response) => {
    let target;
    try { target = new URL(incoming.url); } catch { record("HTTP", "INVALID", true); deny(response); return; }
    if (target.protocol !== "http:" || target.origin !== allowed.origin || target.username || target.password) {
      record("HTTP", target.origin, true); deny(response); return;
    }
    record("HTTP", target.origin, false);
    mockForwarded++;
    const headers = { ...incoming.headers, host: allowed.host };
    delete headers["proxy-authorization"]; delete headers["proxy-connection"];
    const upstream = request({
      hostname: "127.0.0.1", port: Number(allowed.port),
      method: incoming.method, path: target.pathname + target.search, headers
    }, result => { response.writeHead(result.statusCode, result.headers); result.pipe(response); });
    upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    incoming.on("aborted", () => upstream.destroy());
    response.on("close", () => upstream.destroy());
    incoming.pipe(upstream);
  });
  server.on("connect", (incoming, socket) => {
    let origin = "INVALID";
    try {
      const target = new URL("https://" + incoming.url);
      if (!target.username && !target.password && target.pathname === "/") origin = target.origin;
    } catch {}
    record("CONNECT", origin, true);
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  });
  server.on("upgrade", (_incoming, socket) => { record("UPGRADE", "INVALID", true); socket.destroy(); });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  // Listener failure rejects before callers can launch Chromium.
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
  const address = server.address();
  return {
    launchProxy: { server: "http://127.0.0.1:" + address.port, bypass: "<-loopback>" },
    snapshot() {
      return {
        startedBeforeBrowser: true, allowedOrigin: allowed.origin, implicitLoopbackBypassRemoved: true,
        attempts: attempts.map(value => ({ ...value })), overflow, mockForwarded,
        attemptedOutsideMock: attempts.filter(value => value.blocked).length,
        forwardedOutsideMock: 0,
        attribution: "Proxy origins cover browser HTTP/CONNECT from launch, including MV3 SW. Unique startup controls identify worker requests; other origins may be browser traffic or production and cannot be attributed here. This is not zero attempted external requests or OS-level isolation."
      };
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
}

export function startupNetworkControl(token, baseUrl) {
  assert(/^[a-z0-9-]+$/u.test(token));
  const port = new URL(baseUrl).port;
  return {
    token,
    origins: ["http://" + token + ".invalid", "https://" + token + ".invalid", "http://localhost:" + port]
  };
}

export function assertStartupNetworkControl(observed, control, network) {
  assert.equal(observed?.token, control.token, "The selected worker startup probe must actually execute");
  assert.equal(observed.calls, 3);
  assert.equal(observed.results.length, 3, "Every native startup fetch must settle in the bounded assertion window");
  assert.equal(network.overflow, false);
  assert.equal(network.forwardedOutsideMock, 0);
  for (const [index, origin] of control.origins.entries()) {
    assert(network.attempts.some(value => value.blocked && value.origin === origin &&
      value.kind === (index === 1 ? "CONNECT" : "HTTP")), "No proxy rejection for native worker startup " + origin);
    const result = observed.results.find(value => value.origin === origin);
    assert(result, "No native fetch settlement for " + origin);
    if (index === 1) assert.equal(result.state, "REJECTED");
    else assert.deepEqual(result, { origin, state: "FULFILLED", status: 403 });
  }
}
