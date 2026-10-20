import { createServer } from "node:http";
import { once } from "node:events";

// Real provider output is never mocked. A loopback-only relay is necessary to
// enforce a durable cap on every physical attempt, including extension retries.
export async function startBudgetRelay(config, key, budget, port = 0) {
  const server = createServer(async (request, response) => {
    const reply = (status, code) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: { message: code, type: code, code } })); };
    if (request.method !== "POST" || request.url !== "/chat/completions") return reply(404, "TEST_ROUTE");
    if (!key || request.headers.authorization !== `Bearer ${key}`) return reply(401, "TEST_AUTH");
    let id;
    try {
      const chunks = []; let bytes = 0;
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 256 * 1024) throw new Error("TEST_INPUT"); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (body.model !== config.realAi.model || body.stream === true) return reply(400, "TEST_MODEL_OR_STREAM");
      // Safety cap only; preserve the actual product prompt, model and response.
      body.max_tokens = Math.min(body.max_tokens || config.realAi.maxOutputTokens, config.realAi.maxOutputTokens);
      id = budget.reserve();
      const upstream = await fetch(`${config.realAi.baseUrl}/chat/completions`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(120000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(body)
      });
      const data = await upstream.text();
      let usage = null; try { usage = JSON.parse(data).usage; } catch {}
      budget.settle(id, upstream.status, usage);
      response.writeHead(upstream.status, { "Content-Type": "application/json" });
      // Do not forward upstream diagnostic bodies that could echo input/secrets.
      response.end(upstream.ok ? data : JSON.stringify({ error: { message: `DeepSeek HTTP ${upstream.status}`, code: `HTTP_${upstream.status}` } }));
    } catch (error) {
      if (id) budget.settle(id, "NETWORK_OR_TIMEOUT");
      reply(error.code === "TEST_BUDGET" ? 429 : 502, error.code === "TEST_BUDGET" ? "TEST_BUDGET" : "TEST_RELAY_NETWORK");
    }
  });
  server.listen(port, "127.0.0.1"); await once(server, "listening");
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
