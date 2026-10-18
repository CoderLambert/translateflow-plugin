import { normalizeLexicalExactKey } from "../../../shared/lexical.js";
import {
  MDICT_IMPORT_ERROR,
  mdictFail,
  requireMdictAtMost
} from "./mdict-contract.js";
import { decodeMdictBlock } from "./mdict-block-codec.js";
import {
  decodeRichKeyBlock,
  readSourceRange
} from "./mdict-rich-index.js";
import {
  RICH_MDICT_IMPORT_LIMITS,
  validateRichMdictIndex
} from "./mdict-rich-validation.js";
import { normalizeRichMdictLookupKey } from "./mdict-rich-metadata.js";
import {
  createRichMdictLookupBudget,
  meterRichMdictRangeSource,
  RICH_MDICT_LOOKUP_BUDGETS
} from "./mdict-rich-query-budget.js";
import {
  decodeRichMdictRecordText,
  toSafeRichMdictPlainText,
  validateRichMdictAliasTarget
} from "./mdict-rich-record-text.js";

const MAX_ALIAS_HOPS = 8;
const LINK_PREFIX = "@@@LINK=";
export { RICH_MDICT_LOOKUP_BUDGETS } from "./mdict-rich-query-budget.js";

export async function lookupRichMdict({
  source,
  index,
  text,
  limits = RICH_MDICT_IMPORT_LIMITS,
  decompressionStreamFactory,
  onMetrics,
  signal
} = {}) {
  throwIfAborted(signal);
  validateRangeSource(source, limits);
  validateRichMdictIndex(index, { sourceSize: source.size, limits });
  const query = normalizeLexicalExactKey(text);
  if (!query || /[\u0000-\u001F\u007F]/u.test(query)) {
    mdictFail(MDICT_IMPORT_ERROR.UNSAFE_CONTENT, "Rich MDict lookup text is invalid.");
  }
  requireMdictAtMost(
    new TextEncoder().encode(query).byteLength,
    limits.headwordBytes,
    "MDict lookup key bytes"
  );

  const budget = createRichMdictLookupBudget(onMetrics);
  const rangeSource = meterRichMdictRangeSource(source, budget);
  const requestedKey = query;
  const keyCache = new Map(), blockCache = new Map(), spanCache = new Map(), matchCache = new Map();
  const terminals = new Map();
  let aggregateSourceRecordBytes = 0, aggregateDecodedTextBytes = 0, aliasCycleBranches = 0;
  const context = { source: rangeSource, index, limits, decompressionStreamFactory, budget, signal, keyCache, blockCache };
  try {
    const roots = await matches(query);
    if (!roots.length) return { found: false, requestedKey, records: [] };
    await visitAll(roots, new Set(), 0, null);
    if (!terminals.size) mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict alias loop has no valid terminal record.");
    const records = [...terminals.values()].sort((left, right) => left.recordOffset - right.recordOffset);
    return { found: true, requestedKey, ...records[0], records, aggregateSourceRecordBytes, aggregateDecodedTextBytes,
      ...(aliasCycleBranches ? { diagnostics: { aliasCycleBranches } } : {}) };
  } finally { budget.report(); }

  async function matches(text) {
    const key = normalizeLexicalExactKey(text);
    if (!matchCache.has(key)) matchCache.set(key, await findMatchingEntries({ ...context, text }));
    return matchCache.get(key);
  }

  async function visitAll(entries, path, hops, aliasTarget) {
    // Charge the complete next branch before processing any of its candidates.
    budget.consumeSpanVisits(entries.length);
    for (const match of entries) {
      throwIfAborted(signal);
      if (path.has(match.recordOffset)) { aliasCycleBranches += 1; continue; }
      let decoded = spanCache.get(match.recordOffset);
      if (!decoded) {
        const bytes = await readRecord({ ...context, start: match.recordOffset, end: match.recordEnd });
        throwIfAborted(signal);
        const rawRecord = decodeRichMdictRecordText(bytes, index.header.encoding, match.displayForm, limits);
        decoded = { rawRecord, sourceRecordBytes: bytes.byteLength,
          decodedTextBytes: new TextEncoder().encode(rawRecord).byteLength };
        spanCache.set(match.recordOffset, decoded);
      }
      if (decoded.rawRecord.startsWith(LINK_PREFIX)) {
        const target = decoded.rawRecord.slice(LINK_PREFIX.length).trim();
        validateRichMdictAliasTarget(target, limits);
        if (hops === MAX_ALIAS_HOPS) mdictFail(MDICT_IMPORT_ERROR.LIMIT, "MDict alias chain exceeds the safety limit.");
        budget.metrics.aliasHops = Math.max(budget.metrics.aliasHops, hops + 1);
        const targets = await matches(target);
        if (!targets.length) mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict alias target is missing.");
        const nextPath = new Set(path); nextPath.add(match.recordOffset);
        await visitAll(targets, nextPath, hops + 1, aliasTarget ?? target);
        continue;
      }
      if (terminals.has(match.recordOffset)) continue;
      aggregateSourceRecordBytes += decoded.sourceRecordBytes;
      aggregateDecodedTextBytes += decoded.decodedTextBytes;
      requireMdictAtMost(aggregateSourceRecordBytes, limits.entryBytes, "MDict aggregate record bytes");
      requireMdictAtMost(aggregateDecodedTextBytes, limits.expandedTextBytes, "MDict aggregate decoded text bytes");
      terminals.set(match.recordOffset, { ...decoded, displayForm: match.displayForm, recordOffset: match.recordOffset,
        recordEnd: match.recordEnd, safeTextFallback: toSafeRichMdictPlainText(decoded.rawRecord, index.header, limits.expandedTextBytes), aliasTarget });
    }
  }
}

async function findMatchingEntries({
  source,
  index,
  text,
  limits,
  decompressionStreamFactory,
  budget,
  signal,
  keyCache
}) {
  throwIfAborted(signal);
  const normalizedQuery = comparisonKey(text, index.header);
  const rangeQuery = lookupSortKey(text, index.header);
  const candidates = [];
  for (let blockIndex = 0; blockIndex < index.keyBlocks.length; blockIndex += 1) {
    budget.consumeKeyScans();
    const block = index.keyBlocks[blockIndex];
    if (
      rangeQuery >= block.lookupMinKey &&
      rangeQuery <= block.lookupMaxKey
    ) {
      candidates.push({ blockIndex, descriptor: block });
    }
  }
  const uncached = candidates.filter(({ blockIndex }) => !keyCache.has(blockIndex));
  budget.checkCandidatePlan(uncached.map((candidate) => candidate.descriptor));
  budget.addCandidateCount(uncached.length);
  const exact = [], folded = [];
  let exactCount = 0, foldedCount = 0;
  for (const { blockIndex } of candidates) {
    const entries = await cachedKeys({ source, index, blockIndex, limits, decompressionStreamFactory, budget, signal, keyCache });
    let nextRecordOffset;
    const nextOffsets = new Array(entries.length);
    for (let position = entries.length - 1; position >= 0; position -= 1) {
      budget.consumeKeyScans();
      if (entries[position + 1]?.recordOffset > entries[position].recordOffset) nextRecordOffset = entries[position + 1].recordOffset;
      nextOffsets[position] = nextRecordOffset;
    }
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      if ((entryIndex & 0x3ff) === 0) throwIfAborted(signal);
      budget.consumeKeyScans();
      const entry = entries[entryIndex];
      if (comparisonKey(entry.displayForm, index.header) !== normalizedQuery) continue;
      const match = { recordOffset: entry.recordOffset, displayForm: entry.displayForm, blockIndex, entryIndex,
        nextRecordOffset: nextOffsets[entryIndex] };
      foldedCount += 1;
      if (folded.length <= RICH_MDICT_LOOKUP_BUDGETS.matchedEntries) folded.push(match);
      if (normalizeLexicalExactKey(entry.displayForm) === normalizeLexicalExactKey(text)) {
        exactCount += 1;
        if (exact.length <= RICH_MDICT_LOOKUP_BUDGETS.matchedEntries) exact.push(match);
      }
    }
  }
  budget.checkMatches(exactCount || foldedCount);
  const chosen = exactCount ? exact : folded;
  const seenOffsets = new Set(), matches = [];
  for (const selected of chosen) {
    if (seenOffsets.has(selected.recordOffset)) continue;
    seenOffsets.add(selected.recordOffset);
    const recordEnd = await findNextRecordOffset({ source, index, selected, limits, decompressionStreamFactory, budget, signal, keyCache });
    throwIfAborted(signal);
    if (recordEnd <= selected.recordOffset) mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict record boundary is empty or reversed.");
    matches.push({ ...selected, recordEnd });
  }
  return matches;
}

async function cachedKeys(options) {
  const { keyCache, blockIndex } = options;
  if (!keyCache.has(blockIndex)) keyCache.set(blockIndex, await decodeRichKeyBlock(options));
  return keyCache.get(blockIndex);
}

async function findNextRecordOffset({
  source,
  index,
  selected,
  limits,
  decompressionStreamFactory,
  budget,
  signal,
  keyCache
}) {
  throwIfAborted(signal);
  const start = selected.recordOffset;
  if (selected.nextRecordOffset > start) return selected.nextRecordOffset;
  for (
    let blockIndex = selected.blockIndex + 1;
    blockIndex < index.keyBlocks.length;
    blockIndex += 1
  ) {
    throwIfAborted(signal);
    budget.consumeKeyScans();
    const descriptor = index.keyBlocks[blockIndex];
    if (descriptor.lastRecordOffset <= start) continue;
    if (descriptor.firstRecordOffset > start) return descriptor.firstRecordOffset;
    const entries = await cachedKeys({ source, index, blockIndex, limits, decompressionStreamFactory, budget, signal, keyCache });
    throwIfAborted(signal);
    for (const entry of entries) {
      budget.consumeKeyScans();
      throwIfAborted(signal);
      if (entry.recordOffset > start) return entry.recordOffset;
    }
  }
  return index.totalRecordBytes;
}

async function readRecord({
  source,
  index,
  start,
  end,
  limits,
  decompressionStreamFactory,
  budget,
  signal,
  blockCache
}) {
  throwIfAborted(signal);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= end ||
    end > index.totalRecordBytes
  ) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict record range is invalid.");
  }
  const length = end - start;
  requireMdictAtMost(length, limits.entryBytes, "MDict record bytes");
  let blockIndex = findRecordBlock(index.recordBlocks, start);
  if (blockIndex < 0) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict record block is missing.");
  }
  const chunks = [];
  let totalBytes = 0;
  while (blockIndex < index.recordBlocks.length) {
    throwIfAborted(signal);
    const descriptor = index.recordBlocks[blockIndex];
    const overlapStart = Math.max(start, descriptor.uncompressedOffset);
    const overlapEnd = Math.min(end, descriptor.uncompressedOffset + descriptor.decompressedBytes);
    if (overlapStart < overlapEnd) {
      let decoded = blockCache.get(blockIndex);
      if (!decoded) {
        budget.consumeRecordBlock(descriptor);
        const compressed = await readSourceRange(source, descriptor.dataOffset, descriptor.compressedBytes, signal);
        throwIfAborted(signal);
        const block = await decodeMdictBlock({ input: compressed, expectedBytes: descriptor.decompressedBytes,
          limits, label: "MDict record block", decompressionStreamFactory, signal });
        throwIfAborted(signal);
        decoded = block.bytes;
        blockCache.set(blockIndex, decoded);
      }
      const from = overlapStart - descriptor.uncompressedOffset;
      const to = overlapEnd - descriptor.uncompressedOffset;
      const chunk = decoded.subarray(from, to);
      totalBytes += chunk.byteLength;
      requireMdictAtMost(totalBytes, limits.entryBytes, "MDict record bytes");
      chunks.push(chunk);
    }
    if (overlapEnd === end) break;
    blockIndex += 1;
  }
  if (totalBytes !== length) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict record block ranges are incomplete.");
  }
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    throwIfAborted(signal);
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException("MDict lookup cancelled.", "AbortError");
}

function findRecordBlock(blocks, offset) {
  let low = 0;
  let high = blocks.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const block = blocks[middle];
    const end = block.uncompressedOffset + block.decompressedBytes;
    if (offset < block.uncompressedOffset) high = middle - 1;
    else if (offset >= end) low = middle + 1;
    else return middle;
  }
  return -1;
}

function comparisonKey(value, header) {
  return normalizeRichMdictLookupKey(
    normalizeLexicalExactKey(value),
    header
  );
}

function lookupSortKey(value, header) {
  return normalizeRichMdictLookupKey(normalizeLexicalExactKey(value), header);
}

function validateRangeSource(source, limits) {
  if (
    !source ||
    !Number.isSafeInteger(source.size) ||
    typeof source.read !== "function"
  ) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict range source is invalid.");
  }
  requireMdictAtMost(source.size, limits.fileBytes, "MDX bytes");
}
