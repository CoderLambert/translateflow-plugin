import { selectedTranslationMethod } from "../../shared/translation-preferences.js";
import { rawTranslationSite } from "../../shared/machine-translation.js";
import { getConfig } from "../config.js";
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
  const lexicalLookup = deps.runLexicalLookup || runLexicalLookup;
  const assessLookup = deps.assessLexicalLookup || assessLexicalLookup;

  const text = String(input.text || "").trim();
  const pageUrl = String(input.pageUrl || "");
  const storedConfig = await getStoredConfig();
  const site = rawTranslationSite(storedConfig, pageUrl);
  const requestedDepth = normalizeSelectionDepth(input.depth || storedConfig.selectionExplanationDepth);
  const targetLanguage = site?.targetLanguage || storedConfig.targetLanguage;
  const classified = classifySelectionIntent({ text, targetLanguage });
  const intent = input.selectionKind === "word" ? { ...classified, kind: "lexical", tokenCount: 1 }
    : input.selectionKind === "text" ? { ...classified, kind: "translation" } : classified;
  const surface = intent.kind === "lexical" ? "selection-word" : "selection-text";
  const method = selectedTranslationMethod(storedConfig, site, surface, input.temporaryMethod);
  const context = sanitizeSelectionContext(input.context);

  if (method !== "dictionary") {
    return { ...response({ text, intent, context, lookup: null, decision: null,
      route: { route: input.explainRequested === true ? SELECTION_ROUTE.NEEDS_EXPLANATION : "translation", reason: input.explainRequested === true ? "explicit-ai" : "selected-method", depth: requestedDepth, explanationAllowed: true } }), method, surface };
  }

  if (intent.reason === "rich-dictionary-only") {
    const decision = { outcome: "no-hit", candidates: [], evidence: [] };
    const route = chooseSelectionRoute({
      intent,
      decision,
      depth: requestedDepth,
      text,
      explainRequested: input.explainRequested === true
    });
    return { ...response({ text, intent, route, context, lookup: null, decision }), preferRich: false };
  }

  if (intent.kind === "translation") {
    const route = chooseSelectionRoute({
      intent,
      depth: requestedDepth,
      text,
      explainRequested: input.explainRequested === true
    });
    return response({
      text,
      intent,
      route,
      context,
      lookup: null,
      decision: null
    });
  }

  let lookup;
  try {
    lookup = await lexicalLookup({
      text,
      pageUrl,
      contextText: context.text,
      sourceLanguage: intent.sourceLanguage,
      targetLanguage: "zh-CN"
    });
  } catch (error) {
    lookup = {
      status: "error",
      error: { code: typeof error?.code === "string" ? error.code.slice(0, 80) : "LEXICAL_LOOKUP_FAILED" }
    };
  }
  const decision = assessLookup(lookup, { contextText: context.text });
  const route = chooseSelectionRoute({ intent, decision, depth: requestedDepth, text, explainRequested: input.explainRequested === true });
  if (route.route === "translation") { route.route = "unresolved"; route.reason = "no-hit-local"; route.explanationAllowed = true; }

  const preferRich = method === "dictionary" && input.explainRequested !== true && intent.kind === "lexical" &&
    (route.route === SELECTION_ROUTE.TRANSLATION || (decision.outcome === "error" && intent.tokenCount === 1));
  if (preferRich && intent.tokenCount === 1 && decision.outcome === "error") route.explanationAllowed = true;
  return { ...response({ text, intent, route, context, lookup, decision }), preferRich };
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
