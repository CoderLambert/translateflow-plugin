import test from "node:test";
import assert from "node:assert/strict";
import {
  SELECTION_EXPLANATION_DEPTH,
  SELECTION_INTENT,
  SELECTION_ROUTE,
  chooseSelectionRoute,
  classifySelectionIntent,
  sanitizeSelectionContext
} from "../src/shared/selection.js";
import { resolveSelectionRequest } from "../src/background/selection/resolve.js";

test("Selection v2 classifier keeps lexical, sentence and unsupported-local routes separate", () => {
  const word = classifySelectionIntent({ text: "persistent", targetLanguage: "Simplified Chinese" });
  assert.equal(word.kind, SELECTION_INTENT.LEXICAL);
  assert.equal(word.reason, "lexical-token");

  const phrase = classifySelectionIntent({ text: "terminal multiplexer", targetLanguage: "zh-CN" });
  assert.equal(phrase.kind, SELECTION_INTENT.LEXICAL);
  assert.equal(phrase.reason, "lexical-phrase");

  const sentence = classifySelectionIntent({
    text: "This full sentence should continue through the normal translation gateway.",
    targetLanguage: "Simplified Chinese"
  });
  assert.equal(sentence.kind, SELECTION_INTENT.TRANSLATION);
  assert.equal(sentence.reason, "sentence-or-long-text");

  const unsupportedSource = classifySelectionIntent({
    text: "这是一个中文选择",
    targetLanguage: "Simplified Chinese"
  });
  assert.equal(unsupportedSource.kind, SELECTION_INTENT.TRANSLATION);
  assert.equal(unsupportedSource.reason, "unsupported-local-source");

  const unsupportedTarget = classifySelectionIntent({ text: "persistent", targetLanguage: "Japanese" });
  assert.equal(unsupportedTarget.kind, SELECTION_INTENT.TRANSLATION);
  assert.equal(unsupportedTarget.reason, "unsupported-local-target");
});

test("Selection v2 keeps dictionary lookup first and AI explanation explicit", () => {
  const intent = classifySelectionIntent({ text: "persistent", targetLanguage: "Simplified Chinese" });
  const sufficient = { outcome: "sufficient", candidates: [{ id: "core:persistent:1" }] };
  const ambiguous = { outcome: "ambiguous", candidates: [{ id: "core:persistent:1" }, { id: "core:persistent:2" }] };

  const expectedSufficientDepth = new Map([
    [SELECTION_EXPLANATION_DEPTH.AUTO, SELECTION_EXPLANATION_DEPTH.CONCISE],
    [SELECTION_EXPLANATION_DEPTH.CONCISE, SELECTION_EXPLANATION_DEPTH.CONCISE],
    [SELECTION_EXPLANATION_DEPTH.STANDARD, SELECTION_EXPLANATION_DEPTH.STANDARD],
    [SELECTION_EXPLANATION_DEPTH.PROFESSIONAL, SELECTION_EXPLANATION_DEPTH.PROFESSIONAL]
  ]);

  for (const [depth, expected] of expectedSufficientDepth) {
    const route = chooseSelectionRoute({ intent, decision: sufficient, depth, text: "persistent" });
    assert.equal(route.route, SELECTION_ROUTE.LOCAL);
    assert.equal(route.depth, expected);
    assert.equal(route.explanationAllowed, true);
  }

  assert.deepEqual(
    chooseSelectionRoute({ intent, decision: ambiguous, depth: "auto", text: "persistent" }),
    {
      route: SELECTION_ROUTE.LOCAL,
      reason: "local-ambiguous",
      depth: SELECTION_EXPLANATION_DEPTH.STANDARD,
      explanationAllowed: true
    }
  );

  for (const depth of ["concise", "standard", "professional"]) {
    assert.equal(
      chooseSelectionRoute({ intent, decision: ambiguous, depth, text: "persistent" }).route,
      SELECTION_ROUTE.LOCAL
    );
  }

  assert.equal(
    chooseSelectionRoute({
      intent,
      decision: sufficient,
      depth: "auto",
      text: "persistent",
      explainRequested: true
    }).route,
    SELECTION_ROUTE.NEEDS_EXPLANATION
  );
  assert.equal(
    chooseSelectionRoute({
      intent,
      decision: ambiguous,
      depth: "concise",
      text: "persistent",
      explainRequested: true
    }).route,
    SELECTION_ROUTE.NEEDS_EXPLANATION
  );

  const noHit = { outcome: "no-hit", candidates: [] };
  const initialMiss = chooseSelectionRoute({ intent, decision: noHit, depth: "auto", text: "foobar" });
  assert.equal(initialMiss.route, SELECTION_ROUTE.UNRESOLVED);
  assert.equal(initialMiss.reason, "no-hit-local");
  assert.equal(initialMiss.explanationAllowed, true);
  assert.equal(
    chooseSelectionRoute({
      intent,
      decision: noHit,
      depth: "auto",
      text: "foobar",
      explainRequested: true
    }).route,
    SELECTION_ROUTE.NEEDS_EXPLANATION
  );
});

test("Selection context sanitization is bounded and strips sensitive surrounding context", () => {
  const sensitive = sanitizeSelectionContext({
    text: "private form text should not leave the page",
    sensitive: true,
    source: "visible-local"
  });
  assert.deepEqual(sensitive, {
    text: "",
    sensitive: true,
    source: "selection-only",
    truncated: false
  });

  const bounded = sanitizeSelectionContext({
    text: "abcdefghijklmno",
    sensitive: false,
    source: "visible-local",
    pageUrl: "https://secret.example/path"
  }, { maxChars: 8 });
  assert.equal(bounded.text, "abcdefgh");
  assert.equal(bounded.truncated, true);
  assert.equal("pageUrl" in bounded, false);
});

test("Selection resolver returns sufficient local lexical results without entering translation semantics", async () => {
  let lexicalCalls = 0;
  const candidate = {
    id: "core:persistent",
    kind: "lexical",
    headword: "persistent",
    translations: ["持久的"],
    matchedBy: "exact",
    exactCaseMatch: true,
    provenance: { packId: "core", packVersion: "1", fingerprint: "sha256:test" }
  };

  const result = await resolveSelectionRequest({
    text: "persistent",
    pageUrl: "https://example.test/docs",
    depth: "professional",
    context: {
      text: "A persistent connection remains available.",
      source: "visible-local",
      sensitive: false
    }
  }, {
    getConfig: async () => ({
      selectionExplanationDepth: "auto",
      targetLanguage: "Simplified Chinese"
    }),
    getEffectiveConfig: async () => ({ targetLanguage: "Simplified Chinese" }),
    runLexicalLookup: async (input) => {
      lexicalCalls += 1;
      assert.equal(input.sourceLanguage, "en");
      assert.equal(input.targetLanguage, "zh-CN");
      return {
        status: "candidates",
        query: { text: "persistent", normalized: "persistent", sourceLanguage: "en", targetLanguage: "zh-CN" },
        candidates: [candidate]
      };
    },
    assessLexicalLookup: () => ({
      outcome: "sufficient",
      reason: "single-high-confidence",
      topCandidateId: candidate.id,
      candidates: [candidate]
    })
  });

  assert.equal(lexicalCalls, 1);
  assert.equal(result.route, SELECTION_ROUTE.LOCAL);
  assert.equal(result.depth, SELECTION_EXPLANATION_DEPTH.PROFESSIONAL);
  assert.equal(result.explanationAllowed, true);
  assert.equal("explanationInput" in result, false);
  assert.deepEqual(result.contextPolicy, {
    sensitive: false,
    source: "visible-local",
    truncated: false,
    chars: 42
  });
});

test("Selection resolver bypasses lexical lookup for sentence and unsupported target translation routes", async () => {
  let lexicalCalls = 0;
  const deps = {
    getConfig: async () => ({
      selectionExplanationDepth: "auto",
      targetLanguage: "Simplified Chinese"
    }),
    getEffectiveConfig: async () => ({ targetLanguage: "Simplified Chinese" }),
    runLexicalLookup: async () => {
      lexicalCalls += 1;
      throw new Error("lexical lookup should not run");
    }
  };

  const sentence = await resolveSelectionRequest({
    text: "This full sentence should use normal translation instead of dictionary exposition.",
    pageUrl: "https://example.test/"
  }, deps);
  assert.equal(sentence.route, SELECTION_ROUTE.TRANSLATION);

  const unsupportedTarget = await resolveSelectionRequest({
    text: "persistent",
    pageUrl: "https://example.test/"
  }, {
    ...deps,
    getEffectiveConfig: async () => ({ targetLanguage: "Japanese" })
  });
  assert.equal(unsupportedTarget.route, SELECTION_ROUTE.TRANSLATION);
  assert.equal(lexicalCalls, 0);
});

test("Unknown multi-word lexical phrases route to translation instead of token-definition concatenation", async () => {
  const result = await resolveSelectionRequest({
    text: "persistent session",
    pageUrl: "https://example.test/"
  }, {
    getConfig: async () => ({
      selectionExplanationDepth: "auto",
      targetLanguage: "Simplified Chinese"
    }),
    getEffectiveConfig: async () => ({ targetLanguage: "Simplified Chinese" }),
    runLexicalLookup: async () => ({
      status: "no-hit",
      query: {
        text: "persistent session",
        normalized: "persistent session",
        sourceLanguage: "en",
        targetLanguage: "zh-CN"
      },
      evidence: [{
        token: "persistent",
        candidates: [{ id: "core:persistent" }]
      }, {
        token: "session",
        candidates: [{ id: "core:session" }]
      }]
    }),
    assessLexicalLookup: (lookup) => ({
      outcome: "no-hit",
      reason: "no-local-candidates",
      query: lookup.query,
      candidates: [],
      evidence: lookup.evidence
    })
  });

  assert.equal(result.route, SELECTION_ROUTE.TRANSLATION);
  assert.equal(result.routeReason, "unknown-phrase-translation");
  assert.equal(result.lookup.status, "no-hit");
});

test("Sensitive ambiguous Selection explanation input never includes surrounding form text or raw URL", async () => {
  const result = await resolveSelectionRequest({
    text: "persistent",
    pageUrl: "https://private.example/account?token=secret",
    depth: "standard",
    explainRequested: true,
    context: {
      text: "account password and private editable content",
      source: "visible-local",
      sensitive: true
    }
  }, {
    getConfig: async () => ({
      selectionExplanationDepth: "auto",
      targetLanguage: "Simplified Chinese"
    }),
    getEffectiveConfig: async () => ({ targetLanguage: "Simplified Chinese" }),
    runLexicalLookup: async () => ({
      status: "candidates",
      query: { text: "persistent", normalized: "persistent", sourceLanguage: "en", targetLanguage: "zh-CN" },
      candidates: [{ id: "core:persistent", translations: ["持久的"] }]
    }),
    assessLexicalLookup: () => ({
      outcome: "ambiguous",
      reason: "candidate-gap-too-small",
      topCandidateId: "core:persistent",
      candidates: [{ id: "core:persistent", translations: ["持久的"] }]
    })
  });

  assert.equal(result.route, SELECTION_ROUTE.NEEDS_EXPLANATION);
  assert.equal(result.explanationInput.contextText, "");
  assert.equal(result.explanationInput.sensitive, true);
  assert.equal(JSON.stringify(result.explanationInput).includes("private.example"), false);
  assert.equal(JSON.stringify(result.explanationInput).includes("password"), false);
});

test("Selection resolver preserves competing Core/Technical candidates for #85 ranking", async () => {
  const core = {
    id: "core:container",
    kind: "lexical",
    headword: "container",
    translations: ["容器"],
    matchedBy: "exact",
    exactCaseMatch: true,
    domains: [],
    provenance: { packId: "core", packVersion: "1", fingerprint: "sha256:core" }
  };
  const technical = {
    id: "technical:container",
    kind: "technical-concept",
    headword: "container",
    translations: [],
    matchedBy: "exact",
    exactCaseMatch: true,
    domains: ["runtime"],
    typeLabels: ["runtime isolation", "namespace"],
    provenance: { packId: "technical", packVersion: "1", fingerprint: "sha256:technical" }
  };

  const result = await resolveSelectionRequest({
    text: "container",
    pageUrl: "https://example.test/",
    context: {
      text: "The runtime uses isolation and a namespace for each container.",
      source: "visible-local",
      sensitive: false
    }
  }, {
    getConfig: async () => ({
      selectionExplanationDepth: "auto",
      targetLanguage: "Simplified Chinese"
    }),
    getEffectiveConfig: async () => ({ targetLanguage: "Simplified Chinese" }),
    runLexicalLookup: async () => ({
      status: "candidates",
      query: { text: "container", normalized: "container", sourceLanguage: "en", targetLanguage: "zh-CN" },
      matchedBy: "exact",
      candidates: [core, technical]
    })
  });

  assert.equal(result.lookup.candidates.length, 2);
  assert.equal(result.decision.topCandidateId, technical.id);
  assert.equal(result.route, SELECTION_ROUTE.LOCAL);
});

test("Selection resolver can use an untranslated tmux technical entity locally when the pack supplies it", async () => {
  const result = await resolveSelectionRequest({
    text: "tmux",
    pageUrl: "https://example.test/",
    context: {
      text: "Open tmux in the terminal and attach to the session.",
      source: "visible-local",
      sensitive: false
    }
  }, {
    getConfig: async () => ({
      selectionExplanationDepth: "auto",
      targetLanguage: "Simplified Chinese"
    }),
    getEffectiveConfig: async () => ({ targetLanguage: "Simplified Chinese" }),
    runLexicalLookup: async () => ({
      status: "candidates",
      query: { text: "tmux", normalized: "tmux", sourceLanguage: "en", targetLanguage: "zh-CN" },
      matchedBy: "exact",
      candidates: [{
        id: "technical:Q1935361",
        kind: "technical-entity",
        headword: "tmux",
        translations: [],
        matchedBy: "exact",
        exactCaseMatch: true,
        domains: ["developer-tool"],
        typeLabels: ["terminal multiplexer", "free software"],
        provenance: { packId: "technical-wikidata", packVersion: "fixture", fingerprint: "sha256:tech" }
      }]
    })
  });

  assert.equal(result.route, SELECTION_ROUTE.LOCAL);
  assert.equal(result.decision.topCandidateId, "technical:Q1935361");
  assert.equal(result.decision.candidates[0].typeLabels[0], "terminal multiplexer");
});

