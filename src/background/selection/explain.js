import { getEffectiveConfig } from "../config.js";
import {
  lookupSelectionExplanation,
  storeSelectionExplanation
} from "../cache-db.js";
import { completeJson } from "../providers/index.js";
import { resolveSelectionRequest } from "./resolve.js";
import { buildSelectionExplainPrompt } from "./explain-prompt.js";
import {
  buildSelectionExplainCacheIdentity,
  parseSelectionExplainResult
} from "../../shared/selection-explanation.js";
import { SELECTION_ROUTE } from "../../shared/selection.js";

const requestsById = new Map();

export async function runSelectionExplanationRequest(input = {}, deps = {}) {
  const requestId = String(input.requestId || crypto.randomUUID());
  const controller = new AbortController();
  const existing = requestsById.get(requestId);
  existing?.abort();
  requestsById.set(requestId, controller);

  const resolveRequest = deps.resolveSelectionRequest || resolveSelectionRequest;
  const getPageConfig = deps.getEffectiveConfig || getEffectiveConfig;
  const runCompletion = deps.completeJson || completeJson;
  const lookupCache = deps.lookupSelectionExplanation || lookupSelectionExplanation;
  const storeCache = deps.storeSelectionExplanation || storeSelectionExplanation;

  try {
    const resolved = await resolveRequest({
      text: input.text,
      pageUrl: input.pageUrl || "",
      context: input.context || null,
      depth: input.depth,
      explainRequested: true
    });
    assertActive(controller.signal);

    if (resolved.route !== SELECTION_ROUTE.NEEDS_EXPLANATION) {
      return {
        route: resolved.route,
        routeReason: resolved.routeReason,
        resolved,
        cacheHit: false,
        generated: null
      };
    }

    const config = await getPageConfig(input.pageUrl || "");
    assertActive(controller.signal);

    const cache = await buildSelectionExplainCacheIdentity({
      provider: config.provider,
      model: config.model,
      endpoint: config.apiBaseUrl || "",
      targetLanguage: config.targetLanguage,
      payload: {
        ...resolved.explanationInput,
        targetLanguage: config.targetLanguage
      }
    });
    const payload = cache.payload;
    const candidateIds = payload.candidates.map((candidate) => candidate.id);

    const allowPersistentCache = !payload.sensitive;
    if (allowPersistentCache) {
      const cached = await lookupCache({ cacheKey: cache.cacheKey });
      assertActive(controller.signal);
      if (cached?.hit) {
        const generated = parseSelectionExplainResult(cached.hit, { candidateIds });
        return response({
          resolved,
          generated,
          cacheHit: true,
          cacheKey: cache.cacheKey
        });
      }
    }

    const generated = await runCompletion({
      systemPrompt: buildSelectionExplainPrompt({
        targetLanguage: config.targetLanguage,
        depth: payload.depth
      }),
      payload,
      parseResult: (value) => parseSelectionExplainResult(value, { candidateIds })
    }, config, { signal: controller.signal });
    assertActive(controller.signal);

    if (allowPersistentCache) {
      await storeCache({
        cacheKey: cache.cacheKey,
        result: {
          selectedCandidateIds: [...generated.selectedCandidateIds],
          explanation: generated.explanation,
          translation: generated.translation
        }
      });
      assertActive(controller.signal);
    }

    return response({
      resolved,
      generated,
      cacheHit: false,
      cacheKey: cache.cacheKey
    });
  } finally {
    if (requestsById.get(requestId) === controller) requestsById.delete(requestId);
  }
}

export function cancelSelectionExplanationRequest(requestId) {
  const id = String(requestId || "");
  const controller = requestsById.get(id);
  if (!controller) return { cancelled: false };
  controller.abort();
  requestsById.delete(id);
  return { cancelled: true };
}

function response({ resolved, generated, cacheHit, cacheKey }) {
  const candidates = Array.isArray(resolved?.decision?.candidates)
    ? resolved.decision.candidates
    : [];
  return {
    route: "explained",
    routeReason: resolved.routeReason,
    depth: resolved.depth,
    cacheHit,
    cacheKey,
    generated,
    local: {
      decisionOutcome: resolved?.decision?.outcome || "",
      decisionReason: resolved?.decision?.reason || "",
      topCandidateId: resolved?.decision?.topCandidateId || null,
      candidates
    },
    contextPolicy: resolved.contextPolicy
  };
}

function assertActive(signal) {
  if (!signal?.aborted) return;
  const error = new Error("Selection explanation 已取消。");
  error.code = "CANCELLED";
  throw error;
}
