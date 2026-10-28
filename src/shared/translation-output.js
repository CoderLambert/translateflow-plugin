// Pure content validation shared by Provider parsers and persisted cache reads.
// Compare syntax only; never repair a result by stripping suspected characters.
const normalizeQuotes = text => text.replace(/[“”]/gu, '"').replace(/：/gu, ':');
const syntax = [
  /```(?:json)?/giu,
  /"(?:translations|segments|id|text)"\s*:/gu,
  /⟦TF:/gu,
  /"\s*\}\s*,\s*\{/gu,
  /"\s*[}\]]\s*[}\]](?:\s*[}\]])*/gu,
];

function introducedSyntax(text, source, pattern) {
  const available = new Map();
  for (const match of source.matchAll(pattern)) {
    const key = match[0].replace(/\s/gu, '');
    available.set(key, (available.get(key) || 0) + 1);
  }
  for (const match of text.matchAll(pattern)) {
    const key = match[0].replace(/\s/gu, '');
    const remaining = available.get(key) || 0;
    if (!remaining) return true;
    available.set(key, remaining - 1);
  }
  return false;
}

export function hasUnexpectedTranslationEnvelope(translation, sourceText) {
  const text = normalizeQuotes(translation), source = normalizeQuotes(sourceText);
  if (syntax.some(pattern => introducedSyntax(text, source, pattern))) return true;
  // A completed sentence followed only by three or more quoted numeric IDs is
  // a known local-model spill. Ordinary numbers, quotes, lists and JSON remain
  // data; numerical source material is deliberately excluded from this rule.
  const prose = text.replace(/⟦TF:\d+:[SE]⟧/gu, '');
  const sourceProse = source.replace(/⟦TF:\d+:[SE]⟧/gu, '');
  return !/\d/u.test(sourceProse) &&
    /[.!?。！？]\s*(?:"\d+"\s*[,、]\s*){2,}"\d+"\s*$/u.test(prose);
}
