import { normalizeSourceText } from "./text.js";

const MARKERS = /⟦TF:(\d+):(S|E)⟧/g;
const TAGS = new Set(["a", "strong", "em", "code", "kbd", "mark"]);
const PROTECTED_TAGS = new Set(["code", "kbd"]);

/**
 * An auxiliary, deterministic source contract; NOT a Provider request, an HTML
 * parser or a translation cache key. Keeping providerText untouched preserves
 * the existing exact-cache protocol until a later, separately gated wave.
 *
 * @param {{text?: unknown, rich?: boolean, descriptors?: unknown[]}} source
 */
export function createTranslationUnitV1(source) {
  const providerText = String(source?.text ?? "");
  const rich = source?.rich === true;
  const inputDescriptors = source?.descriptors ?? [];
  if (!Array.isArray(inputDescriptors) || (!rich && inputDescriptors.length)) {
    throw new TypeError("invalid translation source descriptors");
  }

  const descriptors = inputDescriptors.map((descriptor) => {
    const tag = descriptor?.tag;
    if (!TAGS.has(tag)) throw new TypeError("unsupported source descriptor");
    const copy = { tag };
    if (PROTECTED_TAGS.has(tag)) {
      if (typeof descriptor.protectedText !== "string") {
        throw new TypeError("missing protected source text");
      }
      copy.protectedText = descriptor.protectedText;
    }
    if (tag === "a") {
      if (typeof descriptor.href === "string") copy.href = descriptor.href;
      if (typeof descriptor.title === "string") copy.title = descriptor.title;
    }
    return Object.freeze(copy);
  });

  let semanticText;
  let protectedSpans = [];
  let layout = [];
  if (!rich) {
    // Literal marker-looking text in ordinary user content stays literal.
    semanticText = normalizeSourceText(providerText);
  } else {
    if (!descriptors.length) throw new TypeError("structured text has no descriptors");
    const stack = [];
    const opened = new Set();
    const closed = new Set();
    const raw = [];
    const ranges = [];
    let rawOffset = 0;
    let lastIndex = 0;
    for (const match of providerText.matchAll(MARKERS)) {
      const chunk = providerText.slice(lastIndex, match.index);
      if (chunk.includes("⟦TF:")) throw new TypeError("ambiguous source marker");
      raw.push(chunk);
      rawOffset += chunk.length;

      const id = Number(match[1]);
      const kind = match[2];
      if (!Number.isSafeInteger(id) || !descriptors[id]) throw new TypeError("unknown source marker");
      layout.push(Object.freeze([rawOffset, id, kind]));
      if (kind === "S") {
        if (opened.has(id)) throw new TypeError("duplicate source marker");
        opened.add(id);
        stack.push({ id, start: rawOffset });
      } else {
        const top = stack.pop();
        if (!top || top.id !== id || closed.has(id)) throw new TypeError("unbalanced source marker");
        closed.add(id);
        if (PROTECTED_TAGS.has(descriptors[id].tag)) {
          ranges.push({ descriptorId: id, tag: descriptors[id].tag, start: top.start, end: rawOffset });
        }
      }
      lastIndex = match.index + match[0].length;
    }
    const tail = providerText.slice(lastIndex);
    if (tail.includes("⟦TF:") || stack.length || opened.size !== descriptors.length || closed.size !== descriptors.length) {
      throw new TypeError("incomplete source markers");
    }
    raw.push(tail);
    const semanticRaw = raw.join("");
    semanticText = normalizeSourceText(semanticRaw);
    protectedSpans = ranges.map(({ descriptorId, tag, start, end }) => {
      const text = descriptors[descriptorId].protectedText;
      if (normalizeSourceText(semanticRaw.slice(start, end)) !== normalizeSourceText(text)) {
        throw new TypeError("protected source text mismatch");
      }
      // The sentinel accounts for whitespace immediately before an inline tag,
      // which trim() would otherwise remove from a prefix-only calculation.
      const offset = (position) => normalizeSourceText(`${semanticRaw.slice(0, position)}\uE000`).length - 1;
      return Object.freeze({ descriptorId, tag, start: offset(start), end: offset(end), text });
    }).sort((a, b) => a.start - b.start || a.descriptorId - b.descriptorId);
  }

  const unit = {
    version: 1,
    semanticText,
    providerText,
    format: rich ? "structured" : "plain",
    descriptors: Object.freeze(descriptors),
    protectedSpans: Object.freeze(protectedSpans),
    // Comparison signatures, deliberately NOT persisted IndexedDB keys.
    semanticIdentity: JSON.stringify(["tf.semantic.v1", semanticText]),
    formatIdentity: JSON.stringify(["tf.format.v1", rich ? "structured" : "plain", layout, descriptors])
  };
  return Object.freeze(unit);
}
