#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function parseOmwTab(text, { lemmaRelation }) {
  const bySynset = new Map();
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const fields = rawLine.split("\t");
    if (fields.length < 3 || fields[1] !== lemmaRelation) continue;
    const synset = fields[0];
    const lemma = fields.slice(2).join("\t").trim();
    if (!lemma) continue;
    if (!bySynset.has(synset)) bySynset.set(synset, []);
    bySynset.get(synset).push(lemma);
  }
  return bySynset;
}

export function buildEnglishLemmaIndex(bySynset) {
  const index = new Map();
  for (const [synset, lemmas] of bySynset) {
    for (const lemma of lemmas) {
      const key = normalizeEnglishLemma(lemma);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(synset);
    }
  }
  return index;
}

export function auditCorpus({ englishTab, chineseTab, corpus }) {
  const englishBySynset = parseOmwTab(englishTab, { lemmaRelation: "lemma" });
  const chineseBySynset = parseOmwTab(chineseTab, { lemmaRelation: "cmn:lemma" });
  const englishIndex = buildEnglishLemmaIndex(englishBySynset);

  const cases = (corpus?.cases || []).map((item) => {
    const term = String(item.term || "");
    const synsets = [...new Set(englishIndex.get(normalizeEnglishLemma(term)) || [])];
    const mapped = synsets.filter((synset) => chineseBySynset.has(synset));
    return {
      id: item.id,
      term,
      category: item.category,
      wordnetSynsetCount: synsets.length,
      chineseMappedSynsetCount: mapped.length,
      coverage: synsets.length === 0 ? "wordnet-miss" : (mapped.length === 0 ? "chinese-miss" : (mapped.length === synsets.length ? "full" : "partial")),
      senses: synsets.map((synset) => ({
        synset,
        chinese: chineseBySynset.get(synset) || []
      }))
    };
  });

  const groups = {};
  for (const item of cases) {
    const group = groups[item.category] ||= { cases: 0, wordnetTermHits: 0, chineseMappedTerms: 0, wordnetSynsets: 0, chineseMappedSynsets: 0 };
    group.cases += 1;
    if (item.wordnetSynsetCount) group.wordnetTermHits += 1;
    if (item.chineseMappedSynsetCount) group.chineseMappedTerms += 1;
    group.wordnetSynsets += item.wordnetSynsetCount;
    group.chineseMappedSynsets += item.chineseMappedSynsetCount;
  }

  return { version: 1, groups, cases };
}

export function normalizeEnglishLemma(value) {
  return String(value || "").trim().toLowerCase().replaceAll("_", " ").replace(/\s+/g, " ");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.eng || !args.cmn || !args.corpus) {
    throw new Error("Usage: node scripts/audit-lexicon-sources.mjs --eng <wn-data-eng.tab> --cmn <wn-data-cmn.tab> --corpus <selection-v2-quality.json>");
  }
  const [englishTab, chineseTab, corpusText] = await Promise.all([
    readFile(resolve(args.eng), "utf8"),
    readFile(resolve(args.cmn), "utf8"),
    readFile(resolve(args.corpus), "utf8")
  ]);
  process.stdout.write(JSON.stringify(auditCorpus({
    englishTab,
    chineseTab,
    corpus: JSON.parse(corpusText)
  }), null, 2) + "\n");
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    result[argv[i].slice(2)] = argv[i + 1] || "";
    i += 1;
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
