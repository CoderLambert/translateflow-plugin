import { createServer } from "node:http";

export async function startMockServer() {
  let calls = [];
  let failures = [];

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");

      if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
        const body = JSON.parse(await readBody(request));
        const systemPrompt = String(
          body?.messages?.find((message) => message?.role === "system")?.content || ""
        );
        const userContent = String(
          body?.messages?.findLast?.((message) => message?.role === "user")?.content
            || [...(body?.messages || [])].reverse().find((message) => message?.role === "user")?.content
            || ""
        );

        const plannedStatus = Number(failures.shift() || 200);
        let segments = [];
        try {
          const payload = JSON.parse(userContent);
          segments = Array.isArray(payload?.segments) ? payload.segments : [];
        } catch {}

        calls.push({
          plannedStatus,
          systemPrompt,
          userContent,
          segments: segments.map((item) => ({
            id: String(item?.id || ""),
            text: String(item?.text || "")
          }))
        });

        if (plannedStatus !== 200) {
          response.statusCode = plannedStatus;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          if (plannedStatus === 429) response.setHeader("Retry-After", "0");
          response.end(JSON.stringify({
            error: { message: `mock failure ${plannedStatus}` }
          }));
          return;
        }

        const isConnectionTest = systemPrompt.includes("Reply with exactly: OK");
        const content = isConnectionTest
          ? "OK"
          : JSON.stringify({
              translations: segments.map((item) => ({
                id: String(item.id),
                text: translateDeterministically(String(item.text || ""), systemPrompt)
              }))
            });

        json(response, 200, {
          id: "chatcmpl-translateflow-e2e",
          object: "chat.completion",
          choices: [{
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop"
          }]
        });
        return;
      }

      if (request.method === "GET") {
        html(response, renderFixture(url.pathname));
        return;
      }

      response.statusCode = 405;
      response.end("Method Not Allowed");
    } catch (error) {
      json(response, 500, { error: { message: error?.message || String(error) } });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    get calls() {
      return calls;
    },
    reset() {
      calls = [];
      failures = [];
    },
    setFailures(statuses) {
      failures = [...(Array.isArray(statuses) ? statuses : [])].map(Number);
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  };
}

function translateDeterministically(text, systemPrompt) {
  const mode = systemPrompt.includes("Translation style preset: Technical")
    ? "TECH"
    : systemPrompt.includes("Translation style preset: Academic")
      ? "ACADEMIC"
      : systemPrompt.includes("Translation style preset: News")
        ? "NEWS"
        : systemPrompt.includes("Translation style preset: Natural")
          ? "NATURAL"
          : "DEFAULT";
  const glossary = systemPrompt.includes("Terminology glossary") ? "GLOSSARY" : "PLAIN";

  let translated = text;
  if (
    systemPrompt.includes("Terminology glossary")
    && /"repository"\s*->\s*"仓库"/i.test(systemPrompt)
  ) {
    translated = translated.replace(/\brepository\b/gi, "仓库");
  }

  return `[${mode}|${glossary}] ${translated}`;
}

function renderFixture(pathname) {
  const pages = {
    "/article": `
      <p id="intro">TranslateFlow keeps the original English paragraph while showing a bilingual translation directly below it.</p>
      <p id="rich">Read <a href="/docs" title="Documentation">API documentation</a> and run <code>npm test</code> before merging the change.</p>
      <p id="cache">Caching should avoid repeated model requests when the source text and effective translation configuration are unchanged.</p>
    `,
    "/incremental": `
      <p id="initial">Automatic translation should process visible English content and preserve cached results for later visits.</p>
    `,
    "/selection": `
      <p id="selectable">Selection translation should reuse the same provider configuration and cached result on the second invocation.</p>
    `,
    "/failure": `
      <p id="auth">Authentication failures should produce a visible retry action instead of leaving the translation UI stuck.</p>
      <p id="transient">Rate limits and temporary server failures should retry automatically and eventually recover.</p>
    `,
    "/glossary": `
      <p id="glossary">The repository contains technical documentation that should follow the configured terminology and translation mode.</p>
    `
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TranslateFlow E2E Fixture</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; line-height: 1.6; }
    main { max-width: 820px; margin: 40px auto; padding: 0 24px; }
    p { margin: 20px 0; font-size: 18px; }
  </style>
</head>
<body>
  <main>
    <h1>Fixture</h1>
    ${pages[pathname] || `<p id="fallback">This deterministic fixture page exists for TranslateFlow browser integration testing.</p>`}
  </main>
</body>
</html>`;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function json(response, status, value) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

function html(response, value) {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(value);
}
