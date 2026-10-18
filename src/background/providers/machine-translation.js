import { translationParts } from "../../shared/browser-language.js";
import { MACHINE_ENGINE, machineError, machineProvider, normalizeProtectedIds } from "../../shared/machine-translation.js";
import { requestMachineTexts } from "./machine-translation-transport.js";

// Reuse the existing local structure parser; no provider receives TF markers,
// link destinations, code/kbd content, dictionary material or AI credentials.
export async function translateMachineBatch(segments, config, { signal } = {}) {
  if (config?.engine !== MACHINE_ENGINE) throw machineError("MT_CONFIG");
  const provider = machineProvider(config.provider), ids = new Set();
  if (!Array.isArray(segments) || segments.length > 128) throw machineError("MT_INPUT");
  const requests = [], plans = [];
  let total = 0;
  for (const segment of segments) {
    if (signal?.aborted) throw machineError("CANCELLED");
    if (typeof segment?.text !== "string" || !segment.id || ids.has(String(segment.id))) throw machineError("MT_INPUT");
    ids.add(String(segment.id)); total += segment.text.length;
    if (total > 100000) throw machineError("MT_INPUT");
    const protectedIds = normalizeProtectedIds(segment.protectedIds);
    // Never infer trusted structure from user-authored marker-looking text.
    // Only the Page encoder may explicitly request the internal rich protocol.
    const format = segment.format ?? "plain";
    if (!["plain", "tf-markers"].includes(format) ||
        (format !== "tf-markers" && (protectedIds.length || /⟦TF:/u.test(segment.text))) ||
        (format === "tf-markers" && !/⟦TF:\d+:[SE]⟧/u.test(segment.text))) throw machineError("MT_STRUCTURE");
    let parts;
    try { parts = translationParts(segment.text, protectedIds); } catch { throw machineError("MT_STRUCTURE"); }
    const markerIds = new Set([...segment.text.matchAll(/⟦TF:(\d+):S⟧/gu)].map(match => Number(match[1])));
    if (protectedIds.some(id => !markerIds.has(id))) throw machineError("MT_STRUCTURE");
    const pieces = [];
    for (const part of parts) {
      if (part.protected || !part.text.trim() || config.sourceLanguage === config.targetLanguage) { pieces.push({ literal: part.text }); continue; }
      for (const chunk of splitMachineText(part.text)) {
        const match = /^(\s*)([\s\S]*?)(\s*)$/u.exec(chunk);
        if (!match[2]) { pieces.push({ literal: chunk }); continue; }
        pieces.push({ index: requests.length, before: match[1], after: match[3] }); requests.push(match[2]);
      }
    }
    plans.push({ id: String(segment.id), pieces });
  }
  const answers = [];
  for (let start = 0; start < requests.length; start += provider.batchSize) {
    if (signal?.aborted) throw machineError("CANCELLED");
    const batch = requests.slice(start, start + provider.batchSize);
    answers.push(...await requestMachineTexts(config, batch, { signal }));
  }
  if (signal?.aborted) throw machineError("CANCELLED");
  return plans.map(plan => ({ id: plan.id, text: plan.pieces.map(piece => piece.literal ?? `${piece.before}${answers[piece.index]}${piece.after}`).join("") }));
}

export function splitMachineText(text, maximum = 1000) {
  if (typeof text !== "string" || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 10000) throw machineError("MT_INPUT");
  // Native grapheme boundaries avoid splitting emoji ZWJ sequences and
  // combining marks; requests still honor the existing code-point limit.
  const graphemes = [...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(text)].map(item => item.segment);
  const sizes = graphemes.map(item => [...item].length), chunks = [];
  if (sizes.some(size => size > maximum)) throw machineError("MT_INPUT");
  for (let start = 0; start < graphemes.length;) {
    let end = start, chars = 0;
    while (end < graphemes.length && chars + sizes[end] <= maximum) chars += sizes[end++];
    if (end < graphemes.length) {
      let trailing = chars;
      for (let cut = end; cut > start && trailing > maximum / 2; cut--) {
        if (/[\s。！？.!?;]/u.test(graphemes[cut - 1])) { end = cut; break; }
        trailing -= sizes[cut - 1];
      }
    }
    chunks.push(graphemes.slice(start, end).join(""));
    start = end;
  }
  return chunks;
}
