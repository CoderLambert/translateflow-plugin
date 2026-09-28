import test from "node:test";
import assert from "node:assert/strict";
import {
  cancelSelectionExplanationRequest,
  runSelectionExplanationRequest
} from "../src/background/selection/explain.js";

function ambiguousResolved() {
  return {
    route: "needs-explanation",
    routeReason: "ambiguous-explicit-explanation",
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

test("Selection explanation marks recompute as explicit and can enhance a sufficient local hit", async () => {
  let resolvedInput;
  let providerCalls = 0;
  const explicit = ambiguousResolved();
  explicit.routeReason = "local-sufficient-explicit-explanation";
  explicit.depth = "concise";
  explicit.decision.outcome = "sufficient";
  explicit.explanationInput.depth = "concise";

  const result = await runSelectionExplanationRequest({
    requestId: "explicit-local-detail",
    text: "persistent",
    pageUrl: "https://example.test/",
    context: { text: "persistent connection", source: "visible-local", sensitive: false }
  }, {
    resolveSelectionRequest: async (input) => {
      resolvedInput = input;
      return explicit;
    },
    getEffectiveConfig: async () => config,
    lookupSelectionExplanation: async () => ({ hit: null }),
    storeSelectionExplanation: async () => ({ stored: 1 }),
    completeJson: async (input) => {
      providerCalls += 1;
      return input.parseResult({
        selectedCandidateIds: ["core:persistent:1"],
        explanation: "这里表示连接会持续保持。",
        translation: "持久的"
      });
    }
  });

  assert.equal(resolvedInput.explainRequested, true);
  assert.equal(result.route, "explained");
  assert.equal(result.depth, "concise");
  assert.equal(providerCalls, 1);
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


test("sensitive Selection explanations bypass persistent cache", async () => {
  let lookupCalls = 0;
  let storeCalls = 0;
  let providerCalls = 0;
  const sensitive = ambiguousResolved();
  sensitive.contextPolicy = { sensitive: true, source: "selection-only", truncated: false, chars: 10 };
  sensitive.explanationInput = {
    ...sensitive.explanationInput,
    contextText: "",
    sensitive: true
  };

  const deps = {
    resolveSelectionRequest: async () => sensitive,
    getEffectiveConfig: async () => config,
    lookupSelectionExplanation: async () => {
      lookupCalls += 1;
      return {
        hit: {
          selectedCandidateIds: ["core:persistent:1"],
          explanation: "must not be reused",
          translation: "cached"
        }
      };
    },
    storeSelectionExplanation: async () => {
      storeCalls += 1;
      return { stored: 1 };
    },
    completeJson: async (input) => {
      providerCalls += 1;
      return input.parseResult({
        selectedCandidateIds: ["core:persistent:1"],
        explanation: "fresh sensitive explanation",
        translation: "持久的"
      });
    }
  };

  const first = await runSelectionExplanationRequest({
    requestId: "sensitive-1",
    text: "persistent",
    pageUrl: "https://example.test/private",
    context: { text: "persistent", source: "selection-only", sensitive: true }
  }, deps);
  const second = await runSelectionExplanationRequest({
    requestId: "sensitive-2",
    text: "persistent",
    pageUrl: "https://example.test/private",
    context: { text: "persistent", source: "selection-only", sensitive: true }
  }, deps);

  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, false);
  assert.equal(first.generated.explanation, "fresh sensitive explanation");
  assert.equal(second.generated.explanation, "fresh sensitive explanation");
  assert.equal(providerCalls, 2);
  assert.equal(lookupCalls, 0);
  assert.equal(storeCalls, 0);
});

test("tmux explanation is grounded in attributable local technical facts", async () => {
  let providerPayload;
  const technical = {
    route: "needs-explanation",
    routeReason: "ambiguous-explicit-explanation",
    depth: "standard",
    contextPolicy: { sensitive: false, source: "visible-local", truncated: false, chars: 45 },
    decision: {
      outcome: "ambiguous",
      reason: "candidate-gap-too-small",
      topCandidateId: "technical-wikidata:Q1935361",
      candidates: [{
        id: "technical-wikidata:Q1935361",
        kind: "technical-entity",
        headword: "tmux",
        aliases: ["tmux"],
        matchedBy: "exact",
        queryForm: "tmux",
        exactCaseMatch: true,
        entityId: "Q1935361",
        partOfSpeech: null,
        translations: [],
        domains: ["developer-tool"],
        typeLabels: ["terminal multiplexer", "free software"],
        provenance: {
          packId: "technical-wikidata",
          packVersion: "2026-09",
          fingerprint: "sha256:tmux",
          sourceRefs: [{ sourceId: "wikidata", recordId: "Q1935361@12345" }]
        },
        ranking: { score: 90, signals: [], policyVersion: 1 }
      }]
    },
    explanationInput: {
      selectionText: "tmux",
      contextText: "Open tmux in the terminal and attach to a session.",
      sensitive: false,
      depth: "standard",
      candidates: [{
        id: "technical-wikidata:Q1935361",
        kind: "technical-entity",
        headword: "tmux",
        aliases: ["tmux"],
        matchedBy: "exact",
        queryForm: "tmux",
        exactCaseMatch: true,
        entityId: "Q1935361",
        partOfSpeech: null,
        translations: [],
        domains: ["developer-tool"],
        typeLabels: ["terminal multiplexer", "free software"],
        provenance: {
          packId: "technical-wikidata",
          packVersion: "2026-09",
          fingerprint: "sha256:tmux",
          sourceRefs: [{ sourceId: "wikidata", recordId: "Q1935361@12345" }]
        },
        ranking: { score: 90, signals: [], policyVersion: 1 }
      }]
    }
  };

  const result = await runSelectionExplanationRequest({
    requestId: "tmux-explain",
    text: "tmux",
    pageUrl: "https://example.test/docs"
  }, {
    resolveSelectionRequest: async () => technical,
    getEffectiveConfig: async () => config,
    lookupSelectionExplanation: async () => ({ hit: null }),
    storeSelectionExplanation: async () => ({ stored: 1 }),
    completeJson: async (input) => {
      providerPayload = input.payload;
      return input.parseResult({
        selectedCandidateIds: ["technical-wikidata:Q1935361"],
        explanation: "tmux 是用于管理多个终端会话的终端复用器。",
        translation: ""
      });
    }
  });

  assert.equal(result.route, "explained");
  assert.deepEqual(result.generated.selectedCandidateIds, ["technical-wikidata:Q1935361"]);
  assert.deepEqual(providerPayload.candidates[0].typeLabels, ["terminal multiplexer", "free software"]);
  assert.equal(providerPayload.candidates[0].provenance.packId, "technical-wikidata");
  assert.equal(providerPayload.candidates[0].provenance.sourceRefs[0].sourceId, "wikidata");
  assert.equal(result.local.candidates[0].provenance.fingerprint, "sha256:tmux");
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
