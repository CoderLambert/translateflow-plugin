import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { once } from "node:events";

export async function startMockServer({ ecdictMdxArchivePath = "" } = {}) {
  let calls = [];
  let failures = [];
  let delayMs = 0;
  let ecdictMdxArchiveMode = "archive";
  let ecdictMdxArchiveRequests = [];
  let customPages = new Map();

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");

      if (
        request.method === "GET" &&
        url.pathname === "/__e2e/ecdict-mdx-28.zip" &&
        ecdictMdxArchivePath
      ) {
        const requestMode = ecdictMdxArchiveMode;
        const evidence = {
          origin: `http://${request.headers.host}`,
          path: url.pathname,
          mode: requestMode,
          startedAt: new Date().toISOString()
        };
        ecdictMdxArchiveRequests.push(evidence);
        if (requestMode === "failure") {
          response.statusCode = 503;
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.end("cached ECDICT test server failure");
          return;
        }
        if (requestMode === "cancel") {
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/zip");
          response.setHeader("Content-Length", String((await stat(ecdictMdxArchivePath)).size));
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 30_000);
            response.once("close", () => {
              clearTimeout(timer);
              resolve();
            });
          });
          if (!response.destroyed) response.end();
          evidence.finishedAt = new Date().toISOString();
          return;
        }

        const { size } = await stat(ecdictMdxArchivePath);
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/zip");
        response.setHeader("Content-Length", String(size));
        const stream = createReadStream(ecdictMdxArchivePath);
        stream.on("error", (error) => response.destroy(error));
        response.once("finish", () => {
          evidence.finishedAt = new Date().toISOString();
        });
        stream.pipe(response);
        await once(response, "finish").catch(() => {});
        return;
      }

      if (request.method === "POST" && isNativeProviderPath(url.pathname)) {
        const body = JSON.parse(await readBody(request));
        const native = nativeProviderInput(url.pathname, body);
        const plannedStatus = Number(failures.shift() || 200);
        const segments = parseSegments(native.userContent);
        const call = providerCall({ request, plannedStatus, protocol: native.protocol,
          systemPrompt: native.systemPrompt, userContent: native.userContent, segments });
        calls.push(call);
        trackResponseState(response, call);
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (plannedStatus !== 200) {
          json(response, plannedStatus, { error: { message: `mock failure ${plannedStatus}` } });
          return;
        }
        const completionContent = native.systemPrompt.includes("Reply with exactly: OK")
          ? "OK"
          : JSON.stringify({ translations: segments.map(item => ({ id: item.id,
              text: translateDeterministically(item.text, native.systemPrompt) })) });
        json(response, 200, nativeProviderResponse(native.protocol, completionContent));
        return;
      }

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

        const call = {
          plannedStatus,
          systemPrompt,
          userContent,
          segments: segments.map((item) => ({
            id: String(item?.id || ""),
            text: String(item?.text || "")
          })),
          responseState: "pending"
        };
        calls.push(call);
        response.once("finish", () => { call.responseState = "finished"; });
        response.once("close", () => {
          if (!response.writableFinished) call.responseState = "closed";
        });

        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

        if (body?.stream === true && systemPrompt.includes("Plain text only")) {
          const markdown = userContent.includes("markdownfixture");
          const chunks = markdown
            ? ["## Summary\n\n**streamed** answer\n\n- first\n", "- second\n\n`code`\n\n![remote](https://remote.invalid/pixel.png)\n\n[unsafe](javascript:alert(1))"]
            : ["streamed ", "answer"];
          response.statusCode = 200; response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[0] } }] })}\n\n`);
          await new Promise(resolve => setTimeout(resolve, 300));
          if (!response.destroyed) { response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[1] } }] })}\n\n`); response.end("data: [DONE]\n\n"); }
          return;
        }

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
        const isSelectionExplain = systemPrompt.includes("Selection Explain");
        const isPlainAssistant = systemPrompt.includes("Plain text only");
        let completionContent;
        if (isConnectionTest) {
          completionContent = "OK";
        } else if (isPlainAssistant) {
          completionContent = userContent.includes("markdownfixture")
            ? "## Summary\n\n**streamed** answer\n\n- first\n- second\n\n`code`\n\n![remote](https://remote.invalid/pixel.png)\n\n[unsafe](javascript:alert(1))"
            : "streamed answer";
        } else if (isSelectionExplain) {
          let explainPayload = {};
          try { explainPayload = JSON.parse(userContent); } catch {}
          const firstCandidateId = String(explainPayload?.candidates?.[0]?.id || "");
          completionContent = JSON.stringify({
            selectedCandidateIds: firstCandidateId ? [firstCandidateId] : [],
            explanation: "这里表示所选词在当前上下文中持续存在或保持有效。",
            translation: "持久的"
          });
        } else {
          completionContent = JSON.stringify({
            translations: segments.map((item) => ({
              id: String(item.id),
              text: translateDeterministically(String(item.text || ""), systemPrompt)
            }))
          });
        }

        json(response, 200, {
          id: "chatcmpl-translateflow-e2e",
          object: "chat.completion",
          choices: [{
            index: 0,
            message: { role: "assistant", content: completionContent },
            finish_reason: "stop"
          }]
        });
        return;
      }

      if (request.method === "GET") {
        html(response, customPages.get(url.pathname) ?? renderFixture(url.pathname));
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
    get ecdictMdxArchiveRequests() {
      return ecdictMdxArchiveRequests;
    },
    reset() {
      calls = [];
      failures = [];
      delayMs = 0;
      ecdictMdxArchiveMode = "archive";
      ecdictMdxArchiveRequests = [];
      customPages = new Map();
    },
    setFailures(statuses) {
      failures = [...(Array.isArray(statuses) ? statuses : [])].map(Number);
    },
    setDelay(ms) {
      delayMs = Math.max(0, Number(ms) || 0);
    },
    setPage(pathname, body) {
      const path = new URL(String(pathname), "http://fixture.invalid").pathname;
      customPages.set(path, String(body));
    },
    setEcdictMdxArchiveMode(mode) {
      if (!["archive", "failure", "cancel"].includes(mode)) {
        throw new Error("Unknown ECDICT E2E archive mode.");
      }
      ecdictMdxArchiveMode = mode;
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

function isNativeProviderPath(pathname) {
  return pathname === "/v1/responses" || pathname === "/v1/messages" || /\/models\/[^/]+:generateContent$/u.test(pathname);
}

function nativeProviderInput(pathname, body) {
  if (pathname === "/v1/responses") return { protocol: "openai-responses", systemPrompt: String(body?.instructions || ""), userContent: String(body?.input || "") };
  if (pathname === "/v1/messages") return { protocol: "anthropic-messages", systemPrompt: String(body?.system || ""), userContent: String(body?.messages?.[0]?.content || "") };
  return { protocol: "gemini-generate", systemPrompt: String(body?.systemInstruction?.parts?.map(item => item?.text || "").join("") || ""), userContent: String(body?.contents?.[0]?.parts?.map(item => item?.text || "").join("") || "") };
}

function parseSegments(userContent) {
  try {
    const payload = JSON.parse(userContent);
    return Array.isArray(payload?.segments) ? payload.segments.map(item => ({ id: String(item?.id || ""), text: String(item?.text || "") })) : [];
  } catch { return []; }
}

function providerCall({ request, plannedStatus, protocol, systemPrompt, userContent, segments }) {
  return { plannedStatus, protocol, systemPrompt, userContent, segments,
    headers: { authorization: String(request.headers.authorization || ""), xApiKey: String(request.headers["x-api-key"] || ""), xGoogApiKey: String(request.headers["x-goog-api-key"] || "") },
    responseState: "pending" };
}

function trackResponseState(response, call) {
  response.once("finish", () => { call.responseState = "finished"; });
  response.once("close", () => { if (!response.writableFinished) call.responseState = "closed"; });
}

function nativeProviderResponse(protocol, text) {
  if (protocol === "openai-responses") return { output: [{ content: [{ type: "output_text", text }] }] };
  if (protocol === "anthropic-messages") return { content: [{ type: "text", text }] };
  return { candidates: [{ content: { parts: [{ text }] } }] };
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
      <button id="focus-return-before">Focus return before Selection</button>
      <button id="focus-moved-after">Focus moved after Selection</button>
      <p id="selectable">Selection translation should reuse the same provider configuration while keeping Selection v2 cache identity separate.</p>
      <p id="lexical-context"><span id="entity">tmux</span> is a <span id="lexical">terminal multiplexer</span> used to manage terminal sessions.</p>
      <p id="technical-competition-context">Open tmux in the terminal and attach to a <span id="technical-competition">session</span>.</p>
      <p id="technical-competition-second-context">A second <span id="technical-competition-second">session</span> keeps another saved lookup on this page.</p>
      <p id="ambiguous-context">A <span id="ambiguous">persistent</span> connection remains available across reconnects.</p>
      <p id="phrase-context">The documentation mentions <span id="unknown-phrase">persistent session</span> as an ordinary phrase.</p>
      <p id="nohit-context">The invented token <span id="nohit">TFNoSuchLexeme</span> is intentionally absent from the local dictionary.</p>
      <p id="unrelated">UNRELATED_SECRET_PAGE_TEXT should never be sent for the nearby selection.</p>
      <div id="editable" contenteditable="true">Private draft <span contenteditable="false"><span id="editable-word">persistent</span></span> account token</div>
      <p id="dual-source">The <span id="foundation">foundation</span> is <span id="production-grade">production-grade</span>.</p>
      <a href="#link" id="test-link">Normal Link</a>
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
