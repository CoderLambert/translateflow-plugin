import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import {
  buildTranslationRequestKey,
  cancelTranslationRequest,
  runTranslationRequest
} from "../src/background/translation-requests.js";

const BASE_CONFIG = Object.freeze({
  provider: "openai-compatible",
  apiBaseUrl: "https://benchmark.invalid/v1",
  apiKey: "",
  prompt: "Translate naturally.",
  targetLanguage: "Simplified Chinese",
  streaming: false
});

export function createBenchmarkFixtures() {
  return Object.freeze({
    short: Object.freeze({
      name: "short",
      segments: Object.freeze(makeSegments("short", 6, 80))
    }),
    medium: Object.freeze({
      name: "medium",
      segments: Object.freeze(makeSegments("medium", 24, 120))
    }),
    long: Object.freeze({
      name: "long",
      segments: Object.freeze(makeSegments("long", 48, 180))
    })
  });
}

export async function runTranslationBenchmarks() {
  const fixtures = createBenchmarkFixtures();

  const generic = {};
  const local = {};
  for (const fixture of Object.values(fixtures)) {
    generic[fixture.name] = await runProviderScenario({
      fixture,
      model: "mock-generic-model",
      delayMs: 2
    });
    local[fixture.name] = await runProviderScenario({
      fixture,
      model: "hy-mt2-7b",
      delayMs: 2
    });
  }

  const cache = await runCacheScenario(fixtures.medium);
  const coalescing = await runCoalescingScenario(fixtures.short);
  const cancellation = await runCancellationScenario(fixtures.short);
  const concurrency = await runConcurrencyScenario(fixtures.short);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    fixtures: Object.fromEntries(
      Object.values(fixtures).map((fixture) => [
        fixture.name,
        {
          segmentCount: fixture.segments.length,
          sourceChars: fixture.segments.reduce((sum, item) => sum + item.text.length, 0)
        }
      ])
    ),
    profiles: {
      genericOpenAICompatible: generic,
      localHyMt2: local
    },
    cache,
    coalescing,
    cancellation,
    concurrency,
    recommendation: {
      localBatchMaxSegments: 8,
      localBatchMaxChars: 3200,
      changedProductionDefaults: false,
      rationale: "The benchmark establishes a reproducible baseline; no correctness-safe default change is justified by deterministic counts alone."
    }
  };
}

async function runProviderScenario({ fixture, model, delayMs }) {
  const transport = createMockTransport({ delayMs });
  const config = { ...BASE_CONFIG, model };
  const requestId = `bench-${fixture.name}-${model}`;

  const { value: result, elapsedMs } = await withMockRuntime(transport, () =>
    timed(() => runTranslationRequest({
      requestId,
      segments: fixture.segments,
      config
    }))
  );

  assertTranslatedCount(result, fixture.segments.length);
  return {
    providerRequests: transport.metrics.requestCount,
    observedBatchSizes: [...transport.metrics.batchSizes],
    peakConcurrency: transport.metrics.peakConcurrency,
    latencyMs: roundMs(elapsedMs)
  };
}

async function runCacheScenario(fixture) {
  const transport = createMockTransport({ delayMs: 3 });
  const config = { ...BASE_CONFIG, model: "mock-cache-model" };
  const cache = new Map();

  const runCached = async (requestId) => {
    const key = buildTranslationRequestKey(fixture.segments, config);
    if (cache.has(key)) {
      return {
        fromCache: true,
        result: cloneResult(cache.get(key))
      };
    }
    const result = await runTranslationRequest({
      requestId,
      segments: fixture.segments,
      config
    });
    cache.set(key, cloneResult(result));
    return { fromCache: false, result };
  };

  return withMockRuntime(transport, async () => {
    const coldBefore = transport.metrics.requestCount;
    const cold = await timed(() => runCached("bench-cache-cold"));
    const coldRequests = transport.metrics.requestCount - coldBefore;

    const warmBefore = transport.metrics.requestCount;
    const warm = await timed(() => runCached("bench-cache-warm"));
    const warmRequests = transport.metrics.requestCount - warmBefore;

    assertTranslatedCount(cold.value.result, fixture.segments.length);
    assertTranslatedCount(warm.value.result, fixture.segments.length);

    return {
      adapter: "in-memory benchmark cache",
      storageLatencyIncluded: false,
      cold: {
        providerRequests: coldRequests,
        cacheHits: cold.value.fromCache ? fixture.segments.length : 0,
        totalSegments: fixture.segments.length,
        cacheHitRatio: cold.value.fromCache ? 1 : 0,
        latencyMs: roundMs(cold.elapsedMs)
      },
      warm: {
        providerRequests: warmRequests,
        cacheHits: warm.value.fromCache ? fixture.segments.length : 0,
        totalSegments: fixture.segments.length,
        cacheHitRatio: warm.value.fromCache ? 1 : 0,
        latencyMs: roundMs(warm.elapsedMs)
      }
    };
  });
}

async function runCoalescingScenario(fixture) {
  const transport = createMockTransport({ delayMs: 12 });
  const config = { ...BASE_CONFIG, model: "mock-coalescing-model" };

  return withMockRuntime(transport, async () => {
    const { value: results, elapsedMs } = await timed(() => Promise.all([
      runTranslationRequest({
        requestId: "bench-coalesce-a",
        segments: fixture.segments,
        config
      }),
      runTranslationRequest({
        requestId: "bench-coalesce-b",
        segments: fixture.segments,
        config
      })
    ]));

    assertTranslatedCount(results[0], fixture.segments.length);
    assertTranslatedCount(results[1], fixture.segments.length);

    return {
      consumers: 2,
      providerRequests: transport.metrics.requestCount,
      requestsSavedByCoalescing: 2 - transport.metrics.requestCount,
      peakConcurrency: transport.metrics.peakConcurrency,
      latencyMs: roundMs(elapsedMs)
    };
  });
}

async function runCancellationScenario(fixture) {
  const transport = createMockTransport({ delayMs: 50 });
  const config = { ...BASE_CONFIG, model: "mock-cancellation-model" };

  return withMockRuntime(transport, async () => {
    const pending = runTranslationRequest({
      requestId: "bench-cancel",
      segments: fixture.segments,
      config
    });

    await transport.waitForRequestStart(1);
    const cancelResult = cancelTranslationRequest("bench-cancel");

    let cancelled = false;
    const startedAt = performance.now();
    try {
      await pending;
    } catch (error) {
      cancelled = error?.code === "CANCELLED";
      if (!cancelled) throw error;
    }

    return {
      cancelAccepted: cancelResult.cancelled,
      cancelled,
      providerRequests: transport.metrics.requestCount,
      abortedRequests: transport.metrics.abortedRequests,
      cancellationSettleMs: roundMs(performance.now() - startedAt)
    };
  });
}

async function runConcurrencyScenario(fixture) {
  const transport = createMockTransport({ delayMs: 15 });
  const config = { ...BASE_CONFIG, model: "mock-concurrency-model" };
  const tasks = Array.from({ length: 4 }, (_, index) => ({
    requestId: `bench-concurrency-${index}`,
    segments: fixture.segments.map((item) => ({
      ...item,
      text: `${item.text} page-${index}`
    }))
  }));

  return withMockRuntime(transport, async () => {
    const { value: results, elapsedMs } = await timed(() => Promise.all(
      tasks.map((task) => runTranslationRequest({
        requestId: task.requestId,
        segments: task.segments,
        config
      }))
    ));

    for (const result of results) {
      assertTranslatedCount(result, fixture.segments.length);
    }

    return {
      concurrentTasks: tasks.length,
      providerRequests: transport.metrics.requestCount,
      peakConcurrency: transport.metrics.peakConcurrency,
      latencyMs: roundMs(elapsedMs)
    };
  });
}

function createMockTransport({ delayMs }) {
  const metrics = {
    requestCount: 0,
    abortedRequests: 0,
    activeRequests: 0,
    peakConcurrency: 0,
    batchSizes: []
  };
  const waiters = [];

  const notifyStartWaiters = () => {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      if (metrics.requestCount < waiters[index].count) continue;
      const [{ resolve }] = waiters.splice(index, 1);
      resolve();
    }
  };

  const fetch = async (_url, options = {}) => {
    const body = JSON.parse(String(options.body || "{}"));
    const segments = extractSegments(body);

    metrics.requestCount += 1;
    metrics.activeRequests += 1;
    metrics.peakConcurrency = Math.max(metrics.peakConcurrency, metrics.activeRequests);
    metrics.batchSizes.push(segments.length);
    notifyStartWaiters();

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return false;
        settled = true;
        metrics.activeRequests -= 1;
        return true;
      };

      const onAbort = () => {
        clearTimeout(timer);
        if (!finish()) return;
        metrics.abortedRequests += 1;
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      };

      const timer = setTimeout(() => {
        options.signal?.removeEventListener("abort", onAbort);
        if (!finish()) return;
        resolve(mockResponse(body, segments));
      }, Math.max(0, Number(delayMs || 0)));

      options.signal?.addEventListener("abort", onAbort, { once: true });
    });
  };

  return {
    metrics,
    fetch,
    waitForRequestStart(count = 1) {
      if (metrics.requestCount >= count) return Promise.resolve();
      return new Promise((resolve) => {
        waiters.push({ count, resolve });
      });
    }
  };
}

function mockResponse(body, segments) {
  const local = /hy[-_.]?mt|translate[-_]?gemma|translategemma/i.test(String(body.model || ""));
  const translated = local
    ? {
        translations: Object.fromEntries(
          segments.map((item) => [String(item.id), `译文-${item.id}`])
        )
      }
    : {
        translations: segments.map((item) => ({
          id: String(item.id),
          text: `译文-${item.id}`
        }))
      };

  return {
    ok: true,
    status: 200,
    headers: { get() { return null; } },
    async text() {
      return JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify(translated)
          }
        }]
      });
    }
  };
}

function extractSegments(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const content = String(messages[index]?.content || "");
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed?.segments)) return parsed.segments;
    } catch {}

    const marker = "Input JSON:\n";
    const markerIndex = content.lastIndexOf(marker);
    if (markerIndex >= 0) {
      const parsed = JSON.parse(content.slice(markerIndex + marker.length));
      if (Array.isArray(parsed?.segments)) return parsed.segments;
    }
  }
  throw new Error("Benchmark mock transport could not extract request segments.");
}

async function withMockRuntime(transport, task) {
  const originalFetch = globalThis.fetch;
  const hadChrome = Object.prototype.hasOwnProperty.call(globalThis, "chrome");
  const originalChrome = globalThis.chrome;

  globalThis.fetch = transport.fetch;
  globalThis.chrome = {
    permissions: {
      async contains() {
        return true;
      }
    }
  };

  try {
    return await task();
  } finally {
    globalThis.fetch = originalFetch;
    if (hadChrome) globalThis.chrome = originalChrome;
    else delete globalThis.chrome;
  }
}

async function timed(task) {
  const startedAt = performance.now();
  const value = await task();
  return {
    value,
    elapsedMs: performance.now() - startedAt
  };
}

function makeSegments(prefix, count, charsPerSegment) {
  return Array.from({ length: count }, (_, index) => {
    const label = `${prefix}-${index + 1} `;
    const fillLength = Math.max(0, charsPerSegment - label.length);
    return {
      id: String(index + 1),
      text: label + "x".repeat(fillLength)
    };
  });
}

function cloneResult(result) {
  return result.map((item) => ({ ...item }));
}

function assertTranslatedCount(result, expected) {
  if (!Array.isArray(result) || result.length !== expected) {
    throw new Error(`Benchmark expected ${expected} translated segments, received ${Array.isArray(result) ? result.length : "non-array"}.`);
  }
}

function roundMs(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function printSummary(result) {
  console.log("TranslateFlow translation benchmark");
  console.log("");
  console.log("fixture  generic requests  local requests  local batches");
  for (const name of ["short", "medium", "long"]) {
    const generic = result.profiles.genericOpenAICompatible[name];
    const local = result.profiles.localHyMt2[name];
    console.log(
      `${name.padEnd(7)} ${String(generic.providerRequests).padEnd(17)} ${String(local.providerRequests).padEnd(15)} ${local.observedBatchSizes.join(",")}`
    );
  }
  console.log("");
  console.log(`warm cache: hit ratio=${result.cache.warm.cacheHitRatio}, provider requests=${result.cache.warm.providerRequests}`);
  console.log(`coalescing: consumers=${result.coalescing.consumers}, provider requests=${result.coalescing.providerRequests}`);
  console.log(`cancellation: cancelled=${result.cancellation.cancelled}, aborted fetches=${result.cancellation.abortedRequests}`);
  console.log(`concurrency: tasks=${result.concurrency.concurrentTasks}, peak fetches=${result.concurrency.peakConcurrency}`);
  console.log("");
  console.log("Timing values are observational only; deterministic tests assert counts and invariants, not speed thresholds.");
}

const invokedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedUrl) {
  runTranslationBenchmarks()
    .then((result) => {
      if (process.argv.includes("--json")) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printSummary(result);
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
