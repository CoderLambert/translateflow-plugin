import { resolveMachineTranslation, rawTranslationSite } from "../../shared/machine-translation.js";
import { hasConfiguredAi } from "../../shared/browser-translation.js";
import { getSiteProfile } from "../../shared/provider-config.js";
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
  const storedConfig = await getStoredConfig();
  const machine = resolveMachineTranslation(storedConfig, rawTranslationSite(storedConfig, pageUrl), "selection");
  const site = machine ? rawTranslationSite(storedConfig, pageUrl) : getSiteProfile(storedConfig.siteProfiles, pageUrl);
  const effectiveConfig = machine || ((deps.getEffectiveConfig || hasConfiguredAi(storedConfig, site)) ? await getPageConfig(pageUrl) : { targetLanguage: site?.targetLanguage || storedConfig.targetLanguage });

  const requestedDepth = normalizeSelectionDepth(
    input.depth || storedConfig.selectionExplanationDepth
  );
  const targetLanguage = effectiveConfig.targetLanguage || storedConfig.targetLanguage;
  const intent = classifySelectionIntent({ text, targetLanguage });
  const context = sanitizeSelectionContext(input.context);

  if (storedConfig.dictionaryEnabled === false) {
    return response({ text, intent, context, lookup: null, decision: null, route: { route: "translation", reason: "dictionary-disabled", depth: requestedDepth, explanationAllowed: true } });
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
    if (storedConfig.dictionaryEnabled === true && input.explainRequested !== true) return { ...response({ text, intent, route: { ...route, route: "translation" }, context, lookup: null, decision }), preferRich: true };
    return response({ text, intent, route, context, lookup: null, decision });
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
  try { lookup = await lexicalLookup({
    text,
    pageUrl,
    contextText: context.text,
    sourceLanguage: intent.sourceLanguage,
    targetLanguage: "zh-CN"
  }); } catch {
    return response({ text, intent, context, lookup: null, decision: null, route: { route: "translation", reason: "dictionary-unavailable", depth: requestedDepth, explanationAllowed: true } });
  }
  const decision = assessLookup(lookup, { contextText: context.text });
  const route = { ...chooseSelectionRoute({
    intent,
    decision,
    depth: requestedDepth,
    text,
    explainRequested: input.explainRequested === true
  }) };

  if (!["local", "translation"].includes(route.route) && input.explainRequested !== true) { route.route = "translation"; route.reason = "dictionary-miss"; }
  return { ...response({ text, intent, route, context, lookup, decision }), preferRich: storedConfig.dictionaryEnabled === true && route.route === "translation" && intent.kind === "lexical" };
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
