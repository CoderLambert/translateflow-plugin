import test from "node:test";
import assert from "node:assert/strict";
import {
  cancelSelectionExplanationRequest,
  runSelectionExplanationRequest
} from "../src/background/selection/explain.js";

function ambiguousResolved() {
  return {
    route: "needs-explanation",
    routeReason: "ambiguous-needs-explanation",
    depth: "standard",
    contextPolicy: { sensitive: false, source: "visible-local", truncated: false, chars: 44 },
    decision: {
      outcome: "ambiguous",
      reason: "candidate-gap-too-small",
      topCandidateId: "core:persistent:1",
      candidates: [{
        id: "core:persistent:1",
        kind: "lexical",
        headword: "persistent",
        aliases: ["persistent"],
        matchedBy: "exact",
        queryForm: "persistent",
        exactCaseMatch: true,
        senseId: "persistent:1",
        partOfSpeech: "adjective",
        translations: ["持久的"],
        domains: ["computing"],
        provenance: {
          packId: "core",
          packVersion: "2026.09",
          fingerprint: "sha256:core",
          sourceRefs: [{ sourceId: "cedict", recordId: "persistent:1" }]
        },
        ranking: { score: 80, signals: [], policyVersion: 1 }
      }]
    },
    explanationInput: {
      selectionText: "persistent",
      contextText: "The connection is persistent across reconnects.",
      sensitive: false,
      depth: "standard",
      candidates: [{
        id: "core:persistent:1",
        kind: "lexical",
        headword: "persistent",
        aliases: ["persistent"],
        matchedBy: "exact",
        queryForm: "persistent",
        exactCaseMatch: true,
        senseId: "persistent:1",
        partOfSpeech: "adjective",
        translations: ["持久的"],
        domains: ["computing"],
        provenance: {
          packId: "core",
          packVersion: "2026.09",
          fingerprint: "sha256:core",
          sourceRefs: [{ sourceId: "cedict", recordId: "persistent:1" }]
        },
        ranking: { score: 80, signals: [], policyVersion: 1 }
      }]
    }
  };
}

const config = {
  provider: "deepseek",
  model: "deepseek-flash",
  apiBaseUrl: "https://api.deepseek.com",
  apiKey: "secret",
  targetLanguage: "Simplified Chinese",
  prompt: "PAGE PROMPT: Do not add explanations."
};

test("Selection explanation does not call Provider when recomputed local decision is sufficient", async () => {
  let providerCalls = 0;
  const local = {
    route: "local",
    routeReason: "local-sufficient",
    depth: "concise",
    decision: { outcome: "sufficient", candidates: [] },
    contextPolicy: { sensitive: false, source: "visible-local", truncated: false, chars: 10 }
  };

  const result = await runSelectionExplanationRequest({
    requestId: "local-only",
    text: "persistent",
    pageUrl: "https://example.test/",
    context: { text: "persistent connection", source: "visible-local", sensitive: false }
  }, {
    resolveSelectionRequest: async () => local,
    getEffectiveConfig: async () => {
      throw new Error("config should not be needed");
    },
    completeJson: async () => {
      providerCalls += 1;
    }
  });

  assert.equal(result.route, "local");
  assert.equal(result.generated, null);
  assert.equal(providerCalls, 0);
});

test("Selection explanation uses its own prompt and stores only generated fields", async () => {
  let captured;
  let stored;
  const result = await runSelectionExplanationRequest({
    requestId: "explain-once",
    text: "persistent",
    pageUrl: "https://example.test/private?token=never-send",
    context: {
      text: "The connection is persistent across reconnects.",
      source: "visible-local",
      sensitive: false
    }
  }, {
    resolveSelectionRequest: async () => ambiguousResolved(),
    getEffectiveConfig: async () => config,
    lookupSelectionExplanation: async () => ({ hit: null }),
    storeSelectionExplanation: async (value) => {
      stored = value;
      return { stored: 1 };
    },
    completeJson: async (input, providerConfig) => {
      captured = { input, providerConfig };
      return input.parseResult({
        selectedCandidateIds: ["core:persistent:1"],
        explanation: "这里表示连接在重连后仍保持。",
        translation: "持久的"
      });
    }
  });

  assert.equal(result.route, "explained");
  assert.equal(result.cacheHit, false);
  assert.deepEqual(result.generated.selectedCandidateIds, ["core:persistent:1"]);
  assert.equal(result.local.candidates[0].provenance.packId, "core");
  assert.equal(captured.input.systemPrompt.includes("PAGE PROMPT"), false);
  assert.equal(captured.input.systemPrompt.includes("Selection Explain"), true);
  assert.equal(captured.input.payload.contextText.includes("never-send"), false);
  assert.equal(captured.providerConfig.prompt, config.prompt);
  assert.deepEqual(Object.keys(stored.result).sort(), [
    "explanation",
    "selectedCandidateIds",
    "translation"
  ]);
  assert.equal("provenance" in stored.result, false);
});

test("Selection explanation cache hit bypasses Provider and revalidates candidate IDs", async () => {
  let providerCalls = 0;
  const result = await runSelectionExplanationRequest({
    requestId: "cache-hit",
    text: "persistent",
    pageUrl: "https://example.test/"
  }, {
    resolveSelectionRequest: async () => ambiguousResolved(),
    getEffectiveConfig: async () => config,
    lookupSelectionExplanation: async () => ({
      hit: {
        selectedCandidateIds: ["core:persistent:1"],
        explanation: "缓存解释",
        translation: "持久的"
      }
    }),
    storeSelectionExplanation: async () => {
      throw new Error("cache hit must not store");
    },
    completeJson: async () => {
      providerCalls += 1;
    }
  });

  assert.equal(result.cacheHit, true);
  assert.equal(result.generated.explanation, "缓存解释");
  assert.equal(providerCalls, 0);
});

test("Selection explanation cancellation aborts the Provider signal", async () => {
  let observedAbort = false;
  let providerStartedResolve;
  const providerStarted = new Promise((resolve) => {
    providerStartedResolve = resolve;
  });

  const promise = runSelectionExplanationRequest({
    requestId: "cancel-me",
    text: "persistent",
    pageUrl: "https://example.test/"
  }, {
    resolveSelectionRequest: async () => ambiguousResolved(),
    getEffectiveConfig: async () => config,
    lookupSelectionExplanation: async () => ({ hit: null }),
    storeSelectionExplanation: async () => ({ stored: 1 }),
    completeJson: async (_input, _config, { signal }) => new Promise((resolve, reject) => {
      const onAbort = () => {
        observedAbort = true;
        const error = new Error("cancelled");
        error.code = "CANCELLED";
        reject(error);
      };
      if (signal.aborted) onAbort();
      else {
        signal.addEventListener("abort", onAbort, { once: true });
        providerStartedResolve();
      }
    })
  });

  await providerStarted;
  assert.deepEqual(cancelSelectionExplanationRequest("cancel-me"), { cancelled: true });
  await assert.rejects(promise, (error) => error?.code === "CANCELLED");
  assert.equal(observedAbort, true);
});
