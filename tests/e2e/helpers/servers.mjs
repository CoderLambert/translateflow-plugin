import http from "node:http";
import { once } from "node:events";

export async function startE2EServer() {
  const state = {
    calls: [],
    failures: []
  };

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/fixture/article") {
      return sendHtml(response, fixtureHtml());
    }

    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      const body = await readJson(request);
      const call = {
        at: Date.now(),
        body,
        systemPrompt: String(body?.messages?.find((item) => item.role === "system")?.content || ""),
        segments: readSegments(body)
      };
      state.calls.push(call);

      const failure = state.failures.shift();
      if (failure) {
        response.statusCode = failure.status;
        response.setHeader("Content-Type", "application/json");
        if (failure.status === 429) response.setHeader("Retry-After", "0");
        response.end(JSON.stringify({
          error: { message: failure.message || `mock HTTP ${failure.status}` }
        }));
        return;
      }

      const translations = call.segments.map((segment) => ({
        id: String(segment.id),
        text: mockTranslation(segment.text)
      }));

      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({ translations })
          }
        }]
      }));
      return;
    }

    response.statusCode = 404;
    response.end("not found");
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    fixtureUrl(path = "") {
      return `${origin}/fixture/article${path}`;
    },
    apiBaseUrl: `${origin}/v1`,
    calls: state.calls,
    resetCalls() {
      state.calls.length = 0;
    },
    failNext(status, count = 1, message = "") {
      for (let i = 0; i < count; i += 1) {
        state.failures.push({ status, message });
      }
    },
    clearFailures() {
      state.failures.length = 0;
    },
    async close() {
      server.close();
      await once(server, "close");
    }
  };
}

function readSegments(body) {
  const userMessage = [...(body?.messages || [])].reverse()
    .find((item) => item.role === "user");
  if (!userMessage?.content) return [];

  try {
    const parsed = JSON.parse(userMessage.content);
    return Array.isArray(parsed?.segments)
      ? parsed.segments.map((item) => ({
          id: String(item?.id || ""),
          text: String(item?.text || "")
        }))
      : [];
  } catch {
    return [];
  }
}

function mockTranslation(text) {
  return `E2E 译文：${String(text || "")}`;
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function sendHtml(response, html) {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(html);
}

function fixtureHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>TranslateFlow E2E Fixture</title>
  <style>
    body { max-width: 760px; margin: 40px auto; font: 18px/1.6 system-ui, sans-serif; }
    main { min-height: 900px; }
  </style>
</head>
<body>
  <main>
    <h1 id="headline">A deterministic article for browser extension testing</h1>
    <p id="plain">TranslateFlow keeps the original English source visible while a translated paragraph is displayed next to the source content.</p>
    <p id="selection-target">Selection translation should reuse cached results when the exact same text is selected and translated again.</p>
    <p id="rich">This <strong>important statement</strong> links to <a href="/docs" title="Fixture docs">project documentation</a> and preserves the <code>fetch()</code> call.</p>
    <div id="dynamic"></div>
  </main>
  <script>
    window.appendFixtureParagraph = (text = "A newly appended paragraph should be translated without resending previously cached article paragraphs.") => {
      const node = document.createElement("p");
      node.id = "dynamic-paragraph";
      node.textContent = text;
      document.querySelector("#dynamic").appendChild(node);
      return node.id;
    };
  </script>
</body>
</html>`;
}
