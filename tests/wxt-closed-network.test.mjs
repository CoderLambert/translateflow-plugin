import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { startClosedNetwork, startupNetworkControl, assertStartupNetworkControl } from "../e2e/support/closed-network.mjs";

function throughProxy(proxy, target, method = "GET") {
  const server = new URL(proxy.launchProxy.server);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: server.hostname, port: server.port, method, path: target }, response => {
      response.resume(); response.on("end", () => resolve(response.statusCode));
    });
    req.on("connect", (response, socket) => { socket.destroy(); resolve(response.statusCode); });
    req.on("error", reject); req.setTimeout(2000, () => req.destroy(new Error("Proxy control timed out"))); req.end();
  });
}

test("migration proxy forwards only exact mock origin; blocks HTTP, alternate loopback and CONNECT without logging data", async () => {
  let mockCalls = 0;
  const mock = createServer((_req, res) => { mockCalls++; res.end("mock"); });
  await new Promise(resolve => mock.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + mock.address().port;
  const proxy = await startClosedNetwork(origin);
  try {
    assert.equal(await throughProxy(proxy, origin + "/article"), 200);
    for (const target of ["http://never-contact.invalid/private?synthetic=unlogged", origin.replace("127.0.0.1", "localhost") + "/article",
      origin.replace("http:", "https:") + "/article", "http://user:password@127.0.0.1:" + mock.address().port + "/article", "/relative"]) {
      assert.equal(await throughProxy(proxy, target), 403);
    }
    assert.equal(await throughProxy(proxy, "never-contact.invalid:443", "CONNECT"), 403);
    assert.equal(mockCalls, 1);
    const report = proxy.snapshot();
    assert.equal(report.forwardedOutsideMock, 0); assert.equal(report.attemptedOutsideMock, 6);
    assert.equal(report.mockForwarded, 1); assert.equal(report.overflow, false);
    assert(!JSON.stringify(report).includes("private"));
    assert(!JSON.stringify(report).includes("password"));
    assert.deepEqual(Object.keys(report.attempts[0]).sort(), ["blocked", "kind", "origin"]);
  } finally { await proxy.close(); await new Promise(resolve => mock.close(resolve)); }
});

test("proxy rejects non-pinned origins and a listener conflict before browser launch", async () => {
  for (const origin of ["https://127.0.0.1:1234", "http://localhost:1234", "http://127.0.0.1:1234/path", "http://127.0.0.1"]) {
    await assert.rejects(startClosedNetwork(origin));
  }
  const proxy = await startClosedNetwork("http://127.0.0.1:1234");
  try {
    await assert.rejects(startClosedNetwork("http://127.0.0.1:1234", { port: Number(new URL(proxy.launchProxy.server).port) }),
      error => error.code === "EADDRINUSE");
  } finally { await proxy.close(); }
});

test("startup acceptance cannot pass on absent native calls, late page observation, overflow or forwarding", () => {
  const control = startupNetworkControl("wxt-control", "http://127.0.0.1:1234");
  const observed = { token: control.token, calls: 3, results: control.origins.map((origin, index) =>
    index === 1 ? { origin, state: "REJECTED" } : { origin, state: "FULFILLED", status: 403 }) };
  const network = { overflow: false, forwardedOutsideMock: 0,
    attempts: control.origins.map((origin, index) => ({ origin, kind: index === 1 ? "CONNECT" : "HTTP", blocked: true })) };
  assertStartupNetworkControl(observed, control, network);
  assert.throws(() => assertStartupNetworkControl(undefined, control, network));
  assert.throws(() => assertStartupNetworkControl({ ...observed, calls: 0 }, control, network));
  assert.throws(() => assertStartupNetworkControl(observed, control, { ...network, attempts: [] }));
  assert.throws(() => assertStartupNetworkControl(observed, control, { ...network, overflow: true }));
  assert.throws(() => assertStartupNetworkControl(observed, control, { ...network, forwardedOutsideMock: 1 }));
  assert.throws(() => assertStartupNetworkControl({ ...observed, results: observed.results.slice(1) }, control, network));
});
