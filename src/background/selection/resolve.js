import { getConfig, getEffectiveConfig } from "../config.js";
import { runLexicalLookup } from "../lexical/index.js";
import { assessLexicalLookup } from "../lexical/ranking.js";
import {
  SELECTION_ROUTE,
  chooseSelectionRoute,
  classifySelectionIntent,
  normalizeSelectionDepth,
  sanitizeSelectionContext
} from "../../shared/selection.js";

export async function resolveSelectionRequest(input = {}, deps = {}) {
  const getStoredConfig = deps.getConfig || getConfig;
  const getPageConfig = deps.getEffectiveConfig || getEffectiveConfig;
  const lexicalLookup = deps.runLexicalLookup || runLexicalLookup;
  const assessLookup = deps.assessLexicalLookup || assessLexicalLookup;

  const text = String(input.text || "").trim();
  const pageUrl = String(input.pageUrl || "");
  const [storedConfig, effectiveConfig] = await Promise.all([
    getStoredConfig(),
    getPageConfig(pageUrl)
  ]);

  const requestedDepth = normalizeSelectionDepth(
    input.depth || storedConfig.selectionExplanationDepth
  );
  const targetLanguage = effectiveConfig.targetLanguage || storedConfig.targetLanguage;
  const intent = classifySelectionIntent({ text, targetLanguage });
  const context = sanitizeSelectionContext(input.context);

  if (intent.kind === "translation") {
    const route = chooseSelectionRoute({ intent, depth: requestedDepth, text });
    return response({
      text,
      intent,
      route,
      context,
      lookup: null,
      decision: null
    });
  }

  const lookup = await lexicalLookup({
    text,
    pageUrl,
    sourceLanguage: intent.sourceLanguage,
    targetLanguage: "zh-CN"
  });
  const decision = assessLookup(lookup, { contextText: context.text });
  const route = chooseSelectionRoute({
    intent,
    decision,
    depth: requestedDepth,
    text
  });

  return response({ text, intent, route, context, lookup, decision });
}

function response({ text, intent, route, context, lookup, decision }) {
  const result = {
    intent,
    route: route.route,
    routeReason: route.reason,
    depth: route.depth,
    explanationAllowed: route.explanationAllowed,
    lookup,
    decision,
    contextPolicy: {
      sensitive: context.sensitive,
      source: context.source,
      truncated: context.truncated,
      chars: context.text.length
    }
  };

  if (route.route === SELECTION_ROUTE.NEEDS_EXPLANATION) {
    result.explanationInput = {
      selectionText: text,
      contextText: context.text,
      sensitive: context.sensitive,
      depth: route.depth,
      candidates: Array.isArray(decision?.candidates) ? decision.candidates : []
    };
  }

  return result;
}
